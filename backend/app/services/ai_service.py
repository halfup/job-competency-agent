from __future__ import annotations
import json
from typing import Any, Optional

from ..config import settings
from ..gateways.model_gateway import ModelConfig, ModelGateway, build_model_gateway
from .assessment_service import SLOT_LABELS, dynamic_targets

_gateway: Optional[ModelGateway] = None


def model_gateway() -> ModelGateway:
    global _gateway
    if _gateway is None:
        _gateway = build_model_gateway(
            ModelConfig(
                base_url=settings.model_base_url,
                api_key=settings.model_api_key,
                model=settings.model_name,
                timeout_seconds=90,
            )
        )
    return _gateway


def model_available() -> bool:
    return bool(settings.model_base_url and settings.model_api_key and settings.model_name)


def growth_agent_with_model(
    *,
    query: str,
    role: dict[str, Any],
    profile: dict[str, Any],
    resume: Optional[dict[str, Any]],
    latest_job: Optional[dict[str, Any]],
    knowledge_hits: list[dict[str, Any]],
    history: list[dict[str, Any]],
    conversation_messages: list[dict[str, Any]],
    fallback: dict[str, Any],
) -> dict[str, Any]:
    """成长 Agent 快速路径：模型只生成建议正文，动作与来源由后端确定性控制。"""
    if not model_available():
        return fallback
    knowledge_context = [
        {
            "source_id": x.get("source_id"),
            "title": x.get("title"),
            "text": str(x.get("text", ""))[:650],
            "score": x.get("score"),
        }
        for x in knowledge_hits[:4]
    ]
    compact_profile = {
        "score": profile.get("score"),
        "coverage": profile.get("coverage"),
        "pending_count": profile.get("pending_count"),
        "focus": profile.get("focus"),
        "competencies": [
            {"id": x.get("competency_id"), "name": x.get("name"), "score": x.get("score"), "status": x.get("status")}
            for x in (profile.get("competencies") or [])[:8]
        ],
    }
    context = {
        "role": {"id": role.get("id"), "name": role.get("name")},
        "profile": compact_profile,
        "latest_job": {
            "id": (latest_job or {}).get("job_analysis_id"),
            "company": (latest_job or {}).get("company"),
            "role_name": (latest_job or {}).get("role_name"),
            "gaps": ((latest_job or {}).get("analysis") or {}).get("gaps", [])[:4],
        } if latest_job else None,
        "knowledge": knowledge_context,
        "history": history[:4],
        "conversation": [
            {"role": x.get("role"), "text": str(x.get("text", ""))[:500]}
            for x in conversation_messages[-6:]
            if isinstance(x, dict) and x.get("role") in {"user", "assistant"}
        ],
    }
    system = (
        "你是职到AI成长Agent。基于提供的真实画像、岗位、历史和RAG知识片段回答。"
        "不要编造经历、分数或已掌握能力；待验证必须明确说待验证。"
        "回答控制在350字以内，先给优先级判断，再给2-4条可执行建议。不要输出JSON。"
    )
    try:
        content = model_gateway().chat(
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": "问题：" + query[:1000] + "\n上下文：" + _compact(context, 9000)},
            ],
            temperature=0.2,
        ).strip()
    except Exception:
        return fallback
    source_ids = ["profile:current"]
    for item in knowledge_context:
        sid = item.get("source_id")
        if sid and sid not in source_ids:
            source_ids.append(str(sid))
    if latest_job and latest_job.get("job_analysis_id"):
        source_ids.append("job:" + str(latest_job["job_analysis_id"]))
    return {
        "content": content or fallback.get("content", ""),
        "plan": fallback.get("plan", {}),
        "source_ids": source_ids[:6],
        "engine": "model+rag-fast-v2",
        "model_name": settings.model_name,
    }


def _compact(obj: Any, limit: int = 12000) -> str:
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    return text[:limit]


def analyze_job_with_model(
    *,
    role: dict[str, Any],
    raw_jd: str,
    company: str,
    role_name: str,
    resume: Optional[dict[str, Any]],
    fallback: dict[str, Any],
) -> dict[str, Any]:
    """模型增强 JD 分析。所有 JD quote 必须能回到 raw_jd 原文。"""
    if not model_available():
        return fallback

    competencies = [
        {
            "id": c.get("id"),
            "name": c.get("name"),
            "definition": c.get("definition"),
            "weight": c.get("weight"),
        }
        for c in role.get("competencies", [])
    ]
    resume_summary = {
        "skills": (resume or {}).get("skills", []),
        "projects": (resume or {}).get("projects", [])[:3],
        "claims": (resume or {}).get("claims", [])[:12],
        "evidence_gaps": (resume or {}).get("evidence_gaps", [])[:8],
    }
    schema = {
        "type": "object",
        "properties": {
            "requirements": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "quote": {"type": "string"},
                        "competency_id": {"type": "string"},
                        "priority": {"type": "string", "enum": ["high", "medium", "low"]},
                        "reason": {"type": "string"},
                    },
                    "required": ["quote", "competency_id", "priority", "reason"],
                },
            },
            "strengths": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "competency_id": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                    "required": ["competency_id", "reason"],
                },
            },
            "gaps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "competency_id": {"type": "string"},
                        "reason": {"type": "string"},
                        "priority": {"type": "string", "enum": ["high", "medium", "low"]},
                    },
                    "required": ["competency_id", "reason", "priority"],
                },
            },
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "competency_id": {"type": "string"},
                        "stage": {"type": "string"},
                        "text": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                    "required": ["competency_id", "stage", "text", "reason"],
                },
            },
        },
        "required": ["requirements", "strengths", "gaps", "questions"],
    }
    system = (
        "你是职到AI的岗位分析引擎。目标是把招聘JD映射为可验证的岗位能力，不做印象式总结。"
        "requirements.quote 必须逐字复制自用户提供的 JD 原文，不得改写或编造；competency_id 只能从提供的能力列表中选择。"
        "简历只用于判断哪些能力有初步事实或仍待验证，不得把简历声明当作已认证能力。"
        "问题必须是面试可直接使用的问题，并明确考察某一 competency_id。"
    )
    user = (
        "岗位：" + role_name + "\n公司：" + (company or "未填写")
        + "\n能力定义：" + _compact(competencies, 8000)
        + "\n简历结构化摘要：" + _compact(resume_summary, 6000)
        + "\nJD原文：\n" + raw_jd[:12000]
    )
    try:
        result = model_gateway().structured(system=system, user=user, schema=schema)
    except Exception:
        return fallback

    valid_comp_ids = {c.get("id") for c in competencies}
    comp_names = {c.get("id"): c.get("name") for c in competencies}
    requirements = []
    seen = set()
    for idx, item in enumerate(result.get("requirements", [])):
        if not isinstance(item, dict):
            continue
        quote = str(item.get("quote", "")).strip()
        cid = item.get("competency_id")
        if not quote or quote not in raw_jd or cid not in valid_comp_ids:
            continue
        key = (quote, cid)
        if key in seen:
            continue
        seen.add(key)
        priority = item.get("priority") if item.get("priority") in {"high", "medium", "low"} else "medium"
        requirements.append({
            "id": "ai_signal_%02d" % (idx + 1),
            "quote": quote,
            "competency_id": cid,
            "competency_name": comp_names.get(cid, cid),
            "priority": priority,
            "matched_keywords": [],
            "reason": str(item.get("reason", "")).strip(),
            "source": "jd",
        })

    # 如果模型没有给出任何可审计原句，完全回退规则版。
    if not requirements:
        return fallback

    mapped_ids = {x["competency_id"] for x in requirements}
    strengths = []
    for item in result.get("strengths", []):
        if not isinstance(item, dict) or item.get("competency_id") not in mapped_ids:
            continue
        cid = item["competency_id"]
        strengths.append({
            "competency_id": cid,
            "name": comp_names.get(cid, cid),
            "reason": str(item.get("reason", "")).strip(),
            "status": "resume_evidence",
        })
    gaps = []
    for item in result.get("gaps", []):
        if not isinstance(item, dict) or item.get("competency_id") not in mapped_ids:
            continue
        cid = item["competency_id"]
        gaps.append({
            "competency_id": cid,
            "name": comp_names.get(cid, cid),
            "reason": str(item.get("reason", "")).strip() or "该能力仍需通过面试验证",
            "priority": item.get("priority") if item.get("priority") in {"high", "medium", "low"} else "medium",
            "status": "pending_verification",
        })

    questions = []
    for idx, item in enumerate(result.get("questions", [])):
        if not isinstance(item, dict) or item.get("competency_id") not in mapped_ids:
            continue
        text = str(item.get("text", "")).strip()
        if not text:
            continue
        cid = item["competency_id"]
        questions.append({
            "id": "ai_job_q_%02d" % (idx + 1),
            "stage": str(item.get("stage", "能力考察")).strip() or "能力考察",
            "text": text[:280],
            "competency_id": cid,
            "competency_name": comp_names.get(cid, cid),
            "reason": str(item.get("reason", "")).strip() or "用于验证 JD 对应能力",
        })
    if not questions:
        questions = fallback.get("likely_questions", [])

    high = sum(1 for x in requirements if x["priority"] == "high")
    mapped_weight = sum(float(next((c.get("weight", 0) for c in competencies if c.get("id") == cid), 0)) for cid in mapped_ids)
    total_weight = sum(float(c.get("weight", 0) or 0) for c in competencies) or 100
    coverage = min(1.0, mapped_weight / total_weight)
    readiness = max(20, min(95, round(48 + coverage * 28 + min(20, len(strengths) * 5) - min(25, len(gaps) * 6))))
    prep_plan = []
    for gap in gaps[:3]:
        prep_plan.append({"type": "gap", "title": "补齐 %s 证据" % gap["name"], "competency_id": gap["competency_id"]})
    for q in questions[:2]:
        prep_plan.append({"type": "question", "title": "练习：%s…" % q["text"][:28], "competency_id": q["competency_id"]})

    return {
        "role_id": role.get("id"),
        "role_name": role_name or role.get("name", ""),
        "company": company,
        "readiness": readiness,
        "summary": {
            "high_priority_count": high,
            "mapped_signal_count": len(requirements),
            "gap_count": len(gaps),
            "mapped_competency_count": len(mapped_ids),
        },
        "core_requirements": requirements,
        "strengths": strengths,
        "gaps": gaps,
        "likely_questions": questions[:8],
        "prep_plan": prep_plan,
        "analysis_engine": "model+rules-v1",
        "model_name": settings.model_name,
    }


def extract_evidence_with_model(
    *,
    targets: list[str],
    answer_text: str,
    fallback: dict[str, Any],
) -> dict[str, Any]:
    """模型只负责识别/定位证据，充分性仍由后端确定性规则计算。"""
    if not model_available():
        return fallback
    expanded = dynamic_targets(targets, answer_text)
    target_defs = [{"slot": x, "label": SLOT_LABELS.get(x, x)} for x in expanded]
    schema = {
        "type": "object",
        "properties": {
            "acquired": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "slot": {"type": "string"},
                        "quote": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                    "required": ["slot", "quote", "reason"],
                },
            },
            "conflicts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"quote": {"type": "string"}, "reason": {"type": "string"}},
                    "required": ["quote", "reason"],
                },
            },
            "incomplete": {"type": "boolean"},
            "suggested_followup": {"type": "string"},
        },
        "required": ["acquired", "conflicts", "incomplete", "suggested_followup"],
    }
    system = (
        "你是职到AI的证据抽取引擎。你只能从候选人回答原文中抽取可验证证据。"
        "每条 acquired.quote 必须逐字复制回答里的连续原文片段，不得总结、改写或补全。"
        "slot 只能从给定 targets 中选择。回答没覆盖的 slot 不要硬判为 acquired。"
        "incomplete 只表示候选人回答明显中断、只有半句话、或明确表示还没说完；简短但完整的回答不算 incomplete。"
        "如果仍有关键 targets 没有证据，请同时给出一个80个汉字以内的中性追问 suggested_followup；"
        "追问不得透露标准答案、不得替候选人补答案；如果证据已充分则 suggested_followup 返回空字符串。"
    )
    user = "目标证据槽：" + _compact(target_defs, 5000) + "\n候选人原始回答：\n" + answer_text[:12000]
    try:
        result = model_gateway().structured(system=system, user=user, schema=schema)
    except Exception:
        return fallback

    acquired_by_slot: dict[str, dict[str, Any]] = {}
    for item in fallback.get("acquired", []):
        if item.get("slot") in expanded:
            acquired_by_slot[item["slot"]] = item
    for item in result.get("acquired", []):
        if not isinstance(item, dict):
            continue
        slot = item.get("slot")
        quote = str(item.get("quote", "")).strip()
        if slot not in expanded or not quote or quote not in answer_text:
            continue
        # 引用长度避免整个答案被粗暴当成每个槽的同一条证据。
        if len(quote) > 260:
            quote = quote[:260]
            if quote not in answer_text:
                continue
        acquired_by_slot[slot] = {
            "slot": slot,
            "label": SLOT_LABELS.get(slot, slot),
            "quote": quote,
            "status": "acquired",
            "reason": str(item.get("reason", "")).strip(),
            "engine": "model",
        }

    acquired = [acquired_by_slot[x] for x in expanded if x in acquired_by_slot]
    acquired_slots = {x["slot"] for x in acquired}
    missing = [x for x in expanded if x not in acquired_slots]
    conflicts = []
    for item in result.get("conflicts", []):
        if not isinstance(item, dict):
            continue
        quote = str(item.get("quote", "")).strip()
        if quote and quote in answer_text:
            conflicts.append({"quote": quote, "reason": str(item.get("reason", "")).strip()})
    incomplete = bool(result.get("incomplete")) or bool(fallback.get("incomplete"))
    threshold = max(1, min(len(expanded), 3 if len(expanded) <= 4 else 4))
    critical = {"performance_metric", "validation", "stop_loss", "verification"}
    critical_present = not (critical & set(expanded)) or bool(critical & acquired_slots)
    sufficient = not incomplete and len(acquired) >= threshold and critical_present and not conflicts
    suggested = str(result.get("suggested_followup", "")).strip()
    if sufficient or len(suggested) > 140:
        suggested = ""
    return {
        "targets": expanded,
        "acquired": acquired,
        "missing": missing,
        "conflicts": conflicts,
        "incomplete": incomplete,
        "sufficient": sufficient,
        "suggested_followup": suggested,
        "engine": "model+rules-v1",
    }
