# 职到 AI · 岗位胜任力评估智能体

面向求职与岗位胜任力评估的 Evidence-grounded AI 系统。系统围绕“岗位要求是否被真实证据覆盖”组织完整流程，而不是仅根据简历关键词或一次回答直接给分。

## 核心业务闭环

```text
简历 / JD
→ 岗位能力映射
→ 面试问题
→ 动态 Evidence Gap 追问
→ 回答原文引用
→ Rubric 评分与待验证状态
→ 可审计评估报告
→ ProfileEvent
→ 长期能力画像
→ 专项训练 / 录音复盘
→ 知识库 RAG
→ 成长 Agent
```

## 核心特性

- JD 原句可追溯：能力要求与面试问题保留岗位描述原文来源。
- Evidence 可审计：评分结果可回到候选人原始回答引用。
- Evidence Gap 动态追问：证据不足时优先追问，不把未知直接计为低分。
- 待验证语义：未覆盖能力保持 `unknown / score=null`。
- 长期画像：正式评估、训练和录音复盘通过 ProfileEvent 回流。
- 知识库混合检索：Lexical + Embedding + Reranker。
- 成长 Agent：结合画像、JD、历史记录和 RAG 证据生成下一步行动建议。
- 录音复盘：支持 ASR 转写后进入 Q&A / Evidence / Profile 流程。
- 深色模式：主要业务页面均已适配。

## 技术栈

### 前端

- 原生 HTML / CSS / JavaScript
- 单页应用式页面切换
- 响应式布局与深色模式

### 后端

- Python
- FastAPI
- SQLAlchemy
- SQLite（竞赛/单机版）
- OpenAI-compatible LLM Gateway
- Embedding Gateway
- Reranker Gateway
- WebSocket ASR Gateway

## 模型能力

代码不绑定具体厂商，统一通过环境变量配置。

当前工程支持：

- 主推理模型：OpenAI-compatible Chat Model
- Embedding：OpenAI-compatible Embeddings API
- Reranker：HTTP `/rerank`
- ASR：WebSocket 实时语音转写

真实密钥不会包含在竞赛源码包中。配置方法见：

```text
backend/.env.example
```

## 本地启动

推荐 Python 3.10+。一键启动（首次会自动建 venv 并装依赖）：

```bash
./scripts/dev.sh          # 开发模式，代码改动自动重载
./scripts/dev.sh --no-reload
```

或手动启动：

```bash
python -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
cp backend/.env.example backend/.env      # 首次需填写密钥
backend/.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 4173
```

> 注意：`backend/.venv` 不可跨操作系统复用。若从其他机器拷贝过来（例如里面是 `Scripts/*.exe`），删掉重建即可。
> 若 pip 安装报 `Errno 28` 磁盘空间不足，说明 `/tmp` 太小，用 `TMPDIR=/var/tmp` 前缀再执行。

访问：

```text
http://127.0.0.1:4173/
```

## 前端构建检查

```bash
npm run build
```

项目为轻量前端结构，构建命令主要执行模板、页面结构与关键文件检查。

## 主要目录

```text
.
├── index.html                 # 前端入口
├── app.js                     # 前端业务逻辑
├── styles.css                 # 全站样式与深色模式
├── templates/roles.json       # 岗位模板
├── assets/                    # 品牌资源
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI 入口
│   │   ├── models.py          # 数据模型
│   │   ├── gateways/          # LLM / Embedding / ASR 等网关
│   │   └── services/          # JD / Assessment / RAG / Agent 等业务服务
│   ├── requirements.txt
│   └── .env.example
├── docs/
│   ├── ARCHITECTURE.md        # 全局架构总览（分层、目录、API 地图、数据模型）
│   ├── BACKEND_ARCHITECTURE.md
│   └── API_CONTRACT.md
└── scripts/
    ├── dev.sh                 # 一键启动（建 venv + 装依赖 + 热重载）
    ├── build-check.mjs        # 前端结构自检
    └── push-to-github.sh      # 推送到 GitHub（自动建私有仓库）
```

## 多机协作 / 同步提交

仓库已初始化 git，分支为 `main`。`.env`、`*.db`、`uploads/` 均已忽略，**密钥和本机数据不会入库**。

在新机器上拉取：

```bash
git clone https://github.com/<你的账号>/job-competency-agent.git
cd job-competency-agent
cp backend/.env.example backend/.env   # 填入自己的密钥
./scripts/dev.sh
```

日常提交：

```bash
git add -A && git commit -m "feat: 说明改了什么" && git push
```

若两台机器都改过，推送前先 `git pull --rebase`，避免冲突提交。

## 竞赛源码包安全说明

竞赛源码包会排除：

- `backend/.env`
- SQLite 运行数据库及 WAL/SHM
- 用户上传文件
- `.venv`
- `node_modules`
- 服务日志与 PID 文件
- 开发过程备份目录

因此源码包可以用于评审、答辩和代码审查，但首次运行前需要自行填写模型与 ASR 的环境变量。

## 数据与评分原则

1. 简历声明只用于决定“应该验证什么”，不直接作为能力得分。
2. 模型负责语义抽取与建议，核心评分、覆盖率和 sufficiency 由后端确定性逻辑约束。
3. 未获得足够证据的能力保持“待验证”，不得自动按 0 分处理。
4. Training Evidence 权重低于正式 Assessment，不应直接降低正式画像得分。
5. 报告应能从结论回溯至 JD、问题、原始回答、Evidence 与 Rubric。
