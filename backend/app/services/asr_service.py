from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import threading
import time
import uuid
import wave
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote, urlencode, urlparse

from websocket import WebSocketTimeoutException, create_connection

from ..config import settings


class SpeechServiceError(RuntimeError):
    """Safe, user-facing ASR service failure."""


@dataclass
class _ReceiverState:
    session_id: Optional[str] = None
    error: Optional[str] = None
    final_seen: bool = False


def speech_available() -> bool:
    return bool(settings.speech_app_id and settings.speech_api_key and settings.speech_api_secret)


def _endpoint() -> str:
    base = (settings.speech_base_url or "wss://office-api-ast-dx.iflyaisol.com/").strip()
    if not base.startswith(("ws://", "wss://")):
        base = "wss://" + base.lstrip("/")
    parsed = urlparse(base)
    path = parsed.path.rstrip("/")
    if not path or path == "":
        path = "/ast/communicate/v1"
    elif not path.endswith("/ast/communicate/v1"):
        path = path + "/ast/communicate/v1"
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def _build_ws_url(*, speaker_separation: bool) -> str:
    # Xunfei RTASR large-model signature: sorted URL-encoded params + HMAC-SHA1.
    utc = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%dT%H:%M:%S%z")
    params: dict[str, str] = {
        "accessKeyId": settings.speech_api_key,
        "appId": settings.speech_app_id,
        "uuid": uuid.uuid4().hex,
        "utc": utc,
        "audio_encode": "pcm_s16le",
        "lang": "autodialect",
        "samplerate": "16000",
        "pd": "tech",
    }
    if speaker_separation:
        params["role_type"] = "2"
    base_string = "&".join(f"{quote(str(k), safe='')}={quote(str(params[k]), safe='')}" for k in sorted(params))
    digest = hmac.new(settings.speech_api_secret.encode("utf-8"), base_string.encode("utf-8"), hashlib.sha1).digest()
    params["signature"] = base64.b64encode(digest).decode("ascii")
    return f"{_endpoint()}?{urlencode(params)}"


def _pcm_from_wav(data: bytes) -> bytes:
    try:
        import audioop
        with wave.open(io.BytesIO(data), "rb") as wf:
            channels = wf.getnchannels()
            width = wf.getsampwidth()
            rate = wf.getframerate()
            frames = wf.readframes(wf.getnframes())
        if width not in {1, 2, 3, 4}:
            raise SpeechServiceError("unsupported_wav_sample_width")
        if channels > 1:
            # Interview recordings are normally mono/stereo. Mix the first two channels.
            if channels != 2:
                raise SpeechServiceError("wav_channels_not_supported")
            frames = audioop.tomono(frames, width, 0.5, 0.5)
        if width != 2:
            frames = audioop.lin2lin(frames, width, 2)
        if rate != 16000:
            frames, _ = audioop.ratecv(frames, 2, 1, rate, 16000, None)
        return frames
    except SpeechServiceError:
        raise
    except Exception as exc:
        raise SpeechServiceError("invalid_wav_audio") from exc


def normalize_audio_to_pcm16k(data: bytes, filename: str) -> bytes:
    suffix = Path(filename or "audio.pcm").suffix.lower()
    if suffix in {".pcm", ".raw"}:
        pcm = data
    elif suffix == ".wav":
        pcm = _pcm_from_wav(data)
    else:
        raise SpeechServiceError("audio_format_requires_browser_decode")
    if not pcm:
        raise SpeechServiceError("audio_empty")
    # 16kHz * 16-bit * mono = 32000 bytes/sec. Keep a bounded synchronous upload path.
    max_bytes = 32000 * 60 * 30
    if len(pcm) > max_bytes:
        raise SpeechServiceError("audio_too_long_over_30_minutes")
    return pcm


def _words_from_message(message: dict[str, Any], current_role: Optional[int]) -> tuple[list[dict[str, Any]], Optional[int]]:
    data = message.get("data") or {}
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError:
            return [], current_role
    st = ((data.get("cn") or {}).get("st") or {})
    # Only persist deterministic/final sentence results. Intermediate results may be replaced.
    if str(st.get("type", "0")) != "0":
        return [], current_role
    bg = int(st.get("bg") or 0)
    ed = int(st.get("ed") or bg)
    out: list[dict[str, Any]] = []
    for rt in st.get("rt") or []:
        for ws in rt.get("ws") or []:
            wb = int(ws.get("wb") or 0)
            we = int(ws.get("we") or wb)
            for cw in ws.get("cw") or []:
                text = str(cw.get("w") or "")
                if not text:
                    continue
                try:
                    role_marker = int(cw.get("rl") or 0)
                except (TypeError, ValueError):
                    role_marker = 0
                if role_marker > 0:
                    current_role = role_marker
                out.append({
                    "text": text,
                    "role_id": current_role,
                    "start_ms": bg + wb,
                    "end_ms": min(ed, bg + we) if ed else bg + we,
                })
    return out, current_role


def _merge_word_segments(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for word in words:
        rid = word.get("role_id")
        if segments and segments[-1].get("role_id") == rid:
            segments[-1]["text"] += word.get("text", "")
            segments[-1]["end_ms"] = max(int(segments[-1].get("end_ms") or 0), int(word.get("end_ms") or 0))
        else:
            segments.append({
                "role_id": rid,
                "text": word.get("text", ""),
                "start_ms": int(word.get("start_ms") or 0),
                "end_ms": int(word.get("end_ms") or 0),
            })
    return [x for x in segments if x.get("text", "").strip()]


def _speaker_map(segments: list[dict[str, Any]], mode: str) -> dict[Optional[int], str]:
    roles: list[Optional[int]] = []
    for seg in segments:
        rid = seg.get("role_id")
        if rid not in roles:
            roles.append(rid)
    if mode == "solo":
        return {rid: "candidate" for rid in roles}
    if not roles:
        return {None: "unknown"}
    scores: dict[Optional[int], int] = {}
    for rid in roles:
        text = "".join(x.get("text", "") for x in segments if x.get("role_id") == rid)
        scores[rid] = text.count("？") * 3 + text.count("?") * 3 + sum(text.count(k) for k in ("请问", "请介绍", "为什么", "如何", "怎么", "能否", "你会"))
    interviewer = max(roles, key=lambda rid: scores.get(rid, 0))
    if len(roles) == 1 and scores.get(interviewer, 0) == 0:
        return {roles[0]: "candidate"}
    return {rid: ("interviewer" if rid == interviewer else "candidate") for rid in roles}


def _format_transcript(segments: list[dict[str, Any]], mode: str) -> str:
    if not segments:
        return ""
    labels = {"interviewer": "面试官", "candidate": "候选人", "unknown": "说话人"}
    if mode == "solo":
        return "\n".join(f"候选人：{x['text'].strip()}" for x in segments if x.get("text", "").strip())
    return "\n".join(f"{labels.get(x.get('speaker', 'unknown'), '说话人')}：{x['text'].strip()}" for x in segments if x.get("text", "").strip())


def transcribe_pcm16k(pcm: bytes, *, mode: str = "dialogue") -> dict[str, Any]:
    if not speech_available():
        raise SpeechServiceError("speech_not_configured")

    speaker_separation = mode == "dialogue"
    url = _build_ws_url(speaker_separation=speaker_separation)
    try:
        ws = create_connection(url, timeout=8, enable_multithread=True)
    except Exception as exc:
        raise SpeechServiceError("speech_connect_failed") from exc

    state = _ReceiverState()
    words: list[dict[str, Any]] = []
    seen_seg_ids: set[str] = set()
    started = threading.Event()
    finished = threading.Event()
    lock = threading.Lock()
    current_role: Optional[int] = None

    def receiver() -> None:
        nonlocal current_role
        try:
            while not finished.is_set():
                try:
                    raw = ws.recv()
                except WebSocketTimeoutException:
                    continue
                if not raw:
                    break
                if isinstance(raw, bytes):
                    continue
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                msg_type = msg.get("msg_type") or msg.get("action")
                if msg_type == "error" or (msg.get("code") not in {None, 0, "0"}):
                    state.error = str(msg.get("desc") or msg.get("message") or msg.get("code") or "speech_service_error")
                    finished.set()
                    break
                data = msg.get("data") or {}
                if isinstance(data, str):
                    try:
                        data_obj = json.loads(data)
                    except json.JSONDecodeError:
                        data_obj = {}
                else:
                    data_obj = data if isinstance(data, dict) else {}
                sid = data_obj.get("sessionId") or msg.get("sid")
                if sid:
                    state.session_id = str(sid)
                if msg_type in {"action", "started"} or state.session_id:
                    started.set()
                if msg_type == "result" or msg.get("res_type") == "asr":
                    seg_id = str(data_obj.get("seg_id", ""))
                    st = ((data_obj.get("cn") or {}).get("st") or {})
                    deterministic = str(st.get("type", "0")) == "0"
                    if deterministic and (not seg_id or seg_id not in seen_seg_ids):
                        parsed, current_role = _words_from_message({"data": data_obj}, current_role)
                        if parsed:
                            with lock:
                                words.extend(parsed)
                        if seg_id:
                            seen_seg_ids.add(seg_id)
                    if data_obj.get("ls") is True:
                        state.final_seen = True
                        finished.set()
                        break
        except Exception as exc:
            if not finished.is_set():
                state.error = f"speech_receive_failed:{type(exc).__name__}"
                finished.set()

    recv_thread = threading.Thread(target=receiver, name="xfyun-asr-receiver", daemon=True)
    recv_thread.start()

    try:
        # Some service versions emit sessionId immediately; others only after the first audio frame.
        started.wait(timeout=1.5)
        frame_bytes = 1280  # 40 ms @ 16kHz, 16-bit mono
        for offset in range(0, len(pcm), frame_bytes):
            if state.error:
                raise SpeechServiceError("speech_service_error")
            ws.send_binary(pcm[offset: offset + frame_bytes])
            # The real-time endpoint expects paced input; sending substantially faster may be rejected.
            time.sleep(0.04)
        end_payload: dict[str, Any] = {"end": True}
        if state.session_id:
            end_payload["sessionId"] = state.session_id
        ws.send(json.dumps(end_payload, ensure_ascii=False))
        finished.wait(timeout=15)
        if state.error:
            raise SpeechServiceError("speech_service_error")
    finally:
        finished.set()
        try:
            ws.close()
        except Exception:
            pass
        recv_thread.join(timeout=1)

    with lock:
        segments = _merge_word_segments(words)
    mapping = _speaker_map(segments, mode)
    for item in segments:
        item["speaker"] = mapping.get(item.get("role_id"), "unknown")
    text = _format_transcript(segments, mode)
    if not text.strip():
        raise SpeechServiceError("speech_no_text_returned")
    return {
        "text": text,
        "segments": segments,
        "session_id": state.session_id,
        "engine": "xfyun-rtasr-llm",
        "speaker_separation": speaker_separation,
        "audio_duration_seconds": round(len(pcm) / 32000, 2),
    }
