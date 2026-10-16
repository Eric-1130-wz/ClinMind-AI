"""Multi-Agent Doctor-Patient-Family-Nurse Collaboration Engine.

Features:
- Patient Agent: dynamic trust T_trust, pain perception, unlocked clinical history.
- Family Agent: anxiety impedance equation, interruption countdown, surgical consent.
- Nurse Agent: order execution pipeline, active critical value alarms, safety warnings.
- Dual-mode architecture: 100% offline high-fidelity simulation engine with optional online LLM connector.
"""

import time
from typing import Dict, Any, List, Optional, Tuple
import httpx
from app.models.entities import AgentState, DialogueMessage, ActionType, PatientStateEnum
import config


class AgentEngine:
    """Manages the dynamic multi-agent clinical simulation."""

    def __init__(self, initial_state: Optional[AgentState] = None):
        self.state = initial_state or AgentState(
            patient_trust=0.40,
            patient_pain=9,
            family_anxiety=0.65,
            family_interrupted_count=0,
            nurse_orders_queue=[],
            active_critical_alarms=[]
        )
        self.dialogue_history: List[DialogueMessage] = []
        self.history_actions_count: int = 0
        self.last_interaction_time: float = time.time()

    def handle_inquiry(self, query: str, current_state: PatientStateEnum = PatientStateEnum.S0_STABLE) -> List[DialogueMessage]:
        """Process clinician inquiry directed towards patient or family."""
        self.last_interaction_time = time.time()
        self.history_actions_count += 1
        q = query.strip().lower()
        now = time.time()
        messages: List[DialogueMessage] = []

        # Clinician speaking bubble
        messages.append(DialogueMessage(
            speaker="doctor",
            text=query,
            timestamp=now,
            role_title="主治医师/接诊医生",
            emotion="professional"
        ))

        # Check for Patient Unconsciousness / Tamponade / Arrest
        if current_state in [PatientStateEnum.S4_CARDIAC_TAMPONADE, PatientStateEnum.S5_AORTIC_RUPTURE, PatientStateEnum.S6_CARDIAC_ARREST]:
            messages.append(DialogueMessage(
                speaker="patient",
                text="（双眼紧闭，意识丧失，对呼唤与摇晃无任何反应，口唇严重发绀）",
                timestamp=now + 0.5,
                role_title="患者 孙建国 (52岁)",
                emotion="unconscious"
            ))
            messages.append(DialogueMessage(
                speaker="family",
                text="老孙！老孙你怎么了？！医生求求你快救救他啊！怎么不说话了啊老孙！",
                timestamp=now + 1.0,
                role_title="家属（妻子李秀梅）",
                emotion="terrified"
            ))
            return messages

        # ==========================================
        # 1. 优先分支: 在线大模型多角色协同推演 (Online Multi-Agent LLM Branch)
        # ==========================================
        if config.is_online_llm_active():
            llm_messages = self._generate_multi_agent_llm_response(query)
            if llm_messages:
                return llm_messages

        # ==========================================
        # 2. 备用分支: 高保真离线多场景规则引擎
        # ==========================================
        # 1. 安慰与同理心沟通
        # Accept the wording used by the UI quick actions as well as natural
        # variations clinicians commonly type (e.g. "镇痛" instead of
        # "止痛").  These are all empathy/safety statements and should move
        # the trust state before the hidden history question is asked.
        if any(k in q for k in [
            "别紧张", "放松", "别害怕", "马上止痛", "镇痛", "止痛",
            "控制血压", "别慌", "我们全力救治", "全力救治", "信任我们"
        ]):
            self.state.patient_trust = min(1.0, self.state.patient_trust + 0.15)
            self.state.family_anxiety = max(0.2, self.state.family_anxiety - 0.15)
            messages.append(DialogueMessage(
                speaker="patient",
                text="好……大夫，有您这句话我就放心点了……但我胸口真的快被撕开了，求您快救救我……",
                timestamp=now + 0.8,
                role_title="患者 孙建国 (52岁)",
                emotion="relieved"
            ))
            messages.append(DialogueMessage(
                speaker="family",
                text="大夫，我们全家都听您的，只要能让我爱人止住疼，您怎么治都行！",
                timestamp=now + 1.2,
                role_title="家属（妻子李秀梅）",
                emotion="appreciative"
            ))
            return messages

        # 2. 问疼痛性质与放射 (金标准节点 N1)
        if any(k in q for k in ["撕裂", "刀割", "后背", "性质", "怎么疼", "疼痛", "哪里疼", "胸口"]):
            messages.append(DialogueMessage(
                speaker="patient",
                text="大夫！我胸骨后面像被生生用刀劈开撕裂了一样！而且剧痛一下子窜到了后背两块肩胛骨中间！疼得我浑身冷汗直冒，喘不上气！",
                timestamp=now + 0.8,
                role_title="患者 孙建国 (52岁)",
                emotion="agony"
            ))
            return messages

        # 3. 问发病诱因 (金标准节点 N2)
        if any(k in q for k in ["重体力", "用力", "搬东西", "诱因", "怎么发作的", "情绪", "干什么时", "什么时候开始"]):
            messages.append(DialogueMessage(
                speaker="patient",
                text="今天下午在工地上……我帮工友们搬了一大包重水泥，刚一使劲猛抬，胸口突然就像‘啪’的一声撕裂炸开了！持续疼了整整3个多小时了！",
                timestamp=now + 0.8,
                role_title="患者 孙建国 (52岁)",
                emotion="groaning"
            ))
            return messages

        # 4. 问高血压病史与服药遵从度 (金标准节点 N3)
        if any(k in q for k in ["高血压", "服药", "停药", "降压药", "平时血压", "吃什么药", "既往史", "病史"]):
            if self.state.patient_trust >= 0.35:
                messages.append(DialogueMessage(
                    speaker="patient",
                    text="我……我有高血压十年了，最高量过 200/115！平时嫌吃药麻烦经常漏服……最近赶工期这两周擅自停药了……",
                    timestamp=now + 0.8,
                    role_title="患者 孙建国 (52岁)",
                    emotion="regretful"
                ))
                messages.append(DialogueMessage(
                    speaker="family",
                    text="大夫！他根本不听劝！天天熬夜加班，擅自把降压药全停了，我怎么骂他都不吃！",
                    timestamp=now + 1.3,
                    role_title="家属（妻子李秀梅）",
                    emotion="anxious"
                ))
            else:
                messages.append(DialogueMessage(
                    speaker="family",
                    text="大夫，他有高血压好多年了，经常不好好服药！大夫您快救救他，别光问这个了！",
                    timestamp=now + 0.8,
                    role_title="家属（妻子李秀梅）",
                    emotion="distressed"
                ))
            return messages

        # 5. 急诊手术与知情同意 (金标准节点 N18)
        if any(k in q for k in [
            "知情同意", "同意书", "签署", "签字", "手术", "病危",
            "病危通知", "心胸外科", "开胸", "交代病情"
        ]):
            self.state.family_anxiety = max(0.4, self.state.family_anxiety - 0.2)
            messages.append(DialogueMessage(
                speaker="family",
                text="（流着眼泪颤抖拿笔）大夫……我们全家都听您的！我们全力配合！字我们马上签，求医院心胸外科马上安排急诊手术！",
                timestamp=now + 1.0,
                role_title="家属（妻子李秀梅）",
                emotion="determined"
            ))
            return messages

        # 6. 多场景上下文离线兜底 (轮换多样化回应，杜绝复读机)
        fallbacks = [
            "大夫……我胸口和后背两块骨头中间像被刀劈开一样钻心地疼，喘气都费劲……快救救我……",
            "大夫，我全身都在冒冷汗，两只胳膊发沉发麻，您问的我全配合，快给我上点止痛针吧！",
            "大夫，我下午搬水泥用力猛了突然发作的，现在连吸气胸腔都像要炸开一样……",
            "大夫……我平时血压确实很高，这次是不是心脏或者大血管破了啊……我还撑得住吗大夫……"
        ]
        import random
        chosen_text = random.choice(fallbacks)
        messages.append(DialogueMessage(
            speaker="patient",
            text=chosen_text,
            timestamp=now + 0.8,
            role_title="患者 孙建国 (52岁)",
            emotion="pleading"
        ))
        return messages

    def notify_order_dispatched(self, action_name: str, duration_sec: int = 15) -> DialogueMessage:
        """Nurse confirms execution of medical order."""
        return DialogueMessage(
            speaker="nurse",
            text=f"【护士执行】收到医嘱：已立即执行【{action_name}】。",
            timestamp=time.time(),
            role_title="急诊抢救室 林护士",
            emotion="efficient"
        )

    def observe_action(self, action_type: ActionType, content: str, *, safe: bool = True) -> None:
        """Update trust and anxiety from observable bedside care behavior."""
        q = (content or "").lower()
        if action_type == ActionType.INQUIRY:
            if any(k in q for k in ["安慰", "别紧张", "止痛", "镇痛", "全力救治", "解释", "沟通"]):
                self.state.patient_trust = min(1.0, self.state.patient_trust + 0.08)
                self.state.family_anxiety = max(0.2, self.state.family_anxiety - 0.08)
            else:
                self.state.patient_trust = min(1.0, self.state.patient_trust + 0.025)
        elif action_type == ActionType.PHYSICAL_EXAM:
            self.state.patient_trust = min(1.0, self.state.patient_trust + 0.035)
            self.state.family_anxiety = max(0.2, self.state.family_anxiety - 0.025)
        elif action_type == ActionType.LAB_ORDER:
            self.state.family_anxiety = max(0.2, self.state.family_anxiety - 0.035)
        elif action_type == ActionType.RESCUE_DISPOSITION:
            if any(k in q for k in ["吸氧", "监护", "静脉", "会诊", "手术", "知情", "签字", "抢救"]):
                self.state.patient_trust = min(1.0, self.state.patient_trust + 0.06)
                self.state.family_anxiety = max(0.2, self.state.family_anxiety - 0.07)
        elif action_type == ActionType.MEDICATION and not safe:
            self.state.patient_trust = max(0.0, self.state.patient_trust - 0.12)
            self.state.family_anxiety = min(1.0, self.state.family_anxiety + 0.15)

    def generate_nurse_warning(self, drug_name: str) -> DialogueMessage:
        """Nurse issues an emergency safety intercept alert."""
        return DialogueMessage(
            speaker="nurse",
            text=(
                f"【护士警觉拦截】王大夫！您开具了【{drug_name}】？！"
                "患者表现为突发剧烈撕裂样胸痛伴双臂血压显著不对称，未排除大血管病变！"
                "使用抗血小板/抗凝/溶栓极易诱发假腔暴发性破裂！您确定要强制推注吗？！"
            ),
            timestamp=time.time(),
            role_title="急诊抢救室 林护士 (危急拦截)",
            emotion="urgent"
        )

    def generate_tamponade_alert(self, sbp: float) -> DialogueMessage:
        """Nurse sounds fatal cardiac tamponade alert."""
        return DialogueMessage(
            speaker="nurse",
            text=(
                f"【危急抢救警报】患者突发呼之不应！血压骤降至 {int(sbp)}/30 mmHg！心音遥远！颈静脉怒张！"
                "疑似夹层破裂急性心包填塞！请立即准备抢救车与心包穿刺！"
            ),
            timestamp=time.time(),
            role_title="急诊抢救室 林护士 (紧急呼救)",
            emotion="alarm"
        )

    def handle_nurse_order(self, action_type: ActionType, order_desc: str) -> Dict[str, Any]:
        """Process nurse order execution status."""
        warning = None
        desc_lower = order_desc.lower()
        if action_type == ActionType.MEDICATION:
            from config import LETHAL_MEDICATION_KEYWORDS
            if any(k in desc_lower for k in LETHAL_MEDICATION_KEYWORDS):
                warning = "【护士紧急警示拦截】王医生，患者双臂血压相差巨大且剧烈撕裂样胸背痛，高度怀疑主动脉夹层！指南严禁使用抗栓药物，该医嘱将诱发夹层破裂大出血！请再次确认！"
                self.state.active_critical_alarms.append(warning)

        msg = self.notify_order_dispatched(f"{action_type.value}: {order_desc}")
        return {
            "status": "医嘱已下达 (dispatched)",
            "order_desc": order_desc,
            "nurse_response": msg.text,
            "warning": warning,
            "timestamp": time.time()
        }

    def check_spontaneous_events(self, elapsed_seconds: float, current_state: PatientStateEnum) -> List[DialogueMessage]:
        """Check for time-triggered family interruptions or nurse alarms."""
        messages: List[DialogueMessage] = []
        now = time.time()

        # Family interruption if silence / inactivity > 40s
        if now - self.last_interaction_time > 40.0 and self.state.family_interrupted_count < 2:
            self.state.family_interrupted_count += 1
            self.last_interaction_time = now

            family_text = "医生！怎么停下了？！我爱人脸色煞白一身虚汗，你们还要商量多久？！电视上说胸痛要嚼阿司匹林，到底给不给他吃啊？！"
            # 若在线大模型已激活，可动态生成家属突发催促
            if config.is_online_llm_active():
                dynamic_prompt = "请扮演急诊抢救室极度焦急的妻子李秀梅，看到抢救暂停了40秒，说一句催促医生救救丈夫的简短话（不超过40字，口语、急切恐慌）。"
                dynamic_text = self._generate_llm_response(dynamic_prompt)
                if dynamic_text:
                    family_text = f"{dynamic_text.strip()}\n\n[🟢 来自在线大模型情境推演: {config.LLM_MODEL}]"

            messages.append(DialogueMessage(
                speaker="family",
                text=family_text,
                timestamp=now,
                role_title="家属（妻子李秀梅 - 焦虑催促）",
                emotion="anxious"
            ))

        return messages

    def _generate_multi_agent_llm_response(self, user_query: str) -> Optional[List[DialogueMessage]]:
        """Call external LLM API to collaboratively generate patient & family dialogue dynamically."""
        import json
        import time

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

        if not api_key and provider != "custom":
            return None

        if "deepseek.com" in base_url and not base_url.endswith("/v1") and not base_url.endswith("/chat/completions"):
            base_url = f"{base_url}/v1"
        elif "openai.com" in base_url and not base_url.endswith("/v1") and not base_url.endswith("/chat/completions"):
            base_url = f"{base_url}/v1"

        url = base_url if base_url.endswith("/chat/completions") else f"{base_url}/chat/completions"

        system_prompt = (
            "你正在参与国家级医工交叉与临床思维虚拟仿真模拟，负责在急诊抢救室协同推演多角色交互。\n"
            "【场景设定】：急诊抢救室，重症患者孙建国（男，52岁，建筑工人），突发极剧烈胸背部撕裂样、刀劈样剧痛3小时，大汗淋漓、面色惨白、极度濒死感；"
            "旁边是极度焦虑惶恐的家属妻子李秀梅（49岁）。\n"
            "【隐秘病史设定】：孙建国有10年原发高血压史，最高曾达200/115mmHg。两周前嫌麻烦擅自停降压药，今天下午在工地搬运重水泥猛用力时突发剧痛。\n"
            "【多角色协同生成规则】：\n"
            "1. 绝不允许输出套话与机械模板。必须根据医生的发言内容进行自然、真实的人性化回应。\n"
            "2. 如果医生询问身体感受（如痛感性质、部位、放射方向、发病时间）：以【患者】为主回答（口语化、痛苦呻吟断续、喘息），【家属】在旁焦急补充生活细节。\n"
            "3. 如果医生询问既往史/诱因/吃药情况，或明确对家属讲话：以【家属李秀梅】为主回答（焦急、懊悔自责丈夫停药），【患者】在旁呻吟忍痛。\n"
            "4. 如果医生进行心理安慰、交代病情、知情同意或要求签字手术：【家属】情绪转为高度配合与信任感激（表态全家全力配合签字），【患者】表示放心与感激。\n"
            "5. 严禁患者或家属说出'主动脉夹层'等专业医学诊断名词！他们只是普通工人群体。\n"
            "【严格JSON返回格式】：\n"
            "{\n"
            '  "patient": "患者的回答文本（若此时无法发声可为简短呻吟）",\n'
            '  "patient_emotion": "groaning | pleading | relieved | regretful",\n'
            '  "family": "家属妻子的回答或补充文本（若无需发言可为空字符串）",\n'
            '  "family_emotion": "anxious | distressed | determined | grateful"\n'
            "}"
        )

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_query}
            ],
            "max_tokens": 300,
            "temperature": 0.6
        }

        try:
            with httpx.Client(timeout=9.0) as client:
                res = client.post(url, headers=headers, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    choices = data.get("choices", [])
                    if choices:
                        raw_content = choices[0].get("message", {}).get("content", "").strip()
                        now = time.time()
                        messages: List[DialogueMessage] = []

                        # 尝试 JSON 解析
                        try:
                            # 提取可能包含在 ```json ``` 标记中的内容
                            cleaned = raw_content
                            if "```json" in cleaned:
                                cleaned = cleaned.split("```json")[1].split("```")[0].strip()
                            elif "```" in cleaned:
                                cleaned = cleaned.split("```")[1].split("```")[0].strip()
                            parsed = json.loads(cleaned)

                            p_text = parsed.get("patient", "").strip()
                            p_emo = parsed.get("patient_emotion", "groaning")
                            f_text = parsed.get("family", "").strip()
                            f_emo = parsed.get("family_emotion", "anxious")

                            if p_text:
                                messages.append(DialogueMessage(
                                    speaker="patient",
                                    text=f"{p_text}\n\n[🟢 来自在线大模型多角色协同: {model}]",
                                    timestamp=now + 0.6,
                                    role_title="患者 孙建国 (52岁)",
                                    emotion=p_emo
                                ))
                            if f_text:
                                messages.append(DialogueMessage(
                                    speaker="family",
                                    text=f"{f_text}",
                                    timestamp=now + 1.2,
                                    role_title="家属（妻子李秀梅）",
                                    emotion=f_emo
                                ))
                            
                            # 联动状态机
                            if "relieved" in p_emo or "grateful" in f_emo or "determined" in f_emo:
                                self.state.patient_trust = min(1.0, self.state.patient_trust + 0.15)
                                self.state.family_anxiety = max(0.2, self.state.family_anxiety - 0.15)

                            if messages:
                                return messages
                        except Exception:
                            # 非标准 JSON 兜底处理
                            messages.append(DialogueMessage(
                                speaker="patient",
                                text=f"{raw_content}\n\n[🟢 来自在线大模型协同: {model}]",
                                timestamp=now + 0.6,
                                role_title="患者 孙建国 (52岁)",
                                emotion="groaning"
                            ))
                            return messages
                else:
                    print(f"⚠️ [AgentEngine LLM Error] HTTP {res.status_code}: {res.text[:120]}")
        except Exception as e:
            print(f"⚠️ [AgentEngine LLM Exception] {e}")

        return None

    def _generate_llm_response(self, user_query: str) -> Optional[str]:
        """Call external LLM API (DeepSeek/OpenAI compatible) for realistic natural language response."""
        # 针对当前配置的 Provider 动态判定凭证与端点
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

        if not api_key and provider != "custom":
            return None

        # 兼容 v1 路径拼接
        if "deepseek.com" in base_url and not base_url.endswith("/v1") and not base_url.endswith("/chat/completions"):
            base_url = f"{base_url}/v1"
        elif "openai.com" in base_url and not base_url.endswith("/v1") and not base_url.endswith("/chat/completions"):
            base_url = f"{base_url}/v1"
        
        if base_url.endswith("/chat/completions"):
            url = base_url
        else:
            url = f"{base_url}/chat/completions"

        system_prompt = (
            "你正在参与国家级医科临床思维实训模拟。你扮演急诊抢救室52岁男性重症患者孙建国。\n"
            "【当前病理特征】你突发极其剧烈的胸背部撕裂样、刀劈样剧痛3小时，伴大汗淋漓、胸闷气短，极度痛苦恐慌。\n"
            "【隐秘病史设定】你有10年高血压史，最高曾达200/115mmHg。两周前擅自停药，今天下午在工地搬运重水泥猛用力时突发剧痛。\n"
            "【回答规则】\n"
            "1. 严格使用第一人称患者口吻，口语化、痛苦呻吟断续、真实反映剧痛濒死感，每次回答带拟声词或粗重呼吸（如‘呃啊……’、‘咳……’）。\n"
            "2. 每次回答控制在45~90字以内，重点回答医生的问题，不要长篇大论。\n"
            "3. 严禁自行说出‘主动脉夹层’等专业医学诊断名词！你只是个普通工地工人。\n"
            "4. 真实回答病情细节：比如后背剧痛、两周前擅自停药、搬重水泥用力诱发等。"
        )

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_query}
            ],
            "max_tokens": 160,
            "temperature": 0.7
        }

        try:
            with httpx.Client(timeout=8.0) as client:
                res = client.post(url, headers=headers, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    choices = data.get("choices", [])
                    if choices:
                        return choices[0].get("message", {}).get("content", "").strip()
                else:
                    print(f"⚠️ [AgentEngine LLM Error] HTTP {res.status_code}: {res.text[:120]}")
        except Exception as e:
            print(f"⚠️ [AgentEngine LLM Exception] {e}")
            return None
        return None
