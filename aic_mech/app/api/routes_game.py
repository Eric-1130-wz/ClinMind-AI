"""Game-mode REST routes: case library serving + medical-AI tutor proxy.

Case endpoints are thin wrappers around CaseRepository (the shared, data-driven
catalogue introduced in 2.0) so the game client and the simulation engines
always see one single source of truth. The AI tutor endpoint proxies chat to
the configured LLM with a game-teaching system prompt; fully offline-safe:
it reports source=offline when no LLM is configured, letting the client fall
back to its local rule engine.
"""

import json
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import config
from app.core.case_repository import get_case_repository

router = APIRouter(prefix="/api/game", tags=["Game Mode"])

CASES_DIR = config.DATA_DIR / "cases"


class GameAIRequest(BaseModel):
    message: str
    case_context: Optional[str] = ""


@router.get("/cases")
async def list_game_cases():
    """Case library index for the game lobby (catalogue view + availability)."""
    repo = get_case_repository()
    available = set(repo.ids())
    index = {"version": "0", "patients": []}
    index_path = CASES_DIR / "index.json"
    if index_path.exists():
        with open(index_path, "r", encoding="utf-8-sig") as f:
            index = json.load(f)
    for entry in index.get("patients", []):
        entry["available"] = entry.get("case_id") in available
        # Fall back to repository summaries when index metadata is missing.
        if not entry.get("disease"):
            try:
                summary = repo.summary(repo.require(entry.get("case_id", "")))
                entry["disease"] = summary["title"]
                entry["one_liner"] = entry.get("one_liner") or summary["description"]
            except KeyError:
                continue
    index["available_ids"] = sorted(available)
    return index


@router.get("/cases/{case_id}")
async def get_game_case(case_id: str):
    """Serve one full case JSON through the shared CaseRepository."""
    repo = get_case_repository()
    data = repo.get(case_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Unknown case id")
    index_path = CASES_DIR / "index.json"
    if index_path.exists():
        with open(index_path, "r", encoding="utf-8-sig") as f:
            for entry in json.load(f).get("patients", []):
                if entry.get("case_id") == case_id:
                    data["index_entry"] = entry
                    break
    return data


@router.post("/ai")
async def game_ai_tutor(req: GameAIRequest):
    """Medical-education tutor for the game client.

    Proxies to the configured LLM when online mode is active; otherwise
    returns source=offline so the client can use its built-in rule answers.
    """
    message = (req.message or "").strip()[:500]
    if not message:
        raise HTTPException(status_code=422, detail="Empty message")

    if not config.is_online_llm_active():
        return {"source": "offline", "reply": "", "model": ""}

    provider = (config.LLM_PROVIDER or "").lower()
    if provider == "deepseek":
        api_key = config.DEEPSEEK_API_KEY or config.OPENAI_API_KEY
        base_url = (config.DEEPSEEK_BASE_URL or "https://api.deepseek.com").rstrip("/")
        model = config.LLM_MODEL or "deepseek-chat"
    elif provider == "openai":
        api_key = config.OPENAI_API_KEY or config.DEEPSEEK_API_KEY
        base_url = (config.OPENAI_BASE_URL or "https://api.openai.com/v1").rstrip("/")
        model = config.LLM_MODEL or "gpt-4o-mini"
    else:
        api_key = config.DEEPSEEK_API_KEY or config.OPENAI_API_KEY
        base_url = (config.OPENAI_BASE_URL or config.DEEPSEEK_BASE_URL or "https://api.deepseek.com").rstrip("/")
        model = config.LLM_MODEL or "deepseek-chat"

    if not api_key:
        return {"source": "offline", "reply": "", "model": ""}

    if ("deepseek.com" in base_url or "openai.com" in base_url) and not base_url.endswith("/v1"):
        base_url = f"{base_url}/v1"
    url = base_url if base_url.endswith("/chat/completions") else f"{base_url}/chat/completions"

    system_prompt = (
        "你是2D医疗实训游戏《急诊小诊室》里的AI医学助教，面向大学生实训课程。"
        "职责：用通俗、简短（120字内）、鼓励的中文解答游戏内的医学知识问题——症状识别、鉴别思路、"
        "检查选择、治疗流程与禁忌。"
        "回答必须基于游戏设定与教学逻辑，不替代真实医疗建议，涉及真实医疗时提醒就医。"
        "禁止给出真实用药变更建议；口吻轻松友好，可用1-2个emoji。"
    )
    if req.case_context:
        system_prompt += f"\n【当前病例背景（虚构）】{req.case_context[:300]}"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": message},
        ],
        "max_tokens": 300,
        "temperature": 0.6,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(url, headers=headers, json=payload)
            if res.status_code == 200:
                choices = res.json().get("choices", [])
                if choices:
                    reply = choices[0].get("message", {}).get("content", "").strip()
                    if reply:
                        return {"source": "llm", "reply": reply, "model": model}
        return {"source": "offline", "reply": "", "model": ""}
    except Exception:
        return {"source": "offline", "reply": "", "model": ""}
