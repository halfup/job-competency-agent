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

### 2026-11-11 · P0 登录闭环（本轮新增）

**登录失败限流**
- `auth_service.py` 新增内存级限流：同一「账号 + IP」连续失败 5 次后锁定 5 分钟，期间返回 429；登录成功自动清零，锁定过期自动解除；失败记录 24 小时 TTL，超 1 万条自动清理。
- `login_user` 接入 `client_ip`（取自 `request.client.host`），锁定只影响该账号+IP 组合，不影响其他账号。

**密码重置（验证码流程）**
- 新增 `password_reset_codes` 表：只存 sha256(验证码)，10 分钟有效，最多错 5 次，一次一码（新申请作废旧码）。
- 新增 2 个接口：`POST /api/auth/reset/request`（防账号枚举，账号不存在也返回成功结构）、`POST /api/auth/reset/confirm`（验证通过后改密并吊销该用户全部 token、清空登录限流）。
- 发送通道可插拔：配置 `ZHIDAO_SMTP_*` 环境变量后，邮箱账号真实发送邮件（标准库 smtplib，无新依赖）；未配置时进入**演示模式**，验证码随接口返回（`dev_code`），保证答辩演示可走通全流程。
- 同一账号 60 秒内只能申请一次验证码（429）。
- 前端登录页新增「重置密码」模式：步骤 1 输入账号 → 步骤 2 验证码 + 新密码 + 确认，成功后回登录页并预填账号；演示模式下验证码直接显示在提示中。

**服务条款 / 隐私说明 / 帮助中心**
- 登录页页脚三个死链（`javascript:;`）替换为真实弹窗：条款 5 节、隐私 6 节（含录音上传与 LLM 网关数据流说明）、帮助 6 条 FAQ。
- 注册表单「服务条款与隐私说明」文案改为可点击，点击打开对应弹窗。
- 图标集补充 `x`（关闭）图标；`auth-view-check.mjs` 渲染冒烟测试覆盖全部表单模式与弹窗。

**验证**
- curl：限流 401×4 → 429 锁定；重置全流程（申请/节流/错码/正确码/旧会话吊销/新旧密码登录）全部通过。
- 浏览器实测：忘记密码 → 验证码 → 重置 → 新密码登录进入工作台 → 条款弹窗开合，全链路 OK。
- `node scripts/auth-view-check.mjs` 11 项渲染检查通过；`npm run build` 通过。

---

## 三、已知限制与技术债

1. **数据未按用户隔离**：认证只做访问门禁，简历、评估、知识库等业务数据仍统一绑定 `demo-user`。多个账号登录看到的是同一套演示数据。真要做多租户，需要把 `user_id` 贯穿到所有查询与服务层。
2. ~~忘记密码未实现~~、~~服务条款/隐私说明死链~~、~~无登录失败限流~~：**已于 2026-11-11 P0 阶段解决**（验证码重置 + 限流锁定 + 法务弹窗）。
3. **密码重置的邮件通道默认未配置**：当前为演示模式（验证码直接返回）。生产使用需配置 `ZHIDAO_SMTP_*` 环境变量，并建议改为 HttpOnly Cookie 会话。
4. **Token 存在 localStorage**：便于本机演示，但存在 XSS 读取风险；生产环境建议改 HttpOnly Cookie + CSRF 防护。
5. **限流与验证码节流为单机内存实现**：重启即清零，多实例部署需换 Redis 等共享存储。
6. **前端仍是单文件巨兽**：`app.js` 约 2300 行、`styles.css` 360KB，改动容易互相影响。
7. **测试仍薄弱**：已新增 `scripts/auth-view-check.mjs` 渲染冒烟测试（11 项），但无单元测试与端到端测试，回归主要靠手工。
8. **应用内页脚仍有死链**：工作台首页的「使用帮助/反馈建议/关于职到」仍为 `javascript:;`（登录页已修复，应用内未处理）。

---

## 四、下一步规划

### P0 · 让登录真正闭环 ✅ 已完成（2026-11-11）
- ~~密码重置流程~~ → 验证码重置（SMTP 可插拔，未配置走演示模式）
- ~~登录失败限流~~ → 账号+IP 连续 5 次锁定 5 分钟
- ~~服务条款 / 隐私说明落地~~ → 登录页法务弹窗（条款/隐私/帮助）
- 遗留小项：工作台内页脚死链（见技术债 8）

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
