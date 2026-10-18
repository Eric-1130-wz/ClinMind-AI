"""Case Management and Session Initialization REST Routes."""

from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, Query
from app.models.schemas import StartCaseRequest, CaseSummaryDTO, SessionStateResponse
from app.core.session_manager import SessionStore
from app.core.case_repository import get_case_repository
import config

router = APIRouter(prefix="/api/case", tags=["Case Management"])


@router.get("/list", response_model=List[CaseSummaryDTO])
async def list_cases():
    """Return the bundled chest-pain case and the five catalogue cases."""
    return [CaseSummaryDTO(**item) for item in get_case_repository().summaries()]


@router.get("/detail/{case_id}")
async def get_case_detail(case_id: str):
    """Get full case briefing and patient profile."""
    data = get_case_repository().get(case_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Case not found")

    return {
        "case_id": data.get("case_id"),
        "title": data.get("title"),
        "chief_complaint": data.get("chief_complaint"),
        "patient_profile": data.get("patient_profile"),
        "initial_vitals": data.get("initial_vitals"),
        "difficulty": data.get("difficulty"),
        "category": data.get("category"),
        "game_extensions": data.get("game_extensions", {}),
    }


@router.post("/start")
async def start_case(req: StartCaseRequest):
    """Initialize or reset an active simulation training session."""
    if get_case_repository().get(req.case_id) is None:
        raise HTTPException(status_code=404, detail=f"病例不存在：{req.case_id}")
    store = SessionStore.get_instance()
    session = store.create_session(req.case_id, req.student_name)

    return {
        "status": "success",
        "message": "抢救室实训已就绪，患者已接入多参数心电监护仪，计时开始！",
        "session_id": session.session_id,
        "case_id": session.case_id,
        "student_name": session.student_name,
        "initial_vitals": session.physiology_engine.get_current_vitals(),
        "patient_state": session.physiology_engine.get_state().value
    }


@router.get("/session/status", response_model=SessionStateResponse)
async def get_session_status(session_id: str = Query(default="default")):
    """Get active training session snapshot."""
    store = SessionStore.get_instance()
    session = store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Active session not found")

    vitals = session.physiology_engine.get_current_vitals()
    state = session.physiology_engine.get_state()

    return SessionStateResponse(
        session_id=session.session_id,
        case_id=session.case_id,
        student_name=session.student_name,
        is_active=session.is_active,
        elapsed_virtual_seconds=session.virtual_seconds,
        patient_state=state,
        vitals=vitals,
        agent_trust=round(session.agent_engine.state.patient_trust, 2),
        agent_anxiety=round(session.agent_engine.state.family_anxiety, 2),
        history_actions_count=len(session.action_history),
        active_alarms=session.agent_engine.state.active_critical_alarms
    )


@router.get("/session/{session_id}/workspace")
def workspace(session_id: str):
    """Restore both new UI screens from the same persistent session."""
    session = SessionStore.get_instance().get_session(session_id)
    if not session:
        raise HTTPException(404, "实训会话不存在，请重新开始接诊")
    assessment = session.final_assessment or session.ged_evaluator.evaluate(session.action_history, "", include_feedback=False)
    profile = session.case_data.get("patient_profile") or {}
    extensions = session.case_data.get("game_extensions") or {}
    return {
        "session_id": session.session_id, "case_id": session.case_id,
        "student_name": session.student_name, "is_active": session.is_active,
        "is_finished": session.is_finished, "virtual_seconds": session.virtual_seconds,
        "vitals": session.physiology_engine.get_current_vitals(),
        "patient_state": session.physiology_engine.get_state(),
        "trust_level": session.agent_engine.state.patient_trust,
        "family_anxiety": session.agent_engine.state.family_anxiety,
        "rupture_countdown": session.physiology_engine.get_rupture_countdown(),
        "dialogues": session.dialogues, "actions": session.action_history,
        "reports": [a.result for a in session.action_history if isinstance(a.result, dict)],
        "radar_scores": assessment.radar_scores,
        "assessment": session.final_assessment,
        "case_profile": {
            "case_id": session.case_data.get("case_id", session.case_id),
            "title": session.case_data.get("title", ""),
            "difficulty": session.case_data.get("difficulty", ""),
            "category": session.case_data.get("category", ""),
            "chief_complaint": session.case_data.get("chief_complaint", ""),
            "patient_profile": profile,
            "initial_vitals": session.case_data.get("initial_vitals", {}),
            "core_teaching": extensions.get("core_teaching") or session.case_data.get("core_teaching", ""),
            "game_extensions": extensions,
        },
    }


@router.post("/session/{session_id}/pause")
def pause_session(session_id: str):
    store = SessionStore.get_instance()
    session = store.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    session.is_active = False
    store.persist(session)
    return {"success": True}
