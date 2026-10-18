"""API Request and Response Pydantic Schemas for ClinMind-AI."""

from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field, field_validator
from app.models.entities import ActionType, PatientStateEnum, VitalsVector, OSCEAssessment, DialogueMessage


class StartCaseRequest(BaseModel):
    """Request payload to initiate a new training/exam session."""
    case_id: str = Field(default="case_chest_pain_001", description="ID of the case to load")
    student_name: str = Field(default="参赛学员", min_length=1, max_length=100, description="Student identifier")


class CaseSummaryDTO(BaseModel):
    """Case summary for case selection screen."""
    case_id: str
    title: str
    difficulty: str
    chief_complaint: str
    target_competency: str
    description: str


class ActionRequest(BaseModel):
    """Request payload for executing a clinical action."""
    session_id: Optional[str] = Field(default="default", description="Active session ID")
    action_type: ActionType
    content: str = Field(..., min_length=1, max_length=4000, description="Action description or query text")
    params: Dict[str, Any] = Field(default_factory=dict, description="Supplementary params, e.g. drug dose, site")

    @field_validator("action_type", mode="before")
    @classmethod
    def normalize_action_type(cls, v: Any) -> Any:
        if isinstance(v, str):
            aliases = {"ASK": "INQUIRY", "EXAM": "PHYSICAL_EXAM", "ORDER": "LAB_ORDER", "LAB": "LAB_ORDER", "TREAT": "MEDICATION", "DISPO": "RESCUE_DISPOSITION", "RESCUE": "RESCUE_DISPOSITION"}
            return aliases.get(v.upper(), v.upper())
        return v

    @field_validator("content")
    @classmethod
    def nonempty_content(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("请输入问诊或诊疗指令")
        return v.strip()


class ActionResponse(BaseModel):
    """Immediate response after dispatching a clinical action."""
    action_id: str
    success: bool
    action_type: ActionType
    message: str
    dialogues: List[DialogueMessage] = Field(default_factory=list)
    report: Optional[Dict[str, Any]] = None
    order_status: Optional[str] = None
    vitals: VitalsVector
    patient_state: PatientStateEnum
    warning: Optional[str] = None
    is_contraindicated: bool = False


class VitalsStreamPayload(BaseModel):
    """1Hz Realtime Push Payload over WebSocket."""
    timestamp: float
    virtual_seconds: int
    vitals: VitalsVector
    patient_state: PatientStateEnum
    trust_level: float
    family_anxiety: float
    alarms: List[str] = Field(default_factory=list)
    rupture_countdown: Optional[int] = None
    patient_say: Optional[str] = None
    family_say: Optional[str] = None
    nurse_say: Optional[str] = None


class SessionStateResponse(BaseModel):
    """Full snapshot of active simulation session."""
    session_id: str
    case_id: str
    student_name: str
    is_active: bool
    elapsed_virtual_seconds: int
    patient_state: PatientStateEnum
    vitals: VitalsVector
    agent_trust: float
    agent_anxiety: float
    history_actions_count: int
    active_alarms: List[str]


class EvaluationRequest(BaseModel):
    """Request to submit session and compute OSCE final score."""
    session_id: Optional[str] = Field(default="default", description="Active session ID")
    final_diagnosis: str = Field(..., min_length=1, max_length=1000, description="Student's declared diagnosis")
    differential_diagnoses: List[str] = Field(default_factory=list, description="Differential diagnoses considered")
    clinical_rationale: Optional[str] = Field(default="", description="Clinical rationale")
    treatment_plan: Optional[str] = Field(default="", description="Student's disposition notes")


class EvaluationResponse(BaseModel):
    """Comprehensive OSCE Evaluation feedback response."""
    success: bool = True
    session_id: str
    student_name: str = "参赛学员"
    total_score: float
    ged_distance: float
    topological_similarity: float
    radar_scores: Dict[str, float]
    fatal_errors: List[str] = Field(default_factory=list)
    clinical_feedback: List[str] = Field(default_factory=list)
    action_sequence_summary: List[Dict[str, Any]] = Field(default_factory=list)
    comparison_dag: Dict[str, Any] = Field(default_factory=dict)
    assessment: Optional[OSCEAssessment] = None
