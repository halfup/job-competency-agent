# 职到 AI 后端架构设计

> 目标：让当前已经跑通的前端，从“固定数据演示”升级为真实可用的岗位胜任力评估系统，同时保持现有证据协议、岗位模板协议和页面交互不变。

## 1. 架构结论

后端采用 **模块化单体 + 明确状态机 + 可插拔智能服务**。

第一阶段不做微服务，不做多 Agent 拆分，不引入复杂消息队列。原因很简单：比赛 P0 最重要的是稳定、可复现、可审计，而不是基础设施数量。

推荐技术栈：

- Web API：FastAPI
- Python：3.9+（当前服务器可直接运行）
- ORM：SQLAlchemy 2.x
- P0 数据库：SQLite
- 生产/扩展：PostgreSQL
- 文件存储：本机 `data/uploads/`，后续可替换 OSS
- 向量检索：统一 `VectorStore` 接口；P0 可使用本地实现，后续切 pgvector/Qdrant
- 模型调用：统一 `ModelGateway`，供应商配置仅存在服务端环境变量，前端不暴露模型切换
- 流式输出：SSE，仅用于成长 Agent / 长回答；普通评估接口保持 JSON

总体结构：

```text
Frontend
  ↓ REST / SSE
FastAPI API Layer
  ↓
Application Services
  ├─ AuthService
  ├─ ResumeService
  ├─ JobService
  ├─ AssessmentEngine
  ├─ EvidenceEngine
  ├─ ScoringEngine
  ├─ DrillService
  ├─ RecordingService
  ├─ ProfileService
  ├─ KnowledgeService
  └─ AgentOrchestrator
  ↓
Domain / State Machine
  ├─ RolePack
  ├─ Competency
  ├─ Evidence
  ├─ Rubric
  ├─ AssessmentSession
  └─ ProfileEvent
  ↓
Infrastructure
  ├─ SQL Database
  ├─ File Storage
  ├─ Vector Store
  ├─ ModelGateway
  └─ SpeechGateway
```

---

## 2. 后端必须坚持的 8 条规则

### 2.1 简历声明不是能力得分

简历只产生：

- `resume_claim`
- `project_fact`
- `evidence_target`
- `unknown / pending_verification`

不能因为简历写了 “精通 Redis” 就直接给 Redis 能力加分。

### 2.2 所有评分必须经过 Evidence

禁止：

```text
answer → LLM 直接给 82 分
```

必须：

```text
answer
→ evidence extraction
→ evidence status
→ rubric matching
→ score item
→ report
```

### 2.3 `unknown` / `incomplete` 不等于 1 分

内部状态：

- `acquired`
- `missing`
- `conflict`
- `incomplete`
- `sufficient`
- `unknown`

其中 `unknown` 与 `incomplete` 不进入已评估权重分母。

### 2.4 原始回答不可被 AI 改写后覆盖

`assessment_answers.raw_text` 保存原文，后续抽取结果全部另存。

报告引用必须能回到原始回答。

### 2.5 画像更新必须是事件，而不是直接改一个分数

每次更新保存 `ProfileEvent`：

```text
source
session_id
question_id
evidence_ids
competency_id
before
after
reason
confidence
created_at
```

当前画像由事件聚合得到。

### 2.6 岗位模板必须版本化

每次评估保存：

- `role_id`
- `template_version`
- `rubric_version`

防止模板升级后旧报告无法复算。

### 2.7 知识库只提供标准与上下文，不替候选人回答

RAG 可以帮助：

- 理解岗位
- 出题
- 判断知识标准
- 提供训练内容

但候选人的能力证据必须来自：

- 正式回答
- 专项训练回答
- 录音复盘文本
- 明确的项目事实

### 2.8 模型供应商不进入前端产品逻辑

统一由：

```text
ModelGateway
```

管理。

前端只调用：

```text
分析 JD
提交回答
生成下一问
生成报告
```

不出现模型名称或模型切换。

---

## 3. 推荐目录结构

```text
backend/
├─ app/
│  ├─ main.py
│  ├─ config.py
│  ├─ database.py
│  ├─ dependencies.py
│  │
│  ├─ api/
│  │  ├─ auth.py
│  │  ├─ resumes.py
│  │  ├─ jobs.py
│  │  ├─ assessments.py
│  │  ├─ drills.py
│  │  ├─ recordings.py
│  │  ├─ profiles.py
│  │  ├─ knowledge.py
│  │  ├─ history.py
│  │  └─ agent.py
│  │
│  ├─ domain/
│  │  ├─ enums.py
│  │  ├─ role_pack.py
│  │  ├─ evidence.py
│  │  ├─ rubric.py
│  │  ├─ assessment_state.py
│  │  └─ profile_event.py
│  │
│  ├─ models/
│  │  ├─ user.py
│  │  ├─ resume.py
│  │  ├─ job.py
│  │  ├─ assessment.py
│  │  ├─ evidence.py
│  │  ├─ drill.py
│  │  ├─ recording.py
│  │  ├─ profile.py
│  │  ├─ knowledge.py
│  │  └─ agent.py
│  │
│  ├─ schemas/
│  │  ├─ auth.py
│  │  ├─ resume.py
│  │  ├─ job.py
│  │  ├─ assessment.py
│  │  ├─ report.py
│  │  └─ common.py
│  │
│  ├─ services/
│  │  ├─ resume_service.py
│  │  ├─ job_service.py
│  │  ├─ assessment_engine.py
│  │  ├─ evidence_engine.py
│  │  ├─ scoring_engine.py
│  │  ├─ report_service.py
│  │  ├─ drill_service.py
│  │  ├─ recording_service.py
│  │  ├─ profile_service.py
│  │  ├─ knowledge_service.py
│  │  └─ agent_orchestrator.py
│  │
│  ├─ gateways/
│  │  ├─ model_gateway.py
│  │  ├─ speech_gateway.py
│  │  └─ vector_store.py
│  │
│  ├─ repositories/
│  │  ├─ resume_repo.py
│  │  ├─ assessment_repo.py
│  │  ├─ evidence_repo.py
│  │  └─ profile_repo.py
│  │
│  └─ prompts/
│     ├─ resume_parse.py
│     ├─ jd_parse.py
│     ├─ evidence_extract.py
│     ├─ followup_decision.py
│     └─ report_reason.py
│
├─ data/
│  ├─ app.db
│  ├─ uploads/
│  └─ vector/
│
├─ tests/
│  ├─ test_evidence_state.py
│  ├─ test_scoring.py
│  ├─ test_assessment_flow.py
│  └─ test_profile_event.py
│
├─ requirements.txt
└─ .env.example
```

---

## 4. 核心数据模型

## 4.1 users

```text
id                 UUID / string PK
name               string
email              string nullable
phone              string nullable
password_hash      string
created_at         datetime
updated_at         datetime
```

P0 可以先只做账号密码；后续再接验证码。

---

## 4.2 resumes

```text
id                  UUID
user_id             FK users
name                string
source_type         text | pdf | word | structured
source_file_path    nullable
raw_text            text
structured_json     JSON
parse_version       string
is_active           bool
created_at
updated_at
```

### resume_claims

```text
id
resume_id
claim_type          skill | project | responsibility | result
claim_text
normalized_name
competency_id       nullable
evidence_status     pending | partial | unsupported
source_path         例如 projects[0].result
confidence
```

---

## 4.3 role_templates

与当前 `templates/roles.json` 保持兼容。

```text
id                  java-backend
name                Java 后端开发工程师
version             v1.0
seniority           初中级
status              active
raw_config          JSON
created_at
```

### competencies

```text
id
role_template_id
code                backend-depth
name                后端技术深度
definition
weight
required
training_tags       JSON
```

### competency_evidence_slots

```text
id
competency_id
slot_code            tradeoff
slot_name            技术取舍
priority             high | medium | low
required              bool
```

### rubrics

```text
id
competency_id
version
level                 1..5
criteria_text
required_evidence     JSON
```

---

## 4.4 job_analyses

```text
id
user_id
role_template_id
company
role_name
raw_jd
use_resume
resume_id nullable
status
created_at
```

### job_signals

```text
id
job_analysis_id
quote                JD 原句
competency_id
priority
signal_type          duty | requirement | bonus
source_start nullable
source_end nullable
confidence
```

这样页面中的：

```text
JD 原句 → 能力指标
```

能够由数据库真实返回。

---

## 4.5 assessment_sessions

```text
id
user_id
role_template_id
template_version
resume_id nullable
job_analysis_id nullable
source_mode          resume | job
stage
question_index
status               ready | running | finished | aborted
max_followups        default 2
started_at
finished_at nullable
```

### assessment_questions

```text
id
session_id
sequence
stage
question_type
text
competency_id
evidence_targets      JSON
source_ids            JSON
parent_question_id nullable
is_followup            bool
created_at
```

### assessment_answers

```text
id
session_id
question_id
raw_text
status                completed | incomplete | skipped
submitted_at
```

原始文本保存后禁止被智能服务覆盖。

---

## 4.6 evidence_items

这是整个系统最重要的表。

```text
id
user_id
session_id
question_id nullable
answer_id nullable
competency_id
slot_code
status                 acquired | missing | conflict | incomplete | sufficient | unknown
evidence_type          statement | action | result | tradeoff | boundary | metric | collaboration
quote_text             原始回答引用
quote_start nullable
quote_end nullable
reason
confidence
source_type            assessment | drill | recording | resume_fact
source_id
created_at
```

禁止只存：

```text
“回答不错”
```

必须尽量保存具体引用：

```text
“接口平均响应从 420ms 降至 95ms”
```

---

## 4.7 score_items

```text
id
session_id
competency_id
rubric_version
score                 1..5 nullable
status                satisfied | partial | gap | unknown | incomplete
coverage_weight
reason
evidence_ids          JSON
created_at
```

注意：

- unknown → score NULL
- incomplete → score NULL
- 不是 score = 1

---

## 4.8 reports

```text
id
session_id
match_score
coverage
ability_score
confidence
summary_json
created_at
```

报告详情由 `score_items + evidence_items + questions + answers` 组合得到，不重复复制大量文本。

---

## 4.9 drill_sessions

```text
id
user_id
role_template_id
competency_id
topic
source                self | report | jd_prep | profile | recording
source_ref_id nullable
status
started_at
finished_at
```

### drill_answers

```text
id
drill_session_id
question_index
question_text
raw_answer
score nullable
feedback_json
created_at
```

训练完成后生成新的 `evidence_items`，再由 `ProfileService` 决定是否创建 ProfileEvent。

---

## 4.10 recordings

```text
id
user_id
mode                  dialogue | solo
input_type            audio | text
company nullable
role_name nullable
file_path nullable
status                uploaded | transcribing | transcribed | analyzed | failed
raw_text nullable
created_at
```

### transcript_segments

```text
id
recording_id
speaker               interviewer | candidate | unknown
start_ms nullable
end_ms nullable
text
sequence
```

双人模式先恢复问答结构，再抽 Evidence。

单人模式不硬造“面试官问题”，而是分析：

- 表达结构
- 证据具体度
- 岗位相关性
- 内容完整度

---

## 4.11 knowledge_documents

```text
id
user_id nullable
role_template_id nullable
type                  core | project | job | personal_note
title
source_file_path nullable
raw_text
status                uploaded | indexed | failed
created_at
updated_at
```

### knowledge_chunks

```text
id
document_id
chunk_index
text
metadata_json
embedding_ref
source_id             stable id
```

模型每次检索必须返回 `source_id`，以便日志和报告复查。

---

## 4.12 profile_events

```text
id
user_id
role_template_id
competency_id
source_type
source_id
session_id nullable
question_id nullable
before_score nullable
after_score nullable
reason
evidence_ids JSON
confidence
created_at
```

### profile_snapshots

```text
id
user_id
role_template_id
competency_json
coverage
updated_at
```

Snapshot 是缓存，Event 才是事实来源。

---

## 4.13 Agent 数据

### agent_conversations

```text
id
user_id
title
created_at
updated_at
```

### agent_messages

```text
id
conversation_id
role                  user | assistant | system
content
source_ids JSON
action_plan_json JSON nullable
created_at
```

### agent_actions

```text
id
conversation_id
type                  open_job | start_drill | start_assessment | open_report | open_profile
payload_json
status                pending | executed | failed
created_at
```

成长 Agent 不直接改数据库业务状态，它只调用已有 Application Service。

---

## 5. AssessmentEngine 状态机

### 简历模式

```text
SELF_INTRO
  ↓
PROJECT_DEEP_DIVE
  ↓
COMPETENCY_CHECK
  ↓
SUMMARY
  ↓
FINISHED
```

### 岗位模式

```text
ROLE_UNDERSTANDING
  ↓
CORE_REQUIREMENT_CHECK
  ↓
JOB_SCENARIO
  ↓
MATCH_SUMMARY
  ↓
FINISHED
```

每次提交回答后统一执行：

```text
1. save raw answer
2. extract evidence
3. compare evidence_targets
4. detect missing/conflict/incomplete
5. decide followup / next competency / next stage
6. if sufficient → score current competency
7. return next question + evidence status summary
```

伪代码：

```python
answer = answer_repo.create(raw_text)
result = evidence_engine.extract(question, answer)

if result.incomplete:
    return mark_pending_and_continue()

if result.conflicts:
    return build_neutral_clarification(result.conflicts)

if result.critical_missing and followup_count < 2:
    return build_followup(result.highest_priority_missing)

if result.is_sufficient:
    scoring_engine.score(question.competency_id)
    return next_competency_or_stage()

return mark_pending_and_continue()
```

---

## 6. EvidenceEngine 输出协议

模型不能自由输出一段 prose。

必须返回结构化对象：

```json
{
  "question_id": "q_07",
  "competency_id": "backend-depth",
  "acquired": [
    {
      "slot": "action",
      "quote": "通过联合索引优化了 SQL",
      "type": "action",
      "confidence": 0.94
    }
  ],
  "missing": [
    "index_column_order",
    "explain_before_after",
    "performance_metric"
  ],
  "conflicts": [],
  "incomplete": false,
  "sufficient": false,
  "decision_reason": "只有优化动作，没有验证结果"
}
```

服务端用 Pydantic 校验，不符合协议直接重试或降级处理。

---

## 7. ScoringEngine

### 7.1 能力得分

```text
ability_score = Σ(score_i × weight_i) / Σ(evaluated_weight_i)
```

只有这些状态进入分母：

- satisfied
- partial
- gap（已经真实评估，但存在明确缺口）

不进入：

- unknown
- incomplete

### 7.2 覆盖率

```text
coverage = evaluated_weight / all_weight
```

### 7.3 岗位匹配度

只聚合 `required = true` 的岗位必需能力。

```text
match_score = Σ(required_score_i × weight_i) / Σ(evaluated_required_weight_i)
```

报告必须同时展示覆盖率。

### 7.4 置信度

P0 建议：

```text
confidence = min(1, coverage / 0.8)
```

coverage < 0.8：

```text
结论置信度有限
```

---

## 8. ProfileService 聚合规则

不建议一次训练就让能力分大幅跳动。

P0 可用简单规则：

```text
formal_assessment weight = 1.0
focused_drill      weight = 0.45
recording_review   weight = 0.65
resume_claim       weight = 0
```

新证据对画像的更新同时考虑：

- source weight
- evidence confidence
- recency
- 当前覆盖率

并设置单次最大变化，例如：

```text
正式评估 ±8
专项训练 ±4
录音复盘 ±5
```

这样画像不会因为一道训练题突然从 50 变 90。

---

## 9. Knowledge / RAG

P0 检索流程：

```text
query
→ metadata filter（role / type / user）
→ vector retrieve top_k
→ rerank
→ context package
→ ModelGateway
→ response + source_ids
```

每个上下文块统一：

```json
{
  "source_id": "kb_chunk_0032",
  "document_id": "doc_java_backend",
  "type": "core",
  "title": "Java 后端核心知识库",
  "text": "...",
  "score": 0.83
}
```

严禁在日志中只保存“用了知识库”。

---

## 10. 岗位知识图谱 / 赛题要求兼容

前端不需要新增“图谱中心”，但后端必须能够沉淀岗位图谱。

建议图结构：

```text
JobRole
  ├─ REQUIRES → Competency
  ├─ MENTIONS → Skill
  └─ HAS_SIGNAL → JDSignal

Competency
  ├─ HAS_RUBRIC → Rubric
  ├─ TESTED_BY → Question
  ├─ NEEDS_EVIDENCE → EvidenceSlot
  └─ TRAINED_BY → DrillTopic

Candidate
  └─ HAS_EVIDENCE → Evidence
```

P0 不需要 Neo4j。

可以用关系表：

### graph_nodes

```text
id
node_type
external_id
label
metadata_json
```

### graph_edges

```text
id
source_node_id
target_node_id
edge_type
weight
source_ids
version
```

同时保留内部岗位语料：

### job_corpus

```text
id
source
company
role_name
raw_jd
collected_at
normalized_role_id
```

后续可用于：

- 100+ JD 测试集
- 高频能力统计
- 岗位模板更新
- 新岗位发现
- 图谱动态更新

但 **频率不能直接等于能力权重**，权重仍需模板/Rubric 规则控制。

---

## 11. ModelGateway

界面不暴露模型，但后端必须解耦。

```python
class ModelGateway(Protocol):
    async def structured(self, task, schema, messages): ...
    async def chat(self, messages, stream=False): ...
```

内部可以按环境变量配置。

调用层永远写：

```python
model_gateway.structured(
    task="evidence_extract",
    schema=EvidenceExtraction,
    messages=...
)
```

而不是业务代码里出现某家厂商 SDK。

---

## 12. 异常与降级

### 模型超时

- 不删除原始回答
- session 保持可恢复
- 返回 `analysis_pending`
- 用户可重试

### 结构化输出失败

- schema validation fail
- 自动重试 1 次
- 仍失败：标记 `needs_review`
- 不能编造评分

### 录音转写失败

- 保留录音
- 允许用户手动粘贴文本继续

### RAG 无结果

- 允许继续评估
- source_ids 为空
- 报告标记“无外部标准来源”，不能伪造引用

---

## 13. 日志与审计

建议所有智能决策统一记录：

```text
trace_id
user_id
session_id
action
template_version
input_refs
output_refs
source_ids
latency_ms
status
created_at
```

特别记录：

- 为什么问这题
- 为什么追问
- 为什么停止追问
- 为什么给这个分
- 为什么画像变化

这才是比赛现场最有价值的技术证据。

---

## 14. P0 不做什么

暂不做：

- 微服务拆分
- Kafka / RabbitMQ
- Neo4j
- 多评估器 Agent 投票
- 实时视频面试
- 企业级 RBAC
- 多租户
- 复杂工作流引擎

P0 先把：

```text
JD
→ Resume
→ Assessment
→ Evidence
→ Report
→ Drill
→ Profile
```

做真。

---

## 15. 后端验收标准

后端第一版完成时，必须能用 API 真实跑通：

```text
注册 / 登录
↓
保存一份文本简历
↓
解析 StructuredResume
↓
提交 Java JD
↓
生成 JDSignal 与能力映射
↓
创建岗位面试
↓
提交弱回答
↓
返回 missing evidence + followup
↓
提交补充回答
↓
生成 Evidence
↓
完成报告
↓
点击薄弱项创建 DrillSession
↓
完成训练
↓
生成 ProfileEvent
↓
Profile 发生有来源的变化
```

如果这条链路没有真实跑通，就不能称为后端 P0 完成。
