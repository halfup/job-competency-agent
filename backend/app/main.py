from __future__ import annotations
from pathlib import Path
from datetime import datetime, timedelta
import uuid
from typing import Any, Optional
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import ROOT_DIR, DATA_DIR, settings
from .database import Base, engine, get_db, SessionLocal
from .models import AgentConversation, AssessmentAnswer, AssessmentSession, DrillAttempt, DrillSession, Evidence, JobAnalysis, KnowledgeDocument, ProfileEvent, RecordingReview, Resume, RolePack, UserSetting
from .seed import DEMO_USER_ID, seed
from .services.resume_service import extract_text_from_file, parse_resume_text
from .services.job_service import analyze_job
from .services.assessment_service import base_targets, build_question, extract_evidence, followup_question, rubric_reason, rubric_score
from .services.ai_service import analyze_job_with_model, extract_evidence_with_model, growth_agent_with_model
from .services.product_services import agent_fallback_reply, build_question_graph, create_drill_questions, evaluate_drill_answer, split_text_chunks, analyze_recording_text, topic_competency
from .services.retrieval_service import delete_document_index, embedding_available, hybrid_search, index_document, reindex_all, rerank_available
from .services.asr_service import SpeechServiceError, normalize_audio_to_pcm16k, speech_available, transcribe_pcm16k

app = FastAPI(title="职到 AI API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed(db)


def ok(data: Any) -> dict[str, Any]:
    return {"ok": True, "data": data}


@app.get("/api/health")
def health() -> dict[str, Any]:
    return ok({
        "service": "zhidao-ai-backend",
        "status": "ok",
        "database": "sqlite" if settings.database_url.startswith("sqlite") else "sql",
        "model_configured": bool(settings.model_base_url and settings.model_api_key and settings.model_name),
        "embedding_configured": embedding_available(),
        "rerank_configured": rerank_available(),
        "speech_configured": speech_available(),
    })


@app.get("/api/roles")
def roles(db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = db.execute(select(RolePack).order_by(RolePack.id)).scalars().all()
    return ok([r.payload for r in rows])


@app.get("/api/roles/{role_id}")
def role(role_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(RolePack, role_id)
    if not row:
        raise HTTPException(404, "role_not_found")
    return ok(row.payload)


@app.get("/api/dashboard")
def dashboard(role_id: str = Query("java-backend"), db: Session = Depends(get_db)) -> dict[str, Any]:
    role = db.get(RolePack, role_id)
    if not role:
        raise HTTPException(404, "role_not_found")
    payload = role.payload
    comps = payload.get("competencies", [])
    score = round(sum(float(c.get("score", 0)) * float(c.get("weight", 0)) for c in comps) / max(1, sum(float(c.get("weight", 0)) for c in comps)))
    pending = sum(1 for c in comps if c.get("status") != "verified")
    event_count = db.scalar(select(func.count()).select_from(ProfileEvent).where(ProfileEvent.user_id == DEMO_USER_ID)) or 0
    resume_count = db.scalar(select(func.count()).select_from(Resume).where(Resume.user_id == DEMO_USER_ID)) or 0
    chunks = db.scalar(select(func.coalesce(func.sum(KnowledgeDocument.chunk_count), 0)).where(KnowledgeDocument.user_id == DEMO_USER_ID)) or 0
    return ok({
        "role_id": role_id,
        "role_name": role.name,
        "match_score": score,
        "coverage": 81,
        "pending_competencies": pending,
        "weekly_training_count": 4,
        "profile_event_count": event_count,
        "resume_count": resume_count,
        "knowledge_chunks": chunks,
        "next_action": {"title":"Redis 一致性专项训练","detail":"补齐失败补偿、高并发竞态和一致性边界证据。"},
        "competencies": comps,
    })


class SettingsPatch(BaseModel):
    evidenceStrict: Optional[bool] = None
    autoProfile: Optional[bool] = None
    hints: Optional[bool] = None


class ResumeCreate(BaseModel):
    name: str
    source_type: str = "text"
    raw_text: str = ""
    structured_json: Optional[dict[str, Any]] = None


class ResumePatch(BaseModel):
    name: Optional[str] = None
    raw_text: Optional[str] = None
    source_type: Optional[str] = None
    structured_json: Optional[dict[str, Any]] = None


class JobAnalyzeRequest(BaseModel):
    role_id: str
    company: str = ""
    role_name: str = ""
    raw_jd: str
    resume_id: Optional[str] = None
    use_resume: bool = True


class AssessmentCreateRequest(BaseModel):
    role_id: str
    source_mode: str = "resume"
    resume_id: Optional[str] = None
    job_analysis_id: Optional[str] = None
    mode: str = "evaluation"


class AssessmentAnswerRequest(BaseModel):
    question_id: str
    text: str


class AssessmentSkipRequest(BaseModel):
    question_id: str


class AssessmentFinishRequest(BaseModel):
    reason: str = "completed"


class DrillCreateRequest(BaseModel):
    role_id: str = "java-backend"
    topic: str = "sql"
    competency_id: Optional[str] = None
    source: str = "manual"
    source_ref_id: Optional[str] = None
    count: int = 5


class DrillAttemptRequest(BaseModel):
    question_index: int
    text: str


class DrillFinishRequest(BaseModel):
    reason: str = "completed"


class KnowledgeCreateRequest(BaseModel):
    title: str
    source_type: str = "text"
    raw_text: str
    category: str = "核心知识"
    meta: str = ""
    desc: str = ""
    used: str = "专项训练 / 面试准备 / 成长 Agent"


class KnowledgePatchRequest(BaseModel):
    title: Optional[str] = None
    raw_text: Optional[str] = None
    category: Optional[str] = None
    meta: Optional[str] = None
    desc: Optional[str] = None
    used: Optional[str] = None


class RecordingCreateRequest(BaseModel):
    mode: str = "dialogue"
    company: str = ""
    role_name: str = ""
    raw_text: str = ""


class RecordingAnalyzeRequest(BaseModel):
    raw_text: Optional[str] = None


class RecordingSyncRequest(BaseModel):
    role_id: str = "java-backend"


class AgentConversationCreateRequest(BaseModel):
    title: str = "新对话"


class AgentMessageRequest(BaseModel):
    role_id: str = "java-backend"
    text: str


class AgentPlanActionRequest(BaseModel):
    action_id: str
    status: str = "done"


def settings_payload(row: UserSetting, db: Session) -> dict[str, Any]:
    resume = db.execute(select(Resume).where(Resume.user_id == DEMO_USER_ID, Resume.is_active == True).order_by(Resume.updated_at.desc())).scalars().first()
    docs = db.scalar(select(func.count()).select_from(KnowledgeDocument).where(KnowledgeDocument.user_id == DEMO_USER_ID)) or 0
    chunks = db.scalar(select(func.coalesce(func.sum(KnowledgeDocument.chunk_count), 0)).where(KnowledgeDocument.user_id == DEMO_USER_ID)) or 0
    events = db.scalar(select(func.count()).select_from(ProfileEvent).where(ProfileEvent.user_id == DEMO_USER_ID)) or 0
    return {
        "preferences": {"evidenceStrict": row.evidence_strict, "autoProfile": row.auto_profile, "hints": row.hints},
        "capabilities": [
            {"id":"jd","name":"岗位与 JD 理解","enabled":True},
            {"id":"evidence","name":"证据抽取与动态追问","enabled":True},
            {"id":"score","name":"可审计评分","enabled":True},
            {"id":"rag","name":"知识库检索","enabled":True},
            {"id":"embedding","name":"向量召回","enabled":embedding_available()},
            {"id":"rerank","name":"证据重排","enabled":rerank_available()},
        ],
        "assets": {"resume_name": resume.name if resume else None, "knowledge_documents": docs, "knowledge_chunks": chunks, "profile_events": events},
        "workspace": {"role_templates": 3, "current_role": "Java 后端开发工程师", "role_pack_version":"v1.0", "evidence_protocol": True, "profile_sync":"实时"},
        "model": {"configured": bool(settings.model_base_url and settings.model_api_key and settings.model_name), "provider": settings.model_provider},
        "retrieval": {
            "embedding_configured": embedding_available(),
            "embedding_model": settings.embedding_model or None,
            "rerank_configured": rerank_available(),
            "rerank_model": settings.rerank_model or None,
            "speech_configured": bool(settings.speech_base_url and settings.speech_app_id),
        },
    }


@app.get("/api/settings")
def get_settings(db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.execute(select(UserSetting).where(UserSetting.user_id == DEMO_USER_ID)).scalar_one()
    return ok(settings_payload(row, db))


@app.patch("/api/settings")
def patch_settings(body: SettingsPatch, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.execute(select(UserSetting).where(UserSetting.user_id == DEMO_USER_ID)).scalar_one()
    if body.evidenceStrict is not None:
        row.evidence_strict = body.evidenceStrict
    if body.autoProfile is not None:
        row.auto_profile = body.autoProfile
    if body.hints is not None:
        row.hints = body.hints
    db.commit()
    db.refresh(row)
    return ok(settings_payload(row, db))


def resume_payload(row: Resume) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "source_type": row.source_type,
        "source_file_path": row.source_file_path,
        "raw_text": row.raw_text,
        "structured_json": row.structured_json or {},
        "parse_version": row.parse_version,
        "is_active": row.is_active,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def activate_resume(db: Session, resume_id: str) -> Resume:
    rows = db.execute(select(Resume).where(Resume.user_id == DEMO_USER_ID)).scalars().all()
    target = None
    for row in rows:
        row.is_active = row.id == resume_id
        if row.id == resume_id:
            target = row
    if not target:
        raise HTTPException(404, "resume_not_found")
    db.commit()
    db.refresh(target)
    return target


@app.get("/api/resumes")
def list_resumes(db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = db.execute(select(Resume).where(Resume.user_id == DEMO_USER_ID).order_by(Resume.updated_at.desc())).scalars().all()
    return ok([resume_payload(x) for x in rows])


@app.get("/api/resumes/{resume_id}")
def get_resume(resume_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(Resume, resume_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "resume_not_found")
    return ok(resume_payload(row))


@app.post("/api/resumes")
def create_resume(body: ResumeCreate, db: Session = Depends(get_db)) -> dict[str, Any]:
    rid = f"resume-{uuid.uuid4().hex[:12]}"
    structured = body.structured_json or parse_resume_text(body.raw_text)
    for old in db.execute(select(Resume).where(Resume.user_id == DEMO_USER_ID)).scalars().all():
        old.is_active = False
    row = Resume(
        id=rid,
        user_id=DEMO_USER_ID,
        name=body.name.strip() or "未命名简历",
        source_type=body.source_type,
        raw_text=body.raw_text,
        structured_json=structured,
        parse_version="rules-v1",
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ok(resume_payload(row))


@app.patch("/api/resumes/{resume_id}")
def patch_resume(resume_id: str, body: ResumePatch, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(Resume, resume_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "resume_not_found")
    if body.name is not None:
        row.name = body.name.strip() or row.name
    if body.raw_text is not None:
        row.raw_text = body.raw_text
    if body.source_type is not None:
        row.source_type = body.source_type
    if body.structured_json is not None:
        row.structured_json = body.structured_json
    db.commit()
    db.refresh(row)
    return ok(resume_payload(row))


@app.post("/api/resumes/{resume_id}/parse")
def parse_resume(resume_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(Resume, resume_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "resume_not_found")
    raw_text = row.raw_text
    if not raw_text and row.source_file_path:
        try:
            raw_text = extract_text_from_file(Path(row.source_file_path))
        except Exception as exc:
            raise HTTPException(422, str(exc))
        row.raw_text = raw_text
    if not raw_text.strip():
        raise HTTPException(422, "resume_text_empty")
    row.structured_json = parse_resume_text(raw_text)
    row.parse_version = "rules-v1"
    db.commit()
    db.refresh(row)
    return ok(resume_payload(row))


@app.post("/api/resumes/{resume_id}/activate")
def set_active_resume(resume_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return ok(resume_payload(activate_resume(db, resume_id)))


@app.delete("/api/resumes/{resume_id}")
def delete_resume(resume_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(Resume, resume_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "resume_not_found")
    was_active = row.is_active
    file_path = row.source_file_path
    db.delete(row)
    db.commit()
    if file_path:
        try:
            Path(file_path).unlink(missing_ok=True)
        except OSError:
            pass
    if was_active:
        replacement = db.execute(select(Resume).where(Resume.user_id == DEMO_USER_ID).order_by(Resume.updated_at.desc())).scalars().first()
        if replacement:
            replacement.is_active = True
            db.commit()
    return ok({"deleted": resume_id})


@app.post("/api/resumes/import")
async def import_resume(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    original = Path(file.filename or "resume")
    suffix = original.suffix.lower()
    if suffix not in {".pdf", ".docx", ".doc", ".txt", ".md"}:
        raise HTTPException(422, "unsupported_resume_file")
    rid = f"resume-{uuid.uuid4().hex[:12]}"
    stored = DATA_DIR / "uploads" / f"{rid}{suffix}"
    content = await file.read()
    if len(content) > 12 * 1024 * 1024:
        raise HTTPException(413, "resume_file_too_large")
    stored.write_bytes(content)
    try:
        raw_text = extract_text_from_file(stored)
    except Exception as exc:
        stored.unlink(missing_ok=True)
        raise HTTPException(422, str(exc))
    structured = parse_resume_text(raw_text)
    for old in db.execute(select(Resume).where(Resume.user_id == DEMO_USER_ID)).scalars().all():
        old.is_active = False
    row = Resume(
        id=rid,
        user_id=DEMO_USER_ID,
        name=(name or original.name or "导入简历").strip(),
        source_type=suffix.lstrip("."),
        source_file_path=str(stored),
        raw_text=raw_text,
        structured_json=structured,
        parse_version="rules-v1",
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ok(resume_payload(row))


def job_payload(row: JobAnalysis) -> dict[str, Any]:
    data = dict(row.analysis_json or {})
    data.update({
        "job_analysis_id": row.id,
        "role_id": row.role_id,
        "company": row.company,
        "role_name": row.title,
        "raw_jd": row.raw_jd,
        "template_version": row.template_version,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    })
    return data


@app.get("/api/jobs")
def list_jobs(db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = db.execute(select(JobAnalysis).where(JobAnalysis.user_id == DEMO_USER_ID).order_by(JobAnalysis.created_at.desc())).scalars().all()
    return ok([job_payload(x) for x in rows])


@app.post("/api/jobs/analyze")
def create_job_analysis(body: JobAnalyzeRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    role = db.get(RolePack, body.role_id)
    if not role:
        raise HTTPException(404, "role_not_found")
    raw_jd = body.raw_jd.strip()
    if len(raw_jd) < 20:
        raise HTTPException(422, "jd_too_short")
    resume_row = None
    if body.use_resume:
        if body.resume_id:
            resume_row = db.get(Resume, body.resume_id)
        else:
            resume_row = db.execute(select(Resume).where(Resume.user_id == DEMO_USER_ID, Resume.is_active == True)).scalar_one_or_none()
    rule_analysis = analyze_job(role.payload, raw_jd, company=body.company.strip(), role_name=(body.role_name.strip() or role.name), resume=resume_row.structured_json if resume_row else None)
    analysis = analyze_job_with_model(
        role=role.payload,
        raw_jd=raw_jd,
        company=body.company.strip(),
        role_name=(body.role_name.strip() or role.name),
        resume=resume_row.structured_json if resume_row else None,
        fallback=rule_analysis,
    )
    analysis["resume_id"] = resume_row.id if resume_row else None
    analysis["use_resume"] = bool(resume_row)
    jid = f"job-{uuid.uuid4().hex[:12]}"
    row = JobAnalysis(id=jid,user_id=DEMO_USER_ID,role_id=body.role_id,company=body.company.strip(),title=(body.role_name.strip() or role.name),raw_jd=raw_jd,analysis_json=analysis,template_version=role.version)
    db.add(row)
    db.commit()
    db.refresh(row)
    return ok(job_payload(row))


@app.get("/api/jobs/{job_analysis_id}")
def get_job_analysis(job_analysis_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(JobAnalysis, job_analysis_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "job_analysis_not_found")
    return ok(job_payload(row))


@app.post("/api/jobs/{job_analysis_id}/reanalyze")
def reanalyze_job(job_analysis_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(JobAnalysis, job_analysis_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "job_analysis_not_found")
    role = db.get(RolePack, row.role_id)
    if not role:
        raise HTTPException(404, "role_not_found")
    old = row.analysis_json or {}
    resume_row = db.get(Resume, old.get("resume_id")) if old.get("resume_id") else None
    rule_analysis = analyze_job(role.payload,row.raw_jd,company=row.company,role_name=row.title,resume=resume_row.structured_json if resume_row else None)
    analysis = analyze_job_with_model(
        role=role.payload,
        raw_jd=row.raw_jd,
        company=row.company,
        role_name=row.title,
        resume=resume_row.structured_json if resume_row else None,
        fallback=rule_analysis,
    )
    analysis["resume_id"] = resume_row.id if resume_row else None
    analysis["use_resume"] = bool(resume_row)
    row.analysis_json = analysis
    row.template_version = role.version
    db.commit()
    db.refresh(row)
    return ok(job_payload(row))


@app.delete("/api/jobs/{job_analysis_id}")
def delete_job_analysis(job_analysis_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(JobAnalysis, job_analysis_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "job_analysis_not_found")
    db.delete(row)
    db.commit()
    return ok({"deleted": job_analysis_id})


def _session_role(session: AssessmentSession, db: Session) -> RolePack:
    role = db.get(RolePack, session.role_id)
    if not role:
        raise HTTPException(404, "role_not_found")
    return role


def _session_question(session: AssessmentSession, role_payload: dict[str, Any], index: int, db: Session) -> Optional[dict[str, Any]]:
    if session.job_analysis_id:
        job = db.get(JobAnalysis, session.job_analysis_id)
        questions = (job.analysis_json or {}).get("likely_questions", []) if job else []
        if 0 <= index < len(questions):
            item = questions[index]
            cid = item.get("competency_id") or (role_payload.get("competencies", [{}])[0] or {}).get("id", "")
            return {
                "id": f"job_q_{index + 1:02d}",
                "sequence": index + 1,
                "stage": item.get("stage") or "岗位能力验证",
                "text": item.get("text", ""),
                "competency_id": cid,
                "evidence_targets": base_targets(role_payload.get("id", session.role_id), min(index, 3), cid),
                "source_ids": [item.get("id")] if item.get("id") else [],
                "reason": item.get("reason"),
                "is_followup": False,
            }
    return build_question(role_payload, index)


def _session_question_count(session: AssessmentSession, role_payload: dict[str, Any], db: Session) -> int:
    if session.job_analysis_id:
        job = db.get(JobAnalysis, session.job_analysis_id)
        questions = (job.analysis_json or {}).get("likely_questions", []) if job else []
        if questions:
            return len(questions)
    return len(role_payload.get("questions", []))


def _question_index(question_id: str) -> int:
    import re
    match = re.search(r"_q_(\d+)", question_id)
    if not match:
        raise HTTPException(422, "invalid_question_id")
    return max(0, int(match.group(1)) - 1)


def _session_payload(session: AssessmentSession) -> dict[str, Any]:
    return {
        "id": session.id,
        "status": session.status,
        "source_mode": "job" if session.job_analysis_id else "resume",
        "mode": session.mode,
        "stage": session.stage,
        "role_id": session.role_id,
        "resume_id": session.resume_id,
        "job_analysis_id": session.job_analysis_id,
        "template_version": session.template_version,
        "coverage": session.coverage,
        "score": session.score,
        "created_at": session.created_at.isoformat() if session.created_at else None,
    }


def _all_answers(session_id: str, db: Session) -> list[AssessmentAnswer]:
    return db.execute(select(AssessmentAnswer).where(AssessmentAnswer.session_id == session_id).order_by(AssessmentAnswer.created_at)).scalars().all()


def _answer_bundle(session: AssessmentSession, base_question_id: str, db: Session) -> str:
    parts = []
    for row in _all_answers(session.id, db):
        if row.question_id == base_question_id or row.question_id.startswith(base_question_id + "_f"):
            if row.raw_text != "[SKIPPED]":
                parts.append(row.raw_text)
    return "\n".join(parts).strip()


def _next_base_question(session: AssessmentSession, role_payload: dict[str, Any], current_index: int, db: Session) -> Optional[dict[str, Any]]:
    return _session_question(session, role_payload, current_index + 1, db)


@app.post("/api/assessments")
def create_assessment(body: AssessmentCreateRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    role = db.get(RolePack, body.role_id)
    if not role:
        raise HTTPException(404, "role_not_found")
    resume_id = body.resume_id
    if not resume_id:
        active = db.execute(select(Resume).where(Resume.user_id == DEMO_USER_ID, Resume.is_active == True).order_by(Resume.updated_at.desc())).scalars().first()
        resume_id = active.id if active else None
    if body.source_mode == "job" and not body.job_analysis_id:
        raise HTTPException(422, "job_analysis_required")
    if body.job_analysis_id:
        job = db.get(JobAnalysis, body.job_analysis_id)
        if not job or job.user_id != DEMO_USER_ID:
            raise HTTPException(404, "job_analysis_not_found")
    sid = f"sess-{uuid.uuid4().hex[:12]}"
    row = AssessmentSession(
        id=sid,
        user_id=DEMO_USER_ID,
        role_id=body.role_id,
        resume_id=resume_id,
        job_analysis_id=body.job_analysis_id,
        mode=body.mode,
        stage="能力验证",
        status="running",
        template_version=role.version,
        coverage=0.0,
    )
    db.add(row)
    db.flush()
    first = _session_question(row, role.payload, 0, db)
    if not first:
        db.rollback()
        raise HTTPException(422, "role_has_no_questions")
    row.stage = first["stage"]
    db.commit()
    db.refresh(row)
    return ok({"session": _session_payload(row), "question": first})


@app.get("/api/assessments/{session_id}")
def get_assessment(session_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    session = db.get(AssessmentSession, session_id)
    if not session or session.user_id != DEMO_USER_ID:
        raise HTTPException(404, "assessment_not_found")
    role = _session_role(session, db)
    answers = _all_answers(session_id, db)
    base_answer_indices = [_question_index(a.question_id) for a in answers if "_f" not in a.question_id and a.raw_text != "[SKIPPED]"]
    total_questions = max(1, _session_question_count(session, role.payload, db))
    idx = min(total_questions - 1, (max(base_answer_indices) + 1) if base_answer_indices else 0)
    question = _session_question(session, role.payload, idx, db) if session.status == "running" else None
    return ok({"session": _session_payload(session), "question": question, "answer_count": len(answers)})


@app.post("/api/assessments/{session_id}/answers")
def submit_assessment_answer(session_id: str, body: AssessmentAnswerRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    session = db.get(AssessmentSession, session_id)
    if not session or session.user_id != DEMO_USER_ID:
        raise HTTPException(404, "assessment_not_found")
    if session.status != "running":
        raise HTTPException(409, "assessment_not_running")
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "answer_empty")
    role = _session_role(session, db)
    idx = _question_index(body.question_id)
    parent = _session_question(session, role.payload, idx, db)
    if not parent:
        raise HTTPException(422, "question_not_found")

    # Model inference can take several seconds. Do not hold a SQLite write lock
    # while waiting for the external model: first read the existing answer
    # bundle, run inference, then persist Answer/Evidence in a short transaction.
    previous_bundle = _answer_bundle(session, parent["id"], db)
    combined = "\n".join(x for x in (previous_bundle, text) if x).strip()
    rule_evidence = extract_evidence(parent["evidence_targets"], combined)
    evidence_result = extract_evidence_with_model(
        targets=parent["evidence_targets"],
        answer_text=combined,
        fallback=rule_evidence,
    )

    # The session may have been ended by another request while model inference
    # was running. Re-read its state before persisting the new answer.
    db.expire(session)
    db.refresh(session)
    if session.status != "running":
        raise HTTPException(409, "assessment_not_running")

    answer_id = f"ans-{uuid.uuid4().hex[:12]}"
    answer = AssessmentAnswer(id=answer_id,session_id=session_id,question_id=body.question_id,competency_id=parent["competency_id"],raw_text=text)
    db.add(answer)
    db.flush()
    for item in evidence_result["acquired"]:
        existing_ev = db.execute(
            select(Evidence).where(
                Evidence.session_id == session_id,
                Evidence.competency_id == parent["competency_id"],
                Evidence.slot == item["slot"],
                Evidence.quote == item["quote"],
            )
        ).scalars().first()
        if existing_ev:
            continue
        ev = Evidence(
            id=f"ev-{uuid.uuid4().hex[:12]}", session_id=session_id, answer_id=answer_id,
            competency_id=parent["competency_id"], slot=item["slot"], status="acquired",
            quote=item["quote"], source_type="assessment", meta_json={"question_id": body.question_id, "label": item.get("label")}
        )
        db.add(ev)

    followups = [a for a in _all_answers(session_id, db) if a.question_id.startswith(parent["id"] + "_f")]
    is_followup = "_f" in body.question_id
    followup_count = len(followups)
    next_question = None
    decision_type = "next_question"
    decision_reason = "当前能力证据已达到可判断条件"

    if evidence_result["incomplete"]:
        decision_type = "followup"
        decision_reason = "回答未完成，暂不计为低分"
        fallback_followup = followup_question(parent, evidence_result["missing"] or parent["evidence_targets"], followup_count + 1)
        next_question = fallback_followup
        suggested = str(evidence_result.get("suggested_followup", "")).strip()
        if suggested:
            next_question["text"] = suggested
            next_question["generation_engine"] = "model+rules-v1"
    elif not evidence_result["sufficient"] and evidence_result["missing"] and followup_count < 2:
        decision_type = "followup"
        decision_reason = "关键验证证据不足"
        fallback_followup = followup_question(parent, evidence_result["missing"], followup_count + 1)
        next_question = fallback_followup
        suggested = str(evidence_result.get("suggested_followup", "")).strip()
        if suggested:
            next_question["text"] = suggested
            next_question["generation_engine"] = "model+rules-v1"
    else:
        next_question = _next_base_question(session, role.payload, idx, db)
        if next_question:
            session.stage = next_question["stage"]
        else:
            decision_type = "complete"
            decision_reason = "岗位问题已完成，可生成当前覆盖范围内的报告"

    score = rubric_score(len(evidence_result["acquired"]), len(evidence_result["targets"]), evidence_result["sufficient"])
    evaluated_competencies = {a.competency_id for a in _all_answers(session_id, db) if a.raw_text != "[SKIPPED]" and len(a.raw_text.strip()) >= 12}
    weights = {c["id"]: float(c.get("weight", 0)) for c in role.payload.get("competencies", [])}
    total_weight = sum(weights.values()) or 100
    session.coverage = sum(weights.get(cid, 0) for cid in evaluated_competencies) / total_weight
    db.commit()

    return ok({
        "answer_id": answer_id,
        "evidence": evidence_result,
        "decision": {"type": decision_type, "reason": decision_reason},
        "score_update": {"competency_id": parent["competency_id"], "rubric_score": score, "normalized_score": score * 20, "reason": rubric_reason(score)},
        "next_question": next_question,
    })


@app.post("/api/assessments/{session_id}/skip")
def skip_assessment_question(session_id: str, body: AssessmentSkipRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    session = db.get(AssessmentSession, session_id)
    if not session or session.user_id != DEMO_USER_ID:
        raise HTTPException(404, "assessment_not_found")
    role = _session_role(session, db)
    idx = _question_index(body.question_id)
    q = _session_question(session, role.payload, idx, db)
    if not q:
        raise HTTPException(422, "question_not_found")
    row = AssessmentAnswer(id=f"ans-{uuid.uuid4().hex[:12]}",session_id=session_id,question_id=body.question_id,competency_id=q["competency_id"],raw_text="[SKIPPED]")
    db.add(row)
    next_q = _next_base_question(session, role.payload, idx, db)
    if next_q:
        session.stage = next_q["stage"]
    db.commit()
    return ok({"status": "unknown", "score": None, "next_question": next_q})


@app.post("/api/assessments/{session_id}/finish")
def finish_assessment(session_id: str, body: AssessmentFinishRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    session = db.get(AssessmentSession, session_id)
    if not session or session.user_id != DEMO_USER_ID:
        raise HTTPException(404, "assessment_not_found")
    session.status = "completed"
    db.commit()
    report = _build_report(session, db)
    events = _sync_assessment_profile_events(session, report, db)
    return ok({"session": _session_payload(session), "reason": body.reason, "report": report, "profile_events": events})


def _build_report(session: AssessmentSession, db: Session) -> dict[str, Any]:
    role = _session_role(session, db)
    answers = _all_answers(session.id, db)
    evidence_rows = db.execute(select(Evidence).where(Evidence.session_id == session.id)).scalars().all()
    weights = {c["id"]: float(c.get("weight", 0)) for c in role.payload.get("competencies", [])}
    comp_out = []
    evaluated_weight = 0.0
    weighted_score = 0.0
    for comp in role.payload.get("competencies", []):
        cid = comp["id"]
        comp_answers = [a for a in answers if a.competency_id == cid and a.raw_text != "[SKIPPED]" and len(a.raw_text.strip()) >= 12]
        evs = [e for e in evidence_rows if e.competency_id == cid and e.status == "acquired"]
        slots = sorted({e.slot for e in evs})
        if not comp_answers:
            comp_out.append({"competency_id":cid,"name":comp["name"],"score":None,"rubric_score":None,"status":"unknown","weight":comp.get("weight",0),"evidence_ids":[],"evidence_slots":[]})
            continue
        # 以当前能力实际获得的不同证据槽数量计算保守 Rubric。
        rscore = 2 if len(slots) <= 1 else 3 if len(slots) <= 2 else 4 if len(slots) <= 4 else 5
        normalized = rscore * 20
        status = "verified" if rscore >= 4 else "partial"
        w = weights.get(cid, 0)
        evaluated_weight += w
        weighted_score += normalized * w
        comp_out.append({"competency_id":cid,"name":comp["name"],"score":normalized,"rubric_score":rscore,"status":status,"weight":comp.get("weight",0),"evidence_ids":[e.id for e in evs],"evidence_slots":slots,"reason":rubric_reason(rscore)})
    total_weight = sum(weights.values()) or 100
    coverage = evaluated_weight / total_weight
    match = round(weighted_score / evaluated_weight) if evaluated_weight else 0
    sufficiency = min(1.0, coverage / 0.8) if coverage else 0.0
    session.coverage = coverage
    session.score = match
    db.commit()
    return {
        "session_id": session.id,
        "role": {"id": role.id, "name": role.name, "version": role.version},
        "match_score": match,
        "coverage": round(coverage, 4),
        "sufficiency": round(sufficiency, 4),
        "summary": {"evaluated_count":sum(1 for x in comp_out if x["status"] != "unknown"),"total_count":len(comp_out),"pending_count":sum(1 for x in comp_out if x["status"] == "unknown")},
        "competencies": comp_out,
    }


def _latest_profile_score(role_id: str, competency_id: str, db: Session) -> Optional[float]:
    row = db.execute(
        select(ProfileEvent).where(
            ProfileEvent.user_id == DEMO_USER_ID,
            ProfileEvent.role_id == role_id,
            ProfileEvent.competency_id == competency_id,
        ).order_by(ProfileEvent.created_at.desc())
    ).scalars().first()
    return row.after if row and row.after is not None else None


def _sync_assessment_profile_events(session: AssessmentSession, report: dict[str, Any], db: Session) -> list[dict[str, Any]]:
    role = db.get(RolePack, session.role_id)
    role_scores = {c["id"]: float(c.get("score", 0)) for c in (role.payload.get("competencies", []) if role else [])}
    created = []
    for item in report.get("competencies", []):
        if item.get("status") == "unknown" or item.get("score") is None:
            continue
        existing = db.execute(select(ProfileEvent).where(
            ProfileEvent.user_id == DEMO_USER_ID,
            ProfileEvent.source == "assessment",
            ProfileEvent.session_id == session.id,
            ProfileEvent.competency_id == item["competency_id"],
        )).scalars().first()
        if existing:
            created.append({"id": existing.id, "competency_id": existing.competency_id, "before": existing.before, "after": existing.after})
            continue
        before = _latest_profile_score(session.role_id, item["competency_id"], db)
        if before is None:
            before = role_scores.get(item["competency_id"])
        event = ProfileEvent(
            id=f"pe-{uuid.uuid4().hex[:12]}",
            user_id=DEMO_USER_ID,
            source="assessment",
            role_id=session.role_id,
            session_id=session.id,
            question_id=None,
            competency_id=item["competency_id"],
            reason=item.get("reason") or "评估产生了新的岗位能力证据",
            before=before,
            after=float(item["score"]),
            evidence_ids=item.get("evidence_ids", []),
            confidence=report.get("sufficiency"),
        )
        db.add(event)
        created.append({"id": event.id, "competency_id": event.competency_id, "before": before, "after": event.after})
    db.commit()
    return created


@app.get("/api/assessments/{session_id}/report")
def assessment_report(session_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    session = db.get(AssessmentSession, session_id)
    if not session or session.user_id != DEMO_USER_ID:
        raise HTTPException(404, "assessment_not_found")
    return ok(_build_report(session, db))


@app.get("/api/assessments/{session_id}/audit/{competency_id}")
def assessment_audit(session_id: str, competency_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    session = db.get(AssessmentSession, session_id)
    if not session or session.user_id != DEMO_USER_ID:
        raise HTTPException(404, "assessment_not_found")
    role = _session_role(session, db)
    comp = next((c for c in role.payload.get("competencies", []) if c["id"] == competency_id), None)
    if not comp:
        raise HTTPException(404, "competency_not_found")
    answers = [a for a in _all_answers(session_id, db) if a.competency_id == competency_id and a.raw_text != "[SKIPPED]"]
    evs = db.execute(select(Evidence).where(Evidence.session_id == session_id, Evidence.competency_id == competency_id)).scalars().all()
    q_idx = next((_question_index(a.question_id) for a in answers), None)
    q = _session_question(session, role.payload, q_idx, db) if q_idx is not None else None
    report = _build_report(session, db)
    rc = next((x for x in report["competencies"] if x["competency_id"] == competency_id), None)
    job_source = None
    if session.job_analysis_id:
        job = db.get(JobAnalysis, session.job_analysis_id)
        if job:
            sig = next((x for x in (job.analysis_json or {}).get("core_requirements", []) if x.get("competency_id") == competency_id), None)
            if sig:
                job_source = {"quote": sig.get("quote"), "source_id": sig.get("id"), "source": sig.get("source")}
    return ok({
        "competency": comp,
        "job_source": job_source,
        "question": q,
        "answer": {"raw_text":"\n".join(a.raw_text for a in answers)} if answers else None,
        "evidence": [{"id":e.id,"slot":e.slot,"status":e.status,"quote":e.quote,"meta":e.meta_json} for e in evs],
        "rubric": {"version":"v1.0","level":rc.get("rubric_score") if rc else None,"criteria":rubric_reason(rc.get("rubric_score")) if rc and rc.get("rubric_score") else "待验证"},
        "reason": rc.get("reason") if rc else "尚未形成可评分证据",
        "evidence_confidence": min(1.0, len({e.slot for e in evs}) / 4) if evs else 0.0,
    })


def profile_event_payload(row: ProfileEvent) -> dict[str, Any]:
    return {
        "id": row.id,
        "source": row.source,
        "role_id": row.role_id,
        "session_id": row.session_id,
        "question_id": row.question_id,
        "competency_id": row.competency_id,
        "reason": row.reason,
        "before": row.before,
        "after": row.after,
        "evidence_ids": row.evidence_ids or [],
        "confidence": row.confidence,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@app.get("/api/profile/events")
def profile_events(role_id: Optional[str] = Query(None), limit: int = Query(30, ge=1, le=200), db: Session = Depends(get_db)) -> dict[str, Any]:
    stmt = select(ProfileEvent).where(ProfileEvent.user_id == DEMO_USER_ID)
    if role_id:
        stmt = stmt.where(ProfileEvent.role_id == role_id)
    rows = db.execute(stmt.order_by(ProfileEvent.created_at.desc()).limit(limit)).scalars().all()
    return ok([profile_event_payload(x) for x in rows])


@app.get("/api/profile")
def profile(role_id: str = Query("java-backend"), db: Session = Depends(get_db)) -> dict[str, Any]:
    role = db.get(RolePack, role_id)
    if not role:
        raise HTTPException(404, "role_not_found")
    events = db.execute(select(ProfileEvent).where(ProfileEvent.user_id == DEMO_USER_ID, ProfileEvent.role_id == role_id).order_by(ProfileEvent.created_at.desc())).scalars().all()
    latest_session = db.execute(select(AssessmentSession).where(AssessmentSession.user_id == DEMO_USER_ID, AssessmentSession.role_id == role_id, AssessmentSession.status == "completed").order_by(AssessmentSession.updated_at.desc())).scalars().first()
    latest_report = _build_report(latest_session, db) if latest_session else None
    latest_report_by_comp = {x["competency_id"]: x for x in (latest_report or {}).get("competencies", [])}
    latest_by_comp: dict[str, ProfileEvent] = {}
    for event in events:
        latest_by_comp.setdefault(event.competency_id, event)
    competencies = []
    for comp in role.payload.get("competencies", []):
        event = latest_by_comp.get(comp["id"])
        score = event.after if event and event.after is not None else comp.get("score")
        latest_assessment = latest_report_by_comp.get(comp["id"])
        competencies.append({
            "competency_id": comp["id"],
            "name": comp["name"],
            "score": score,
            "status": comp.get("status", "unknown") if not event else "verified",
            "latest_assessment_status": latest_assessment.get("status") if latest_assessment else "unknown",
            "latest_assessment_score": latest_assessment.get("score") if latest_assessment else None,
            "weight": comp.get("weight", 0),
            "latest_event_id": event.id if event else None,
            "latest_reason": event.reason if event else None,
            "updated_at": event.created_at.isoformat() if event and event.created_at else None,
        })
    weighted = sum(float(x.get("score") or 0) * float(x.get("weight") or 0) for x in competencies)
    total = sum(float(x.get("weight") or 0) for x in competencies) or 100

    # Real practice statistics, aggregated from persisted sessions.
    assessments = db.execute(select(AssessmentSession).where(AssessmentSession.user_id == DEMO_USER_ID, AssessmentSession.role_id == role_id, AssessmentSession.status == "completed").order_by(AssessmentSession.updated_at.desc())).scalars().all()
    drills = db.execute(select(DrillSession).where(DrillSession.user_id == DEMO_USER_ID, DrillSession.role_id == role_id, DrillSession.status == "completed").order_by(DrillSession.updated_at.desc())).scalars().all()
    recordings = db.execute(select(RecordingReview).where(RecordingReview.user_id == DEMO_USER_ID, RecordingReview.status == "analyzed").order_by(RecordingReview.updated_at.desc())).scalars().all()
    assessment_scores = [float(x.score) for x in assessments if x.score is not None]
    drill_scores = [float(x.average_score) for x in drills if x.average_score is not None]
    seven_days_ago = datetime.now() - timedelta(days=7)
    recent_events = [x for x in events if x.created_at and x.created_at >= seven_days_ago]
    recent_change = round(sum((float(x.after) - float(x.before)) for x in recent_events if x.after is not None and x.before is not None), 1)

    # Evidence library: only quotes that were actually persisted from candidate answers.
    comp_name = {x["competency_id"]: x["name"] for x in competencies}
    evidence_rows = db.execute(
        select(Evidence, AssessmentSession)
        .join(AssessmentSession, Evidence.session_id == AssessmentSession.id)
        .where(
            AssessmentSession.user_id == DEMO_USER_ID,
            AssessmentSession.role_id == role_id,
            Evidence.status == "acquired",
        )
        .order_by(Evidence.created_at.desc())
        .limit(60)
    ).all()
    evidence_library = []
    for ev, sess in evidence_rows:
        meta = ev.meta_json or {}
        evidence_library.append({
            "id": ev.id,
            "name": meta.get("label") or ev.slot,
            "slot": ev.slot,
            "type": "verified",
            "tag": comp_name.get(ev.competency_id, ev.competency_id),
            "detail": ev.quote or "",
            "quote": ev.quote or "",
            "competency_id": ev.competency_id,
            "session_id": ev.session_id,
            "source_type": ev.source_type,
            "created_at": ev.created_at.isoformat() if ev.created_at else None,
        })

    # Latest assessment gaps are represented explicitly as pending verification,
    # but are never fabricated as acquired Evidence.
    pending_evidence = []
    for item in (latest_report or {}).get("competencies", []):
        if item.get("status") in {"unknown", "partial", "gap"}:
            pending_evidence.append({
                "id": f"pending:{latest_session.id if latest_session else 'none'}:{item['competency_id']}",
                "name": f"{item.get('name', item['competency_id'])} · 待补证据",
                "type": item.get("status") or "unknown",
                "tag": item.get("name", item["competency_id"]),
                "detail": item.get("reason") or ("本轮尚未覆盖该能力，保持待验证。" if item.get("status") == "unknown" else "现有回答证据仍不充分。"),
                "quote": "",
                "competency_id": item["competency_id"],
                "session_id": latest_session.id if latest_session else None,
                "source_type": "assessment_gap",
                "created_at": latest_session.updated_at.isoformat() if latest_session and latest_session.updated_at else None,
            })

    focus_pool = sorted(
        competencies,
        key=lambda x: (
            0 if x.get("latest_assessment_status") == "unknown" else 1 if x.get("latest_assessment_status") in {"gap", "partial"} else 2,
            -float(x.get("weight") or 0),
            float(x.get("score") or 0),
        ),
    )
    focus = focus_pool[0] if focus_pool else None
    if focus:
        focus = {
            **focus,
            "reason": focus.get("latest_reason") or (
                "最新评估尚未获得该能力的可评分证据，建议优先验证。"
                if focus.get("latest_assessment_status") == "unknown"
                else "当前能力已有长期分数，继续用新证据验证其稳定性。"
            ),
        }

    trend_events = list(reversed(events[:8]))
    trend = [
        {
            "id": x.id,
            "competency_id": x.competency_id,
            "competency_name": comp_name.get(x.competency_id, x.competency_id),
            "before": x.before,
            "after": x.after,
            "source": x.source,
            "created_at": x.created_at.isoformat() if x.created_at else None,
        }
        for x in trend_events
    ]
    return ok({
        "role": {"id": role.id, "name": role.name, "version": role.version},
        "score": round(weighted / total),
        "coverage": latest_session.coverage if latest_session else 0.0,
        "competencies": competencies,
        "events": [profile_event_payload(x) for x in events[:20]],
        "pending_count": (latest_report or {}).get("summary", {}).get("pending_count", sum(1 for x in competencies if x["status"] != "verified")),
        "latest_assessment": {
            "session_id": latest_session.id if latest_session else None,
            "score": latest_session.score if latest_session else None,
            "coverage": latest_session.coverage if latest_session else 0.0,
            "updated_at": latest_session.updated_at.isoformat() if latest_session and latest_session.updated_at else None,
        },
        "practice_stats": {
            "total": len(assessments) + len(drills) + len(recordings),
            "assessment_count": len(assessments),
            "drill_count": len(drills),
            "recording_count": len(recordings),
            "assessment_average": round(sum(assessment_scores) / len(assessment_scores), 1) if assessment_scores else None,
            "drill_average": round(sum(drill_scores) / len(drill_scores), 1) if drill_scores else None,
            "latest_score": round(assessment_scores[0], 1) if assessment_scores else None,
            "recent_change": recent_change,
        },
        "evidence": evidence_library,
        "pending_evidence": pending_evidence,
        "focus": focus,
        "trend": trend,
        "updated_at": events[0].created_at.isoformat() if events and events[0].created_at else (latest_session.updated_at.isoformat() if latest_session and latest_session.updated_at else None),
    })


# ---------------------------------------------------------------------------
# Focused drill
# ---------------------------------------------------------------------------

def drill_session_payload(row: DrillSession, db: Session) -> dict[str, Any]:
    attempts = db.execute(select(DrillAttempt).where(DrillAttempt.session_id == row.id).order_by(DrillAttempt.question_index)).scalars().all()
    return {
        "id": row.id,
        "role_id": row.role_id,
        "topic": row.topic,
        "competency_id": row.competency_id,
        "source": row.source,
        "source_ref_id": row.source_ref_id,
        "status": row.status,
        "total": row.total,
        "questions": row.questions_json or [],
        "average_score": row.average_score,
        "attempts": [
            {
                "id": a.id,
                "question_index": a.question_index,
                "raw_text": a.raw_text,
                "score": a.score,
                "feedback": a.feedback_json or {},
                "evidence": a.evidence_json or [],
            }
            for a in attempts
        ],
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@app.get("/api/drills")
def list_drills(role_id: Optional[str] = Query(None), limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)) -> dict[str, Any]:
    stmt = select(DrillSession).where(DrillSession.user_id == DEMO_USER_ID)
    if role_id:
        stmt = stmt.where(DrillSession.role_id == role_id)
    rows = db.execute(stmt.order_by(DrillSession.created_at.desc()).limit(limit)).scalars().all()
    return ok([drill_session_payload(x, db) for x in rows])


@app.post("/api/drills")
def create_drill(body: DrillCreateRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    role = db.get(RolePack, body.role_id)
    if not role:
        raise HTTPException(404, "role_not_found")
    count = max(1, min(int(body.count or 5), 20))
    topic = (body.topic or "sql").strip().lower()
    competency_id = body.competency_id or topic_competency(body.role_id, topic)
    row = DrillSession(
        id=f"drill-{uuid.uuid4().hex[:12]}",
        user_id=DEMO_USER_ID,
        role_id=body.role_id,
        topic=topic,
        competency_id=competency_id,
        source=body.source or "manual",
        source_ref_id=body.source_ref_id,
        total=count,
        status="running",
        questions_json=create_drill_questions(topic, count),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ok(drill_session_payload(row, db))


@app.get("/api/drills/{session_id}")
def get_drill(session_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(DrillSession, session_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "drill_not_found")
    return ok(drill_session_payload(row, db))


@app.post("/api/drills/{session_id}/attempts")
def submit_drill_attempt(session_id: str, body: DrillAttemptRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(DrillSession, session_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "drill_not_found")
    if row.status != "running":
        raise HTTPException(409, "drill_not_running")
    if body.question_index < 0 or body.question_index >= len(row.questions_json or []):
        raise HTTPException(422, "question_index_invalid")
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(422, "answer_empty")
    result = evaluate_drill_answer(row.topic, text)
    existing = db.execute(select(DrillAttempt).where(DrillAttempt.session_id == session_id, DrillAttempt.question_index == body.question_index)).scalars().first()
    if existing:
        existing.raw_text = text
        existing.score = float(result["score"])
        existing.feedback_json = result["feedback"]
        existing.evidence_json = result["evidence"]
        attempt = existing
    else:
        attempt = DrillAttempt(
            id=f"da-{uuid.uuid4().hex[:12]}",
            session_id=session_id,
            question_index=body.question_index,
            raw_text=text,
            score=float(result["score"]),
            feedback_json=result["feedback"],
            evidence_json=result["evidence"],
        )
        db.add(attempt)
    db.commit()
    return ok({
        "attempt_id": attempt.id,
        "question_index": body.question_index,
        "score": result["score"],
        "feedback": result["feedback"],
        "evidence": result["evidence"],
    })


@app.post("/api/drills/{session_id}/finish")
def finish_drill(session_id: str, body: DrillFinishRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(DrillSession, session_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "drill_not_found")
    attempts = db.execute(select(DrillAttempt).where(DrillAttempt.session_id == session_id).order_by(DrillAttempt.question_index)).scalars().all()
    if not attempts:
        raise HTTPException(422, "drill_has_no_attempts")
    avg_score = round(sum(float(x.score) for x in attempts) / len(attempts), 1)
    row.average_score = avg_score
    row.status = "completed"

    role = db.get(RolePack, row.role_id)
    role_default = None
    if role:
        comp = next((c for c in role.payload.get("competencies", []) if c.get("id") == row.competency_id), None)
        if comp:
            role_default = float(comp.get("score", 0))
    before = _latest_profile_score(row.role_id, row.competency_id, db)
    if before is None:
        before = role_default if role_default is not None else avg_score
    # 专项训练属于补强证据，权重低于正式评估：只做小步上调，不用单轮训练直接下调长期画像。
    delta = max(0.0, min(5.0, (avg_score - float(before)) * 0.25))
    after = round(max(0.0, min(100.0, float(before) + delta)), 1)
    existing_event = db.execute(select(ProfileEvent).where(
        ProfileEvent.user_id == DEMO_USER_ID,
        ProfileEvent.source == "training",
        ProfileEvent.session_id == row.id,
        ProfileEvent.competency_id == row.competency_id,
    )).scalars().first()
    evidence_ids = [f"{a.id}:{e.get('id')}" for a in attempts for e in (a.evidence_json or [])]
    event = existing_event
    if not event:
        event = ProfileEvent(
            id=f"pe-{uuid.uuid4().hex[:12]}",
            user_id=DEMO_USER_ID,
            source="training",
            role_id=row.role_id,
            session_id=row.id,
            question_id=None,
            competency_id=row.competency_id,
            reason=f"完成 {row.topic} 专项训练：{len(attempts)}/{row.total} 题，平均 {avg_score} 分",
            before=before,
            after=after,
            evidence_ids=evidence_ids,
            confidence=min(1.0, len(attempts) / max(1, row.total)),
        )
        db.add(event)
    db.commit()
    return ok({
        "session": drill_session_payload(row, db),
        "profile_event": profile_event_payload(event),
        "reason": body.reason,
    })


# ---------------------------------------------------------------------------
# Knowledge base
# ---------------------------------------------------------------------------

def knowledge_payload(row: KnowledgeDocument) -> dict[str, Any]:
    meta = row.meta_json or {}
    chunks = split_text_chunks(row.raw_text or "")
    snippets = meta.get("snippets") or chunks[:2]
    return {
        "id": row.id,
        "title": row.title,
        "source_type": row.source_type,
        "raw_text": row.raw_text,
        "chunk_count": row.chunk_count,
        "category": meta.get("category", "核心知识"),
        "meta": meta.get("meta", ""),
        "desc": meta.get("desc", (chunks[0][:100] if chunks else "")),
        "used": meta.get("used", "专项训练 / 面试准备 / 成长 Agent"),
        "size": meta.get("size", "文本资料"),
        "snippets": snippets,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@app.get("/api/knowledge")
def list_knowledge(query: str = Query(""), category: str = Query("全部"), db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = db.execute(select(KnowledgeDocument).where(KnowledgeDocument.user_id == DEMO_USER_ID).order_by(KnowledgeDocument.created_at.desc())).scalars().all()
    docs = [knowledge_payload(x) for x in rows]
    if category and category != "全部":
        docs = [x for x in docs if x.get("category") == category]
    q = query.strip().lower()
    if q:
        docs = [x for x in docs if q in (x.get("title", "") + " " + x.get("raw_text", "") + " " + x.get("meta", "")).lower()]
    return ok(docs)


@app.get("/api/knowledge/search")
def search_knowledge(q: str = Query(..., min_length=1), limit: int = Query(8, ge=1, le=30), db: Session = Depends(get_db)) -> dict[str, Any]:
    return ok(hybrid_search(db, DEMO_USER_ID, q, limit=limit))


@app.post("/api/knowledge/reindex")
def reindex_knowledge(db: Session = Depends(get_db)) -> dict[str, Any]:
    return ok(reindex_all(db, DEMO_USER_ID))


@app.get("/api/knowledge/{document_id}")
def get_knowledge(document_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(KnowledgeDocument, document_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "knowledge_not_found")
    return ok(knowledge_payload(row))


@app.post("/api/knowledge")
def create_knowledge(body: KnowledgeCreateRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    raw = (body.raw_text or "").strip()
    if not body.title.strip() or not raw:
        raise HTTPException(422, "knowledge_title_and_text_required")
    chunks = split_text_chunks(raw)
    row = KnowledgeDocument(
        id=f"kb-{uuid.uuid4().hex[:12]}",
        user_id=DEMO_USER_ID,
        title=body.title.strip(),
        source_type=body.source_type or "text",
        raw_text=raw,
        chunk_count=len(chunks),
        meta_json={
            "category": body.category or "核心知识",
            "meta": body.meta,
            "desc": body.desc or raw[:100],
            "used": body.used,
            "snippets": chunks[:2],
            "size": f"{len(raw)} 字",
        },
    )
    db.add(row)
    db.flush()
    try:
        index_document(db, row)
    except Exception as exc:
        meta = dict(row.meta_json or {})
        meta["retrieval_error"] = str(exc)[:180]
        row.meta_json = meta
    db.commit()
    db.refresh(row)
    return ok(knowledge_payload(row))


@app.patch("/api/knowledge/{document_id}")
def patch_knowledge(document_id: str, body: KnowledgePatchRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(KnowledgeDocument, document_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "knowledge_not_found")
    meta = dict(row.meta_json or {})
    if body.title is not None:
        row.title = body.title.strip() or row.title
    if body.raw_text is not None:
        raw = body.raw_text.strip()
        if not raw:
            raise HTTPException(422, "knowledge_text_empty")
        row.raw_text = raw
        chunks = split_text_chunks(raw)
        row.chunk_count = len(chunks)
        meta["snippets"] = chunks[:2]
        meta["size"] = f"{len(raw)} 字"
    if body.category is not None:
        meta["category"] = body.category
    if body.meta is not None:
        meta["meta"] = body.meta
    if body.desc is not None:
        meta["desc"] = body.desc
    if body.used is not None:
        meta["used"] = body.used
    row.meta_json = meta
    try:
        index_document(db, row)
    except Exception as exc:
        meta = dict(row.meta_json or {})
        meta["retrieval_error"] = str(exc)[:180]
        row.meta_json = meta
    db.commit()
    db.refresh(row)
    return ok(knowledge_payload(row))


@app.delete("/api/knowledge/{document_id}")
def delete_knowledge(document_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(KnowledgeDocument, document_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "knowledge_not_found")
    delete_document_index(db, document_id)
    db.delete(row)
    db.commit()
    return ok({"deleted": document_id})


@app.post("/api/knowledge/import")
async def import_knowledge(file: UploadFile = File(...), category: str = Form("核心知识"), db: Session = Depends(get_db)) -> dict[str, Any]:
    suffix = Path(file.filename or "upload.txt").suffix.lower()
    if suffix not in {".pdf", ".docx", ".txt", ".md"}:
        raise HTTPException(422, "knowledge_file_type_not_supported")
    upload_dir = DATA_DIR / "knowledge_uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    path = upload_dir / f"{uuid.uuid4().hex[:12]}{suffix}"
    path.write_bytes(await file.read())
    try:
        raw = extract_text_from_file(path)
    except Exception as exc:
        raise HTTPException(422, f"knowledge_extract_failed:{exc}")
    if not raw.strip():
        raise HTTPException(422, "knowledge_text_empty")
    chunks = split_text_chunks(raw)
    row = KnowledgeDocument(
        id=f"kb-{uuid.uuid4().hex[:12]}", user_id=DEMO_USER_ID,
        title=Path(file.filename or "导入资料").stem,
        source_type=suffix.lstrip("."), raw_text=raw, chunk_count=len(chunks),
        meta_json={"category": category, "meta": "导入资料", "desc": raw[:100], "used": "专项训练 / 面试准备 / 成长 Agent", "snippets": chunks[:2], "size": f"{len(raw)} 字", "file_name": file.filename},
    )
    db.add(row)
    db.flush()
    try:
        index_document(db, row)
    except Exception as exc:
        meta = dict(row.meta_json or {})
        meta["retrieval_error"] = str(exc)[:180]
        row.meta_json = meta
    db.commit()
    db.refresh(row)
    return ok(knowledge_payload(row))


# ---------------------------------------------------------------------------
# Recording review
# ---------------------------------------------------------------------------

def recording_payload(row: RecordingReview) -> dict[str, Any]:
    return {
        "id": row.id,
        "mode": row.mode,
        "input_type": row.input_type,
        "company": row.company,
        "role_name": row.role_name,
        "file_path": row.file_path,
        "raw_text": row.raw_text,
        "segments": row.segments_json or [],
        "analysis": row.analysis_json or {},
        "status": row.status,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@app.get("/api/recordings")
def list_recordings(limit: int = Query(30, ge=1, le=100), db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = db.execute(select(RecordingReview).where(RecordingReview.user_id == DEMO_USER_ID).order_by(RecordingReview.created_at.desc()).limit(limit)).scalars().all()
    return ok([recording_payload(x) for x in rows])


@app.post("/api/recordings")
def create_recording(body: RecordingCreateRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    raw = (body.raw_text or "").strip()
    row = RecordingReview(
        id=f"rec-{uuid.uuid4().hex[:12]}", user_id=DEMO_USER_ID,
        mode=body.mode if body.mode in {"dialogue", "solo"} else "dialogue",
        input_type="text", company=body.company, role_name=body.role_name,
        raw_text=raw, status="ready" if raw else "draft",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ok(recording_payload(row))


@app.post("/api/recordings/transcribe")
async def transcribe_recording(
    file: UploadFile = File(...),
    mode: str = Form("dialogue"),
    company: str = Form(""),
    role_name: str = Form(""),
    original_name: str = Form(""),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not speech_available():
        raise HTTPException(503, "speech_not_configured")
    raw = await file.read()
    if len(raw) > 64 * 1024 * 1024:
        raise HTTPException(413, "audio_file_too_large")
    mode = mode if mode in {"dialogue", "solo"} else "dialogue"
    safe_original = Path(original_name or file.filename or "recording.pcm").name[:180]
    try:
        pcm = normalize_audio_to_pcm16k(raw, file.filename or "recording.pcm")
    except SpeechServiceError as exc:
        message = str(exc)
        status_code = 415 if "format" in message or "wav" in message else 413 if "too_long" in message else 422
        raise HTTPException(status_code, message)

    recording_id = f"rec-{uuid.uuid4().hex[:12]}"
    upload_dir = DATA_DIR / "uploads" / "recordings"
    upload_dir.mkdir(parents=True, exist_ok=True)
    pcm_path = upload_dir / f"{recording_id}.pcm"
    pcm_path.write_bytes(pcm)
    row = RecordingReview(
        id=recording_id,
        user_id=DEMO_USER_ID,
        mode=mode,
        input_type="audio",
        company=company.strip(),
        role_name=role_name.strip(),
        file_path=str(pcm_path.relative_to(DATA_DIR)),
        raw_text="",
        segments_json=[],
        analysis_json={"transcription": {"original_name": safe_original, "engine": "xfyun-rtasr-llm", "status": "transcribing"}},
        status="transcribing",
    )
    db.add(row)
    db.commit()

    try:
        result = transcribe_pcm16k(pcm, mode=mode)
    except SpeechServiceError as exc:
        row.status = "transcription_failed"
        row.analysis_json = {
            "transcription": {
                "original_name": safe_original,
                "engine": "xfyun-rtasr-llm",
                "status": "failed",
                "error": str(exc),
            }
        }
        db.commit()
        raise HTTPException(502, str(exc))

    row.raw_text = result["text"]
    row.segments_json = result.get("segments", [])
    row.analysis_json = {
        "transcription": {
            "original_name": safe_original,
            "engine": result.get("engine"),
            "status": "ready",
            "session_id": result.get("session_id"),
            "speaker_separation": result.get("speaker_separation", False),
            "audio_duration_seconds": result.get("audio_duration_seconds"),
        }
    }
    row.status = "ready"
    db.commit()
    db.refresh(row)
    return ok(recording_payload(row))


@app.get("/api/recordings/{recording_id}")
def get_recording(recording_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(RecordingReview, recording_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "recording_not_found")
    return ok(recording_payload(row))


@app.post("/api/recordings/{recording_id}/analyze")
def analyze_recording(recording_id: str, body: RecordingAnalyzeRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(RecordingReview, recording_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "recording_not_found")
    if body.raw_text is not None:
        row.raw_text = body.raw_text.strip()
    if not (row.raw_text or "").strip():
        raise HTTPException(422, "recording_text_empty")
    transcription_meta = (row.analysis_json or {}).get("transcription")
    asr_segments = row.segments_json or []
    analysis = analyze_recording_text(row.raw_text, row.mode)
    if transcription_meta:
        analysis["transcription"] = transcription_meta
        analysis["asr_segments"] = asr_segments
    row.segments_json = analysis.get("segments", [])
    row.analysis_json = analysis
    row.status = "analyzed"
    db.commit()
    db.refresh(row)
    return ok(recording_payload(row))


@app.post("/api/recordings/{recording_id}/sync-profile")
def sync_recording_profile(recording_id: str, body: RecordingSyncRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(RecordingReview, recording_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "recording_not_found")
    analysis = row.analysis_json or {}
    evidence = analysis.get("evidence", [])
    if not evidence:
        raise HTTPException(422, "recording_has_no_evidence")
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in evidence:
        grouped.setdefault(item.get("competency_id") or "collaboration", []).append(item)
    role = db.get(RolePack, body.role_id)
    if not role:
        raise HTTPException(404, "role_not_found")
    role_defaults = {c.get("id"): float(c.get("score", 0)) for c in role.payload.get("competencies", [])}
    created = []
    for cid, items in grouped.items():
        existing = db.execute(select(ProfileEvent).where(
            ProfileEvent.user_id == DEMO_USER_ID,
            ProfileEvent.source == "recording",
            ProfileEvent.session_id == row.id,
            ProfileEvent.competency_id == cid,
        )).scalars().first()
        if existing:
            created.append(profile_event_payload(existing))
            continue
        before = _latest_profile_score(body.role_id, cid, db)
        if before is None:
            before = role_defaults.get(cid, 60.0)
        gain = min(3.0, max(1.0, len({x.get('slot') for x in items}) * 0.8))
        after = round(min(100.0, float(before) + gain), 1)
        event = ProfileEvent(
            id=f"pe-{uuid.uuid4().hex[:12]}", user_id=DEMO_USER_ID,
            source="recording", role_id=body.role_id, session_id=row.id,
            question_id=None, competency_id=cid,
            reason=f"录音复盘新增 {len(items)} 条可核验回答证据",
            before=before, after=after,
            evidence_ids=[str(x.get("id")) for x in items if x.get("id")],
            confidence=min(1.0, len(items) / 4),
        )
        db.add(event)
        created.append(profile_event_payload(event))
    db.commit()
    return ok({"recording_id": row.id, "profile_events": created})


# ---------------------------------------------------------------------------
# Question graph
# ---------------------------------------------------------------------------

@app.get("/api/question-graph")
def question_graph(role_id: str = Query("java-backend"), db: Session = Depends(get_db)) -> dict[str, Any]:
    role = db.get(RolePack, role_id)
    if not role:
        raise HTTPException(404, "role_not_found")
    profile_data = profile(role_id=role_id, db=db)["data"]
    return ok(build_question_graph(role.payload, profile_data))


# ---------------------------------------------------------------------------
# Unified history
# ---------------------------------------------------------------------------

def _history_rows(db: Session, role_id: Optional[str] = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    role_names = {x.id: x.name for x in db.execute(select(RolePack)).scalars().all()}

    a_stmt = select(AssessmentSession).where(AssessmentSession.user_id == DEMO_USER_ID)
    if role_id:
        a_stmt = a_stmt.where(AssessmentSession.role_id == role_id)
    for item in db.execute(a_stmt).scalars().all():
        rows.append({
            "id": item.id, "source_id": f"assessment:{item.id}", "type": "岗位评估",
            "title": f"{role_names.get(item.role_id, item.role_id)}岗位评估",
            "role_id": item.role_id, "role": role_names.get(item.role_id, item.role_id),
            "score": round(item.score) if item.score is not None else None,
            "meta": f"覆盖率 {round((item.coverage or 0) * 100)}%",
            "status": "已复盘" if item.status == "completed" else "进行中",
            "tone": "verified" if item.status == "completed" else "partial",
            "summary": "完成岗位胜任力评估，可继续查看回答证据、Rubric 与覆盖率。" if item.status == "completed" else "评估尚未结束，当前回答和证据会继续保留。",
            "created_at": item.updated_at.isoformat() if item.updated_at else item.created_at.isoformat(),
            "detail_view": "report" if item.status == "completed" else "interview",
            "_dt": item.updated_at or item.created_at,
        })

    d_stmt = select(DrillSession).where(DrillSession.user_id == DEMO_USER_ID)
    if role_id:
        d_stmt = d_stmt.where(DrillSession.role_id == role_id)
    for item in db.execute(d_stmt).scalars().all():
        attempt_count = db.scalar(select(func.count()).select_from(DrillAttempt).where(DrillAttempt.session_id == item.id)) or 0
        rows.append({
            "id": item.id, "source_id": f"drill:{item.id}", "type": "专项训练",
            "title": f"{item.topic.upper() if len(item.topic) <= 5 else item.topic} 专项训练",
            "role_id": item.role_id, "role": role_names.get(item.role_id, item.role_id),
            "score": round(item.average_score) if item.average_score is not None else None,
            "meta": f"{item.total} 题 · {attempt_count} 题完成",
            "status": "已完成" if item.status == "completed" else "进行中",
            "tone": "verified" if item.status == "completed" else "partial",
            "summary": f"围绕 {item.topic} 能力进行专项补强，训练证据可用于画像更新。",
            "created_at": item.updated_at.isoformat() if item.updated_at else item.created_at.isoformat(),
            "detail_view": "drill", "_dt": item.updated_at or item.created_at,
        })

    j_stmt = select(JobAnalysis).where(JobAnalysis.user_id == DEMO_USER_ID)
    if role_id:
        j_stmt = j_stmt.where(JobAnalysis.role_id == role_id)
    for item in db.execute(j_stmt).scalars().all():
        analysis = item.analysis_json or {}
        req_count = len(analysis.get("core_requirements", []))
        rows.append({
            "id": item.id, "source_id": f"job:{item.id}", "type": "JD 备面",
            "title": f"{item.company + ' · ' if item.company else ''}{item.title or role_names.get(item.role_id, item.role_id)} JD 备面",
            "role_id": item.role_id, "role": role_names.get(item.role_id, item.role_id),
            "score": analysis.get("readiness"), "meta": f"{req_count} 个岗位要求",
            "status": "已分析", "tone": "blue",
            "summary": "JD 已映射为岗位能力指标、优先级、证据缺口和高概率问题。",
            "created_at": item.created_at.isoformat(), "detail_view": "job", "_dt": item.created_at,
        })

    for item in db.execute(select(RecordingReview).where(RecordingReview.user_id == DEMO_USER_ID)).scalars().all():
        evidence_count = len((item.analysis_json or {}).get("evidence", []))
        rows.append({
            "id": item.id, "source_id": f"recording:{item.id}", "type": "录音复盘",
            "title": f"{item.role_name or '真实面试'}录音复盘", "role_id": None,
            "role": item.role_name or "真实面试", "score": None, "meta": f"Evidence {evidence_count} 条",
            "status": "已复盘" if item.status == "analyzed" else "待分析", "tone": "blue",
            "summary": "原始面试文本已结构化为问答与 Evidence，可继续进入专项训练或画像更新。" if item.status == "analyzed" else "已保存录音/文本来源，等待复盘分析。",
            "created_at": item.updated_at.isoformat() if item.updated_at else item.created_at.isoformat(),
            "detail_view": "recording", "_dt": item.updated_at or item.created_at,
        })

    rows.sort(key=lambda x: x["_dt"], reverse=True)
    for row in rows:
        row.pop("_dt", None)
    return rows


@app.get("/api/history")
def history_api(role_id: Optional[str] = Query(None), item_type: Optional[str] = Query(None), limit: int = Query(80, ge=1, le=200), db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = _history_rows(db, role_id)
    if item_type and item_type != "全部":
        rows = [x for x in rows if x["type"] == item_type]
    rows = rows[:limit]
    profile_events_count = db.scalar(select(func.count()).select_from(ProfileEvent).where(ProfileEvent.user_id == DEMO_USER_ID)) or 0
    return ok({
        "items": rows,
        "summary": {
            "total": len(rows),
            "reports": sum(1 for x in rows if x["type"] == "岗位评估" and x["status"] == "已复盘"),
            "profile_events": profile_events_count,
            "completed_drills": sum(1 for x in rows if x["type"] == "专项训练" and x["status"] == "已完成"),
        },
    })


# ---------------------------------------------------------------------------
# Growth Agent
# ---------------------------------------------------------------------------

def agent_conversation_payload(row: AgentConversation) -> dict[str, Any]:
    return {
        "id": row.id, "title": row.title,
        "messages": row.messages_json or [], "plan": row.plan_json or {},
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@app.get("/api/agent/conversations")
def list_agent_conversations(limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = db.execute(select(AgentConversation).where(AgentConversation.user_id == DEMO_USER_ID).order_by(AgentConversation.updated_at.desc()).limit(limit)).scalars().all()
    return ok([agent_conversation_payload(x) for x in rows])


@app.post("/api/agent/conversations")
def create_agent_conversation(body: AgentConversationCreateRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = AgentConversation(id=f"agent-{uuid.uuid4().hex[:12]}", user_id=DEMO_USER_ID, title=(body.title or "新对话").strip()[:120] or "新对话", messages_json=[], plan_json={})
    db.add(row); db.commit(); db.refresh(row)
    return ok(agent_conversation_payload(row))


@app.get("/api/agent/conversations/{conversation_id}")
def get_agent_conversation(conversation_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(AgentConversation, conversation_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "agent_conversation_not_found")
    return ok(agent_conversation_payload(row))


@app.post("/api/agent/conversations/{conversation_id}/messages")
def agent_message(conversation_id: str, body: AgentMessageRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(AgentConversation, conversation_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "agent_conversation_not_found")
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(422, "agent_message_empty")
    role = db.get(RolePack, body.role_id)
    if not role:
        raise HTTPException(404, "role_not_found")

    profile_data = profile(role_id=body.role_id, db=db)["data"]
    resume_row = db.execute(select(Resume).where(Resume.user_id == DEMO_USER_ID, Resume.is_active == True)).scalars().first()
    latest_job_row = db.execute(select(JobAnalysis).where(JobAnalysis.user_id == DEMO_USER_ID, JobAnalysis.role_id == body.role_id).order_by(JobAnalysis.created_at.desc())).scalars().first()
    latest_job = job_payload(latest_job_row) if latest_job_row else None
    retrieval = hybrid_search(db, DEMO_USER_ID, text, limit=6)
    knowledge_hits = retrieval.get("results", [])
    history_rows = _history_rows(db, body.role_id)[:10]
    history_context = [{"source_id": x["source_id"], "type": x["type"], "title": x["title"], "summary": x["summary"], "score": x["score"], "meta": x["meta"]} for x in history_rows]
    fallback = agent_fallback_reply(text, profile_data, latest_job)
    fallback["source_ids"] = ["profile:current"]
    result = growth_agent_with_model(
        query=text, role=role.payload, profile=profile_data,
        resume={"name": resume_row.name, "structured_json": resume_row.structured_json} if resume_row else None,
        latest_job=latest_job, knowledge_hits=knowledge_hits, history=history_context,
        conversation_messages=list(row.messages_json or []), fallback=fallback,
    )
    messages = list(row.messages_json or [])
    messages.append({"id": f"msg-{uuid.uuid4().hex[:10]}", "role": "user", "text": text})
    messages.append({
        "id": f"msg-{uuid.uuid4().hex[:10]}", "role": "assistant", "text": result["content"],
        "source_ids": result.get("source_ids", []), "engine": result.get("engine", "rules-v1"),
    })
    row.messages_json = messages[-40:]
    row.plan_json = result.get("plan", {})
    if row.title == "新对话" or not row.title.strip():
        row.title = text[:32] + ("…" if len(text) > 32 else "")
    db.commit(); db.refresh(row)
    return ok({
        "conversation": agent_conversation_payload(row),
        "reply": result["content"], "plan": result.get("plan", {}),
        "source_ids": result.get("source_ids", []), "knowledge_hits": knowledge_hits,
        "engine": result.get("engine", "rules-v1"), "model_name": result.get("model_name"),
    })


@app.patch("/api/agent/conversations/{conversation_id}/plan")
def update_agent_plan(conversation_id: str, body: AgentPlanActionRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(AgentConversation, conversation_id)
    if not row or row.user_id != DEMO_USER_ID:
        raise HTTPException(404, "agent_conversation_not_found")
    plan = dict(row.plan_json or {})
    actions = list(plan.get("actions", []))
    found = False
    for item in actions:
        if item.get("id") == body.action_id:
            item["status"] = body.status if body.status in {"pending", "done"} else "done"
            found = True
    if not found:
        raise HTTPException(404, "agent_action_not_found")
    plan["actions"] = actions; row.plan_json = plan
    db.commit(); db.refresh(row)
    return ok(agent_conversation_payload(row))


@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
def frontend_index():
    return FileResponse(ROOT_DIR / "index.html")


@app.api_route("/app.js", methods=["GET", "HEAD"], include_in_schema=False)
def frontend_app_js():
    return FileResponse(ROOT_DIR / "app.js", media_type="application/javascript")


@app.api_route("/styles.css", methods=["GET", "HEAD"], include_in_schema=False)
def frontend_styles():
    return FileResponse(ROOT_DIR / "styles.css", media_type="text/css")


app.mount("/templates", StaticFiles(directory=str(ROOT_DIR / "templates")), name="templates")
app.mount("/assets", StaticFiles(directory=str(ROOT_DIR / "assets")), name="assets")
