# 职到 AI · 项目架构总览

> 面向求职与岗位胜任力评估的 **Evidence-grounded** 系统。
> 核心不是"简历关键词打分"，而是围绕"岗位要求是否被真实证据覆盖"组织完整闭环。

---

## 1. 一句话架构

前端是**零框架单页应用**（模板字符串渲染 + 全局状态），后端是 **FastAPI 分层单体**（路由层 / 服务层 / 模型网关 / 数据层），
模型能力全部通过**可降级的网关**接入，确定性评分与覆盖率逻辑留在后端代码里，不交给模型。

```text
浏览器（原生 HTML/CSS/JS SPA）
        │  fetch /api/*  ·  WebSocket ASR（录音转写）
        ▼
FastAPI（backend/app/main.py，单文件路由层，约 50 个 /api 端点）
        │
        ├── services/   业务规则层（证据抽取、Rubric 评分、RAG、JD 拆解、训练、复盘、Agent）
        ├── gateways/   模型网关层（LLM / Embedding / Rerank / ASR，均可缺省降级）
        └── models.py   SQLAlchemy 数据层（SQLite，WAL 模式，启动自动建表 + seed）
```

---

## 2. 技术栈与运行形态

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 前端 | 原生 HTML / CSS / JavaScript（ES Module） | 无构建、无框架；单入口 `index.html` → `app.js` |
| 后端 | Python 3.10+ / FastAPI / SQLAlchemy 2 / Pydantic v2 | 单进程单体，前后端同源部署 |
| 存储 | SQLite（WAL + busy_timeout 30s） | 竞赛/单机形态；可用 `ZHIDAO_DATABASE_URL` 换库 |
| 模型 | OpenAI-compatible Chat / Embeddings、HTTP `/rerank`、WebSocket ASR | 全部环境变量驱动，不绑定厂商 |
| 部署 | 单端口 4173 | 后端同时托管前端静态资源（`/`、`/app.js`、`/styles.css`、`/templates`、`/assets`） |

---

## 3. 目录地图

```text
demo/
├── index.html                 # 唯一 HTML 入口：只挂载 <div id="app">
├── app.js                     # 前端全部逻辑（约 2.1k 行）：状态机 + 13 个视图渲染函数
├── styles.css                 # 全站样式 + 深色模式（约 1.7k 行）
├── templates/roles.json       # 岗位模板（前端读取 + 后端 seed 共用，单一事实源）
├── assets/brand/              # 品牌图形资源
├── scripts/build-check.mjs    # 轻量构建检查：校验关键文件、roles.json 结构、模板加载
├── package.json               # 仅 build / start 两个脚本，无运行时依赖
├── docs/
│   ├── ARCHITECTURE.md        # 本文件：全局架构总览
│   ├── BACKEND_ARCHITECTURE.md# 后端设计约束、数据表设计、规则细节
│   └── API_CONTRACT.md        # 接口契约与 P0 开发顺序
└── backend/
    ├── requirements.txt       # 9 个依赖：fastapi / uvicorn / sqlalchemy / pydantic / multipart / pypdf / python-docx / websocket-client
    ├── .env.example           # 全部配置项模板（真实 .env 不入库）
    ├── README.md              # 启动方式与关键语义
    ├── app/
    │   ├── main.py            # 路由层：全部 /api 端点 + 静态资源托管（约 1.9k 行）
    │   ├── models.py          # 15 张表的数据模型
    │   ├── config.py          # Pydantic Settings，前缀 ZHIDAO_，读取 backend/.env
    │   ├── database.py        # 引擎 / 会话 / SQLite PRAGMA（WAL、外键、超时）
    │   ├── seed.py            # 启动种子：demo 用户、角色包、示例简历与知识库
    │   ├── gateways/          # 模型网关：抽象基类 + 未配置降级实现 + OpenAI 兼容实现
    │   └── services/          # 业务服务（见下表）
    └── data/                  # 运行时数据：app.db / uploads（不入库）
```

### services 职责划分

| 模块 | 职责 | 关键函数 |
| --- | --- | --- |
| `assessment_service.py` | 证据槽位、Rubric 评分、追问生成（**确定性规则**） | `base_targets` / `extract_evidence` / `rubric_score` / `followup_question` |
| `ai_service.py` | 模型侧增强：JD 拆解、证据抽取、成长 Agent | `analyze_job_with_model` / `extract_evidence_with_model` / `growth_agent_with_model` |
| `job_service.py` | JD 原文分句与岗位能力映射（纯规则兜底） | `analyze_job` / `sentences` |
| `resume_service.py` | PDF/DOCX 文本抽取与简历结构化解析 | `extract_text_from_file` / `parse_resume_text` |
| `retrieval_service.py` | 知识库混合检索：Lexical + Embedding + Rerank | `index_document` / `hybrid_search` / `reindex_all` |
| `asr_service.py` | WebSocket 语音转写、PCM 归一化、说话人合并 | `transcribe_pcm16k` / `normalize_audio_to_pcm16k` |
| `product_services.py` | 题目图谱、专项训练出题评分、录音分析、Agent 兜底回复 | `build_question_graph` / `evaluate_drill_answer` / `analyze_recording_text` |

---

## 4. 前端架构

- **渲染方式**：`renderView()` 按 `S.view` 分发到 13 个视图函数，每个函数返回 HTML 字符串塞进 `#app`；无虚拟 DOM、无路由库，靠 `data-nav` 属性做事件代理。
- **视图清单**：`home`（工作台）、`resume`（简历管理）、`job`（JD 备面）、`interview`（面试训练）、`drill`（专项训练）、`graph`（题目图谱）、`recording`（录音复盘）、`report`（评估报告）、`profile`（能力画像）、`knowledge`（知识库）、`history`（历史记录）、`growth`（成长 Agent）、`settings`（设置）。
- **状态**：单一全局对象 `S`（角色、当前视图、面试会话、报告、画像、知识库、图谱等），偏好写 `localStorage`（如 `zhidao-role`、`zhidao-training-domain`、`zhidao-kb-store`）。
- **接口约定**：统一 `apiRequest(path)` → `API_BASE = '/api'`，响应包装 `{ ok: true, data }`。
- **降级策略**：后端接口不可用时，前端保留内置题库 / 示例画像 / 本地知识库，页面不白屏；后端恢复后以后端数据为准。

---

## 5. 后端架构

四层单向依赖：路由 → 服务 → 网关 → 数据，反向不依赖。

```text
main.py（路由层，全部端点集中）
  ├─ 解析参数、鉴权边界、响应包装 ok()
  ├─ 编排一次业务事务（多次 service 调用 + 单次 commit）
  ▼
services/*（业务规则层，纯函数为主，可单测）
  ├─ assessment_service：槽位/覆盖率/Rubric —— 确定性
  ├─ ai_service：模型增强 —— 失败即回退规则结果
  ├─ retrieval_service：混合检索（词法 ∪ 向量 → rerank 截断）
  ▼
gateways/model_gateway.py（模型网关层）
  ├─ ModelGateway(ABC)          → OpenAICompatibleModelGateway
  └─ UnconfiguredModelGateway   → 未配置密钥时的空实现（保证系统可跑）
  ▼
models.py + database.py（数据层，SQLAlchemy 2.0 Declarative）
```

**启动流程**：`@app.on_event("startup")` → `Base.metadata.create_all()` → `seed()`（幂等：demo 用户、按 `roles.json` 同步角色包、示例简历 / 知识库）。

---

## 6. API 地图（全部挂在 `/api`）

| 分组 | 端点 | 说明 |
| --- | --- | --- |
| 基础 | `GET /health`、`GET /roles`、`GET /roles/{id}` | 健康检查、岗位模板 |
| 工作台 | `GET /dashboard` | 首页聚合数据 |
| 设置 | `GET/PATCH /settings` | 证据严格度、自动画像、提示开关 |
| 简历 | `GET/POST/PATCH/DELETE /resumes`、`/{id}/parse`、`/{id}/activate`、`POST /resumes/import` | 简历 CRUD、解析、启用、文件导入 |
| JD 备面 | `GET /jobs`、`POST /jobs/analyze`、`GET/DELETE /jobs/{id}`、`/{id}/reanalyze` | JD 拆解与备面记录 |
| 评估 | `POST /assessments`、`GET /assessments/{id}`、`POST /answers`、`POST /skip`、`POST /finish`、`GET /report`、`GET /audit/{competency_id}` | 面试主链路 + 可审计报告 |
| 画像 | `GET /profile`、`GET /profile/events` | 长期画像与事件流 |
| 专项训练 | `GET/POST /drills`、`GET /drills/{id}`、`POST /drills/{id}/attempts`、`POST /drills/{id}/finish` | 训练会话与逐题评分 |
| 知识库 | `GET/POST /knowledge`、`GET /knowledge/search`、`POST /reindex`、`GET/PATCH/DELETE /knowledge/{id}`、`POST /knowledge/import` | 文档 CRUD + 混合检索 + 重建索引 |
| 录音复盘 | `GET/POST /recordings`、`POST /recordings/transcribe`、`GET /recordings/{id}`、`/{id}/analyze`、`/{id}/sync-profile` | 转写 → 分析 → 回流画像 |
| 图谱 | `GET /question-graph` | 岗位题目关系图 |
| 历史 | `GET /history` | 评估 / 训练 / 复盘统一时间线 |
| 成长 Agent | `GET/POST /agent/conversations`、`GET /agent/conversations/{id}`、`POST /{id}/messages`、`PATCH /{id}/plan` | 会话、消息、行动计划 |

---

## 7. 数据模型（15 张表）

```text
User ─┬─ UserSetting
      ├─ RolePack（岗位包，按 roles.json 版本化同步）
      ├─ Resume ────────┐
      ├─ JobAnalysis ───┤（JD 原句 → 能力信号）
      ├─ AssessmentSession ── AssessmentAnswer ── Evidence
      │        └── 评分/报告结论可回溯到 Answer 原文
      ├─ DrillSession ── DrillAttempt
      ├─ RecordingReview
      ├─ KnowledgeDocument ── KnowledgeChunk（chunk + 向量索引）
      ├─ AgentConversation（含 plan_json）
      └─ ProfileEvent（画像唯一写入口，事件驱动快照）
```

画像不由任何流程直接改分数，而是写 `ProfileEvent`（正式评估权重最高，训练/复盘权重较低），再由画像接口聚合。

---

## 8. 核心业务闭环

```text
简历 / JD
  → 岗位能力映射（JD 原句可追溯）
  → 生成面试问题（每个问题带 evidence_targets 槽位）
  → 候选人回答原文
  → 证据抽取（命中槽位 / 缺失槽位）
  → 缺失则动态追问（Evidence Gap），不把"未知"记为低分
  → Rubric 评分 + verified / partial / gap / unknown 状态
  → 可审计报告（结论 → 问题 → 原回答 → 证据 → Rubric 全链路）
  → ProfileEvent
  → 长期能力画像
  → 专项训练 / 录音复盘（低权重回流）
  → 知识库 RAG（提供岗位标准与上下文）
  → 成长 Agent（画像 + JD + 历史 + RAG → 下一步行动建议）
```

---

## 9. 五条不可违反的设计约束

1. 简历声明只决定"该验证什么"，**不直接产生能力分**。
2. 所有评分必须经过 Evidence；模型只做语义抽取与建议，评分/覆盖率/sufficiency 由后端确定性逻辑决定。
3. 未获得足够证据的能力保持 `unknown / score = null`，**不得按 0 分处理**。
4. 原始回答不可被模型改写后覆盖，只追加。
5. Training Evidence 权重低于正式 Assessment，不得直接压低正式画像。

---

## 10. 本地启动

```bash
python -m venv backend/.venv
# Windows: backend/.venv/Scripts/activate    macOS/Linux: source backend/.venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env        # 填入模型 / Embedding / Rerank / ASR 配置
backend/.venv/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port 4173
# 访问 http://127.0.0.1:4173/
npm run build                               # 前端结构检查
```

不配置模型密钥也能启动：网关会退化为 `UnconfiguredModelGateway`，规则链路（槽位匹配、Rubric、词法检索）仍然可用。

---

## 11. 工程约定

- 仓库不包含：`backend/.env`、`backend/data/`（app.db 与 uploads）、`.venv`、日志 / PID 文件、开发期备份目录。
- 岗位模板只维护 `templates/roles.json` 一份，前端直接读取、后端 seed 同步入库。
- 每份运行数据都在 `backend/data/` 下，删除即可回到初始 seed 状态。
