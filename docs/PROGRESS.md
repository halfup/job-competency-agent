# 开发进度记录

> 最后更新：2026-11-11
> 仓库：https://github.com/halfup/job-competency-agent （私有）
> 分支：`main`

---

## 一、项目现状速览

| 维度 | 状态 |
|---|---|
| 前端 | 原生 HTML/CSS/JS 单页，`index.html` + `app.js`（约 2260 行）+ `styles.css` |
| 后端 | FastAPI + SQLAlchemy + SQLite（`backend/data/app.db`） |
| 认证 | **已接入真实登录注册**（用户表 + PBKDF2 密码哈希 + Bearer Token） |
| 数据 | 演示数据集（简历 / JD 分析 / 评估会话 / 知识库 / 训练 / 录音复盘） |
| 启动 | `./scripts/dev.sh`，默认 http://127.0.0.1:4173 |
| 体积 | 约 1.4 MB（源码，不含运行时依赖） |

---

## 二、已完成的工作

### 2026-11-10 · 工程基线

- **代码清理**：删除 72MB 的 Windows 格式 `.venv`、前端死代码（`DEFAULT_JOB_PREPS` / `saveJobPrepRecords` / `persistKnowledgeDoc`）、后端死函数（`followup_with_model` / `score_summary_with_model`）与未使用 import、两份过时的 UI 参考笔记。项目从 73MB 降到 1.4MB。
- **启动脚本**：新增 `scripts/dev.sh`，自动建 venv、装依赖、热重载，免去记命令行。
- **Git 基线**：初始化仓库，`.env` / `*.db` / `uploads` 全部排除；发现 `.gitignore` 的 `*.db` 规则漏掉 `.db-wal` / `.db-shm`，用 `filter-branch` 从历史中彻底清除后重写提交。
- **推送 GitHub**：建私有仓库 `job-competency-agent`，提交作者统一为 `halfup`，推送脚本 `scripts/push-to-github.sh` 支持在任意机器一键推送。

### 2026-11-11 · 登录页与认证

**视觉修复**
- 补回登录页缺失的 `auth-aurora` 背景层（三团浮动光斑 + 网格底纹）与三张卖点卡（岗位能力映射 / Evidence 动态追问 / 长期能力画像）——CSS 一直存在但 HTML 标记丢失，导致左侧大片留白。
- **字号与对比度**：15 处调整。9px 级文字提到 12px（底部提示、错误信息、记住账号），表单标签 10→12px，Tab 11→13px，主按钮 11→14px，输入框补 14px 字号；灰字颜色加深至满足 4.5:1 对比度。

**认证后端**
- 新增 `backend/app/services/auth_service.py`：PBKDF2-SHA256（20 万轮）+ 随机盐的密码哈希，标准库实现，**不引入额外依赖**。
- `users` 表扩展 `account`（唯一索引）与 `password_hash` 字段，新增 `auth_tokens` 表（主键为 token 的 SHA-256，库中不存明文 token，30 天过期，可吊销）。
- 启动时自动补列（`PRAGMA table_info` + `ALTER TABLE`），兼容已有 SQLite 库，无需手工迁移。
- 新增 4 个接口，遵循现有 `{"ok": true, "data": ...}` 响应风格：

  | 方法 | 路径 | 说明 |
  |---|---|---|
  | POST | `/api/auth/register` | 注册，返回 token + 用户信息；重复账号 409 |
  | POST | `/api/auth/login` | 登录；账号或密码错误统一返回 401，避免账号枚举 |
  | POST | `/api/auth/logout` | 吊销当前 token |
  | GET | `/api/auth/me` | 校验会话，用于刷新页面后恢复登录态 |

**认证前端**
- `apiRequest` 自动附带 `Authorization: Bearer <token>`。
- 登录/注册表单改调真实接口，服务端错误信息直接展示在表单下方。
- 启动时用 `/api/auth/me` 校验本地 token，失效自动回登录页；未登录不再请求业务接口。
- 退出登录调用后端吊销接口并清理本地凭据；侧边栏用户名取自当前登录账号。

**验证结果**
- `curl` 全流程通过：注册 200 / 重复注册 409 / 错误密码 401 / 登录 200 / me 200 / 无 token 401 / 登出后 401。
- `npm run build` 结构自检通过。

---

## 三、已知限制与技术债

1. **数据未按用户隔离**：认证只做访问门禁，简历、评估、知识库等业务数据仍统一绑定 `demo-user`。多个账号登录看到的是同一套演示数据。真要做多租户，需要把 `user_id` 贯穿到所有查询与服务层。
2. **忘记密码未实现**：前端仍提示"演示版本暂未接入"。要做需要邮件/短信通道或管理员重置。
3. **服务条款 / 隐私说明是死链**（`javascript:;`）。
4. **Token 存在 localStorage**：便于本机演示，但存在 XSS 读取风险；生产环境建议改 HttpOnly Cookie + CSRF 防护。
5. **无登录失败限流**：目前可无限次尝试密码。
6. **前端仍是单文件巨兽**：`app.js` 2260 行、`styles.css` 360KB，改动容易互相影响。
7. **测试缺失**：没有单元测试与端到端测试，回归全靠手工。

---

## 四、下一步规划

### P0 · 让登录真正闭环（建议优先）
- 密码重置流程（邮件验证码或管理员重置接口）
- 登录失败限流（按账号 + IP 计数，超限锁定 5 分钟）
- 服务条款 / 隐私说明落成实际页面

### P1 · 多用户数据隔离
- 业务表查询统一带 `user_id`，注册时为新用户初始化专属数据（或提供"载入示例数据"）
- `DEMO_USER_ID` 逐步退化为只读演示账号

### P1 · 前端工程化
- 按页面拆分 `app.js`（home / resume / interview / drill / report / profile / knowledge / agent）
- `styles.css` 拆分并引入构建（可先用简单 concat，避免引入重型工具链）
- 抽取设计令牌（字号、间距、颜色）为 CSS 变量，避免再次出现 9px 这类碎片化字号

### P2 · 功能增强
- 报告导出 PDF、面试录音回放的交互优化
- 成长 Agent 的多轮会话持久化与上下文压缩
- 知识库增量索引（目前全量重建）

### P2 · 质量保障
- 后端 pytest 覆盖认证、评估评分、Evidence 抽取三条主链路
- 前端 Playwright 冒烟测试：登录 → 面试 → 报告

---

## 五、常用命令

```bash
# 启动（首次自动建 venv）
./scripts/dev.sh

# 结构自检
npm run build

# 推送到 GitHub
GITHUB_TOKEN=ghp_xxx ./scripts/push-to-github.sh --existing

# 直接调认证接口
curl -X POST http://127.0.0.1:4173/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"account":"13800138000","password":"Abc12345!","name":"张同学"}'
```

> 环境提示：本机 `/tmp` 仅 10MB，pip 安装需 `TMPDIR=/var/tmp`；本机有 HTTP 代理，浏览器访问本地服务需 `NO_PROXY=127.0.0.1`。
