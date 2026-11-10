from __future__ import annotations
import re
from pathlib import Path
from typing import Any

TECHS = [
    "Java", "Spring Boot", "Spring", "MySQL", "Redis", "Kafka", "Docker",
    "Kubernetes", "Python", "PyTorch", "TensorFlow", "SQL", "Linux", "Git",
    "Vue", "React", "Go", "Elasticsearch", "RabbitMQ"
]


def extract_text_from_file(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(str(path))
        return "\n".join((page.extract_text() or "") for page in reader.pages).strip()
    if suffix in {".docx", ".doc"}:
        if suffix == ".doc":
            raise ValueError("暂不支持旧版 .doc，请另存为 .docx")
        from docx import Document
        doc = Document(str(path))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip()).strip()
    if suffix in {".txt", ".md"}:
        return path.read_text(encoding="utf-8", errors="ignore").strip()
    raise ValueError("仅支持 PDF、DOCX、TXT、MD")


def _line_value(lines: list[str], labels: list[str]) -> str:
    for line in lines:
        for label in labels:
            if line.startswith(label):
                return line.split("：", 1)[-1].split(":", 1)[-1].strip()
    return ""


def _first_name(lines: list[str]) -> str:
    if not lines:
        return ""
    first = re.split(r"[｜|·•\s]", lines[0].strip())[0].strip()
    if 1 <= len(first) <= 12 and not any(k in first for k in ("简历", "求职", "目标", "项目")):
        return first
    return ""


def _detect_target(text: str, lines: list[str]) -> str:
    explicit = _line_value(lines, ["目标：", "目标:", "求职目标：", "求职目标:", "目标岗位：", "目标岗位:"])
    if explicit:
        return explicit
    candidates = ["Java 后端开发工程师", "AI 算法工程师", "人工智能算法工程师", "产品经理"]
    for c in candidates:
        if c.replace(" ", "") in text.replace(" ", ""):
            return c
    return ""


def _detect_skills(text: str) -> list[str]:
    found = []
    low = text.lower()
    for tech in TECHS:
        if tech.lower() in low and tech not in found:
            found.append(tech)
    return found


def _project_blocks(lines: list[str]) -> list[dict[str, Any]]:
    projects: list[dict[str, Any]] = []
    for i, line in enumerate(lines):
        if re.match(r"^(项目|项目经历)[：:]", line):
            name = re.split(r"[：:]", line, 1)[1].strip() or "项目经历"
            body = []
            for nxt in lines[i + 1:i + 6]:
                if re.match(r"^(项目|项目经历|教育|技能|实习|工作)[：:]", nxt):
                    break
                body.append(nxt)
            projects.append({"name": name, "text": "\n".join(body).strip()})
    if not projects:
        # 对非标准简历保留一个事实块，而不是假装解析出了多个项目。
        projectish = [x for x in lines if any(k in x for k in ("负责", "项目", "开发", "优化", "上线"))]
        if projectish:
            projects.append({"name": "主要经历", "text": "\n".join(projectish[:8])})
    return projects


def parse_resume_text(raw_text: str) -> dict[str, Any]:
    raw = (raw_text or "").replace("\r", "\n").strip()
    lines = [re.sub(r"\s+", " ", x).strip() for x in raw.split("\n") if x.strip()]
    name = _first_name(lines)
    target_role = _detect_target(raw, lines)
    skills = _detect_skills(raw)
    projects = _project_blocks(lines)
    education = _line_value(lines, ["学历：", "学历:", "教育：", "教育:"])
    has_quant = bool(re.search(r"\b\d+(?:\.\d+)?\s*(?:ms|s|%|万|w|qps|tps|倍)\b", raw, re.I))

    project_text = "\n".join(p.get("text", "") for p in projects)
    claims = []
    for skill in skills:
        in_project = skill.lower() in project_text.lower()
        claims.append({
            "claim_type": "skill",
            "claim_text": skill,
            "normalized_name": skill,
            "evidence_status": "project_evidence" if in_project else "pending_verification",
        })

    gaps = []
    if "Redis" in skills and not re.search(r"一致性|补偿|重试|过期|缓存穿透|缓存击穿", raw, re.I):
        gaps.append({"name": "Redis 工程实践", "reason": "简历出现 Redis，但缺少一致性、异常或边界证据", "status": "pending_verification"})
    if "MySQL" in skills and not re.search(r"EXPLAIN|执行计划|索引|慢查询|事务", raw, re.I):
        gaps.append({"name": "MySQL 性能与事务", "reason": "简历出现 MySQL，但缺少优化或事务机制证据", "status": "pending_verification"})
    if "Kafka" not in skills and "Java" in skills:
        gaps.append({"name": "Kafka", "reason": "当前简历未发现直接项目证据", "status": "unknown"})

    readiness = 0
    readiness += min(20, len(raw) // 25)
    readiness += 15 if target_role else 0
    readiness += 25 if projects else 0
    readiness += min(20, len(skills) * 4)
    readiness += 20 if has_quant else 0
    readiness = max(0, min(100, readiness))

    return {
        "name": name,
        "target_role": target_role,
        "education": education,
        "skills": skills,
        "projects": projects,
        "claims": claims,
        "evidence_gaps": gaps,
        "readiness_score": readiness,
        "has_quantified_result": has_quant,
        "parse_engine": "rules-v1",
    }
