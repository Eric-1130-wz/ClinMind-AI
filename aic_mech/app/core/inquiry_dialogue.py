"""Case-backed natural-language inquiries; no generated clinical facts."""
import re
from typing import Any, Dict, List, Optional

_TOPIC_WORDS = {
    "allergy": ("过敏", "不良反应"),
    "medication": ("服药", "用药", "吃药", "停药", "漏服", "吃什么药", "吃了什么药", "吃啥药", "药名"),
    "history": ("既往", "病史", "以前得", "慢性病", "基础病", "高血压", "糖尿病"),
    "onset": ("何时", "什么时候", "多久", "多长时间", "持续", "几天", "几小时", "开始", "起病", "时间"),
    "trigger": ("诱因", "干什么", "做什么", "发作前", "怎么发作", "吃了什么", "吃过什么", "接触", "受凉"),
    "radiation": ("放射", "窜", "传到", "扩散", "延伸"),
    "relief": ("缓解", "加重", "减轻", "好点", "好些", "休息", "体位"),
    "severity": ("几分", "评分", "多严重", "多厉害", "程度"),
    "associated": ("伴随", "还有", "其他不舒服", "别的不舒服", "同时"),
    "identity": ("姓名", "名字", "多大", "几岁", "职业", "做什么工作"),
    "symptoms": ("怎么疼", "疼法", "痛法", "性质", "哪里", "哪儿", "疼", "痛", "症状", "不舒服", "胸闷", "喘", "发热", "咳嗽", "腹泻", "呕吐", "头晕"),
}
FOLLOWUP = re.compile(r"^(?:那|然后|那么|嗯|哦|请)?(?:还有呢|再说一遍|说详细点|具体呢|后来呢|再详细说说)[？?。！!\s]*$")

class CaseInquiry:
    """Keeps only topic/variant state; every answer comes from this case."""
    def __init__(self, data: Dict[str, Any]):
        self.data = data
        self.last_topics: List[str] = []
        self.variants: Dict[str, int] = {}

    def topics(self, query: str) -> List[str]:
        q = query.strip().lower()
        if FOLLOWUP.fullmatch(q):
            return list(self.last_topics)
        # “药物过敏”不属于“用药史”，问哪个字段就答哪个字段。
        cleaned = q.replace("药物过敏", "过敏").replace("对什么药过敏", "过敏")
        topics = [topic for topic, words in _TOPIC_WORDS.items() if any(w in cleaned for w in words)]
        # 精确的病程问题优先，避免“疼了多久”又答一遍整段疼痛性质。
        if len(topics) > 1:
            topics = [t for t in topics if t != "symptoms"]
        if "做什么工作" in q:
            topics = [t for t in topics if t != "trigger"]
        return topics[:4]

    def _layer(self, topic: str) -> Optional[str]:
        layers = (self.data.get("game_extensions") or {}).get("dialogue_layers") or {}
        inquiry = layers.get("inquiry") or {}
        candidates = inquiry.get(topic) or []
        if isinstance(candidates, str):
            candidates = [candidates]
        candidates = [x for x in candidates if isinstance(x, str) and x.strip()]
        if not candidates:
            return None
        n = self.variants.get(topic, 0)
        self.variants[topic] = n + 1
        # Only rotate authored facts; never manufacture a new symptom.
        return re.sub(r"（教学点：[^）]*）", "", candidates[n % len(candidates)])

    def reply(self, query: str) -> Optional[str]:
        if not self.data.get("patient_profile") or not self.data.get("present_illness"):
            return None
        topics = self.topics(query)
        if not topics:
            return None
        profile = self.data.get("patient_profile") or {}
        illness = self.data.get("present_illness") or {}
        if not isinstance(illness, dict):
            illness = {}
        answers = []
        for topic in topics:
            text = None
            if topic == "allergy":
                fact = profile.get("allergy_history")
                text = f"说到过敏，我记得：{fact}" if fact else "过敏这件事我记不清楚了，得再核实，不能直接当成没有。"
            elif topic == "medication":
                facts = profile.get("medication_history") or []
                if isinstance(facts, str):
                    facts = [facts]
                # Describe medication history without turning it into a dosing instruction.
                fact = "；".join(str(x) for x in facts)
                fact = re.sub(r"\d+(?:\.\d+)?\s*(?:mg|µg|μg|mL|ml|g|U)\b", "", fact)
                text = f"之前用药的情况是：{fact}" if fact else "具体药名我记不清，需要核对平时的药盒或处方。"
            elif topic == "history":
                fact = profile.get("past_history")
                text = f"我以前的身体情况是：{fact}" if fact else self._layer("既往史")
            elif topic in ("onset", "trigger", "radiation", "relief"):
                text = illness.get(topic)
                if not text:
                    text = self._layer("诱因" if topic in ("onset", "trigger") else "症状")
                if not text:
                    text = "您问的这个细节我记不清了，需要再核实一下。"
            elif topic == "severity":
                # “现在疼几分”交给实时监护上下文，不伪称初始 VAS 是当前测量值。
                text = illness.get("character") or self.data.get("chief_complaint")
            elif topic == "associated":
                text = self._layer("伴随症状") or illness.get("character")
            elif topic == "symptoms":
                text = self._layer("症状") or illness.get("character") or self.data.get("chief_complaint")
            elif topic == "identity":
                text = f"我叫{profile.get('name', '未记录姓名')}，{profile.get('age', '未记录年龄')}岁。"
                if profile.get("occupation"):
                    text += f"平时做{profile['occupation']}。"
            if isinstance(text, str) and text.strip() and text not in answers:
                answers.append(text.strip())
        self.last_topics = topics
        return " ".join(answers) if answers else None

