"""Continuous Hemodynamic Physiology State Machine Engine (1Hz).

Simulates cardiovascular hemodynamics, state transitions, pharmacodynamics (PD),
and lethal rupture countdowns for acute aortic dissection.
"""

import math
import random
import time
from typing import Dict, Any, List, Optional, Tuple
from app.models.entities import PatientStateEnum, VitalsVector
import config


class PhysiologyEngine:
    """1Hz Continuous Hemodynamic Engine with State Machine transitions."""

    def __init__(self, initial_vitals: Optional[VitalsVector] = None):
        self.state: PatientStateEnum = PatientStateEnum.S0_STABLE
        self.vitals: VitalsVector = initial_vitals or VitalsVector(
            hr=108.0,
            sbp=195.0,
            dbp=115.0,
            spo2=96.0,
            rr=22.0,
            pain_vas=9,
            ecg_rhythm="Sinus Tachycardia (窦性心动过速)",
            consciousness="神志清楚，极度痛苦面容，大汗淋漓"
        )
        self.baseline_vitals: VitalsVector = self.vitals.model_copy()

        # Elapsed virtual simulation time in seconds
        self.elapsed_seconds: float = 0.0

        # Medication infusion rates / active states
        self.active_medications: Dict[str, float] = {}

        # Lethal countdown mechanism
        self.rupture_countdown: Optional[float] = None
        self.rupture_triggered_reason: Optional[str] = None
        self.fatal_death_occurred: bool = False

        # Target control flags
        self.beta_blocker_active: bool = False
        self.vasodilator_active: bool = False
        self.analgesic_active: bool = False

        # Random walk seed for monitor realism
        self._noise_phase: float = 0.0

    def get_vitals(self) -> VitalsVector:
        """Get the current hemodynamic vitals vector."""
        return self.vitals

    def apply_medication(self, drug_name: str, dose: float = 1.0, unit: str = "mg") -> Dict[str, Any]:
        """Apply a medication order to the hemodynamic system."""
        normalized_name = drug_name.strip().lower()
        result = {
            "is_lethal": False,
            "drug_name": drug_name,
            "status": "applied",
            "message": "",
            "previous_state": self.state,
            "new_state": self.state
        }

        # 1. Check for RED-LINE LETHAL CONTRAINDICATIONS
        is_lethal = any(keyword in normalized_name for keyword in config.LETHAL_MEDICATION_KEYWORDS)
        if is_lethal:
            self.trigger_iatrogenic_rupture(f"误用禁忌药物【{drug_name}】诱发内膜假腔破裂大出血")
            result["is_lethal"] = True
            result["message"] = (
                f"【致命红线触发】在 Stanford A型主动脉夹层中禁忌使用【{drug_name}】！"
                "抗血小板/抗凝/溶栓药物导致撕裂内膜假腔暴发性破裂，触发 120s 致命心包填塞倒计时！"
            )
            result["new_state"] = self.state
            return result

        # 2. Check for TARGET BETA-BLOCKERS (Esmolol / Metoprolol / Labetalol)
        if any(bb in normalized_name for bb in ["esmolol", "艾司洛尔", "betaloc", "美托洛尔", "labetalol", "拉贝洛尔"]):
            self.beta_blocker_active = True
            self.active_medications["beta_blocker"] = dose
            result["message"] = f"已静脉泵注【{drug_name}】，负荷剂量起效中，开始抑制心肌收缩力(dp/dt)与心率。"
            self._evaluate_state_transition()
            result["new_state"] = self.state
            return result

        # 3. Check for TARGET VASODILATORS (Nitroprusside / Nicardipine / Nitroglycerin)
        if any(vd in normalized_name for vd in ["nitroprusside", "硝普钠", "nicardipine", "尼卡地平", "nitroglycerin", "硝酸甘油"]):
            self.vasodilator_active = True
            self.active_medications["vasodilator"] = dose
            if not self.beta_blocker_active:
                result["message"] = (
                    f"已静脉泵注【{drug_name}】。提示：在未充分使用β受体阻滞剂控制心率前单用血管扩张剂，"
                    "可能引起反射性心动过速并增加主动脉壁切应力(dp/dt)，建议立即联合艾司洛尔！"
                )
            else:
                result["message"] = f"已联合静脉泵注【{drug_name}】，双靶向血流动力学控制方案起效，收缩压平稳回落。"
            self._evaluate_state_transition()
            result["new_state"] = self.state
            return result

        # 4. Check for ANALGESIA / SEDATION (Morphine / Fentanyl)
        if any(ag in normalized_name for ag in ["morphine", "吗啡", "fentanyl", "芬太尼", "pethidine", "哌替啶"]):
            self.analgesic_active = True
            self.vitals.pain_vas = max(2, self.vitals.pain_vas - 5)
            result["message"] = f"已静脉注射【{drug_name}】，中枢镇痛起效，患者交感风暴减轻，疼痛评分降至 {self.vitals.pain_vas} 分。"
            return result

        # Generic acceptable medication
        result["message"] = f"已执行用药医嘱【{drug_name}】。"
        return result

    def trigger_iatrogenic_rupture(self, reason: str) -> None:
        """Trigger lethal rupture countdown due to contraindication."""
        if self.state in [PatientStateEnum.S4_CARDIAC_TAMPONADE, PatientStateEnum.S5_AORTIC_RUPTURE, PatientStateEnum.S6_CARDIAC_ARREST]:
            return
        self.state = PatientStateEnum.S3_PERICARDIAL_EFFUSION
        self.rupture_countdown = float(config.LETHAL_MEDICATION_KEYWORDS and 120.0)
        self.rupture_triggered_reason = reason
        self.vitals.consciousness = "痛苦呻吟，烦躁加剧，胸痛放射至全腹及背部"

    def advance_time(self, dt: float = 1.0) -> VitalsVector:
        """Advance physiological state by dt seconds."""
        self.elapsed_seconds += dt
        self._noise_phase += dt * 0.5

        # 1. Lethal Cardiac Arrest / Death State
        if self.state == PatientStateEnum.S6_CARDIAC_ARREST:
            self.vitals.hr = 0.0
            self.vitals.sbp = 0.0
            self.vitals.dbp = 0.0
            self.vitals.spo2 = 0.0
            self.vitals.rr = 0.0
            self.vitals.pain_vas = 0
            self.vitals.ecg_rhythm = "Asystole / PEA (心室停搏/无脉电活动)"
            self.vitals.consciousness = "深昏迷，双侧瞳孔散大固定，大动脉搏动消失 (已死亡)"
            return self.vitals

        # 2. Lethal Rupture Countdown in progress
        if self.rupture_countdown is not None:
            self.rupture_countdown = max(0.0, self.rupture_countdown - dt)
            if self.rupture_countdown <= 0.0:
                if self.state == PatientStateEnum.S3_PERICARDIAL_EFFUSION:
                    self.state = PatientStateEnum.S4_CARDIAC_TAMPONADE
                    self.vitals.sbp = min(self.vitals.sbp, 55.0)
                    self.vitals.dbp = min(self.vitals.dbp, 35.0)
                    self.vitals.hr = 45.0
                    self.rupture_countdown = 30.0  # 30 seconds before cardiac arrest
                elif self.state == PatientStateEnum.S4_CARDIAC_TAMPONADE:
                    self.state = PatientStateEnum.S5_AORTIC_RUPTURE
                    self.rupture_countdown = 15.0  # 15 seconds to terminal arrest
                elif self.state == PatientStateEnum.S5_AORTIC_RUPTURE:
                    self.state = PatientStateEnum.S6_CARDIAC_ARREST
                    self.fatal_death_occurred = True
                    self.rupture_countdown = None

        # 3. Pathophysiological State Dynamics
        if self.state == PatientStateEnum.S0_STABLE:
            # If student does not lower BP for > 300s, crisis escalates
            if self.elapsed_seconds > 300.0 and not (self.beta_blocker_active or self.vasodilator_active):
                self.state = PatientStateEnum.S1_HYPERTENSION_CRISIS

        if self.state == PatientStateEnum.S1_HYPERTENSION_CRISIS:
            # BP escalates dangerously
            self.vitals.sbp = min(220.0, max(202.0, self.vitals.sbp + 0.15 * dt))
            self.vitals.dbp = min(128.0, self.vitals.dbp + 0.08 * dt)
            self.vitals.hr = min(130.0, self.vitals.hr + 0.10 * dt)
            self.vitals.pain_vas = 10
            self.vitals.consciousness = "极度痛苦大叫，濒死感加重"
            # Spontaneous rupture if SBP stays > 215 for > 60s
            if self.vitals.sbp >= 215.0 and self.elapsed_seconds > 420.0:
                self.trigger_iatrogenic_rupture("未及时降压，恶性高血压切应力诱发夹层自发性破裂入心包")

        elif self.state == PatientStateEnum.S2_PHARMACO_CONTROLLED:
            # Smooth pharmacodynamics convergence to clinical targets
            target_hr = 65.0
            target_sbp = 112.0
            target_dbp = 70.0
            rate_hr = 0.03 * dt
            rate_bp = 0.04 * dt

            self.vitals.hr += (target_hr - self.vitals.hr) * rate_hr
            self.vitals.sbp += (target_sbp - self.vitals.sbp) * rate_bp
            self.vitals.dbp += (target_dbp - self.vitals.dbp) * rate_bp
            if self.vitals.pain_vas > 3:
                self.vitals.pain_vas = max(3, int(self.vitals.pain_vas - 0.05 * dt))
            self.vitals.ecg_rhythm = "Normal Sinus Rhythm (窦性心律)"
            self.vitals.consciousness = "神志清楚，胸痛明显缓解，呼吸平稳"

        elif self.state == PatientStateEnum.S3_PERICARDIAL_EFFUSION:
            # Blood leaking into pericardium
            self.vitals.sbp = max(80.0, self.vitals.sbp - 0.4 * dt)
            self.vitals.dbp = max(50.0, self.vitals.dbp - 0.3 * dt)
            self.vitals.hr = min(140.0, self.vitals.hr + 0.25 * dt)
            self.vitals.spo2 = max(88.0, self.vitals.spo2 - 0.05 * dt)
            self.vitals.ecg_rhythm = "Sinus Tachycardia with Low Voltage (低电压伴窦速)"

        elif self.state == PatientStateEnum.S4_CARDIAC_TAMPONADE:
            # Full Beck's Triad (Hypotension, JVD, Muffled heart sounds)
            self.vitals.sbp = max(45.0, self.vitals.sbp - 0.8 * dt)
            self.vitals.dbp = max(25.0, self.vitals.dbp - 0.5 * dt)
            self.vitals.hr = max(38.0, self.vitals.hr - 0.5 * dt)  # paradoxical bradycardia
            self.vitals.spo2 = max(70.0, self.vitals.spo2 - 0.3 * dt)
            self.vitals.consciousness = "呼之不应，意识丧失，面色苍白湿冷，贝氏三联征爆发"
            self.vitals.ecg_rhythm = "Severe Bradycardia with Electrical Alternans (电交替伴窦缓)"

        elif self.state == PatientStateEnum.S5_AORTIC_RUPTURE:
            # Terminal rupture shock
            self.vitals.sbp = max(0.0, self.vitals.sbp - 2.0 * dt)
            self.vitals.dbp = max(0.0, self.vitals.dbp - 1.5 * dt)
            self.vitals.hr = max(0.0, self.vitals.hr - 1.5 * dt)
            self.vitals.spo2 = max(0.0, self.vitals.spo2 - 2.0 * dt)
            self.vitals.consciousness = "心搏呼吸骤停，无自主意识"
            self.vitals.ecg_rhythm = "PEA (无脉性电活动) / 室颤波"

        # Apply realistic physiological micro-oscillations (Brownian noise)
        self._apply_realistic_noise()

        return self.vitals

    def _evaluate_state_transition(self) -> None:
        """Evaluate if criteria for S2_PHARMACO_CONTROLLED are satisfied."""
        if self.state in [
            PatientStateEnum.S3_PERICARDIAL_EFFUSION,
            PatientStateEnum.S4_CARDIAC_TAMPONADE,
            PatientStateEnum.S5_AORTIC_RUPTURE,
            PatientStateEnum.S6_CARDIAC_ARREST
        ]:
            return

        if self.beta_blocker_active and self.vasodilator_active:
            self.state = PatientStateEnum.S2_PHARMACO_CONTROLLED

    def _apply_realistic_noise(self) -> None:
        """Inject micro-fluctuations so bedside monitor looks authentic."""
        if self.state in [PatientStateEnum.S5_AORTIC_RUPTURE, PatientStateEnum.S6_CARDIAC_ARREST]:
            return

        # Micro-variation ±0.6 bpm, ±0.8 mmHg
        wave = math.sin(self._noise_phase) * 0.6
        noise = random.uniform(-0.4, 0.4)
        total_jitter = wave + noise

        self.vitals.hr = max(20.0, round(self.vitals.hr + total_jitter * 0.5, 1))
        self.vitals.sbp = max(30.0, round(self.vitals.sbp + total_jitter * 0.8, 1))
        self.vitals.dbp = max(15.0, round(self.vitals.dbp + total_jitter * 0.4, 1))
        self.vitals.rr = max(8.0, round(self.vitals.rr + (random.uniform(-0.2, 0.2)), 1))
        self.vitals.spo2 = min(100.0, max(60.0, round(self.vitals.spo2 + (random.uniform(-0.1, 0.1)), 1)))

    def get_current_vitals(self) -> VitalsVector:
        """Retrieve current vitals snapshot."""
        return self.vitals.model_copy()

    def get_state(self) -> PatientStateEnum:
        """Retrieve current pathophysiological state."""
        return self.state

    def get_rupture_countdown(self) -> Optional[int]:
        """Return remaining rupture seconds, or None if safe."""
        if self.rupture_countdown is not None:
            return int(self.rupture_countdown)
        return None
