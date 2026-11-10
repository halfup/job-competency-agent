from __future__ import annotations
import re
from typing import Any, Optional

ROLE_KEYWORDS = {
    "java-backend": {
        "backend-depth": ["java", "spring", "mysql", "sql", "redis", "缓存", "数据库", "并发", "jvm", "性能", "索引", "事务", "后端", "接口"],
        "delivery-quality": ["开发", "设计", "交付", "测试", "代码质量", "工程", "上线", "维护", "重构", "ci", "cd"],
        "reliability": ["稳定", "高并发", "故障", "线上", "监控", "可观测", "容灾", "性能", "排查", "可靠"],
        "collaboration": ["协作", "沟通", "产品", "测试", "跨团队", "团队"],
        "learning": ["学习", "新技术", "调研", "快速", "成长"],
        "ownership": ["负责", "owner", "推动", "闭环", "风险", "责任"],
    },
    "ai-algorithm": {
        "model-reasoning": ["模型", "算法", "训练", "调优", "深度学习", "机器学习", "transformer", "llm", "推理"],
        "data-experiment": ["数据", "实验", "指标", "评估", "样本", "特征", "ab", "baseline"],
        "ml-engineering": ["部署", "服务化", "推理", "延迟", "成本", "工程", "线上", "监控"],
        "problem-solving": ["分析", "定位", "优化", "误差", "问题"],
        "communication": ["协作", "沟通", "业务", "产品"],
        "learning": ["论文", "研究", "学习", "复现", "新方法"],
    },
    "product-manager": {
        "problem-definition": ["用户", "需求", "痛点", "调研", "场景", "问题定义"],
        "solution-priority": ["方案", "优先级", "规划", "roadmap", "需求池", "取舍"],
        "metrics-experiment": ["指标", "数据", "ab", "实验", "转化", "留存", "增长"],
        "execution": ["推动", "研发", "设计", "运营", "项目", "落地", "交付"],
        "communication": ["沟通", "协作", "汇报", "共识"],
        "business-learning": ["商业", "业务", "行业", "学习", "市场", "竞品"],
    },
}

PRIORITY_WORDS = ("必须", "熟练", "精通", "核心", "重点", "负责", "优先", "要求")


def sentences(text: str) -> list[str]:
    raw = re.split(r"[\n\r；;。！？!?]+", (text or "").strip())
    return [re.sub(r"^[\-•·\d\.、\s]+", "", x).strip() for x in raw if x.strip()]


def analyze_job(
    role: dict[str, Any],
    raw_jd: str,
    *,
    company: str = "",
    role_name: str = "",
    resume: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    role_id = role["id"]
    comps = {c["id"]: c for c in role.get("competencies", [])}
    kws = ROLE_KEYWORDS.get(role_id, {})
    mapped: list[dict[str, Any]] = []
    used = set()

    for idx, sent in enumerate(sentences(raw_jd)):
        low = sent.lower()
        best_id, best_hits = None, []
        for cid, words in kws.items():
            hits = [w for w in words if w.lower() in low]
            if len(hits) > len(best_hits):
                best_id, best_hits = cid, hits
        if best_id and best_hits:
            priority = "high" if any(w in sent.lower() for w in PRIORITY_WORDS) or len(best_hits) >= 2 else "medium"
            key = (sent, best_id)
            if key in used:
                continue
            used.add(key)
            mapped.append({
                "id": f"signal_{idx+1:02d}",
                "quote": sent,
                "competency_id": best_id,
                "competency_name": comps.get(best_id, {}).get("name", best_id),
                "priority": priority,
                "matched_keywords": best_hits[:5],
                "source": "jd",
            })

    # 对非常短的 JD，保留岗位模板里的来源提示，但显式标为 template，不伪装成 JD 原句。
    if not mapped:
        for idx, s in enumerate(role.get("jdSignals", [])[:3]):
            cid = s.get("competency")
            mapped.append({
                "id": f"template_signal_{idx+1:02d}",
                "quote": s.get("quote", ""),
                "competency_id": cid,
                "competency_name": comps.get(cid, {}).get("name", cid),
                "priority": "high" if s.get("priority") == "高" else "medium",
                "matched_keywords": [],
                "source": "role_template",
            })

    mapped_competencies = {x["competency_id"] for x in mapped}
    resume_skills = set((resume or {}).get("skills", []))
    resume_text = " ".join(resume_skills).lower()

    strengths = []
    gaps = []
    for c in role.get("competencies", []):
        cid = c["id"]
        relevant = cid in mapped_competencies
        if not relevant:
            continue
        ckws = kws.get(cid, [])
        skill_hits = [x for x in ckws if x.lower() in resume_text]
        if skill_hits:
            strengths.append({
                "competency_id": cid,
                "name": c["name"],
                "reason": f"简历中已有可关联技能：{'、'.join(skill_hits[:4])}",
                "status": "resume_evidence",
            })
        else:
            gaps.append({
                "competency_id": cid,
                "name": c["name"],
                "reason": "JD 已明确要求，但当前简历缺少直接可核验项目证据",
                "priority": "high" if any(x["competency_id"] == cid and x["priority"] == "high" for x in mapped) else "medium",
                "status": "pending_verification",
            })

    questions = []
    for i, q in enumerate(role.get("questions", [])):
        cid = q.get("competency")
        if cid in mapped_competencies or len(questions) < 2:
            questions.append({
                "id": f"job_q_{i+1:02d}",
                "stage": q.get("stage", "能力考察"),
                "text": q.get("text", ""),
                "competency_id": cid,
                "competency_name": comps.get(cid, {}).get("name", cid),
                "reason": "来自 JD 高优先级能力" if any(x["competency_id"] == cid and x["priority"] == "high" for x in mapped) else "用于补充岗位能力证据",
            })

    high = sum(1 for x in mapped if x["priority"] == "high")
    mapped_weight = sum(float(comps.get(cid, {}).get("weight", 0)) for cid in mapped_competencies)
    total_weight = sum(float(c.get("weight", 0)) for c in role.get("competencies", [])) or 100
    coverage = min(1.0, mapped_weight / total_weight)
    gap_penalty = min(25, len(gaps) * 6)
    resume_bonus = min(20, len(strengths) * 5)
    readiness = max(20, min(95, round(48 + coverage * 28 + resume_bonus - gap_penalty)))

    prep_plan = []
    for g in gaps[:3]:
        prep_plan.append({"type": "gap", "title": f"补齐 {g['name']} 证据", "competency_id": g["competency_id"]})
    for q in questions[:2]:
        prep_plan.append({"type": "question", "title": f"练习：{q['text'][:28]}…", "competency_id": q["competency_id"]})

    return {
        "role_id": role_id,
        "role_name": role_name or role.get("name", ""),
        "company": company,
        "readiness": readiness,
        "summary": {
            "high_priority_count": high,
            "mapped_signal_count": len(mapped),
            "gap_count": len(gaps),
            "mapped_competency_count": len(mapped_competencies),
        },
        "core_requirements": mapped,
        "strengths": strengths,
        "gaps": gaps,
        "likely_questions": questions,
        "prep_plan": prep_plan,
        "analysis_engine": "rules-v1",
    }
