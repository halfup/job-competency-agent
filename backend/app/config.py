from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
DATA_DIR = BACKEND_DIR / "data"


class Settings(BaseSettings):
    env: str = "development"
    database_url: str = f"sqlite:///{DATA_DIR / 'app.db'}"
    model_provider: str = "openai-compatible"
    model_base_url: str = ""
    model_api_key: str = ""
    model_name: str = ""
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = ""
    rerank_base_url: str = ""
    rerank_api_key: str = ""
    rerank_model: str = ""
    speech_base_url: str = ""
    speech_api_key: str = ""
    speech_api_secret: str = ""
    speech_app_id: str = ""
    speech_model: str = ""
    # 密码重置验证码邮件通道（可选；不配置时走演示模式，验证码随接口返回）
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_prefix="ZHIDAO_",
        extra="ignore",
    )


settings = Settings()
DATA_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "uploads").mkdir(parents=True, exist_ok=True)
