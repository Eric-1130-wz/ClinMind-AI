"""Regression tests for free-text inquiries. All model calls are mocked."""
import json
import os
import unittest
from unittest.mock import patch
os.environ["USE_ONLINE_LLM"] = "false"

from app.core.agent_engine import AgentEngine
from app.core.case_repository import get_case_repository
from app.models.entities import DialogueMessage, PatientStateEnum
import config

class InquiryDialogueTests(unittest.TestCase):
    def engine(self, case_id="case_chest_pain_001"):
        engine=AgentEngine(case_data=get_case_repository().require(case_id))
        engine.sync_emotion({"patient_trust":.75, "patient_anxiety":.5})
        return engine

    def patient(self, messages):
        return " ".join(m.text for m in messages if m.speaker=="patient")

    def test_compound_question_uses_onset_and_allergy_not_generic_pain(self):
        e=self.engine()
        answer=self.patient(e.handle_inquiry("什么时候开始的？有没有药物过敏？"))
        self.assertIn("3小时", answer)
        self.assertIn("过敏", answer)
        self.assertNotIn("搬水泥", answer)

    def test_pain_duration_question_is_not_swallowed_by_pain_keyword(self):
        answer=self.patient(self.engine().handle_inquiry("疼了多久？"))
        self.assertIn("3小时", answer)

    def test_followup_retains_topic_and_is_relevant(self):
        e=self.engine("case_gam_003_asthma")
        first=e.handle_inquiry("什么时候开始喘的？")
        follow=e.handle_inquiry("具体呢？")
        self.assertEqual(follow.question_kind,"relevant")
        self.assertIn("2 小时", self.patient(follow))
        self.assertEqual(self.patient(first),self.patient(follow))

    def test_medication_and_allergy_are_different_facts(self):
        e=self.engine("case_gam_003_asthma")
        allergy=self.patient(e.handle_inquiry("对什么药过敏？"))
        self.assertIn("猫毛",allergy)
        self.assertNotIn("吸入剂",allergy)
        drugs=self.patient(e.handle_inquiry("平时吃什么药？"))
        self.assertIn("沙丁胺醇",drugs)

    def test_missing_allergy_is_unknown_instead_of_negative(self):
        e=self.engine()
        e.case_data["patient_profile"].pop("allergy_history",None)
        self.assertIn("不能直接当成没有",self.patient(e.handle_inquiry("有药物过敏吗？")))

    def test_catalogue_uses_online_branch_and_keeps_doctor_turn(self):
        e=self.engine("case_gam_003_asthma")
        with patch.object(config,"is_online_llm_active",return_value=True), patch.object(
            e,"_generate_multi_agent_llm_response",
            return_value=[DialogueMessage(speaker="patient",text="我下午抱过猫，然后打扫了画室。")]
        ) as call:
            answer=e.handle_inquiry("发作前接触了什么？")
        call.assert_called_once()
        self.assertEqual(answer[0].speaker,"doctor")
        self.assertIn("画室",self.patient(answer))
        self.assertEqual(len(e.dialogue_history),2)

    def test_unconscious_patient_never_calls_online_model(self):
        e=self.engine("case_gam_003_asthma")
        with patch.object(config,"is_online_llm_active",return_value=True), patch.object(
            e,"_generate_multi_agent_llm_response"
        ) as call:
            result=e.handle_inquiry("现在感觉怎样",PatientStateEnum.S6_CARDIAC_ARREST)
        call.assert_not_called()
        self.assertIn("意识丧失",self.patient(result))

    def test_online_prompt_contains_case_history_and_current_state(self):
        e=self.engine("case_gam_003_asthma")
        e.dialogue_history=[
            DialogueMessage(speaker="doctor",text="什么时候开始的？"),
            DialogueMessage(speaker="patient",text="下午打扫画室后开始。")
        ]
        e.clinical_context={"patient_state":"S0_STABLE","vitals":{"hr":104}}
        response=unittest.mock.Mock()
        response.status_code=200
        response.json.return_value={"choices":[{"message":{"content":json.dumps({
            "patient":"医生，我下午先抱了画室的猫，接着又打扫了画室，扬起了很多灰尘，后来就觉得呼气越来越费劲了。",
            "family":"", "patient_emotion":"anxious"
        },ensure_ascii=False)}}]}
        with patch.object(config,"LLM_PROVIDER","custom"), patch.object(config,"OPENAI_BASE_URL","http://unit.test/v1"), patch("httpx.Client") as client:
            client.return_value.__enter__.return_value.post.return_value=response
            result=e._generate_multi_agent_llm_response("后来呢？")
            payload=client.return_value.__enter__.return_value.post.call_args.kwargs["json"]
        messages=payload["messages"]
        self.assertIn("陈小雨",messages[0]["content"])
        self.assertIn('"hr": 104',messages[0]["content"])
        self.assertNotIn("孙建国",messages[0]["content"])
        self.assertTrue(any("打扫画室后开始" in m["content"] for m in messages[1:-1]))
        self.assertIsNotNone(result)

if __name__=="__main__":
    unittest.main()

