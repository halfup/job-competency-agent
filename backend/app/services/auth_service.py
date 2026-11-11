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
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AuthToken, User

PBKDF2_ITERATIONS = 200_000
TOKEN_TTL_DAYS = 30

PHONE_RE = re.compile(r"^1[3-9]\d{9}$")
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


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


def login_user(db: Session, *, account: str, password: str) -> User:
    account = (account or "").strip()
    user = db.execute(select(User).where(User.account == account)).scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(password, user.password_hash):
        # 统一报错，不区分「账号不存在」与「密码错误」，避免账号枚举
        raise AuthError("账号或密码不正确", status=401)
    return user
