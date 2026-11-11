"""用户认证服务。

设计取舍（轻量优先）：
- 密码哈希使用标准库 hashlib.pbkdf2_hmac（sha256, 20 万轮），不引入 bcrypt 等额外依赖。
- Token 使用 secrets.token_urlsafe(32) 随机生成；数据库只存 sha256(token)，泄露库不泄露 token。
- 工作区数据仍绑定 DEMO_USER_ID（演示数据共享），认证只做访问门禁；
  后续如需多用户数据隔离，再把 user_id 贯穿到各业务表查询。
"""
from __future__ import annotations

import hashlib
import re
import secrets
import smtplib
from datetime import datetime, timedelta
from email.message import EmailMessage
from typing import Any, Optional

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..models import AuthToken, PasswordResetCode, User

PBKDF2_ITERATIONS = 200_000
TOKEN_TTL_DAYS = 30

# 登录失败限流：同一「账号 + IP」连续失败超过阈值后锁定一段时间
LOGIN_MAX_FAILURES = 5
LOGIN_LOCK_MINUTES = 5
_LOGIN_FAILURE_TTL_SECONDS = 24 * 60 * 60  # 失败记录最长保留 24 小时，避免内存无限增长

PHONE_RE = re.compile(r"^1[3-9]\d{9}$")
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")

# 内存实现（竞赛/单机版足够）：key = "account\tip"（账号统一小写化）
_login_failures: dict[str, dict[str, Any]] = {}


class AuthError(Exception):
    """业务错误，message 可直接展示给用户。"""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def account_kind(account: str) -> Optional[str]:
    if PHONE_RE.match(account):
        return "phone"
    if EMAIL_RE.match(account):
        return "email"
    return None


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iterations, salt, expected = stored.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), int(iterations))
        return secrets.compare_digest(digest.hex(), expected)
    except (ValueError, AttributeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_token(db: Session, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    db.add(AuthToken(
        id=_token_hash(token),
        user_id=user_id,
        expires_at=datetime.utcnow() + timedelta(days=TOKEN_TTL_DAYS),
    ))
    db.commit()
    return token


def resolve_token(db: Session, token: str) -> Optional[User]:
    if not token:
        return None
    row = db.get(AuthToken, _token_hash(token))
    if not row or row.expires_at < datetime.utcnow() or row.revoked:
        return None
    return db.get(User, row.user_id)


def revoke_token(db: Session, token: str) -> None:
    row = db.get(AuthToken, _token_hash(token))
    if row and not row.revoked:
        row.revoked = True
        db.commit()


def user_payload(user: User) -> dict[str, Any]:
    return {"id": user.id, "name": user.name, "account": user.account or ""}


def register_user(db: Session, *, account: str, password: str, name: str) -> User:
    account = (account or "").strip()
    name = (name or "").strip()
    if not account_kind(account):
        raise AuthError("账号格式不正确，请输入有效的手机号或邮箱")
    if len(password) < 8 or len(password) > 72:
        raise AuthError("密码长度需为 8-72 位")
    if not name:
        raise AuthError("请输入姓名")
    existing = db.execute(select(User).where(User.account == account)).scalar_one_or_none()
    if existing:
        raise AuthError("该账号已注册，请直接登录", status=409)
    user = User(
        id=f"user-{secrets.token_hex(8)}",
        account=account,
        name=name,
        password_hash=hash_password(password),
    )
    db.add(user)
    db.commit()
    return user


def login_user(db: Session, *, account: str, password: str, client_ip: str = "") -> User:
    account = (account or "").strip()
    client_ip = (client_ip or "").strip() or "unknown"
    check_login_allowed(account, client_ip)
    user = db.execute(select(User).where(User.account == account)).scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(password, user.password_hash):
        # 统一报错，不区分「账号不存在」与「密码错误」，避免账号枚举
        record_login_failure(account, client_ip)
        raise AuthError("账号或密码不正确", status=401)
    clear_login_failures(account, client_ip)
    return user


# ---------------- 登录失败限流（内存实现，单机/竞赛版） ----------------


def _failure_key(account: str, client_ip: str) -> str:
    return f"{(account or '').strip().lower()}\t{client_ip}"


def _purge_stale_failures() -> None:
    """清理过期失败记录，防止字典无限膨胀。"""
    if len(_login_failures) < 10_000:
        return
    now_ts = datetime.utcnow().timestamp()
    for key in [k for k, v in _login_failures.items() if v.get("expires", 0) < now_ts]:
        _login_failures.pop(key, None)


def check_login_allowed(account: str, client_ip: str) -> None:
    """登录前检查：若已触发锁定则抛 429，并附带剩余锁定秒数。"""
    rec = _login_failures.get(_failure_key(account, client_ip))
    if not rec:
        return
    locked_until = rec.get("locked_until")
    if not locked_until:
        return
    remaining = locked_until - datetime.utcnow()
    if remaining.total_seconds() <= 0:
        # 锁定期已过，清除记录给用户全新机会
        _login_failures.pop(_failure_key(account, client_ip), None)
        return
    minutes = int(remaining.total_seconds() // 60) + 1
    raise AuthError(
        f"失败次数过多，该账号已临时锁定，请约 {minutes} 分钟后再试",
        status=429,
    )


def record_login_failure(account: str, client_ip: str) -> None:
    """记一次失败；达到阈值则锁定 LOGIN_LOCK_MINUTES 分钟。"""
    key = _failure_key(account, client_ip)
    _purge_stale_failures()
    rec = _login_failures.setdefault(key, {"count": 0, "locked_until": None, "expires": 0.0})
    rec["count"] += 1
    rec["expires"] = (datetime.utcnow() + timedelta(seconds=_LOGIN_FAILURE_TTL_SECONDS)).timestamp()
    if rec["count"] >= LOGIN_MAX_FAILURES:
        rec["locked_until"] = datetime.utcnow() + timedelta(minutes=LOGIN_LOCK_MINUTES)
        raise AuthError(
            f"密码连续错误 {LOGIN_MAX_FAILURES} 次，账号已锁定 {LOGIN_LOCK_MINUTES} 分钟",
            status=429,
        )


def clear_login_failures(account: str, client_ip: str) -> None:
    """登录成功后清零失败计数。"""
    _login_failures.pop(_failure_key(account, client_ip), None)


# ---------------- 密码重置（验证码流程） ----------------

RESET_CODE_TTL_MINUTES = 10
RESET_CODE_MAX_ATTEMPTS = 5
RESET_REQUEST_MIN_INTERVAL_SECONDS = 60

# 请求节流：key = 账号小写，value = 上次请求时间戳
_reset_code_last_request: dict[str, float] = {}


def _smtp_configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_user and settings.smtp_password)


def _send_reset_email(to_email: str, code: str) -> None:
    """通过 SMTP SSL 发送验证码邮件（标准库实现，无额外依赖）。"""
    msg = EmailMessage()
    msg["Subject"] = f"职到 AI 密码重置验证码：{code}"
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to_email
    msg.set_content(
        f"您正在重置「职到 AI」账号密码。\n\n"
        f"验证码：{code}\n"
        f"{RESET_CODE_TTL_MINUTES} 分钟内有效。若非本人操作，请忽略本邮件。\n"
    )
    with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10) as server:
        server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)


def request_password_reset(db: Session, *, account: str, client_ip: str = "") -> dict[str, Any]:
    """申请重置验证码。

    - 无论账号是否存在都返回成功结构（防账号枚举）；账号不存在时不真正消耗发送通道。
    - 邮箱账号 + 已配置 SMTP → 真实发送邮件，响应不含验证码。
    - 否则进入演示模式：验证码随响应返回（`dev_code`），便于竞赛/本地演示走通全流程。
    """
    account = (account or "").strip()
    if not account_kind(account):
        raise AuthError("账号格式不正确，请输入有效的手机号或邮箱")

    # 节流：同一账号 60 秒内只能申请一次
    last = _reset_code_last_request.get(account.lower())
    now_ts = datetime.utcnow().timestamp()
    if last and now_ts - last < RESET_REQUEST_MIN_INTERVAL_SECONDS:
        wait = RESET_REQUEST_MIN_INTERVAL_SECONDS - int(now_ts - last)
        raise AuthError(f"请求过于频繁，请 {wait} 秒后再试", status=429)
    _reset_code_last_request[account.lower()] = now_ts

    user = db.execute(select(User).where(User.account == account)).scalar_one_or_none()

    # 作废该账号之前所有未用验证码，一次一码
    db.execute(
        update(PasswordResetCode)
        .where(PasswordResetCode.account == account, PasswordResetCode.used == False)  # noqa: E712
        .values(used=True)
    )

    code = f"{secrets.randbelow(1_000_000):06d}"
    db.add(PasswordResetCode(
        id=f"reset-{secrets.token_hex(12)}",
        account=account,
        code_hash=hashlib.sha256(code.encode("utf-8")).hexdigest(),
        expires_at=datetime.utcnow() + timedelta(minutes=RESET_CODE_TTL_MINUTES),
    ))
    db.commit()

    if user is None:
        # 账号不存在：返回与存在时一致的结构，但不发送
        return {"sent": False, "channel": "email"}

    # 邮箱账号且 SMTP 已配置 → 真实发送
    if account_kind(account) == "email" and _smtp_configured():
        try:
            _send_reset_email(account, code)
            return {"sent": True, "channel": "email"}
        except Exception:
            # 发送失败降级为演示模式，保证流程可用
            return {"sent": False, "channel": "demo", "dev_code": code}

    # 演示模式：验证码直接返回
    return {"sent": False, "channel": "demo", "dev_code": code}


def confirm_password_reset(db: Session, *, account: str, code: str, new_password: str, client_ip: str = "") -> User:
    """校验验证码并重置密码；成功后吊销该用户全部 token 并清空登录限流计数。"""
    account = (account or "").strip()
    code = (code or "").strip()
    if not account_kind(account):
        raise AuthError("账号格式不正确，请输入有效的手机号或邮箱")
    if len(new_password) < 8 or len(new_password) > 72:
        raise AuthError("新密码长度需为 8-72 位")

    row = db.execute(
        select(PasswordResetCode)
        .where(PasswordResetCode.account == account, PasswordResetCode.used == False)  # noqa: E712
        .order_by(PasswordResetCode.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()

    if not row or row.expires_at < datetime.utcnow():
        raise AuthError("验证码已过期或不存在，请重新申请")
    if row.attempts >= RESET_CODE_MAX_ATTEMPTS:
        row.used = True
        db.commit()
        raise AuthError("验证码错误次数过多，已失效，请重新申请")

    if not secrets.compare_digest(row.code_hash, hashlib.sha256(code.encode("utf-8")).hexdigest()):
        row.attempts += 1
        db.commit()
        remaining = RESET_CODE_MAX_ATTEMPTS - row.attempts
        raise AuthError(f"验证码不正确，还可尝试 {remaining} 次" if remaining > 0 else "验证码错误次数过多，已失效，请重新申请")

    # 验证码正确：一次性作废
    row.used = True

    user = db.execute(select(User).where(User.account == account)).scalar_one_or_none()
    if not user:
        db.commit()
        raise AuthError("账号不存在", status=404)

    user.password_hash = hash_password(new_password)
    # 密码已重置，旧会话全部失效（包括忘记密码前被盗用的会话）
    db.execute(update(AuthToken).where(AuthToken.user_id == user.id).values(revoked=True))
    db.commit()
    clear_login_failures(account, client_ip or "unknown")
    return user
