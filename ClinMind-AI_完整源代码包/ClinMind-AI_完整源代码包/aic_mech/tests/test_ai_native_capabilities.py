"""AI 原生能力专项测试：多角色协同问诊 + 大模型专家白盒复盘。

所有断言严格对齐源码真实接口：
- app.core.agent_engine.AgentEngine(initial_state: Optional[AgentState] = None)
- app.core.agent_engine.AgentEngine._generate_multi_agent_llm_response(user_query: str)
- app.core.ged_evaluator.GEDEvaluator._generate_feedback(...)
- app.models.entities.ActionRecord(action_id, action_type, content, timestamp, ...)
"""
import json
from unittest.mock import patch

import pytest

import config
from app.core.agent_engine import AgentEngine
from app.core.ged_evaluator import GEDEvaluator
from app.models.entities import ActionRecord
from app.models.entities import ActionType


@pytest.fixture(autouse=True)
def _isolate_offline(monkeypatch):
    """强制所有用例走离线分支，杜绝测试误调用真实大模型 API 消耗额度。"""
    monkeypatch.setattr(config, "is_online_llm_active", lambda: False)
    monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "")
    monkeypatch.setattr(config, "OPENAI_API_KEY", "")


@pytest.fixture
def agent_engine():
    return AgentEngine()


@pytest.fixture
def ged_evaluator():
    return GEDEvaluator()


def _make_action(content: str, step_id: str = "N13") -> ActionRecord:
    return ActionRecord(
        action_id="act-test-001",
        step_id=step_id,
        action_type=ActionType.MEDICATION,
        content=content,
        timestamp=10.0,
    )

class _FakeHTTPResponse:
    """模拟 httpx.Client.post 的最小响应对象。"""

    def __init__(self, content: str, status_code: int = 200):
        self.status_code = status_code
        self.text = content

    def json(self):
        return {"choices": [{"message": {"content": self.text}}]}


def _mock_llm_reply(content: str):
    """构造一个 patch 上下文，拦截 httpx 并返回指定大模型回复。"""
    return patch("httpx.Client.post", return_value=_FakeHTTPResponse(content))




# ==========================================================
# 一、多角色协同问诊（Multi-Agent LLM Collaboration）
# ==========================================================

class TestMultiAgentDialogue:
    def test_json_response_parses_patient_and_family(self, agent_engine):
        """规范 JSON 返回时，应同时解析出患者与家属两个独立角色气泡。"""
        payload = json.dumps(
            {
                "patient": "呃啊……大夫，我胸口像被刀劈开一样疼……",
                "patient_emotion": "agony",
                "family": "大夫，他今天在工地搬重水泥，突然就成这样了！",
                "family_emotion": "anxious",
            },
            ensure_ascii=False,
        )
        with patch.object(config, "is_online_llm_active", return_value=True), \
                 patch.object(config, "DEEPSEEK_API_KEY", "sk-test-dummy"), \
                 patch.object(config, "LLM_PROVIDER", "deepseek"):
            with _mock_llm_reply(payload):
                msgs = agent_engine._generate_multi_agent_llm_response("哪里疼？之前有高血压吗？")

        assert msgs is not None, "在线模式下应返回解析后的多角色消息"
        speakers = [m.speaker for m in msgs]
        assert "patient" in speakers, "必须包含患者角色"
        assert "family" in speakers, "必须包含家属角色"

        patient = next(m for m in msgs if m.speaker == "patient")
        family = next(m for m in msgs if m.speaker == "family")
        assert "胸口像被刀劈开" in patient.text
        assert patient.emotion == "agony"
        assert "搬重水泥" in family.text
        assert family.emotion == "anxious"

    def test_markdown_fenced_json_is_parsed(self, agent_engine):
        """大模型返回被 ```json 包裹时，应能剥离围栏后正确解析。"""
        payload = (
            "```json\n"
            + json.dumps(
                {
                    "patient": "我……我喘不上气……",
                    "patient_emotion": "groaning",
                    "family": "大夫您快想办法啊！",
                    "family_emotion": "distressed",
                },
                ensure_ascii=False,
            )
            + "\n```"
        )
        with patch.object(config, "is_online_llm_active", return_value=True), \
                 patch.object(config, "DEEPSEEK_API_KEY", "sk-test-dummy"), \
                 patch.object(config, "LLM_PROVIDER", "deepseek"):
            with _mock_llm_reply(payload):
                msgs = agent_engine._generate_multi_agent_llm_response("你现在感觉怎么样？")

        assert msgs is not None
        assert any(m.speaker == "patient" for m in msgs)

    def test_family_only_response(self, agent_engine):
        """医生转向家属提问时，家属角色应能独立承载关键病史信息。"""
        payload = json.dumps(
            {
                "patient": "……（呻吟）",
                "patient_emotion": "groaning",
                "family": "他两周前擅自把降压药全停了！",
                "family_emotion": "regretful",
            },
            ensure_ascii=False,
        )
        with patch.object(config, "is_online_llm_active", return_value=True), \
                 patch.object(config, "DEEPSEEK_API_KEY", "sk-test-dummy"), \
                 patch.object(config, "LLM_PROVIDER", "deepseek"):
            with _mock_llm_reply(payload):
                msgs = agent_engine._generate_multi_agent_llm_response("他平时怎么吃药？")

        assert msgs is not None
        family = next(m for m in msgs if m.speaker == "family")
        assert "停" in family.text

    def test_non_json_raw_text_falls_back_to_patient_bubble(self, agent_engine):
        """大模型返回非 JSON 自然文本时，应优雅降级为患者气泡，不抛异常。"""
        with patch.object(config, "is_online_llm_active", return_value=True), \
                 patch.object(config, "DEEPSEEK_API_KEY", "sk-test-dummy"), \
                 patch.object(config, "LLM_PROVIDER", "deepseek"):
            with _mock_llm_reply("我胸口疼得厉害……"):
                msgs = agent_engine._generate_multi_agent_llm_response("疼吗？")

        assert msgs is not None
        assert msgs[0].speaker == "patient"
        assert "胸口疼" in msgs[0].text

    def test_offline_mode_returns_none(self, agent_engine):
        """离线模式（无 API Key）下应返回 None，交由上层规则引擎兜底。"""
        with patch.object(config, "is_online_llm_active", return_value=False):
            assert agent_engine._generate_multi_agent_llm_response("测试") is None


# ==========================================================
# 二、大模型专家白盒复盘（LLM Clinical Review）
# ==========================================================

class TestLLMClinicalReview:
    def test_llm_review_takes_priority_when_online(self, ged_evaluator):
        """在线模式下，应优先返回大模型生成的个性化复盘，而非离线模板。"""
        review = (
            "【AI主考官·临床决策思维白盒诊断】：学员在本次抢救中第一时间测量双上肢血压，"
            "迅速将鉴别方向锁定于主动脉夹层，思维路径清晰。\n\n"
            "【血流动力学与时序因果根因剖析】：学员严格遵循先控心率后降压的时序阻断原则，"
            "有效抑制了 dP/dt 壁面剪切力的陡增。\n\n"
            "【胸痛中心循证规范个性化提升处方】：建议下次演练更早呼叫心胸外科会诊。"
        )
        with patch.object(config, "is_online_llm_active", return_value=True):
            with patch.object(
                ged_evaluator, "_generate_llm_clinical_review", return_value=[review]
            ) as mocked:
                fb = ged_evaluator._generate_feedback(
                    student_node_ids={"N5", "N8", "N13", "N14", "N15", "N17"},
                    extraneous_nodes=set(),
                    fatal_occurred=False,
                    fatal_errors=[],
                    action_records=[_make_action("静脉推注艾司洛尔 20mg")],
                    total_score=92.0,
                    radar_scores={"critical_first_aid": 100.0},
                    final_diagnosis="Stanford A型主动脉夹层",
                )

        assert mocked.called, "在线模式必须调用大模型复盘通道"
        assert fb == [review]
        assert "AI主考官" in fb[0]

    def test_offline_review_uses_evidence_based_templates(self, ged_evaluator):
        """离线模式下，必须回落到可解释的循证医学模板，并正确识别致命用药错误。"""
        with patch.object(config, "is_online_llm_active", return_value=False):
            fb = ged_evaluator._generate_feedback(
                student_node_ids={"N1"},
                extraneous_nodes=set(),
                fatal_occurred=True,
                fatal_errors=["误用抗血小板药物诱发夹层破裂"],
                action_records=[],
                total_score=32.0,
                radar_scores={},
                final_diagnosis="",
            )

        joined = "\n".join(fb)
        assert "隧道视野" in joined, "应识别出认知偏差类型"
        assert "抗血小板" in joined or "抗凝" in joined, "应明确指出禁忌用药"

    def test_exemplary_path_gets_positive_feedback(self, ged_evaluator):
        """规范完成全部主干节点且无致命错误时，应给出正向评价而非空反馈。"""
        with patch.object(config, "is_online_llm_active", return_value=False):
            fb = ged_evaluator._generate_feedback(
                student_node_ids={
                    "N1", "N2", "N3", "N5", "N6", "N8",
                    "N10", "N13", "N14", "N15", "N17", "N18",
                },
                extraneous_nodes=set(),
                fatal_occurred=False,
                fatal_errors=[],
                action_records=[],
                total_score=95.0,
                radar_scores={},
                final_diagnosis="Stanford A型主动脉夹层",
            )

        assert len(fb) > 0
        joined = "\n".join(fb)
        assert "优秀" in joined or "逻辑缜密" in joined

    def test_review_prompt_contains_real_action_sequence(self, ged_evaluator):
        """送入大模型的 prompt 必须包含学员真实操作序列，确保复盘个性化而非通用模板。"""
        captured = {}

        def fake_post(*args, **kwargs):
            captured["payload"] = kwargs.get("json")
            raise RuntimeError("stop-before-network")

        actions = [
            _make_action("静脉推注艾司洛尔 20mg", "N13"),
            _make_action("微量泵入硝普钠 0.5ug/kg/min", "N14"),
        ]
        with patch.object(config, "is_online_llm_active", return_value=True):
            with patch.object(config, "DEEPSEEK_API_KEY", "sk-test-dummy-key"):
                with patch("httpx.Client.post", side_effect=fake_post):
                    ged_evaluator._generate_llm_clinical_review(
                        action_records=actions,
                        student_node_ids={"N13", "N14"},
                        total_score=88.0,
                        radar_scores={"critical_first_aid": 100.0},
                        fatal_occurred=False,
                        fatal_errors=[],
                        final_diagnosis="Stanford A型主动脉夹层",
                    )

        assert "payload" in captured, "应实际发起带真实操作序列的模型请求"
        user_content = captured["payload"]["messages"][-1]["content"]
        assert "艾司洛尔" in user_content, "prompt 必须含学员真实用药操作"
        assert "硝普钠" in user_content, "prompt 必须含学员真实用药顺序"
        assert "88.0" in user_content, "prompt 必须含真实总分"
