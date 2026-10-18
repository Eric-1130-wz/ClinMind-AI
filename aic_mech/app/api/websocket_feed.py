"""1Hz Real-Time Bedside Telemetry Monitor WebSocket Feed.

Broadcasts real-time physiological vectors (HR, SBP, DBP, SpO2, RR, Rhythm),
dynamic patient trust, family anxiety, and critical alarms to connected monitors.
"""

import asyncio
import json
import time
from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.session_manager import SessionStore
from app.models.schemas import VitalsStreamPayload
from app.models.entities import PatientStateEnum

router = APIRouter(tags=["Real-time Telemetry WebSocket"])


class ConnectionManager:
    """Manages active WebSocket telemetry monitor client connections."""

    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = set()
        self.active_connections[session_id].add(websocket)

    def disconnect(self, session_id: str, websocket: WebSocket):
        if session_id in self.active_connections:
            self.active_connections[session_id].discard(websocket)
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]

    async def broadcast_to_session(self, session_id: str, data: dict):
        if session_id in self.active_connections:
            dead_sockets = set()
            for ws in self.active_connections[session_id]:
                try:
                    await ws.send_json(data)
                except Exception:
                    dead_sockets.add(ws)
            for ws in dead_sockets:
                self.active_connections[session_id].discard(ws)


ws_manager = ConnectionManager()


@router.websocket("/ws/vitals/{session_id}")
async def websocket_vitals_endpoint(websocket: WebSocket, session_id: str):
    """1Hz continuous physiological simulation and telemetry broadcast loop."""
    store = SessionStore.get_instance()
    session = store.get_session(session_id)

    if not session:
        await websocket.close(code=1008, reason="Session not found")
        return
    await ws_manager.connect(session_id, websocket)

    try:
        while True:
            # The application clock advances once, regardless of client count.
            vitals = session.physiology_engine.get_current_vitals()
            state = session.physiology_engine.get_state()
            countdown = session.physiology_engine.get_rupture_countdown()

            # Check time-triggered family interruptions
            spontaneous_msgs = session.spontaneous_dialogues

            # Build broadcast telemetry payload
            payload = {
                "type": "vitals_update",
                "timestamp": time.time(),
                "virtual_seconds": session.virtual_seconds,
                "vitals": vitals.model_dump(),
                "patient_state": state.value,
                "is_finished": session.is_finished,
                "trust_level": round(session.agent_engine.state.patient_trust, 2),
                "family_anxiety": round(session.agent_engine.state.family_anxiety, 2),
                "alarms": list(session.agent_engine.state.active_critical_alarms),
                "rupture_countdown": countdown,
                "spontaneous_dialogues": [m.model_dump() for m in spontaneous_msgs]
            }

            # Send telemetry update to this client
            await websocket.send_json(payload)

            # Wait 1.0 second until next pulse tick
            await asyncio.sleep(1.0)

    except WebSocketDisconnect:
        ws_manager.disconnect(session_id, websocket)
    except Exception:
        ws_manager.disconnect(session_id, websocket)
