from __future__ import annotations
import re
from typing import Any
from .assessment_service import extract_evidence

DRILL_QUESTIONS = {
    "java": [
        "volatile 能保证什么、不能保证什么？请结合一个并发场景说明。",
        "线程池 corePoolSize、队列长度和 maximumPoolSize 如何共同影响吞吐与风险？",
        "HashMap 在 JDK 8 中为什么引入红黑树？它解决了什么问题？",
        "线上频繁 Full GC 时，你会按什么顺序定位并验证原因？",
        "请复盘一次 Java 线上问题：如何复现、定位、修复和防止回归？",
    ],
    "python": [
        "Python 的 GIL 解决了什么问题，又限制了什么？",
        "asyncio 适合什么任务，不适合什么任务？请结合工程场景说明。",
        "列表、生成器和迭代器在内存与执行模型上有什么区别？",
        "Python 服务 CPU 很高但 QPS 不高，你会如何定位？",
        "如何把一个脚本型 Python 项目改造成可维护的生产服务？",
    ],
    "javascript": [
        "事件循环中宏任务和微任务如何执行？Promise 回调属于哪一类？",
        "闭包为什么会形成，什么情况下可能带来内存问题？",
        "async/await 的错误处理和 Promise 链相比有哪些工程注意点？",
        "浏览器页面出现长任务和卡顿，你会如何定位？",
        "如何设计一个可取消、可超时、可重试的前端请求层？",
    ],
    "go": [
        "Goroutine 为什么比传统线程更轻量？",
        "Channel 什么时候该用有缓冲，什么时候用无缓冲？",
        "GMP 调度模型中的 G、M、P 分别是什么？",
        "Go 服务出现 Goroutine 泄漏，你会如何发现和定位？",
        "高并发 Go 服务如何控制连接池、超时和背压？",
    ],
    "algorithm": [
        "如何判断一道题更适合双指针、滑动窗口还是哈希表？",
        "二叉树 DFS 与 BFS 各适合解决哪些问题？",
        "什么情况下可以使用贪心？如何说明局部最优能导向全局最优？",
        "动态规划中状态定义、转移方程和边界条件分别怎么找？",
        "设计一个 LRU Cache，需要哪些数据结构才能做到 O(1)？",
    ],
    "sql": [
        "一个查询在数据量增长后从 90ms 变成 900ms，你会如何定位并验证优化是否有效？",
        "联合索引的字段顺序通常如何确定？什么情况下索引可能失效？",
        "如何通过 EXPLAIN 判断一次 SQL 优化是否真的生效？",
        "事务隔离级别会如何影响并发读写？请结合一个场景说明。",
        "线上出现慢查询尖峰时，你会先止损还是先优化？为什么？",
    ],
    "redis": [
        "数据库更新成功但 Redis 删除失败时，你会如何避免长期脏数据？",
        "高并发下缓存失效后大量请求打到数据库，你会如何处理？",
        "缓存穿透、击穿、雪崩分别如何识别和治理？",
        "延迟双删能解决哪些问题？它的边界是什么？",
        "如果 Redis 出现延迟升高，你会看哪些指标并如何降级？",
    ],
    "concurrency": [
        "线程池参数应该如何结合业务流量和任务类型设置？",
        "出现死锁时你会如何定位和处理？",
        "volatile 和锁分别解决什么问题？",
        "高并发扣库存如何避免超卖？",
        "并发问题修复后如何设计回归和压测？",
    ],
    "system": [
        "设计一个高峰期校园预约系统，你会如何做容量和稳定性设计？",
        "服务依赖超时时如何设计熔断、降级和重试？",
        "如何设计一次可回滚的数据库变更？",
        "系统从单机演进到多实例后，哪些一致性问题会出现？",
        "你会如何建立核心链路的监控和告警？",
    ],
    "expression": [
        "用 STAR 结构说明一次你解决复杂技术问题的经历。",
        "如何在两分钟内解释一次技术取舍并突出你的个人贡献？",
        "被追问一个不会的问题时，你会如何组织回答？",
        "如何用数据而不是形容词证明项目结果？",
        "复盘失败经历时，怎样既客观又体现成长？",
    ],
    "spring": [
        "Spring IOC 容器解决了什么问题？",
        "Spring AOP 常见的使用场景和局限是什么？",
        "@Transactional 为什么可能失效？请列出常见场景。",
        "Spring Boot 自动配置是如何工作的？",
        "线上 Spring 服务出现 Bean 循环依赖或启动慢时，你会如何定位？",
    ],
    "rag": [
        "RAG 为什么需要文档切分？chunk 太大或太小分别有什么问题？",
        "Embedding 检索与关键词检索各自擅长什么？",
        "如何设计召回率、准确率和最终回答质量的 RAG 评测？",
        "多路召回后为什么还需要 rerank？",
        "回答出现幻觉时，如何判断问题来自检索、上下文还是生成模型？",
    ],
    "agent": [
        "Agent 与普通 Chatbot 的核心区别是什么？",
        "工具调用失败时，Agent 应如何判断重试、换工具还是停止？",
        "规划型 Agent 为什么容易出现计划漂移？",
        "短期记忆、长期记忆和会话状态应该如何区分？",
        "你会如何评测一个 Agent 的任务完成率、成本和可解释性？",
    ],
    "model": [
        "你如何判断一个更复杂的模型是否真的值得替换当前 baseline？",
        "分类任务类别极不均衡时，你会如何选择损失函数与评价指标？",
        "过拟合出现时，你会如何区分数据问题、模型容量问题和训练策略问题？",
        "模型效果提升来自数据还是结构，你会怎么设计消融实验？",
        "一个新论文方法离线提升 1%，你会如何判断是否值得引入？",
    ],
    "data": [
        "如何设计训练集、验证集和测试集，避免数据泄漏？",
        "时间序列任务为什么不能简单随机切分数据？",
        "离线指标很好但线上效果差，你会优先检查哪些数据问题？",
        "如何判断训练集与线上数据发生了分布漂移？",
        "请设计一次完整模型实验：假设、变量、对照、指标和停止条件。",
    ],
    "error": [
        "模型整体指标不错，但关键样本表现差，你会怎么做误差归因？",
        "如何构建 confusion matrix 并从中决定下一步优化方向？",
        "线上 bad case 很零散，如何把它们系统化成可行动的问题簇？",
        "如何区分模型能力不足和输入信息不足？",
        "如何证明某次优化真正解决了目标错误而不是偶然波动？",
    ],
    "deploy": [
        "模型上线后延迟超标，你会从哪些层面定位和优化？",
        "批处理、动态 batch 和实时推理分别适合什么场景？",
        "模型服务如何做灰度发布与快速回滚？",
        "如何监控线上模型效果，而不只监控服务 QPS 和延迟？",
        "推理成本上涨时如何从模型、硬件和调用策略三层优化？",
    ],
    "ai-communication": [
        "如何向业务方解释模型的不确定性与适用边界？",
        "请用非技术语言解释精确率和召回率为什么不能同时无限提高。",
        "业务方只关心准确率，你如何说明还需要关注其他指标？",
        "研究同学和工程同学对上线方案意见不一致时，你如何推动决策？",
        "如何把一个误差分析结论转成产品可执行动作？",
    ],
    "user": [
        "用户说“这个功能不好用”，你会如何继续追问并定义真实问题？",
        "用户访谈时如何避免诱导性提问？",
        "如何区分用户诉求、用户问题和产品方案？",
        "定性反馈很多但相互矛盾时，你如何判断优先级？",
        "如何通过行为数据验证访谈结论？",
    ],
    "priority": [
        "三个需求都说自己最紧急，你如何决定先做哪个？",
        "RICE、Kano、MoSCoW 等方法你会如何选择而不是机械套公式？",
        "老板点名要做但数据不支持的需求，你会怎么处理？",
        "如何定义一个 MVP 的最小范围？",
        "技术债和新功能冲突时你如何分配资源？",
    ],
    "metrics": [
        "一个新功能上线后，你如何定义它是否成功？",
        "北极星指标和过程指标如何区分？",
        "转化率上升但投诉率也上升，你如何判断是否成功？",
        "A/B 实验如何确定实验组、对照组和观察周期？",
        "指标之间出现冲突时如何确定主次？",
    ],
    "execution": [
        "研发资源突然减少一半，你会如何调整范围和节奏？",
        "设计、研发对方案理解不一致时如何快速拉齐？",
        "需求进入开发后出现重大变更，你如何处理？",
        "跨部门依赖方迟迟不交付，你会如何推动？",
        "上线前发现高风险缺陷，你如何做 go/no-go 决策？",
    ],
    "pm-communication": [
        "请用 90 秒说明一个产品决策：问题、依据、取舍和结果。",
        "如何向研发解释一个看起来“只是改文案”的需求价值？",
        "如何向老板汇报一个表现不好的功能？",
        "如何把用户反馈转成研发可执行需求？",
        "跨团队发生冲突时如何围绕共同目标沟通？",
    ],
}

TOPIC_COMPETENCY = {
    "sql": "backend-depth",
    "redis": "reliability",
    "concurrency": "backend-depth",
    "system": "reliability",
    "expression": "collaboration",
}

TOPIC_TARGETS = {
    "sql": ["diagnosis", "tool", "validation", "performance_metric"],
    "redis": ["failure_compensation", "concurrency_boundary", "verification"],
    "concurrency": ["diagnosis", "tradeoff_reason", "verification"],
    "system": ["metric", "stop_loss", "prevention", "verification"],
    "expression": ["business_goal", "responsibility", "action", "result"],
    "model": ["alternative", "decision", "tradeoff_reason", "validation"],
    "data": ["metric", "validation", "performance_metric", "prevention"],
    "error": ["diagnosis", "tool", "validation", "result"],
    "deploy": ["metric", "tool", "tradeoff_reason", "verification"],
    "ai-communication": ["business_goal", "responsibility", "reason", "result"],
    "user": ["business_goal", "diagnosis", "validation", "result"],
    "priority": ["alternative", "decision", "tradeoff_reason", "result"],
    "metrics": ["metric", "validation", "result", "prevention"],
    "execution": ["responsibility", "action", "stop_loss", "result"],
    "pm-communication": ["business_goal", "decision", "tradeoff_reason", "result"],
}


DOMAIN_DEFS: dict[str, dict[str, Any]] = {
    "java": {"name": "Java", "meta": "编程语言", "mark": "J", "desc": "JVM、集合、并发、异常与工程实践", "tags": ["JVM", "并发", "集合"], "default_score": 76},
    "python": {"name": "Python", "meta": "编程语言", "mark": "Py", "desc": "语言机制、异步、Web 工程与数据处理", "tags": ["异步", "Web", "工程"], "default_score": 72},
    "javascript": {"name": "JavaScript", "meta": "编程语言", "mark": "JS", "desc": "事件循环、闭包、异步与浏览器机制", "tags": ["Event Loop", "Promise", "闭包"], "default_score": 78},
    "go": {"name": "Go", "meta": "编程语言", "mark": "Go", "desc": "Goroutine、Channel、调度与服务工程", "tags": ["GMP", "Channel", "并发"], "default_score": 68},
    "algorithm": {"name": "数据结构与算法", "meta": "算法基础", "mark": "DS", "desc": "复杂度、数组链表、树图与经典算法", "tags": ["复杂度", "树", "动态规划"], "default_score": 74},
    "sql": {"name": "SQL", "meta": "数据库", "mark": "SQL", "desc": "索引、执行计划、事务锁与性能优化", "tags": ["索引", "EXPLAIN", "事务"], "default_score": 64},
    "spring": {"name": "Spring", "meta": "Java 生态", "mark": "S", "desc": "IOC、AOP、事务、MVC 与 Spring Boot", "tags": ["IOC", "事务", "Boot"], "default_score": 75},
    "rag": {"name": "RAG", "meta": "AI 应用", "mark": "RAG", "desc": "检索、切分、Embedding、召回与评测", "tags": ["检索", "Embedding", "评测"], "default_score": 66},
    "agent": {"name": "Agent", "meta": "AI 应用", "mark": "AI", "desc": "工具调用、规划、记忆与可靠性控制", "tags": ["Tools", "Planning", "Memory"], "default_score": 65},
    "middleware": {"name": "中间件与分布式", "meta": "后端工程", "mark": "MW", "desc": "Redis、MQ、分布式锁、一致性与容错", "tags": ["Redis", "MQ", "一致性"], "default_score": 61, "question_topic": "redis"},
    "microservice": {"name": "微服务", "meta": "系统设计", "mark": "MS", "desc": "服务拆分、网关、限流、熔断与治理", "tags": ["网关", "限流", "治理"], "default_score": 69, "question_topic": "system"},
    "model": {"name": "模型与算法推理", "meta": "模型推理", "mark": "M", "desc": "模型选型、泛化、消融实验与技术判断", "tags": ["Baseline", "泛化", "消融"], "default_score": 80},
    "data": {"name": "数据与实验", "meta": "数据实验", "mark": "D", "desc": "数据切分、漂移、实验设计与评估可靠性", "tags": ["数据", "实验", "评估"], "default_score": 74},
    "error": {"name": "误差分析", "meta": "问题解决", "mark": "E", "desc": "Bad Case、错误归因、长尾与效果验证", "tags": ["Bad Case", "归因", "验证"], "default_score": 83},
    "deploy": {"name": "工程部署", "meta": "工程化", "mark": "DEP", "desc": "推理延迟、灰度、监控、容量与成本", "tags": ["延迟", "监控", "成本"], "default_score": 77},
    "ai-communication": {"name": "算法表达", "meta": "沟通协作", "mark": "AI", "desc": "模型边界、指标解释与跨团队沟通", "tags": ["边界", "指标", "沟通"], "default_score": 86},
    "user": {"name": "用户洞察", "meta": "问题定义", "mark": "U", "desc": "用户问题、访谈、反馈归因与验证", "tags": ["用户", "访谈", "验证"], "default_score": 84},
    "priority": {"name": "需求优先级", "meta": "方案设计", "mark": "P", "desc": "优先级、MVP、资源取舍与决策记录", "tags": ["优先级", "MVP", "取舍"], "default_score": 79},
    "metrics": {"name": "指标与实验", "meta": "数据指标", "mark": "MET", "desc": "成功指标、护栏指标、A/B 实验与结果解释", "tags": ["指标", "A/B", "护栏"], "default_score": 76},
    "execution": {"name": "跨团队执行", "meta": "项目推进", "mark": "EX", "desc": "资源、变更、依赖、上线决策与风险管理", "tags": ["推进", "依赖", "风险"], "default_score": 81},
    "pm-communication": {"name": "产品表达", "meta": "沟通表达", "mark": "PM", "desc": "决策表达、价值沟通与跨团队冲突处理", "tags": ["表达", "价值", "冲突"], "default_score": 88},
}

ROLE_RECOMMENDED_DOMAINS = {
    "java-backend": ["java", "sql", "spring", "middleware", "microservice"],
    "ai-algorithm": ["model", "data", "error", "deploy", "ai-communication"],
    "product-manager": ["user", "priority", "metrics", "execution", "pm-communication"],
}

ROLE_GRAPH_DOMAIN_SETS = {
    "java-backend": ["java", "sql", "spring", "middleware", "microservice", "algorithm", "go", "javascript", "rag", "agent", "python"],
    "ai-algorithm": ["model", "data", "error", "deploy", "ai-communication", "python", "algorithm", "sql", "rag", "agent"],
    "product-manager": ["user", "priority", "metrics", "execution", "pm-communication", "agent", "rag", "sql"],
}

ROLE_DOMAIN_COMPETENCY = {
    "java-backend": {
        "java": "backend-depth", "sql": "backend-depth", "spring": "delivery-quality",
        "middleware": "reliability", "microservice": "reliability", "algorithm": "learning",
    },
    "ai-algorithm": {
        "model": "model-reasoning", "data": "data-experiment", "error": "problem-solving",
        "deploy": "ml-engineering", "ai-communication": "communication",
        "python": "model-reasoning", "algorithm": "problem-solving", "sql": "data-experiment", "rag": "ml-engineering", "agent": "ml-engineering", "java": "learning",
    },
    "product-manager": {
        "user": "problem-definition", "priority": "solution-priority", "metrics": "metrics-experiment",
        "execution": "execution", "pm-communication": "communication",
        "agent": "communication", "rag": "business-learning", "sql": "metrics-experiment", "javascript": "execution", "algorithm": "solution-priority",
    },
}

DOMAIN_KNOWLEDGE_LABELS = {
    "java": ["JMM 与可见性", "线程池", "集合实现", "JVM 诊断", "工程复盘"],
    "python": ["GIL", "异步模型", "迭代机制", "性能诊断", "工程化"],
    "javascript": ["Event Loop", "闭包", "异步编程", "性能分析", "请求治理"],
    "go": ["Goroutine", "Channel", "GMP", "并发诊断", "背压治理"],
    "algorithm": ["模式识别", "树遍历", "贪心", "动态规划", "LRU 设计"],
    "sql": ["慢查询定位", "联合索引", "执行计划", "事务与锁", "性能验证"],
    "spring": ["IOC", "AOP", "事务", "自动配置", "工程诊断"],
    "rag": ["文档切分", "检索机制", "RAG 评测", "重排序", "错误归因"],
    "agent": ["Agent 基础", "工具可靠性", "规划控制", "记忆设计", "Agent 评测"],
    "middleware": ["Redis 一致性", "缓存风险", "分布式锁", "一致性边界", "中间件治理"],
    "microservice": ["容量设计", "熔断降级", "发布治理", "一致性边界", "可观测性"],
    "model": ["模型选型", "不均衡学习", "过拟合诊断", "消融实验", "技术判断"],
    "data": ["数据切分", "时间切分", "线上偏移", "数据漂移", "实验设计"],
    "error": ["误差归因", "混淆分析", "Bad Case 聚类", "信息边界", "效果验证"],
    "deploy": ["推理延迟", "服务策略", "灰度回滚", "效果监控", "成本优化"],
    "ai-communication": ["模型边界表达", "指标解释", "指标沟通", "跨团队协作", "行动转译"],
    "user": ["问题澄清", "访谈设计", "问题定义", "反馈归因", "定量验证"],
    "priority": ["优先级判断", "优先级方法", "向上沟通", "MVP 设计", "资源取舍"],
    "metrics": ["成功指标", "指标体系", "护栏指标", "A/B 实验", "指标取舍"],
    "execution": ["资源变化", "团队对齐", "变更管理", "依赖管理", "上线决策"],
    "pm-communication": ["决策表达", "价值沟通", "向上汇报", "需求转译", "冲突处理"],
}


def topic_competency(role_id: str, topic: str) -> str:
    domain_id = topic
    if topic == "redis":
        domain_id = "middleware"
    elif topic == "system":
        domain_id = "microservice"
    elif topic == "concurrency":
        domain_id = "java"
    elif topic == "expression":
        domain_id = "agent" if role_id != "java-backend" else "java"
    mapped = ROLE_DOMAIN_COMPETENCY.get(role_id, {}).get(domain_id)
    if mapped:
        return mapped
    return TOPIC_COMPETENCY.get(topic, "backend-depth")


def build_question_graph(role: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    """从岗位能力包 + 最新画像生成可复算题目图谱。坐标仅用于稳定渲染，不承载业务语义。"""
    role_id = role.get("id", "java-backend")
    recommended = set(ROLE_RECOMMENDED_DOMAINS.get(role_id, ROLE_RECOMMENDED_DOMAINS["java-backend"]))
    profile_scores = {x.get("competency_id"): x.get("score") for x in profile.get("competencies", [])}
    positions = [(115, 145), (325, 90), (540, 155), (205, 355), (470, 325), (745, 390), (620, 505), (875, 195)]
    domains = []
    allowed_domains = set(ROLE_GRAPH_DOMAIN_SETS.get(role_id, DOMAIN_DEFS.keys()))
    for domain_id, meta in DOMAIN_DEFS.items():
        if domain_id not in allowed_domains:
            continue
        competency_id = ROLE_DOMAIN_COMPETENCY.get(role_id, {}).get(domain_id)
        score = profile_scores.get(competency_id) if competency_id else None
        if score is None:
            score = meta.get("default_score", 65)
        score = round(float(score))
        question_topic = meta.get("question_topic", domain_id)
        pool = DRILL_QUESTIONS.get(question_topic) or DRILL_QUESTIONS["sql"]
        labels = DOMAIN_KNOWLEDGE_LABELS.get(domain_id, [])
        questions = []
        nodes = []
        for idx, text in enumerate(pool[:8]):
            label = labels[idx] if idx < len(labels) else f"{meta['name']} · {idx + 1}"
            difficulty = "进阶" if idx >= 3 else "中等" if idx >= 1 else "基础"
            qid = f"graph:{role_id}:{domain_id}:q{idx}"
            questions.append({
                "id": qid,
                "index": idx,
                "topic": domain_id,
                "backend_topic": question_topic,
                "text": text,
                "label": label,
                "difficulty": difficulty,
                "competency_id": competency_id,
                "evidence_targets": TOPIC_TARGETS.get(question_topic, TOPIC_TARGETS.get("sql", [])),
            })
            variation = [-6, 0, 4, -8, 2, -4, 5, -2][idx % 8]
            node_score = max(45, min(98, score + variation))
            node_status = "gap" if node_score < 70 else "partial" if node_score < 85 else "verified"
            x, y = positions[idx % len(positions)]
            nodes.append({
                "id": f"{domain_id}-q{idx}", "topic": domain_id, "q": idx,
                "question_id": qid, "x": x, "y": y, "label": label,
                "score": node_score, "status": node_status, "domain": meta["name"],
                "competency_id": competency_id,
            })
        edge_spec = [(0, 1, "prerequisite"), (1, 2, "related"), (0, 3, "evidence"), (3, 4, "prerequisite"), (2, 4, "related"), (1, 4, "evidence")]
        edges = []
        for a, b, rel in edge_spec:
            if a < len(nodes) and b < len(nodes):
                edges.append([nodes[a]["id"], nodes[b]["id"], rel])
        domains.append({
            "id": domain_id,
            "name": meta["name"],
            "meta": meta["meta"],
            "mark": meta["mark"],
            "desc": meta["desc"],
            "tags": meta.get("tags", []),
            "score": score,
            "competency_id": competency_id,
            "recommended": domain_id in recommended,
            "questions": questions,
            "nodes": nodes,
            "edges": edges,
        })
    domains.sort(key=lambda x: (not x["recommended"], x["score"], x["name"]))
    default_domain = next((x["id"] for x in domains if x["recommended"] and x["score"] < 80), None) or next((x["id"] for x in domains if x["recommended"]), domains[0]["id"] if domains else "sql")
    return {
        "role": {"id": role_id, "name": role.get("name", ""), "version": role.get("version", "v1.0")},
        "default_domain": default_domain,
        "recommended_domains": [x for x in ROLE_RECOMMENDED_DOMAINS.get(role_id, []) if x in DOMAIN_DEFS],
        "domains": domains,
        "engine": "role-pack+profile-v1",
    }


def create_drill_questions(topic: str, count: int) -> list[dict[str, Any]]:
    pool = DRILL_QUESTIONS.get(topic) or DRILL_QUESTIONS["sql"]
    count = max(1, min(count, 20))
    out = []
    for i in range(count):
        out.append({"index": i, "text": pool[i % len(pool)], "topic": topic, "evidence_targets": TOPIC_TARGETS.get(topic, TOPIC_TARGETS["sql"])})
    return out


def evaluate_drill_answer(topic: str, text: str) -> dict[str, Any]:
    targets = TOPIC_TARGETS.get(topic, TOPIC_TARGETS["sql"])
    ev = extract_evidence(targets, text)
    ratio = len(ev["acquired"]) / max(1, len(ev["targets"]))
    specificity = 10 if re.search(r"\d+(?:\.\d+)?\s*(?:ms|%|qps|tps|秒|倍)", text, re.I) else 0
    depth = min(15, max(0, len(text.strip()) - 25) // 12)
    score = max(20, min(100, round(38 + ratio * 42 + specificity + depth)))
    covered = [x.get("label", x["slot"]) for x in ev["acquired"]]
    missing = ev["missing"]
    suggestion = "回答已经比较完整，继续补充边界条件和失败场景会更稳。" if score >= 80 else "优先补充：" + "、".join(missing[:3]) if missing else "增加具体项目数据和验证过程。"
    evidence = [{"id": f"drill_ev_{i+1}", **x} for i, x in enumerate(ev["acquired"])]
    return {"score": score, "feedback": {"covered": covered, "missing": missing, "suggestion": suggestion}, "evidence": evidence}


def split_text_chunks(text: str, max_chars: int = 420) -> list[str]:
    paragraphs = [x.strip() for x in re.split(r"\n{2,}|(?<=[。！？!?])\s+", text or "") if x.strip()]
    chunks: list[str] = []
    buf = ""
    for p in paragraphs:
        if len(buf) + len(p) + 1 <= max_chars:
            buf = (buf + "\n" + p).strip()
        else:
            if buf:
                chunks.append(buf)
            if len(p) <= max_chars:
                buf = p
            else:
                chunks.extend(p[i:i + max_chars] for i in range(0, len(p), max_chars))
                buf = ""
    if buf:
        chunks.append(buf)
    return chunks or ([text.strip()] if text and text.strip() else [])


def lexical_search(query: str, documents: list[dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
    tokens = [x.lower() for x in re.findall(r"[A-Za-z0-9_+#.]+|[\u4e00-\u9fff]{2,}", query or "")]
    results = []
    for doc in documents:
        chunks = split_text_chunks(doc.get("raw_text", ""))
        for i, chunk in enumerate(chunks):
            low = chunk.lower()
            hits = sum(low.count(t) for t in tokens if t)
            if not tokens:
                hits = 1
            if hits <= 0:
                continue
            score = min(0.99, 0.35 + hits * 0.12 + min(len(chunk), 300) / 3000)
            results.append({"source_id": f"{doc['id']}:chunk:{i}", "document_id": doc["id"], "title": doc["title"], "text": chunk, "score": round(score, 3)})
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:limit]


def parse_recording_segments(text: str, mode: str) -> list[dict[str, str]]:
    lines = [x.strip() for x in (text or "").splitlines() if x.strip()]
    segments = []
    for line in lines:
        if re.match(r"^(面试官| interviewer)[：:]", line, re.I):
            segments.append({"speaker": "interviewer", "text": re.split(r"[：:]", line, 1)[1].strip()})
        elif re.match(r"^(候选人|我| candidate)[：:]", line, re.I):
            segments.append({"speaker": "candidate", "text": re.split(r"[：:]", line, 1)[1].strip()})
        else:
            segments.append({"speaker": "candidate" if mode == "solo" else "unknown", "text": line})
    return segments


def analyze_recording_text(text: str, mode: str) -> dict[str, Any]:
    segments = parse_recording_segments(text, mode)
    qas = []
    evidence = []
    if mode == "dialogue":
        current_q = None
        for seg in segments:
            if seg["speaker"] == "interviewer":
                current_q = seg["text"]
            elif seg["speaker"] in {"candidate", "unknown"} and current_q:
                answer = seg["text"]
                lowq = current_q.lower()
                if "redis" in lowq or "缓存" in current_q:
                    targets = ["failure_compensation", "concurrency_boundary", "verification"]
                    competency = "reliability"
                elif "sql" in lowq or "数据库" in current_q or "索引" in current_q:
                    targets = ["tradeoff_reason", "validation", "performance_metric"]
                    competency = "backend-depth"
                else:
                    targets = ["responsibility", "action", "result"]
                    competency = "delivery-quality"
                ev = extract_evidence(targets, answer)
                eid = []
                for item in ev["acquired"]:
                    rid = f"rec_ev_{len(evidence)+1}"
                    evidence.append({"id": rid, "competency_id": competency, **item})
                    eid.append(rid)
                qas.append({"question": current_q, "answer": answer, "competency_id": competency, "evidence_ids": eid, "missing": ev["missing"]})
                current_q = None
    else:
        answer = "\n".join(x["text"] for x in segments)
        ev = extract_evidence(["business_goal", "responsibility", "action", "result"], answer)
        for item in ev["acquired"]:
            evidence.append({"id": f"rec_ev_{len(evidence)+1}", "competency_id": "collaboration", **item})
    target_total = 0
    missing_total = 0
    if qas:
        target_total = sum(len(x.get("evidence_ids", [])) + len(x.get("missing", [])) for x in qas)
        missing_total = sum(len(x.get("missing", [])) for x in qas)
    elif mode == "solo":
        target_total = 4
        missing_total = max(0, target_total - len(evidence))
    digit_hits = len(re.findall(r"\d+(?:\.\d+)?", text))
    structure_score = min(95, 55 + min(len(segments), 4) * 6 + min(len(qas), 3) * 8)
    specificity_score = min(95, 52 + min(digit_hits, 4) * 6 + min(len(evidence), 6) * 4)
    evidence_score = round((len(evidence) / max(1, target_total)) * 100) if target_total else 0
    return {
        "segments": segments,
        "qa": qas,
        "evidence": evidence,
        "observations": {
            "specificity": "较高" if re.search(r"\d", text) else "一般",
            "structure": "清晰" if len(segments) >= 2 else "待补充",
            "evidence_count": len(evidence),
            "missing_count": missing_total,
            "structure_score": structure_score,
            "specificity_score": specificity_score,
            "evidence_score": min(100, evidence_score),
        },
    }


def agent_fallback_reply(text: str, profile: dict[str, Any], latest_job: dict[str, Any] | None) -> dict[str, Any]:
    comps = sorted(profile.get("competencies", []), key=lambda x: (x.get("score") is None, x.get("score") or 0))
    weak = comps[0] if comps else {"name": "岗位核心能力", "competency_id": "reliability", "score": 0}
    role_name = profile.get("role", {}).get("name", "目标岗位")
    job_hint = latest_job.get("company") if latest_job else "当前目标公司"
    content = f"结合你当前的 {role_name} 画像，优先处理「{weak.get('name')}」。建议先补一轮专项证据，再做一次岗位评估验证变化。"
    plan = {
        "title": f"{role_name} 准备计划",
        "actions": [
            {"id": "act_drill", "type": "start_drill", "label": f"训练 {weak.get('name')}", "payload": {"competency_id": weak.get("competency_id")}, "status": "pending"},
            {"id": "act_job", "type": "review_job", "label": f"复核 {job_hint} 的 JD 高优先级要求", "payload": {}, "status": "pending"},
            {"id": "act_assess", "type": "start_assessment", "label": "完成一轮再评估", "payload": {}, "status": "pending"},
        ],
    }
    return {"content": content, "plan": plan}
