from __future__ import annotations
import re
from typing import Any

SLOT_LABELS = {
    "business_goal": "业务目标",
    "responsibility": "本人职责",
    "result": "结果",
    "alternative": "备选方案",
    "decision": "最终选择",
    "tradeoff_reason": "选择依据",
    "validation": "验证方式",
    "performance_metric": "量化结果",
    "index_column_order": "索引字段顺序",
    "explain_before_after": "EXPLAIN 前后变化",
    "metric": "监控指标",
    "tool": "定位工具",
    "diagnosis": "判断与根因",
    "stop_loss": "止损动作",
    "verification": "修复验证",
    "action": "工程动作",
    "reason": "原因",
    "prevention": "预防机制",
    "failure_compensation": "失败补偿",
    "concurrency_boundary": "并发边界",
}


def question_id(role_id: str, index: int) -> str:
    prefix = "java" if role_id == "java-backend" else "ai" if role_id == "ai-algorithm" else "product"
    return f"{prefix}_q_{index + 1:02d}"


def base_targets(role_id: str, index: int, competency_id: str) -> list[str]:
    if role_id == "java-backend":
        return [
            ["business_goal", "responsibility", "result"],
            ["alternative", "decision", "tradeoff_reason", "validation", "performance_metric"],
            ["metric", "tool", "diagnosis", "stop_loss", "verification"],
            ["action", "reason", "prevention"],
        ][min(index, 3)]
    if role_id == "ai-algorithm":
        return [
            ["business_goal", "responsibility", "result"],
            ["alternative", "decision", "tradeoff_reason", "validation", "performance_metric"],
            ["metric", "diagnosis", "verification"],
            ["action", "reason", "prevention"],
        ][min(index, 3)]
    return [
        ["business_goal", "responsibility", "result"],
        ["alternative", "decision", "tradeoff_reason", "validation"],
        ["metric", "diagnosis", "verification"],
        ["action", "reason", "prevention"],
    ][min(index, 3)]


def build_question(role: dict[str, Any], index: int) -> dict[str, Any] | None:
    qs = role.get("questions", [])
    if index < 0 or index >= len(qs):
        return None
    q = qs[index]
    cid = q.get("competency", "")
    return {
        "id": question_id(role["id"], index),
        "sequence": index + 1,
        "stage": q.get("stage", "能力考察"),
        "text": q.get("text", ""),
        "competency_id": cid,
        "evidence_targets": base_targets(role["id"], index, cid),
        "source_ids": [],
        "is_followup": False,
    }


def _has(pattern: str, text: str) -> bool:
    return bool(re.search(pattern, text, re.I))


def slot_acquired(slot: str, text: str) -> bool:
    t = text.strip()
    if not t:
        return False
    rules = {
        "business_goal": r"目标|业务|用户|需求|为了|解决|场景",
        "responsibility": r"我负责|本人|我主要|负责|主导|承担|实现|开发",
        "result": r"结果|提升|降低|上线|完成|减少|从\s*\d|达到|效果",
        "alternative": r"备选|方案[一二a-b]|另一|对比|相比|也考虑|候选",
        "decision": r"最终|选择|采用|使用|决定|落地|联合索引|redis|mysql|方案",
        "tradeoff_reason": r"因为|原因|考虑|取舍|权衡|适合|成本|复杂度|选择性|数据量|约束",
        "validation": r"验证|测试|压测|explain|对比|监控|观察|执行计划|实验",
        "performance_metric": r"\d+(?:\.\d+)?\s*(?:ms|毫秒|s|秒|%|qps|tps|倍)",
        "index_column_order": r"字段顺序|索引顺序|最左|选择性|区分度|联合索引.*字段|字段.*联合索引",
        "explain_before_after": r"explain|执行计划|type|key|rows|扫描行|回表",
        "metric": r"p99|p95|rt|qps|cpu|内存|线程|连接池|慢查询|错误率|延迟|监控|指标",
        "tool": r"prometheus|grafana|arthas|jstack|jmap|explain|日志|链路|trace|apm|监控平台|工具",
        "diagnosis": r"定位|判断|根因|排查|分析|确认|瓶颈|逐层|数据库|缓存|网络|线程池",
        "stop_loss": r"限流|降级|熔断|回滚|扩容|止损|切流|关闭|兜底",
        "verification": r"验证|恢复|回归|压测|监控|观察|对比|确认修复",
        "action": r"补做|增加|完善|建立|加入|做|实施|演练|监控|告警|测试|复盘",
        "reason": r"因为|为了|原因|避免|降低|防止|保证|所以",
        "prevention": r"预防|以后|下一次|自动化|告警|演练|规范|检查|复盘|机制|测试",
        "failure_compensation": r"重试|补偿|消息|任务|最终一致|过期|延迟双删|binlog|订阅",
        "concurrency_boundary": r"并发|竞态|旧值|覆盖|顺序|锁|版本|cas|原子",
    }
    pattern = rules.get(slot)
    return _has(pattern, t) if pattern else len(t) >= 35


def dynamic_targets(base: list[str], text: str) -> list[str]:
    targets = list(base)
    low = text.lower()
    if ("sql" in low or "索引" in text or "mysql" in low) and "decision" in targets:
        for x in ("index_column_order", "explain_before_after", "performance_metric"):
            if x not in targets:
                targets.append(x)
    # 只有回答确实进入 Redis/缓存一致性语境时才增加一致性证据槽。
    # 仅把“缓存”作为备选方案提到，不应让 SQL 问题突然要求回答缓存补偿。
    cache_context = "redis" in low or bool(re.search(r"缓存.{0,12}(一致|删除|更新|失效|脏|重试|双删|竞态|并发|过期)|(?:一致|删除|更新|失效|脏|重试|双删|竞态|并发).{0,12}缓存", text, re.I))
    if cache_context:
        for x in ("failure_compensation", "concurrency_boundary"):
            if x not in targets:
                targets.append(x)
    return targets


def extract_evidence(targets: list[str], text: str) -> dict[str, Any]:
    targets = dynamic_targets(targets, text)
    acquired = []
    missing = []
    for slot in targets:
        if slot_acquired(slot, text):
            quote = text[:220]
            acquired.append({"slot": slot, "label": SLOT_LABELS.get(slot, slot), "quote": quote, "status": "acquired"})
        else:
            missing.append(slot)
    incomplete = len(text.strip()) < 12
    sufficient_threshold = max(1, min(len(targets), 3 if len(targets) <= 4 else 4))
    critical = {"performance_metric", "validation", "stop_loss", "verification"}
    acquired_slots = {x["slot"] for x in acquired}
    critical_present = not (critical & set(targets)) or bool(critical & acquired_slots)
    sufficient = not incomplete and len(acquired) >= sufficient_threshold and critical_present
    return {
        "targets": targets,
        "acquired": acquired,
        "missing": missing,
        "conflicts": [],
        "incomplete": incomplete,
        "sufficient": sufficient,
    }


FOLLOWUP = {
    "index_column_order": "你能具体说明联合索引的字段顺序是如何确定的吗？",
    "explain_before_after": "你当时如何用 EXPLAIN 验证优化有效？前后执行计划有什么变化？",
    "performance_metric": "优化前后有没有可核验的性能数据，例如耗时、扫描行数或 QPS？",
    "tradeoff_reason": "为什么选择这个方案？当时还有哪些备选方案或约束？",
    "validation": "你是如何验证这个技术选择确实有效的？",
    "failure_compensation": "如果数据库成功但缓存操作失败，你会如何做补偿并保证最终一致？",
    "concurrency_boundary": "高并发下如果发生读写竞态，你如何避免旧值重新写回？",
    "metric": "你会先看哪些指标来判断问题发生在哪一层？",
    "tool": "你会使用哪些具体工具或日志来定位？",
    "stop_loss": "如果故障仍在扩大，你会先采取什么止损动作？",
    "verification": "修复以后，你会如何确认问题真的恢复而不是暂时消失？",
    "business_goal": "这个项目最核心的业务目标是什么？",
    "responsibility": "其中哪些部分是你本人直接负责的？",
    "result": "最后结果如何？有没有可核验的指标或上线效果？",
    "alternative": "当时还有哪些备选方案？",
    "prevention": "这个动作如何降低下一次同类风险？",
}


def followup_question(parent: dict[str, Any], missing: list[str], number: int = 1) -> dict[str, Any]:
    priority = [
        "index_column_order", "explain_before_after", "performance_metric", "tradeoff_reason", "validation",
        "failure_compensation", "concurrency_boundary", "metric", "tool", "stop_loss", "verification",
        "business_goal", "responsibility", "result", "alternative", "prevention",
    ]
    chosen = next((x for x in priority if x in missing), missing[0] if missing else "validation")
    second = next((x for x in priority if x in missing and x != chosen), None)
    text = FOLLOWUP.get(chosen, f"请继续补充 {SLOT_LABELS.get(chosen, chosen)}。")
    if second and chosen in {"index_column_order", "metric"}:
        text = text.rstrip("？?") + "，另外请补充" + SLOT_LABELS.get(second, second) + "。"
    return {
        "id": f"{parent['id']}_f{number}",
        "parent_question_id": parent["id"],
        "sequence": parent["sequence"],
        "stage": parent["stage"],
        "text": text,
        "competency_id": parent["competency_id"],
        "evidence_targets": [chosen] + ([second] if second else []),
        "source_ids": parent.get("source_ids", []),
        "is_followup": True,
    }


def rubric_score(acquired_count: int, target_count: int, sufficient: bool) -> int:
    if target_count <= 0:
        return 2
    ratio = acquired_count / target_count
    if sufficient and ratio >= 0.8:
        return 5
    if sufficient or ratio >= 0.6:
        return 4
    if ratio >= 0.4:
        return 3
    if ratio > 0:
        return 2
    return 1


def rubric_reason(score: int) -> str:
    return {
        1: "缺少可核验回答证据",
        2: "有方向性回答，但关键机制、取舍或结果证据不足",
        3: "具备基础解释和部分场景证据，但完整性仍不足",
        4: "已覆盖机制、取舍或验证结果中的关键证据，可完成较可靠判断",
        5: "证据完整，包含约束、验证数据与边界判断",
    }.get(score, "证据不足")
