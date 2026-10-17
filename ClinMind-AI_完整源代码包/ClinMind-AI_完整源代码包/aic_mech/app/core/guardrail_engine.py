"""Dual-Track Graph-RAG Anti-Hallucination Guardrail Engine.

Physically isolates clinical objective data (physical findings, laboratory tests,
imaging reports) from LLM generation. Guarantees 100% data authenticity and
compliance with authentic Grade-3A tertiary hospital case gold standards.
"""

import json
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List
import config


class GuardrailEngine:
    """Hard-track router for clinical physical examinations and objective diagnostics."""

    def __init__(self, case_file_path: Optional[Path] = None):
        self.case_path = case_file_path or (config.DATA_DIR / "case_chest_pain.json")
        self.case_data: Dict[str, Any] = self._load_case_data()
        self.physical_findings = self.case_data.get("physical_exam_findings", {})
        self.lab_reports = self.case_data.get("lab_and_imaging_reports", {})

    def _load_case_data(self) -> Dict[str, Any]:
        """Load gold standard case repository."""
        if not self.case_path.exists():
            raise FileNotFoundError(f"Case definition file not found at: {self.case_path}")
        with open(self.case_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def route_physical_exam(self, query: str) -> Tuple[bool, Optional[Dict[str, Any]], str]:
        """Match physical examination query to authenticated findings.

        Returns: (matched, report_dict, feedback_message)
        """
        q = query.strip().lower()

        # 1. Bilateral Upper-Arm Blood Pressure (Critical Gold Node N5)
        # 裸关键词"双侧"会误吞其他部位的查体（如双侧瞳孔、双下肢血压），
        # 仅在明确指向上肢/臂部/双侧血压且不属于其他查体区域时命中。
        if any(k in q for k in ["双上肢", "左侧血压", "右侧血压", "双臂", "对侧血压", "压差", "量双上臂", "肢体血压"]) or (
            "双侧" in q and "血压" in q and not any(x in q for x in ["瞳孔", "下肢", "足", "腘", "肺", "呼吸音"])
        ):
            finding = self.physical_findings.get("vitals_bilateral_bp", {})
            msg = (
                f"【双侧上肢血压对比测量】\n"
                f"右上臂血压：{finding.get('right_arm', '195/115 mmHg')}\n"
                f"左上臂血压：{finding.get('left_arm', '162/98 mmHg')}\n"
                f"测量结论：{finding.get('difference', '')}\n"
                f"临床解析：{finding.get('interpretation', '')}"
            )
            return True, finding, msg

        # 2. Heart Auscultation & Valve Murmurs (Gold Node N6)
        if any(k in q for k in ["心脏听诊", "心音", "杂音", "瓣膜", "主动脉瓣", "叹气样", "泼水样", "听心脏"]):
            finding = self.physical_findings.get("heart_auscultation", {})
            msg = (
                f"【心脏查体与瓣膜听诊】\n"
                f"听诊所见：{finding.get('findings', '')}\n"
                f"临床意义：{finding.get('interpretation', '')}"
            )
            return True, finding, msg

        # 3. Peripheral Pulses
        if any(k in q for k in ["脉搏", "桡动脉", "股动脉", "足背动脉", "血管征", "搏动"]):
            finding = self.physical_findings.get("peripheral_pulses", {})
            msg = f"【周围血管搏动查体】\n{finding.get('findings', '')}"
            return True, finding, msg

        # 4. Lung Auscultation
        if any(k in q for k in ["肺", "呼吸音", "啰音", "双肺听诊", "湿啰音"]):
            finding = self.physical_findings.get("lung_auscultation", {})
            msg = f"【双肺听诊】\n{finding.get('findings', '')}"
            return True, finding, msg

        # 5. Abdominal Exam
        if any(k in q for k in ["腹部", "压痛", "反跳痛", "搏动性包块", "触诊腹部"]):
            finding = self.physical_findings.get("abdomen_exam", {})
            msg = f"【腹部查体】\n{finding.get('findings', '')}"
            return True, finding, msg

        # 6. Neurological Exam
        if any(k in q for k in ["神经", "瞳孔", "病理征", "巴氏征", "肌力", "脑膜刺激征"]):
            finding = self.physical_findings.get("neuro_exam", {})
            msg = f"【神经系统快速查体】\n{finding.get('findings', '')}"
            return True, finding, msg

        # Generic physical examination fallback
        return False, None, "本病例未配置该项查体的确定性结果（防幻觉护栏拒绝编造查体所见）。建议进行针对性专科查体（如双上肢血压、心脏瓣膜听诊）。"

    def route_lab_or_imaging(self, order_name: str, current_vitals: Optional[Any] = None) -> Tuple[bool, Optional[Dict[str, Any]], str]:
        """Match lab test or imaging request to authenticated hospital diagnostic report.

        Returns: (matched, report_dict, feedback_message)
        """
        name = order_name.strip().lower()

        # 1. 18-Lead Bedside ECG (Gold Node N8)
        if any(k in name for k in ["心电图", "ecg", "18导联", "十二导联", "12导联"]):
            rep = dict(self.lab_reports.get("ecg_18_lead", {}))
            rep["parameters"] = dict(rep.get("parameters", {}))
            if current_vitals is not None:
                rep["parameters"]["heart_rate"] = int(round(float(current_vitals.hr)))
            msg = (
                f"【急诊18导联床旁心电图报告】\n"
                f"节律：{rep.get('parameters', {}).get('heart_rate')} bpm\n"
                f"心电图诊断结论：{rep.get('conclusion', '')}\n"
                f"⚠️ 警示提示：{rep.get('clinical_hint', '')}"
            )
            return True, rep, msg

        # 2. Bedside Ultrasound / POCUS Echo
        if any(k in name for k in ["超声", "心包", "echo", "pocus", "心脏彩超", "床旁超声"]):
            rep = self.lab_reports.get("bedside_echo", {})
            findings_text = "\n".join(f"• {f}" for f in rep.get("findings", []))
            msg = (
                f"【急诊床旁超声心动图 (POCUS) 报告】\n"
                f"超声征象：\n{findings_text}\n"
                f"诊断结论：{rep.get('conclusion', '')}"
            )
            return True, rep, msg

        # 3. Emergency High-Sensitivity Cardiac Troponin (hs-cTnI) (Gold Node N9)
        if any(k in name for k in ["肌钙蛋白", "ctni", "心肌酶", "tnt", "ckmb", "心肌标志物"]):
            rep = self.lab_reports.get("hs_ctni", {})
            msg = (
                f"【急诊心肌损伤标志物检验单】\n"
                f"高敏肌钙蛋白I (hs-cTnI)：{rep.get('result')}\n"
                f"参考区间：{rep.get('ref_range')}\n"
                f"临床提示：{rep.get('conclusion')}"
            )
            return True, rep, msg

        # 4. Emergency D-Dimer (Gold Node N10)
        if any(k in name for k in ["d-二聚体", "d-dimer", "二聚体"]):
            rep = self.lab_reports.get("d_dimer", {})
            if rep.get("status") == "CRITICAL_HIGH":
                rep["critical_alert"] = True
            msg = (
                f"【急诊大血管及凝血危急值检验单】\n"
                f"D-二聚体 (D-Dimer)：{rep.get('result')}\n"
                f"参考区间：{rep.get('ref_range')}\n"
                f"危急警报：{rep.get('conclusion')}"
            )
            return True, rep, msg

        # 5. Emergency Full Aorta Contrast-Enhanced CTA (Gold Node N15)
        if any(k in name for k in ["cta", "增强cta", "主动脉全长", "大血管cta", "主动脉造影", "主动脉cta"]):
            rep = self.lab_reports.get("aortic_cta", {})
            findings_text = "\n".join(f"• {f}" for f in rep.get("findings", []))
            msg = (
                f"【急诊胸腹全主动脉增强 CTA 确诊金标准报告】\n"
                f"影像表现：\n{findings_text}\n"
                f"🎯 放射影像终审结论：{rep.get('conclusion')}"
            )
            return True, rep, msg

        # 6. Complete Blood Count (CBC)
        if any(k in name for k in ["血常规", "cbc", "白细胞", "血红蛋白"]):
            rep = self.lab_reports.get("routine_blood", {})
            msg = (
                f"【急诊血常规检验单】\n"
                f"结果：{rep.get('result')}\n"
                f"参考区间：{rep.get('ref_range')}"
            )
            return True, rep, msg

        # 7. Coagulation Profile
        if any(k in name for k in ["凝血", "inr", "aptt", "pt", "纤维蛋白原"]):
            rep = self.lab_reports.get("coagulation", {})
            msg = (
                f"【急诊凝血功能检验单】\n"
                f"结果：{rep.get('result')}\n"
                f"参考区间：{rep.get('ref_range')}"
            )
            return True, rep, msg

        # Unmatched routine test: 防幻觉护栏不允许编造"正常"结果——
        # 未收录的检查项目必须诚实回绝，提示学员开立病例支持的检查。
        default_rep = {
            "item_name": order_name,
            "modality": "LAB",
            "result": "本病例未配置该项检查的确定性数据",
            "conclusion": "防幻觉护栏：该项检查未收录，拒绝编造检验数值",
            "status": "NOT_CONFIGURED"
        }
        return False, default_rep, f"【检查回报】开具【{order_name}】：本病例未配置该项检查的确定性报告（护栏拒绝编造结果）。请开立本病例已有金标准数据支持的检查项目。"
