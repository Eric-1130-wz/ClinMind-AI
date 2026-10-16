from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import httpx
import config
from urllib.parse import urlparse

router = APIRouter(prefix="/api/config", tags=["Configuration"])

class LLMConfigRequest(BaseModel):
    provider: str = "deepseek"  # "deepseek" | "openai" | "custom" | "offline"
    api_key: Optional[str] = ""
    base_url: Optional[str] = ""
    model: Optional[str] = ""
    test_connection: bool = False


def _normalize_base_url(provider: str, value: str) -> str:
    """Accept a host, /v1 base URL, or a full completions URL from the UI."""
    raw = (value or "").strip().rstrip("/")
    if not raw:
        raw = {
            "deepseek": "https://api.deepseek.com/v1",
            "openai": "https://api.openai.com/v1",
            "custom": "http://127.0.0.1:11434/v1",
        }[provider]
    if raw.endswith("/chat/completions"):
        return raw[:-len("/chat/completions")].rstrip("/")
    parsed = urlparse(raw)
    if parsed.path in ("", "/") and provider in {"deepseek", "openai", "custom"}:
        raw += "/v1"
    return raw.rstrip("/")


def _completion_url(base_url: str) -> str:
    return base_url.rstrip("/") + "/chat/completions"

@router.get("/llm")
async def get_llm_config():
    raw_key = (config.DEEPSEEK_API_KEY if config.LLM_PROVIDER == "deepseek" else config.OPENAI_API_KEY) if config.USE_ONLINE_LLM else ""
    masked_key = ""
    if raw_key:
        masked_key = "********"
    
    current_provider = config.LLM_PROVIDER if config.USE_ONLINE_LLM else "offline"
    if current_provider not in {"deepseek", "openai", "custom", "offline"}:
        current_provider = "custom"
    if current_provider == "deepseek":
        current_base_url = config.DEEPSEEK_BASE_URL
    elif current_provider in {"openai", "custom"}:
        current_base_url = config.OPENAI_BASE_URL
    else:
        current_base_url = ""

    return {
        "status": "success",
        "use_online": config.USE_ONLINE_LLM,
        "provider": current_provider,
        "masked_key": masked_key,
        "base_url": current_base_url,
        "model": config.LLM_MODEL if config.USE_ONLINE_LLM else "offline-rule-engine",
        "connection_tested": bool(config.LLM_CONNECTION_TESTED_AT),
        "connection_ok": config.LLM_CONNECTION_OK,
        "connection_tested_at": config.LLM_CONNECTION_TESTED_AT,
        "connection_message": config.LLM_CONNECTION_MESSAGE,
    }

@router.post("/llm")
async def update_llm_config(req: LLMConfigRequest):
    provider = (req.provider or "offline").strip().lower()
    if provider == "offline":
        saved, message = config.save_llm_config(
            provider="offline",
            api_key="",
            base_url="",
            model="offline"
        )
        if not saved:
            raise HTTPException(500, message)
        return {
            "success": True,
            "status": "success",
            "message": "已成功切换为高仿真离线规则引擎 (免Key模式)",
            "use_online": False,
            "provider": "offline",
            "connection_tested": False,
            "connection_ok": None,
            "connection_message": "离线模式，无需连接测试"
        }
    
    if provider not in {"deepseek", "openai", "custom"}:
        raise HTTPException(status_code=400, detail="不支持的模型服务商类型")

    api_key = req.api_key.strip() if req.api_key else ""
    if not api_key:
        # Keep existing key if not provided
        api_key = config.DEEPSEEK_API_KEY if provider == "deepseek" else config.OPENAI_API_KEY
    
    if not api_key and provider != "custom":
        raise HTTPException(status_code=400, detail="请填写有效的 API Key，或切换为离线模式")
    
    base_url = _normalize_base_url(provider, req.base_url or "")
            
    model = req.model.strip() if req.model else ""
    if not model:
        if provider == "deepseek":
            model = "deepseek-chat"
        else:
            model = "gpt-4o-mini"
            
    connection_tested = False
    connection_ok = None
    test_result = "未执行连通测试"
    if req.test_connection:
        connection_tested = True
        try:
            url = _completion_url(base_url)
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": "You are a test assistant. Reply 'OK' only."},
                    {"role": "user", "content": "ping"}
                ],
                "max_tokens": 5
            }
            async with httpx.AsyncClient(timeout=4.0) as client:
                res = await client.post(url, headers=headers, json=payload)
                if 200 <= res.status_code < 300:
                    connection_ok = True
                    test_result = "API 连通测试成功 (HTTP 200 OK)"
                else:
                    connection_ok = False
                    test_result = f"连通测试返回 HTTP {res.status_code}，请检查 URL、Key 和模型名称"
        except Exception as e:
            connection_ok = False
            test_result = "连通测试失败：网络不可达或服务未启动，配置仍已保存"

    saved, message = config.save_llm_config(
        provider=provider,
        api_key=api_key,
        base_url=base_url,
        model=model,
        connection_tested=connection_tested,
        connection_ok=connection_ok,
        connection_message=test_result
    )
    if not saved:
        raise HTTPException(500, message)
    
    return {
        "success": True,
        "status": "success",
        "message": f"配置已保存并热生效！{test_result}",
        "use_online": True,
        "provider": provider,
        "model": model,
        "base_url": base_url,
        "connection_tested": connection_tested,
        "connection_ok": connection_ok,
    }
