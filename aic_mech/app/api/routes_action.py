"""Clinical Action Execution and Decision Router REST Routes."""

import time
import uuid
from typing import Dict, Any, List
from fastapi import APIRouter, HTTPException
from app.models.schemas import ActionRequest, ActionResponse, DialogueMessage
from app.models.entities import ActionRecord, ActionType, PatientStateEnum
from app.core.session_manager import SessionStore
import config

router = APIRouter(prefix="/api/action", tags=["Action Execution"])


@router.post("/execute", response_model=ActionResponse)
def execute_action(req: ActionRequest):
    """Execute a student clinical decision action."""
    store = SessionStore.get_instance()
    session = store.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Active session not found")

    if session.is_finished:
        raise HTTPException(status_code=400, detail="本次实训会话已结案，无法继续下达医嘱。")

    action_id = f"act_{uuid.uuid4().hex[:8]}"
    content = req.content.strip()
    action_type = req.action_type
    current_state = session.physiology_engine.get_state()

    dialogues: List[DialogueMessage] = []
    report_dict = None
    is_contraindicated = False
    warning_text = None
    order_status = "executed"
    feedback_message = ""

    # ================= 1. INQUIRY (问诊沟通) =================
    if action_type in (ActionType.INQUIRY, "inquiry", "ask"):
        dialogues = session.agent_engine.handle_inquiry(content, current_state)
        feedback_message = f"已完成问诊沟通：【{content}】"

    # ================= 2. PHYSICAL EXAM (专科体查) =================
    elif action_type in (ActionType.PHYSICAL_EXAM, "physical_exam", "exam"):
        matched, report, msg = session.guardrail_engine.route_physical_exam(content)
        feedback_message = msg
        nurse_msg = session.agent_engine.notify_order_dispatched(f"体格检查：{content}")
        dialogues.append(nurse_msg)
        # 紧接着将客观体查读数与结论以床旁回报消息推入会话流
        if msg:
            report_msg = DialogueMessage(
                speaker="nurse",
                text=msg,
                timestamp=time.time() + 0.5,
                role_title="责任护士 (床旁体查回报)"
            )
            dialogues.append(report_msg)
        
        # 格式化客观凭证卡片数据
        if report:
            norm = dict(report)
            norm["title"] = report.get("title") or report.get("item_name") or f"体格检查：{content}"
            norm["modality"] = report.get("modality") or "EXAM"
            norm["conclusion"] = report.get("conclusion") or report.get("interpretation") or (report.get("findings") if isinstance(report.get("findings"), str) else "") or "双侧血压对比明显不对称，提示大血管病变可能"
            details = {}
            if "right_arm" in report:
                details["右上臂血压"] = report.get("right_arm")
                details["左上臂血压"] = report.get("left_arm")
                details["双臂压差"] = report.get("difference")
                if report.get("interpretation"):
                    details["临床提示"] = report.get("interpretation")
            elif "findings" in report and isinstance(report["findings"], str):
                details["查体所见"] = report["findings"]
            norm["details"] = details
            report_dict = norm

    # ================= 3. LAB / IMAGING ORDER (辅助检查) =================
    elif action_type in (ActionType.LAB_ORDER, "lab_order", "order", "lab"):
        matched, report, msg = session.guardrail_engine.route_lab_or_imaging(
            content, session.physiology_engine.get_current_vitals()
        )
        feedback_message = msg
        nurse_msg = session.agent_engine.notify_order_dispatched(f"辅助检查开单送检：{content}")
        dialogues.append(nurse_msg)
        
        # 将报告出具通知同步推入会话流
        if msg:
            report_msg = DialogueMessage(
                speaker="nurse",
                text=msg,
                timestamp=time.time() + 0.8,
                role_title="急诊检验/放射科 (报告回报)"
            )
            dialogues.append(report_msg)
            
        # 格式化客观检查报告单
        if report:
            norm = dict(report)
            norm["title"] = report.get("title") or report.get("item_name") or f"辅助检查：{content}"
            norm["modality"] = report.get("modality") or "LAB"
            norm["conclusion"] = report.get("conclusion") or report.get("interpretation") or "检查报告已签发"
            details = {}
            if "result" in report:
                details["检测数值"] = report.get("result")
                if report.get("ref_range"):
                    details["参考区间"] = report.get("ref_range")
                if report.get("status"):
                    details["检验状态"] = report.get("status")
            elif "parameters" in report and isinstance(report["parameters"], dict):
                for pk, pv in report["parameters"].items():
                    details[str(pk).upper()] = str(pv)
            elif "findings" in report:
                if isinstance(report["findings"], list):
                    for idx, f in enumerate(report["findings"], 1):
                        details[f"征象{idx}"] = f
                elif isinstance(report["findings"], str):
                    details["影像所见"] = report["findings"]
            norm["details"] = details
            report_dict = norm

    # ================= 4. MEDICATION (药物处方) =================
    elif action_type in (ActionType.MEDICATION, "medication", "treat", "prescription"):
        try:
            dose = float(req.params.get("dose", 1.0)) if req.params else 1.0
            if not (0 < dose < float("inf")):
                raise ValueError()
        except (TypeError, ValueError):
            raise HTTPException(422, "剂量须为有限正数")
        unit = str(req.params.get("unit", "mg")) if req.params else "mg"
        med_result = session.physiology_engine.apply_medication(content, dose, unit)

        if med_result.get("is_lethal"):
            is_contraindicated = True
            warning_text = med_result.get("message")
            feedback_message = warning_text
            # Nurse emergency intercept alarm
            nurse_warn = session.agent_engine.generate_nurse_warning(content)
            dialogues.append(nurse_warn)
        else:
            feedback_message = med_result.get("message")
            nurse_msg = session.agent_engine.notify_order_dispatched(f"用药：{content} {dose}{unit}")
            dialogues.append(nurse_msg)

    # ================= 5. RESCUE / DISPOSITION (急救与终末转归) =================
    elif action_type in (ActionType.RESCUE_DISPOSITION, "rescue_disposition", "dispo", "rescue"):
        c_lower = content.lower()
        if any(k in c_lower for k in ["吸氧", "双通道", "静脉通路", "监护", "抢救"]):
            feedback_message = "【抢救通道建立】已予鼻导管高流量吸氧，快速开放左右上肢双侧静脉通道，持续多参数心电血压监护！"
            nurse_msg = session.agent_engine.notify_order_dispatched("建立双通道静脉通路与吸氧监护")
            dialogues.append(nurse_msg)

        elif any(k in c_lower for k in ["心胸外", "外科", "急会诊", "血管外", "手术室"]):
            feedback_message = "【多学科急救响应】已紧急呼叫心胸外科与大血管外科二线主任急会诊！手术室及体外循环机已进入紧急备班状态！"
            nurse_msg = session.agent_engine.notify_order_dispatched("紧急通知心胸外科主任床旁急会诊")
            dialogues.append(nurse_msg)

        elif any(k in c_lower for k in ["知情同意", "病危", "沟通", "交代", "签字"]):
            feedback_message = "【知情同意交代】已向家属详尽交待急性主动脉夹层极高破裂风险，家属李秀梅已含泪签署急诊开胸手术知情同意书及病危通知书。"
            dialogues.extend(session.agent_engine.handle_inquiry("签署知情同意与病危通知", current_state))

        elif any(k in c_lower for k in ["cpr", "心肺复苏", "胸外按压", "电除颤", "心包穿刺"]):
            if current_state in [PatientStateEnum.S4_CARDIAC_TAMPONADE, PatientStateEnum.S5_AORTIC_RUPTURE]:
                feedback_message = "【心肺复苏执行】立即开展胸外心脏按压与床旁超声引导下心包穿刺引流！全力维持脑血流灌注！"
            else:
                feedback_message = "【临床提示】患者当前自主心搏节律尚存，未发生心室停搏或室颤，无需盲目电除颤。"

        else:
            feedback_message = f"已执行转归处置：{content}"
            nurse_msg = session.agent_engine.notify_order_dispatched(content)
            dialogues.append(nurse_msg)

    # Check for spontaneous alarms
    vitals = session.physiology_engine.get_current_vitals()
    new_state = session.physiology_engine.get_state()

    session.agent_engine.observe_action(action_type, content, safe=not is_contraindicated)

    if new_state in [PatientStateEnum.S4_CARDIAC_TAMPONADE, PatientStateEnum.S5_AORTIC_RUPTURE]:
        dialogues.append(session.agent_engine.generate_tamponade_alert(vitals.sbp))

    # Append to session action history
    action_record = ActionRecord(
        action_id=action_id,
        step_id="",
        action_type=action_type,
        content=content,
        params=req.params or {},
        timestamp=time.time(),
        virtual_time_seconds=session.virtual_seconds,
        result=report_dict or feedback_message,
        is_contraindicated=is_contraindicated
    )
    session.action_history.append(action_record)
    if action_type != ActionType.INQUIRY:
        session.dialogues.append(DialogueMessage(speaker="doctor", text=content, role_title="接诊医生"))
    session.dialogues.extend(dialogues)
    if is_contraindicated and warning_text:
        session.agent_engine.state.active_critical_alarms.append(warning_text)
    session.final_assessment = None
    store.persist(session)

    return ActionResponse(
        action_id=action_id,
        success=True,
        action_type=action_type,
        message=feedback_message,
        dialogues=dialogues,
        report=report_dict,
        order_status=order_status,
        vitals=vitals,
        patient_state=new_state,
        warning=warning_text,
        is_contraindicated=is_contraindicated
    )
