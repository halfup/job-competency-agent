# 职到 AI API 契约与 P0 开发顺序

> API 前缀：`/api`（本文档原为 P0 设计稿写的 `/api/v1`，实际实现已统一为 `/api`）
>
> 原则：前端页面只依赖稳定业务协议，不依赖具体模型供应商、向量数据库或语音供应商。

## 1. 通用约定

### 1.1 成功响应

```json
{
  "data": {},
  "trace_id": "tr_01J..."
}
```

### 1.2 失败响应

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "JD 至少需要 50 字",
    "details": {}
  },
  "trace_id": "tr_01J..."
}
```

### 1.3 ID

P0 推荐统一使用 UUID 字符串。

### 1.4 时间

统一 ISO 8601 UTC：

```text
2026-09-08T01:20:00Z
```

### 1.5 枚举

Evidence：

```text
acquired
missing
conflict
incomplete
sufficient
unknown
```

Report status：

```text
satisfied
partial
gap
unknown
incomplete
```

Session：

```text
ready
running
finished
aborted
```

---

# 2. Auth

## POST `/auth/register`

```json
{
  "name": "张同学",
  "account": "zhang@example.com",
  "password": "******"
}
```

返回：

```json
{
  "data": {
    "user": {
      "id": "usr_001",
      "name": "张同学"
    },
    "access_token": "...",
    "refresh_token": "..."
  }
}
```

## POST `/auth/login`

```json
{
  "account": "zhang@example.com",
  "password": "******"
}
```

## POST `/auth/refresh`

## GET `/auth/me`

---

# 3. Role Packs

## GET `/roles`

用于顶部岗位切换。

返回：

```json
{
  "data": [
    {
      "id": "java-backend",
      "name": "Java 后端开发工程师",
      "version": "v1.0",
      "seniority": "初中级"
    }
  ]
}
```

## GET `/roles/{role_id}`

返回完整岗位能力包。

当前 `templates/roles.json` 可直接作为首批 seed 数据。

---

# 4. Resume Manager

## GET `/resumes`

对应简历管理左侧“简历库”。

```json
{
  "data": [
    {
      "id": "resume_001",
      "name": "张同学_Java后端简历.pdf",
      "source_type": "pdf",
      "is_active": true,
      "parse_completeness": 0.92,
      "updated_at": "2026-09-08T01:00:00Z"
    }
  ]
}
```

## POST `/resumes`

创建结构化/文本简历。

```json
{
  "name": "Java 后端简历",
  "source_type": "structured",
  "structured_resume": {
    "basic": {},
    "education": [],
    "projects": [],
    "skills": []
  }
}
```

## POST `/resumes/import`

`multipart/form-data`

字段：

```text
file
```

支持：

- pdf
- doc
- docx

返回创建后的 resume，并将 `parse_status` 设为 `pending / completed`。

## GET `/resumes/{resume_id}`

返回：

```json
{
  "data": {
    "id": "resume_001",
    "name": "张同学_Java后端简历.pdf",
    "raw_text": "...",
    "structured_resume": {
      "basic": {
        "name": "张同学",
        "target_role": "Java 后端开发工程师"
      },
      "projects": [
        {
          "name": "校园场地预约服务",
          "responsibilities": ["负责预约接口"],
          "technologies": ["Java", "MySQL", "Redis"],
          "results": ["420ms 降至 95ms"]
        }
      ],
      "skills": ["Java", "Spring Boot", "MySQL", "Redis"]
    },
    "claims": [
      {
        "id": "claim_01",
        "name": "Redis 工程实践",
        "status": "partial",
        "source": "项目使用，但一致性边界尚未验证"
      }
    ]
  }
}
```

## PATCH `/resumes/{resume_id}`

更新 Structured Resume。

## POST `/resumes/{resume_id}/parse`

重新解析并生成 `resume_claims`。

## POST `/resumes/{resume_id}/activate`

设为当前简历。

---

# 5. JD 备面 / Job Analysis

## POST `/jobs/analyze`

请求：

```json
{
  "role_id": "java-backend",
  "company": "示例公司",
  "role_name": "Java 后端开发工程师",
  "raw_jd": "负责核心服务设计与开发……",
  "resume_id": "resume_001",
  "use_resume": true
}
```

返回：

```json
{
  "data": {
    "job_analysis_id": "job_001",
    "role_id": "java-backend",
    "readiness": 68,
    "summary": {
      "high_priority_count": 2,
      "mapped_signal_count": 3,
      "gap_count": 3
    },
    "core_requirements": [
      {
        "quote": "负责数据库设计与性能优化",
        "competency_id": "backend-depth",
        "competency_name": "后端技术深度",
        "priority": "high"
      }
    ],
    "strengths": [],
    "gaps": [],
    "likely_questions": [],
    "prep_plan": []
  }
}
```

前端 JD 备面页面直接用这一份响应渲染，不再自己计算。

## GET `/jobs/{job_analysis_id}`

## POST `/jobs/{job_analysis_id}/reanalyze`

重新分析。

---

# 6. Assessment

## POST `/assessments`

创建评估会话。

简历模式：

```json
{
  "role_id": "java-backend",
  "source_mode": "resume",
  "resume_id": "resume_001"
}
```

岗位模式：

```json
{
  "role_id": "java-backend",
  "source_mode": "job",
  "job_analysis_id": "job_001",
  "resume_id": "resume_001"
}
```

返回：

```json
{
  "data": {
    "session": {
      "id": "sess_001",
      "status": "running",
      "source_mode": "job",
      "stage": "ROLE_UNDERSTANDING",
      "template_version": "v1.0"
    },
    "question": {
      "id": "q_001",
      "sequence": 1,
      "stage": "ROLE_UNDERSTANDING",
      "text": "结合这份 JD……",
      "competency_id": "backend-depth",
      "evidence_targets": [
        "role_priorities",
        "business_understanding"
      ],
      "source_ids": ["job_signal_001"]
    }
  }
}
```

## GET `/assessments/{session_id}`

恢复会话。

## POST `/assessments/{session_id}/answers`

这是最核心接口。

请求：

```json
{
  "question_id": "q_002",
  "text": "我们通过联合索引优化了 SQL。"
}
```

返回弱回答示例：

```json
{
  "data": {
    "answer_id": "ans_002",
    "evidence": {
      "acquired": [
        {
          "slot": "action",
          "quote": "通过联合索引优化了 SQL",
          "status": "acquired"
        }
      ],
      "missing": [
        "index_column_order",
        "explain_before_after",
        "performance_metric"
      ],
      "conflicts": [],
      "incomplete": false,
      "sufficient": false
    },
    "decision": {
      "type": "followup",
      "reason": "关键验证证据不足"
    },
    "next_question": {
      "id": "q_002_f1",
      "parent_question_id": "q_002",
      "is_followup": true,
      "text": "你能具体说明联合索引字段顺序，以及 EXPLAIN 前后有什么变化吗？",
      "competency_id": "backend-depth",
      "evidence_targets": [
        "index_column_order",
        "explain_before_after"
      ]
    }
  }
}
```

补充回答后：

```json
{
  "data": {
    "evidence": {
      "sufficient": true
    },
    "decision": {
      "type": "next_stage"
    },
    "score_update": {
      "competency_id": "backend-depth",
      "rubric_score": 4,
      "reason": "已包含方案、取舍和量化结果"
    },
    "next_question": {}
  }
}
```

## POST `/assessments/{session_id}/skip`

```json
{
  "question_id": "q_003"
}
```

服务端保存：

```text
answer.status = skipped
score = null
report status = unknown / incomplete
```

不能自动变成 1 分。

## POST `/assessments/{session_id}/finish`

允许正常结束或提前结束。

请求：

```json
{
  "reason": "completed"
}
```

提前结束：

```json
{
  "reason": "user_ended"
}
```

后端仍生成当前覆盖范围内的报告。

## GET `/assessments/{session_id}/report`

返回：

```json
{
  "data": {
    "session_id": "sess_001",
    "role": {},
    "match_score": 79,
    "coverage": 0.81,
    "confidence": 0.82,
    "summary": {},
    "competencies": [
      {
        "competency_id": "backend-depth",
        "score": 82,
        "rubric_score": 4,
        "status": "partial",
        "weight": 30,
        "evidence_ids": ["ev_01", "ev_02"]
      }
    ]
  }
}
```

## GET `/assessments/{session_id}/audit/{competency_id}`

用于报告右侧“能力证据审计”。

```json
{
  "data": {
    "competency": {},
    "job_source": {
      "quote": "负责数据库设计与性能优化",
      "source_id": "signal_001"
    },
    "question": {},
    "answer": {
      "raw_text": "……"
    },
    "evidence": [],
    "rubric": {
      "version": "v1.0",
      "level": 4,
      "criteria": "……"
    },
    "reason": "……",
    "evidence_confidence": 0.68
  }
}
```

---

# 7. Focused Drill

## POST `/drills`

```json
{
  "role_id": "java-backend",
  "topic": "redis",
  "competency_id": "reliability",
  "source": "report",
  "source_ref_id": "report_001",
  "question_count": 10
}
```

返回 10 题训练 session。

## POST `/drills/{session_id}/answers`

```json
{
  "question_index": 0,
  "text": "……"
}
```

返回：

```json
{
  "data": {
    "score": 82,
    "feedback": {
      "covered": [],
      "missing": [],
      "suggestion": "……"
    },
    "evidence": []
  }
}
```

## POST `/drills/{session_id}/finish`

返回：

```json
{
  "data": {
    "average_score": 84,
    "answered": 9,
    "total": 10,
    "new_evidence_ids": [],
    "profile_events": [
      {
        "competency_id": "reliability",
        "before": 72,
        "after": 75,
        "reason": "……"
      }
    ]
  }
}
```

---

# 8. Recording Review

## POST `/recordings`

文本模式：

```json
{
  "mode": "dialogue",
  "input_type": "text",
  "company": "",
  "role_name": "Java 后端开发工程师",
  "text": "面试官：……\n候选人：……"
}
```

音频使用：

## POST `/recordings/upload`

multipart：

```text
file
mode
dialogue / solo
company
role_name
```

## POST `/recordings/{recording_id}/transcribe`

返回：

```json
{
  "data": {
    "status": "transcribed",
    "raw_text": "……",
    "segments": [
      {
        "speaker": "interviewer",
        "text": "……"
      },
      {
        "speaker": "candidate",
        "text": "……"
      }
    ]
  }
}
```

## PATCH `/recordings/{recording_id}/transcript`

用户纠正转写文本。

## POST `/recordings/{recording_id}/analyze`

双人模式返回：

- Q&A
- Evidence
- 表现观察

单人模式返回：

- 内容片段
- 表达结构
- 证据具体度
- 岗位相关性

统一带：

```text
evidence_ids
```

## POST `/recordings/{recording_id}/apply-profile`

把确认后的 Evidence 写入画像事件。

---

# 9. Profile

## GET `/profile?role_id=java-backend`

返回：

```json
{
  "data": {
    "role_id": "java-backend",
    "overall_score": 79,
    "coverage": 0.81,
    "competencies": [],
    "due_evidence": [],
    "performance_traits": [],
    "trend": [],
    "recent_events": []
  }
}
```

## GET `/profile/evidence`

参数：

```text
role_id
status
competency_id
limit
cursor
```

## GET `/profile/events`

返回 ProfileEvent 时间线。

---

# 10. Knowledge Base

## GET `/knowledge/documents`

参数：

```text
type
role_id
query
```

## POST `/knowledge/documents`

文本资料。

## POST `/knowledge/documents/import`

文件资料。

## GET `/knowledge/documents/{document_id}`

包含：

- metadata
- index status
- representative chunks
- usage

## DELETE `/knowledge/documents/{document_id}`

## GET `/knowledge/search`

```text
q
role_id
user_only
limit
```

返回必须包含：

```json
{
  "source_id": "chunk_001",
  "document_id": "doc_001",
  "title": "Java 后端核心知识库",
  "text": "……",
  "score": 0.83
}
```

---

# 11. Growth Agent

## POST `/agent/conversations`

创建对话。

## GET `/agent/conversations`

## GET `/agent/conversations/{id}`

## POST `/agent/conversations/{id}/messages`

请求：

```json
{
  "text": "我周五要面 Java 后端，帮我准备一下",
  "role_id": "java-backend"
}
```

返回：

```json
{
  "data": {
    "message": {
      "role": "assistant",
      "content": "……",
      "source_ids": [
        "resume_001",
        "job_001",
        "profile_snapshot_001",
        "report_001"
      ]
    },
    "plan": {
      "title": "Java 后端岗位准备流程",
      "actions": [
        {
          "id": "act_01",
          "type": "start_drill",
          "label": "开始训练",
          "payload": {
            "topic": "redis"
          },
          "status": "pending"
        }
      ]
    }
  }
}
```

## POST `/agent/actions/{action_id}/execute`

Agent Action 必须调用已有业务 Service。

例如：

```text
start_drill
→ DrillService.create()
```

不能 Agent 自己直接 INSERT drill_sessions。

### 流式版本

后续可增加：

```text
POST /agent/conversations/{id}/stream
Content-Type: text/event-stream
```

P0 不是硬要求。

---

# 12. History

## GET `/history`

参数：

```text
type
role_id
limit
cursor
```

统一返回：

```json
{
  "data": {
    "items": [
      {
        "id": "sess_001",
        "type": "assessment",
        "title": "Java 后端岗位评估",
        "role_name": "Java 后端开发工程师",
        "status": "reviewed",
        "score": 79,
        "meta": "覆盖率 81%",
        "summary": "……",
        "created_at": "……"
      }
    ],
    "next_cursor": null
  }
}
```

History 是查询聚合层，不额外复制所有业务数据。

---

# 13. Settings

设置页只保存产品行为：

## GET `/settings`

```json
{
  "data": {
    "evidence_strict": true,
    "auto_profile": true,
    "hints": true
  }
}
```

## PATCH `/settings`

```json
{
  "evidence_strict": true,
  "auto_profile": false,
  "hints": true
}
```

**不提供前端模型供应商配置接口。**

系统内部模型选择属于服务端部署配置，不属于普通用户设置。

---

# 14. 内部 / 管理接口

这些接口不出现在普通用户导航。

## POST `/internal/job-corpus/import`

批量导入岗位 JD 测试集。

## GET `/internal/job-corpus/stats`

## POST `/internal/roles/{role_id}/rebuild-signals`

用于岗位能力图谱统计与模板维护。

## GET `/internal/audit/traces/{trace_id}`

比赛或开发排障时查看：

- 输入引用
- source_ids
- 模板版本
- 模型调用状态
- 决策结果
- latency

---

# 15. 前端页面 → API 映射

| 前端页面 | 主要接口 |
|---|---|
| 登录/注册 | `/auth/*` |
| 首页 | `/profile`, `/history`, `/roles` |
| 简历管理 | `/resumes/*` |
| JD 备面 | `/jobs/analyze`, `/jobs/{id}` |
| 简历模式面试 | `/assessments` + `/answers` |
| 岗位模式面试 | `/assessments` + `/answers` |
| 专项训练 | `/drills/*` |
| 录音复盘 | `/recordings/*` |
| 我的画像 | `/profile/*` |
| 知识库 | `/knowledge/*` |
| 历史记录 | `/history` |
| 评估报告 | `/assessments/{id}/report`, `/audit/*` |
| 成长 Agent | `/agent/*` |
| 设置 | `/settings` |

---

# 16. P0 开发顺序

不要同时开 10 个模块。

## Phase 0：工程骨架

1. FastAPI 启动
2. `/health`
3. SQLAlchemy + SQLite
4. Alembic
5. 统一 response/error/trace_id
6. CORS

验收：

```text
GET /api/health → 200
```

---

## Phase 1：账号 + 简历 + 岗位模板

实现：

- auth
- role seed
- resume CRUD
- text StructuredResume
- active resume

暂时不做 PDF/Word 真解析。

验收：

```text
注册
→ 创建文本简历
→ GET 当前简历
```

---

## Phase 2：JD 分析

实现：

- JobAnalysis
- JobSignal
- JD → competency mapping
- resume gap comparison

P0 第一版可以先用结构化规则 + 模型输出协议。

验收：

```text
Java JD
→ 3 条 JD 原句
→ 3 个能力映射
→ 个人缺口
→ likely questions
```

---

## Phase 3：评估引擎（最重要）

实现：

- AssessmentSession
- 两套 stage machine
- questions
- raw answers
- EvidenceEngine
- followup decision
- 追问最多 2 次

先只支持 Java 后端。

必须真实验收：

```text
“我们通过联合索引优化 SQL”
→ missing: EXPLAIN / 字段顺序 / 性能结果
→ 产生针对性追问
```

这个过不了，不做下一阶段。

---

## Phase 4：评分 + 报告

实现：

- Rubric
- score_items
- coverage
- match score
- audit detail

必须验证：

- unknown 不为 0/1
- incomplete 不计分
- 点击分数能回原回答
- 同一报告可复算

---

## Phase 5：专项训练 + ProfileEvent

实现：

- 10 题 DrillSession
- drill answer
- training evidence
- profile event
- profile snapshot

验收：

```text
报告薄弱项
→ Redis 训练
→ 完成
→ ProfileEvent
→ 画像变化有 reason/source
```

---

## Phase 6：知识库 / RAG

实现：

- document import
- chunk
- index
- retrieval
- source_ids

不要先做复杂 rerank。

P0 目标是：

```text
能检索
能引用
能追来源
```

---

## Phase 7：录音复盘

先做文本模式，再接音频。

顺序：

```text
粘贴转写文本
→ dialogue segmentation
→ evidence
→ review
```

然后再接：

```text
audio upload
→ speech gateway
→ transcript
```

这样没有语音服务时也不阻塞核心闭环。

---

## Phase 8：成长 Agent

最后做。

因为 Agent 本质是前面所有 Service 的编排层。

如果前面没有真实 API，Agent 只能继续是假聊天。

实现：

```text
read profile
read resume
read job
read report
read knowledge
create action plan
execute standard service action
```

---

# 17. 第一周推荐任务拆分

## Day 1

- FastAPI 工程
- database
- auth
- role seed
- health

## Day 2

- resume CRUD
- StructuredResume schema
- JobAnalysis

## Day 3

- assessment session
- question state machine
- answer persistence

## Day 4

- EvidenceEngine
- followup logic
- Java 场景验收

## Day 5

- scoring
- report
- audit chain

## Day 6

- drill
- profile event
- profile snapshot

## Day 7

- 前后端联调
- 全链路 E2E
- 修复异常状态

知识库、录音、Agent 放第二周，不要抢核心链路时间。

---

# 18. 后端 P0 Definition of Done

必须同时满足：

- [ ] 登录是真实 API
- [ ] 简历保存到数据库
- [ ] JD 原句来源真实保存
- [ ] 简历模式与岗位模式使用不同 stage machine
- [ ] 原始回答持久化
- [ ] 弱回答能真实触发 Evidence 缺口
- [ ] followup 原因有记录
- [ ] unknown/incomplete 不错误计分
- [ ] 报告可以回到 raw answer
- [ ] 报告薄弱项可以创建 DrillSession
- [ ] 训练可以生成 ProfileEvent
- [ ] 知识库调用保存 source_ids
- [ ] 录音文本可以生成 Evidence
- [ ] 成长 Agent 只通过标准 Service 执行动作
- [ ] 关键流程有自动化测试

全部满足后，才把前端固定 JSON 删除。
