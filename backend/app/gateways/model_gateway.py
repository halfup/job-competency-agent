from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
import json
import re
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest


@dataclass
class ModelConfig:
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    timeout_seconds: int = 90

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key and self.model)


class ModelGateway(ABC):
    """业务层只依赖这个接口，不依赖任何模型厂商。"""

    @abstractmethod
    def structured(self, *, system: str, user: str, schema: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def chat(self, *, messages: list[dict[str, str]], temperature: float = 0.2) -> str:
        raise NotImplementedError


class UnconfiguredModelGateway(ModelGateway):
    def structured(self, *, system: str, user: str, schema: dict[str, Any]) -> dict[str, Any]:
        raise RuntimeError("主模型尚未配置")

    def chat(self, *, messages: list[dict[str, str]], temperature: float = 0.2) -> str:
        raise RuntimeError("主模型尚未配置")


def _extract_json_object(text: str) -> dict[str, Any]:
    """容错提取模型返回的 JSON 对象，允许外层 markdown fence。"""
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        value = json.loads(raw)
        if isinstance(value, dict):
            return value
    except json.JSONDecodeError:
        pass

    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        value = json.loads(raw[start : end + 1])
        if isinstance(value, dict):
            return value
    raise ValueError("模型未返回可解析 JSON 对象")


class OpenAICompatibleModelGateway(ModelGateway):
    """只依赖 OpenAI-compatible /chat/completions 协议。"""

    def __init__(self, config: ModelConfig):
        if not config.configured:
            raise ValueError("模型配置不完整")
        self.config = config

    @property
    def endpoint(self) -> str:
        return self.config.base_url.rstrip("/") + "/chat/completions"

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urlrequest.Request(
            self.endpoint,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.config.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "zhidao-ai-backend/0.1",
            },
        )
        try:
            with urlrequest.urlopen(req, timeout=self.config.timeout_seconds) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urlerror.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")[:1200]
            raise RuntimeError(f"模型服务 HTTP {exc.code}: {detail}") from exc
        except urlerror.URLError as exc:
            raise RuntimeError(f"模型服务连接失败: {exc.reason}") from exc

        choices = data.get("choices") if isinstance(data, dict) else None
        if not choices:
            raise RuntimeError(f"模型服务响应缺少 choices: {str(data)[:800]}")
        return data

    def chat(self, *, messages: list[dict[str, str]], temperature: float = 0.2) -> str:
        payload = {
            "model": self.config.model,
            "messages": messages,
            "temperature": temperature,
        }
        data = self._post(payload)
        message = data["choices"][0].get("message", {})
        content = message.get("content", "")
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("模型返回空内容")
        return content.strip()

    def structured(self, *, system: str, user: str, schema: dict[str, Any]) -> dict[str, Any]:
        schema_text = json.dumps(schema, ensure_ascii=False, separators=(",", ":"))
        messages = [
            {
                "role": "system",
                "content": system
                + "\n你必须只返回一个合法 JSON 对象，不要输出 Markdown、解释文字或代码块。"
                + "\n输出必须符合下面 JSON Schema 的字段语义：\n"
                + schema_text,
            },
            {"role": "user", "content": user},
        ]
        # 优先请求 json_object；中转若不支持则自动退回纯提示词 JSON。
        payload = {
            "model": self.config.model,
            "messages": messages,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        }
        try:
            data = self._post(payload)
        except RuntimeError as exc:
            text = str(exc).lower()
            if "response_format" not in text and "json" not in text and "400" not in text:
                raise
            payload.pop("response_format", None)
            data = self._post(payload)
        content = data["choices"][0].get("message", {}).get("content", "")
        return _extract_json_object(content)


def build_model_gateway(config: ModelConfig) -> ModelGateway:
    if not config.configured:
        return UnconfiguredModelGateway()
    return OpenAICompatibleModelGateway(config)
