from __future__ import annotations
from datetime import datetime
from typing import Optional
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base


def now() -> datetime:
    return datetime.utcnow()


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), default="张同学")
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class UserSetting(Base):
    __tablename__ = "user_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    evidence_strict: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_profile: Mapped[bool] = mapped_column(Boolean, default=True)
    hints: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class RolePack(Base):
    __tablename__ = "role_packs"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    version: Mapped[str] = mapped_column(String(32), default="v1.0")
    seniority: Mapped[str] = mapped_column(String(64), default="初中级")
    focus: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class Resume(Base):
    __tablename__ = "resumes"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    source_type: Mapped[str] = mapped_column(String(32), default="text")
    source_file_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    raw_text: Mapped[str] = mapped_column(Text, default="")
    structured_json: Mapped[dict] = mapped_column(JSON, default=dict)
    parse_version: Mapped[str] = mapped_column(String(32), default="v1")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class JobAnalysis(Base):
    __tablename__ = "job_analyses"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    role_id: Mapped[str] = mapped_column(String(80), index=True)
    company: Mapped[str] = mapped_column(String(160), default="")
    title: Mapped[str] = mapped_column(String(160), default="")
    raw_jd: Mapped[str] = mapped_column(Text)
    analysis_json: Mapped[dict] = mapped_column(JSON, default=dict)
    template_version: Mapped[str] = mapped_column(String(32), default="v1.0")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class AssessmentSession(Base):
    __tablename__ = "assessment_sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    role_id: Mapped[str] = mapped_column(String(80), index=True)
    resume_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    job_analysis_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    mode: Mapped[str] = mapped_column(String(24), default="evaluation")
    stage: Mapped[str] = mapped_column(String(40), default="自我介绍")
    status: Mapped[str] = mapped_column(String(24), default="active")
    template_version: Mapped[str] = mapped_column(String(32), default="v1.0")
    coverage: Mapped[float] = mapped_column(Float, default=0.0)
    score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class AssessmentAnswer(Base):
    __tablename__ = "assessment_answers"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("assessment_sessions.id"), index=True)
    question_id: Mapped[str] = mapped_column(String(80), index=True)
    competency_id: Mapped[str] = mapped_column(String(80), index=True)
    raw_text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Evidence(Base):
    __tablename__ = "evidence"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("assessment_sessions.id"), index=True)
    answer_id: Mapped[str] = mapped_column(ForeignKey("assessment_answers.id"), index=True)
    competency_id: Mapped[str] = mapped_column(String(80), index=True)
    slot: Mapped[str] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(32), default="unknown")
    quote: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_type: Mapped[str] = mapped_column(String(32), default="assessment")
    meta_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class ProfileEvent(Base):
    __tablename__ = "profile_events"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    source: Mapped[str] = mapped_column(String(32))
    role_id: Mapped[str] = mapped_column(String(80), index=True)
    session_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    question_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    competency_id: Mapped[str] = mapped_column(String(80), index=True)
    reason: Mapped[str] = mapped_column(Text)
    before: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    after: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    evidence_ids: Mapped[list] = mapped_column(JSON, default=list)
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    source_type: Mapped[str] = mapped_column(String(32), default="text")
    raw_text: Mapped[str] = mapped_column(Text, default="")
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    meta_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"
    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("knowledge_documents.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text)
    embedding_json: Mapped[list] = mapped_column(JSON, default=list)
    embedding_model: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class DrillSession(Base):
    __tablename__ = "drill_sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    role_id: Mapped[str] = mapped_column(String(80), index=True)
    topic: Mapped[str] = mapped_column(String(80), index=True)
    competency_id: Mapped[str] = mapped_column(String(80), index=True)
    source: Mapped[str] = mapped_column(String(32), default="manual")
    source_ref_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    total: Mapped[int] = mapped_column(Integer, default=5)
    status: Mapped[str] = mapped_column(String(24), default="running")
    questions_json: Mapped[list] = mapped_column(JSON, default=list)
    average_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class DrillAttempt(Base):
    __tablename__ = "drill_attempts"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("drill_sessions.id"), index=True)
    question_index: Mapped[int] = mapped_column(Integer)
    raw_text: Mapped[str] = mapped_column(Text)
    score: Mapped[float] = mapped_column(Float)
    feedback_json: Mapped[dict] = mapped_column(JSON, default=dict)
    evidence_json: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class RecordingReview(Base):
    __tablename__ = "recording_reviews"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    mode: Mapped[str] = mapped_column(String(24), default="dialogue")
    input_type: Mapped[str] = mapped_column(String(24), default="text")
    company: Mapped[str] = mapped_column(String(160), default="")
    role_name: Mapped[str] = mapped_column(String(160), default="")
    file_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    raw_text: Mapped[str] = mapped_column(Text, default="")
    segments_json: Mapped[list] = mapped_column(JSON, default=list)
    analysis_json: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="ready")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class AgentConversation(Base):
    __tablename__ = "agent_conversations"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(255), default="新对话")
    messages_json: Mapped[list] = mapped_column(JSON, default=list)
    plan_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)
