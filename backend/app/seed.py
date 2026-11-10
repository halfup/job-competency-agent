import json
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.orm import Session
from .models import RolePack, User, UserSetting, Resume, KnowledgeDocument, ProfileEvent

ROOT = Path(__file__).resolve().parents[2]
DEMO_USER_ID = "demo-user"


def seed(db: Session) -> None:
    user = db.get(User, DEMO_USER_ID)
    if not user:
        db.add(User(id=DEMO_USER_ID, name="张同学"))
        db.flush()
    existing_settings = db.execute(select(UserSetting).where(UserSetting.user_id == DEMO_USER_ID)).scalar_one_or_none()
    if not existing_settings:
        db.add(UserSetting(user_id=DEMO_USER_ID, evidence_strict=True, auto_profile=True, hints=True))

    roles = json.loads((ROOT / "templates" / "roles.json").read_text(encoding="utf-8"))
    for item in roles:
        row = db.get(RolePack, item["id"])
        if row:
            row.name = item["name"]
            row.version = item.get("version", "v1.0")
            row.seniority = item.get("seniority", "初中级")
            row.focus = item.get("focus", "")
            row.payload = item
        else:
            db.add(RolePack(
                id=item["id"], name=item["name"], version=item.get("version", "v1.0"),
                seniority=item.get("seniority", "初中级"), focus=item.get("focus", ""), payload=item
            ))

    if not db.execute(select(Resume).where(Resume.user_id == DEMO_USER_ID)).scalars().first():
        db.add(Resume(
            id="resume-demo-java", user_id=DEMO_USER_ID, name="张同学_Java后端简历.pdf",
            source_type="structured", raw_text="张同学｜Java 后端开发工程师｜校园场地预约服务",
            structured_json={"target_role":"Java 后端开发工程师","projects":[{"name":"校园场地预约服务"}]}, is_active=True
        ))
    docs = [
        (
            "kb-java", "Java 后端面试知识库", "核心知识", "数据库 · 缓存 · 并发 · 微服务",
            "Java 后端技术判断不仅要给结论，还要说明机制、约束、验证方式和失败边界。\n\n"
            "MySQL 优化应结合慢查询、EXPLAIN、索引结构和线上指标验证，不能只说加索引。\n\n"
            "Redis 一致性问题需要说明失败补偿、并发竞态、过期策略和监控验证。\n\n"
            "高并发系统应优先识别核心链路、容量瓶颈、限流降级和故障恢复策略。"
        ),
        (
            "kb-project", "校园预约项目说明", "项目资料", "项目背景 · 架构 · 量化结果",
            "校园预约系统用于学生预约教室与场地，高峰期存在集中访问和数据库慢查询。\n\n"
            "本人主要负责预约接口、数据库查询优化和 Redis 热点缓存，并参与线上问题排查。\n\n"
            "一次 SQL 优化中通过联合索引与查询调整，将平均响应从 420ms 降到 95ms，并使用 EXPLAIN 与线上监控验证。"
        ),
        (
            "kb-job", "目标公司与岗位资料", "岗位资料", "JD · 职责 · 技术栈 · 重点要求",
            "目标 Java 后端岗位重点关注数据库性能优化、Redis 一致性、线上稳定性治理和跨团队交付。\n\n"
            "高优先级要求应优先进入面试验证；没有覆盖到的能力保持待验证，不能直接按低分处理。"
        ),
        (
            "kb-review", "个人复盘记录", "核心知识", "EXPLAIN · 联合索引 · 回答结构",
            "联合索引设计要结合过滤条件、字段选择性和排序需求判断字段顺序。\n\n"
            "优化完成后需要结合 EXPLAIN、平均耗时、P95/P99 和线上指标验证效果。\n\n"
            "回答技术问题时优先使用：现象或目标 → 定位/机制 → 方案取舍 → 验证 → 风险边界。"
        ),
    ]
    for did, title, category, meta, raw_text in docs:
        row = db.get(KnowledgeDocument, did)
        payload = {
            "category": category,
            "meta": meta,
            "desc": raw_text.split("\n", 1)[0][:100],
            "used": "专项训练 / 面试准备 / 成长 Agent",
            "snippets": [x.strip() for x in raw_text.split("\n\n") if x.strip()][:2],
            "size": f"{len(raw_text)} 字",
        }
        if row:
            if not (row.raw_text or "").strip():
                row.raw_text = raw_text
                row.chunk_count = max(1, len(payload["snippets"]))
                row.source_type = "seed"
                row.meta_json = payload
        else:
            db.add(KnowledgeDocument(
                id=did, user_id=DEMO_USER_ID, title=title, source_type="seed",
                raw_text=raw_text, chunk_count=max(1, len(payload["snippets"])), meta_json=payload
            ))
    if not db.execute(select(ProfileEvent).where(ProfileEvent.user_id == DEMO_USER_ID)).first():
        db.add(ProfileEvent(
            id="profile-event-demo-1", user_id=DEMO_USER_ID, source="assessment", role_id="java-backend",
            session_id="session-demo-1", question_id="java_q_02", competency_id="backend-depth",
            reason="补充了 EXPLAIN 前后变化和性能结果", before=78, after=82,
            evidence_ids=["evidence-demo-1"], confidence=0.82
        ))
    db.commit()
