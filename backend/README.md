# 职到 AI 后端

FastAPI + SQLAlchemy 后端，负责简历、JD 分析、岗位评估、Evidence 抽取、动态追问、可审计报告、画像、专项训练、知识库 RAG、录音复盘与成长 Agent。

## 启动

```bash
python -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
backend/.venv/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port 4173
```

## 环境变量

所有模型与语音密钥均从 `backend/.env` 读取。竞赛源码只提供 `.env.example`，不包含真实凭据。

主要配置：

```text
ZHIDAO_MODEL_*
ZHIDAO_EMBEDDING_*
ZHIDAO_RERANK_*
ZHIDAO_SPEECH_*
ZHIDAO_DATABASE_URL
```

## 主要业务链

```text
Resume
→ JobAnalysis
→ AssessmentSession
→ AssessmentAnswer
→ Evidence
→ Follow-up
→ Report / Audit
→ ProfileEvent
→ Drill / RecordingReview
→ Knowledge RAG
→ Growth Agent
```

## 关键语义

- JD 引用必须来自原始 JD。
- Evidence 引用必须来自候选人原始回答。
- 未覆盖能力保持 `unknown / score=null`。
- 模型不直接拥有确定性评分与覆盖率逻辑。
- Training Evidence 权重低于正式 Assessment。

## 数据库

竞赛/单机版默认 SQLite。运行数据库和用户上传文件不包含在源码包中，首次启动会按配置创建运行数据。

详细设计见：

- `../docs/BACKEND_ARCHITECTURE.md`
- `../docs/API_CONTRACT.md`
