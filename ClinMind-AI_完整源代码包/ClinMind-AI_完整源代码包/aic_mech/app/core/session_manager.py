"""Session Manager for ClinMind-AI Clinical Simulation.

Manages runtime state, instances of physiological engines, multi-agent engines,
action histories, and evaluation objects for concurrent or single-user sessions.
"""

import time
import uuid
import json
import sqlite3
from contextlib import closing
import config
from typing import Dict, Any, List, Optional
from app.models.entities import ActionRecord, OSCEAssessment, PatientStateEnum, VitalsVector, AgentState, DialogueMessage
from app.core.physiology_engine import PhysiologyEngine
from app.core.agent_engine import AgentEngine
from app.core.guardrail_engine import GuardrailEngine
from app.core.ged_evaluator import GEDEvaluator


class SimulationSession:
    """Encapsulates a single student's clinical training session."""

    def __init__(self, session_id: str, case_id: str, student_name: str = "参赛学员"):
        self.session_id: str = session_id
        self.case_id: str = case_id
        self.student_name: str = student_name
        self.start_time: float = time.time()
        self.virtual_seconds: int = 0
        self.is_active: bool = True
        self.is_finished: bool = False

        # Core Engines
        self.physiology_engine: PhysiologyEngine = PhysiologyEngine()
        self.agent_engine: AgentEngine = AgentEngine()
        self.guardrail_engine: GuardrailEngine = GuardrailEngine()
        self.ged_evaluator: GEDEvaluator = GEDEvaluator()

        # Action history and final report
        self.action_history: List[ActionRecord] = []
        self.final_assessment: Optional[OSCEAssessment] = None
        self.dialogues: List[DialogueMessage] = []
        self.spontaneous_dialogues: List[DialogueMessage] = []

    def tick(self, dt: float = 1.0) -> VitalsVector:
        """Advance session time by dt seconds."""
        if not self.is_active or self.is_finished:
            return self.physiology_engine.get_current_vitals()

        self.virtual_seconds += int(dt)
        return self.physiology_engine.advance_time(dt)


class SessionStore:
    """In-memory singleton registry for active training sessions."""

    _instance: Optional["SessionStore"] = None

    def __init__(self):
        self._sessions: Dict[str, SimulationSession] = {}
        self._default_session_id: Optional[str] = None
        config.RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        self.db_path = config.RUNTIME_DIR / "clinmind.sqlite3"
        with closing(sqlite3.connect(self.db_path)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, updated REAL NOT NULL, snapshot TEXT NOT NULL)")
            rows = db.execute("SELECT snapshot FROM sessions ORDER BY updated DESC LIMIT 50").fetchall()
        for (raw,) in rows:
            data = json.loads(raw)
            session = SimulationSession(data["session_id"], data["case_id"], data["student_name"])
            session.start_time = data["start_time"]
            session.virtual_seconds = data["virtual_seconds"]
            session.is_active = data["is_active"]
            session.is_finished = data["is_finished"]
            session.action_history = [ActionRecord.model_validate(a) for a in data["actions"]]
            session.dialogues = [DialogueMessage.model_validate(m) for m in data["dialogues"]]
            session.agent_engine.state = AgentState.model_validate(data["agent_state"])
            session.agent_engine.last_interaction_time = time.time()
            for key, value in data["physiology"].items():
                if key == "vitals":
                    value = VitalsVector.model_validate(value)
                elif key == "state":
                    value = PatientStateEnum(value)
                setattr(session.physiology_engine, key, value)
            if data["assessment"]:
                session.final_assessment = OSCEAssessment.model_validate(data["assessment"])
            self._sessions[session.session_id] = session

    @classmethod
    def get_instance(cls) -> "SessionStore":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def create_session(self, case_id: str, student_name: str = "参赛学员") -> SimulationSession:
        session_id = f"sess_{uuid.uuid4().hex[:8]}"
        session = SimulationSession(session_id, case_id, student_name)
        self._sessions[session_id] = session
        self._default_session_id = session_id
        self.persist(session)
        return session

    def get_session(self, session_id: Optional[str] = None) -> Optional[SimulationSession]:
        if not session_id or session_id == "default":
            session_id = self._default_session_id

        return self._sessions.get(session_id) if session_id else None

    def persist(self, session: SimulationSession) -> None:
        """Store a recoverable local snapshot without external database services."""
        engine = session.physiology_engine
        keys = ["elapsed_seconds", "active_medications", "rupture_countdown", "rupture_triggered_reason", "fatal_death_occurred", "beta_blocker_active", "vasodilator_active", "analgesic_active", "_noise_phase"]
        physiology = {key: getattr(engine, key) for key in keys}
        physiology.update(vitals=engine.get_current_vitals().model_dump(), state=engine.state.value)
        snapshot = {
            "session_id": session.session_id, "case_id": session.case_id,
            "student_name": session.student_name, "start_time": session.start_time,
            "virtual_seconds": session.virtual_seconds, "is_active": session.is_active,
            "is_finished": session.is_finished,
            "actions": [a.model_dump(mode="json") for a in session.action_history],
            "dialogues": [m.model_dump(mode="json") for m in session.dialogues],
            "agent_state": session.agent_engine.state.model_dump(), "physiology": physiology,
            "assessment": session.final_assessment.model_dump() if session.final_assessment else None,
        }
        with closing(sqlite3.connect(self.db_path)) as db, db:
            db.execute("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)", (session.session_id, time.time(), json.dumps(snapshot, ensure_ascii=False)))

    def tick_all(self) -> None:
        """One server clock, shared by all browser tabs and WebSocket clients."""
        for session in list(self._sessions.values()):
            session.spontaneous_dialogues = []
            if session.is_active and not session.is_finished:
                session.tick()
                session.spontaneous_dialogues = session.agent_engine.check_spontaneous_events(session.virtual_seconds, session.physiology_engine.get_state())
                session.dialogues.extend(session.spontaneous_dialogues)
                if session.virtual_seconds % 10 == 0:
                    self.persist(session)

    def get_all_sessions(self) -> Dict[str, SimulationSession]:
        return self._sessions
