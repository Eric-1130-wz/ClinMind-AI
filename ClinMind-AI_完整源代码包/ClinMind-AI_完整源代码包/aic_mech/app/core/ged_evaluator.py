"""Graph Edit Distance (GED) Clinical Decision Reasoning Evaluator.

Evaluates student clinical decision sequences against the Expert Golden DAG
using topological Graph Edit Distance (GED) with NetworkX. Outputs 6-dimensional
OSCE competency radar scores, cognitive bias attribution, and graph comparisons.
"""

import json
import math
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple, Set
import networkx as nx

from app.models.entities import ActionRecord, ActionType, OSCEAssessment
import config


class GEDEvaluator:
    """Evaluates student clinical decision graph against Expert Golden Standard."""

    def __init__(self, golden_dag_path: Optional[Path] = None):
        self.golden_dag_path = golden_dag_path or (config.DATA_DIR / "expert_golden_dag.json")
        self.expert_data = self._load_golden_dag()
        self.expert_graph = self._build_expert_graph()

    def _load_golden_dag(self) -> Dict[str, Any]:
        """Load golden DAG definition."""
        if not self.golden_dag_path.exists():
            raise FileNotFoundError(f"Golden DAG definition not found at: {self.golden_dag_path}")
        with open(self.golden_dag_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _build_expert_graph(self) -> nx.DiGraph:
        """Construct NetworkX DiGraph for expert golden standard."""
        G = nx.DiGraph()
        for node in self.expert_data.get("nodes", []):
            G.add_node(
                node["id"],
                action_type=node["action_type"],
                name=node["name"],
                category=node["category"],
                keywords=node.get("keywords", []),
                score=node.get("score", 5.0),
                ged_penalty=node.get("ged_penalty", 10.0),
                critical=node.get("critical", False)
            )

        for edge in self.expert_data.get("edges", []):
            G.add_edge(edge["from"], edge["to"], relation=edge.get("relation", "prerequisite"), weight=edge.get("weight", 1.0))

        return G

    def match_action_to_golden_node(self, action: ActionRecord) -> Optional[str]:
        """Semantic matching of a single student action to the closest Golden DAG node."""
        text = (action.content + " " + str(action.params)).lower()
        best_node_id: Optional[str] = None
        best_score = 0

        for nid, data in self.expert_graph.nodes(data=True):
            keywords: List[str] = data.get("keywords", [])
            match_count = sum(1 for kw in keywords if kw.lower() in text)
            if match_count > best_score:
                best_score = match_count
                best_node_id = nid

        return best_node_id if best_score >= 1 else None

    def build_student_graph(self, action_records: List[ActionRecord]) -> Tuple[nx.DiGraph, Dict[str, str]]:
        """Construct the student decision DAG from temporal action records.

        Returns: (student_graph, action_id_to_node_map)
        """
        G = nx.DiGraph()
        matched_map: Dict[str, str] = {}
        ordered_nodes: List[str] = []

        unmatched_counter = 1
        for action in action_records:
            matched_id = self.match_action_to_golden_node(action)
            if matched_id:
                node_id = matched_id
                action.step_id = node_id
            else:
                node_id = f"U_{unmatched_counter}"
                unmatched_counter += 1
                action.step_id = node_id

            matched_map[action.action_id] = node_id

            if not G.has_node(node_id):
                G.add_node(
                    node_id,
                    action_type=action.action_type.value,
                    content=action.content,
                    timestamp=action.timestamp,
                    is_contraindicated=action.is_contraindicated
                )
                ordered_nodes.append(node_id)

        # Add temporal causal edges between successive decision nodes
        for i in range(len(ordered_nodes) - 1):
            u = ordered_nodes[i]
            v = ordered_nodes[i + 1]
            if not G.has_edge(u, v):
                G.add_edge(u, v, relation="temporal_sequence")

        # Fulfill expert causal precedence edges when student respects clinical ordering (u before v)
        for u, v in self.expert_graph.edges():
            if u in ordered_nodes and v in ordered_nodes:
                if ordered_nodes.index(u) < ordered_nodes.index(v):
                    if not G.has_edge(u, v):
                        G.add_edge(u, v, relation="causal_precedence")

        return G, matched_map

    def evaluate(self, action_records: List[ActionRecord], final_diagnosis: str = "", include_feedback: bool = True) -> OSCEAssessment:
        """Execute full Graph Edit Distance and OSCE 6-Dimensional competency scoring."""
        student_graph, _ = self.build_student_graph(action_records)

        # 2. Check Fatal Errors (一票否决)
        fatal_errors: List[str] = []
        fatal_occurred = False
        for action in action_records:
            if action.is_contraindicated:
                fatal_occurred = True
                fatal_errors.append(f"【致命红线失误】下达绝对禁忌用药：{action.content}，诱发假腔破裂心包填塞。")

        # 智能识别学员临床抢救思路：若执行了CTA、心外科急诊手术或降压靶向，自动认定确立夹层正确思路
        expert_node_ids = set(self.expert_graph.nodes())
        student_node_ids = set(student_graph.nodes())

        has_cta_or_surgery = ("N15" in student_node_ids) or ("N17" in student_node_ids) or ("N13" in student_node_ids and "N14" in student_node_ids)
        diag_lower = (final_diagnosis or "").lower()
        if not diag_lower and has_cta_or_surgery:
            diag_lower = "stanford a型主动脉夹层 (由救治行为智能确立)"

        if diag_lower and not any(kw in diag_lower for kw in ["主动脉夹层", "夹层", "stanford a", "a型", "aorta dissection"]):
            fatal_errors.append(f"【重大误诊】最终确诊结论【{final_diagnosis}】与金标准严重不符（漏诊 Stanford A型主动脉夹层）。")

        # 临床合理推导链自动对齐:
        if has_cta_or_surgery or any(kw in diag_lower for kw in ["主动脉夹层", "夹层", "stanford a", "a型"]):
            student_node_ids.add("N16")
            student_graph.add_node("N16", label="确诊Stanford A型主动脉夹层", category="diagnosis")

        if not fatal_occurred:
            student_node_ids.add("N12")
            student_graph.add_node("N12", label="严禁抗栓溶栓", category="safety")

        if "N8" in student_node_ids:
            student_node_ids.add("N11") # 查心电图即完成排查AMI鉴别思维
            student_graph.add_node("N11", label="排查AMI鉴别思维", category="synthesis")

        if "N5" in student_node_ids or "N1" in student_node_ids:
            student_node_ids.add("N7")  # 撕裂痛或压差即确立夹层高危假设
            student_graph.add_node("N7", label="压差结合杂音提示夹层高危", category="synthesis")

        # Refresh causal edges for implicit nodes
        for u, v in self.expert_graph.edges():
            if u in student_node_ids and v in student_node_ids and not student_graph.has_edge(u, v):
                student_graph.add_edge(u, v, relation="causal_precedence")

        matched_golden_nodes = expert_node_ids.intersection(student_node_ids)
        missing_golden_nodes = expert_node_ids - student_node_ids
        extraneous_nodes = {n for n in student_node_ids if n.startswith("U_")}

        # 3. Calculate Weighted Graph Edit Distance (GED)
        node_deletion_cost = sum(self.expert_graph.nodes[n].get("ged_penalty", 10.0) for n in missing_golden_nodes)
        node_insertion_cost = len(extraneous_nodes) * 3.0  # Shotgun testing penalty

        # Edge distance
        expert_edge_set = set(self.expert_graph.edges())
        student_edge_set = set(student_graph.edges())
        missing_edges = expert_edge_set - student_edge_set
        edge_cost = len(missing_edges) * 1.5

        total_ged = node_deletion_cost + node_insertion_cost + edge_cost

        # Max possible penalty for normalization
        max_possible_penalty = sum(d.get("ged_penalty", 10.0) for _, d in self.expert_graph.nodes(data=True)) + len(expert_edge_set) * 1.5 + 30.0
        topological_similarity = max(0.0, min(1.0, 1.0 - (total_ged / max_possible_penalty)))

        # 4. OSCE 6-Dimensional Radar Scoring (0 - 100)
        # Dim 1: 急救处置力 (Critical First Aid): N4 (急救通路), N13 (艾司洛尔), N14 (硝普钠)
        first_aid_target = {"N4", "N13", "N14"}
        first_aid_hits = len(first_aid_target.intersection(student_node_ids))
        score_first_aid = round((first_aid_hits / len(first_aid_target)) * 100.0, 1)

        # Dim 2: 诊断精准度 (Diagnostic Accuracy): N15 (CTA确诊), N16 (最终确诊)
        diag_target = {"N15", "N16"}
        diag_hits = len(diag_target.intersection(student_node_ids))
        if any(kw in diag_lower for kw in ["主动脉夹层", "夹层", "stanford a"]):
            diag_hits = min(2, diag_hits + 1)
        score_diag = round((diag_hits / len(diag_target)) * 100.0, 1)

        # Dim 3: 鉴别思维广度 (Differential Thinking): N5 (双侧血压), N6 (听诊), N8 (心电图), N9 (心肌酶), N10 (D-二聚体), N11 (排除AMI)
        diff_target = {"N5", "N6", "N8", "N9", "N10", "N11"}
        diff_hits = len(diff_target.intersection(student_node_ids))
        score_diff = round((diff_hits / len(diff_target)) * 100.0, 1)

        # Dim 4: 安全与禁忌防范 (Safety Awareness): N12
        if fatal_occurred:
            score_safety = 0.0
        else:
            score_safety = 100.0 if "N12" in student_node_ids or not fatal_errors else 85.0

        # Dim 5: 医患沟通力 (Physician-Patient Communication): N1, N2, N3, N18
        comm_target = {"N1", "N2", "N3", "N18"}
        comm_hits = len(comm_target.intersection(student_node_ids))
        score_comm = round((comm_hits / len(comm_target)) * 100.0, 1)

        # Dim 6: 临床路径效率 (Clinical Efficiency): penalized by extra actions and missing nodes
        efficiency_base = 100.0 - (len(extraneous_nodes) * 8.0) - (len(missing_golden_nodes) * 3.0)
        score_efficiency = max(20.0, min(100.0, round(efficiency_base, 1)))

        radar_scores = {
            "critical_first_aid": score_first_aid,
            "diagnostic_accuracy": score_diag,
            "differential_thinking": score_diff,
            "safety_awareness": score_safety,
            "physician_patient_comm": score_comm,
            "clinical_efficiency": score_efficiency
        }

        # 临床医学加权综合得分模型 (真实反映急救思路)
        # 核心主干权衡：急救时效(25%) + 确诊精度(25%) + 鉴别思维(20%) + 安全意识(20%) + 医患沟通(10%)
        if fatal_occurred:
            total_score = min(38.0, round(sum(radar_scores.values()) / 6.0 * 0.4, 1))
        else:
            # 基础雷达综合分
            base_calc = (
                score_first_aid * 0.25 +
                score_diag * 0.25 +
                score_diff * 0.20 +
                score_safety * 0.20 +
                score_comm * 0.10
            )
            # 黄金急救路径达成与漏项梯度扣分
            core_hits = sum(1 for k in ["N5", "N8", "N13", "N14", "N15", "N17"] if k in student_node_ids)
            if core_hits >= 4 and not fatal_errors:
                base_calc = max(base_calc, 86.0)
            elif core_hits >= 2 and not fatal_errors:
                base_calc = max(base_calc, 75.0)

            # 漏项适度扣分（非一票否决项）
            penalty = len(missing_golden_nodes) * 1.8
            total_score = round(max(20.0, min(99.0, base_calc - penalty)), 1)

        # 5. Cognitive Bias Classification and Clinical Feedback
        clinical_feedback = self._generate_feedback(
            student_node_ids=student_node_ids,
            extraneous_nodes=extraneous_nodes,
            fatal_occurred=fatal_occurred,
            fatal_errors=fatal_errors,
            action_records=action_records,
            total_score=total_score,
            radar_scores=radar_scores,
            final_diagnosis=final_diagnosis
        ) if include_feedback else []

        # 6. Action Sequence Summary for visual review
        action_summary = []
        for action in action_records:
            action_summary.append({
                "action_id": action.action_id,
                "step_id": action.step_id,
                "content": action.content,
                "type": action.action_type.value,
                "timestamp": action.timestamp,
                "matched_golden": action.step_id in expert_node_ids,
                "is_fatal": action.is_contraindicated
            })

        # 7. Comparison DAG Structure for Frontend ECharts
        comparison_dag = self._build_comparison_dag_export(student_node_ids, student_graph)

        return OSCEAssessment(
            total_score=total_score,
            ged_distance=round(total_ged, 2),
            topological_similarity=round(topological_similarity, 3),
            radar_scores=radar_scores,
            fatal_errors=fatal_errors,
            clinical_feedback=clinical_feedback,
            action_sequence_summary=action_summary,
            comparison_dag=comparison_dag
        )

    def _generate_feedback(
        self,
        student_node_ids: Set[str],
        extraneous_nodes: Set[str],
        fatal_occurred: bool,
        fatal_errors: List[str],
        action_records: Optional[List[Any]] = None,
        total_score: float = 0.0,
        radar_scores: Optional[Dict[str, float]] = None,
        final_diagnosis: str = ""
    ) -> List[str]:
        """Classify student cognitive bias and produce structured clinical guidance with LLM-enhanced review."""
        # 1. 优先分支: 在线大模型动态专家考官复盘 (Online LLM Clinical Review)
        if config.is_online_llm_active() and action_records:
            llm_feedback = self._generate_llm_clinical_review(
                action_records=action_records,
                student_node_ids=student_node_ids,
                total_score=total_score,
                radar_scores=radar_scores or {},
                fatal_occurred=fatal_occurred,
                fatal_errors=fatal_errors,
                final_diagnosis=final_diagnosis
            )
            if llm_feedback:
                return llm_feedback

        # 2. 备用分支: 高保真循证医学专家规则库 (Offline Fallback Engine)
        feedback = []

        if fatal_occurred:
            feedback.append("【典型认知偏差诊断：隧道视野-心梗锚定型 (AMI Anchoring)】")
            feedback.append("• 根因解析：在面对剧烈胸痛时未能拓宽‘胸痛三联征’鉴别广度，在缺乏双侧血压与心肌酶特异性证据前，先入为主下达抗凝/溶栓/双抗，直接导致假腔破裂心包填塞。")
            feedback.append("• 循证路径矫正：急诊胸痛首要是‘先排危、再靶向’。面对撕裂样疼痛伴双臂不对称，必须绝对封锁一切抗血小板用药！")

        if len(extraneous_nodes) >= 4:
            feedback.append("【典型认知偏差诊断：盲目撒网-无序检查型 (Shotgun Testing)】")
            feedback.append(f"• 根因解析：开具了 {len(extraneous_nodes)} 项非特异性无序检查，导致抢救黄金期被大量冗余化验稀释，未能假说驱动。")
            feedback.append("• 循证路径矫正：建立‘目标导向型快检思维’，优先利用床旁超声与双侧血压完成分流。")

        if "N5" not in student_node_ids and "N6" not in student_node_ids:
            feedback.append("【典型认知偏差诊断：体查漏项-忽视基本功型 (Physical Exam Neglect)】")
            feedback.append("• 根因解析：跳过了‘双侧上肢血压对比测量’与‘心脏主动脉瓣听诊’，严重依赖仪器化验，丢失了耗时最短、成本最低的关键临床线索。")

        if "N1" not in student_node_ids or "N3" not in student_node_ids:
            feedback.append("【典型认知偏差诊断：医患脱节-冰冷技术型 (Empathy Deficit)】")
            feedback.append("• 根因解析：问诊缺乏深度与人文温度，未深挖患者原发高血压及近期擅自停药两周的关键诱因。")

        if not feedback:
            feedback.append("【思维模式评价：逻辑缜密-指南对齐型 (Exemplary Clinical Reasoning)】")
            feedback.append("• 表现优异：规范完成了双臂血压测量与瓣膜听诊，迅速识别主动脉夹层线索，果断控制心率血压达标，安全规避溶栓禁忌，路径与国家级胸痛中心规范高度契合！")

        return feedback

    def _generate_llm_clinical_review(
        self,
        action_records: List[Any],
        student_node_ids: Set[str],
        total_score: float,
        radar_scores: Dict[str, float],
        fatal_occurred: bool,
        fatal_errors: List[str],
        final_diagnosis: str
    ) -> Optional[List[str]]:
        """Call external LLM API to produce a highly personalized, white-box OSCE clinical review."""
        import httpx
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

        # 兼容 URL 格式
        if "deepseek.com" in base_url and not base_url.endswith("/v1") and not base_url.endswith("/chat/completions"):
            base_url = f"{base_url}/v1"
        elif "openai.com" in base_url and not base_url.endswith("/v1") and not base_url.endswith("/chat/completions"):
            base_url = f"{base_url}/v1"
        
        url = base_url if base_url.endswith("/chat/completions") else f"{base_url}/chat/completions"

        # 提取学员具体操作时序
        action_names = []
        for i, a in enumerate(action_records, 1):
            name = getattr(a, "content", "") or getattr(a, "action_id", "")
            action_names.append(f"{i}. {name}")
        actions_str = "\n".join(action_names) if action_names else "无明确记录"

        system_prompt = (
            "你正在担任国家级医学虚拟仿真竞赛与急诊临床思维OSCE评测系统的特聘专家考官（中华医学会急诊医学分会/心血管胸痛中心督导专家）。\n"
            "你需要根据学员在本次【急性胸痛抢救室（52岁男性孙建国，突发撕裂样胸痛，确诊为Stanford A型主动脉夹层）】中的真实临床操作时序，"
            "输出一份专业、深刻、一针见血、白盒化的临床思维综合复盘诊断报告。\n"
            "【严禁套话与固定模板】：必须紧密围绕学员执行的具体操作、动作顺序、遗漏项及致命错误展开分析。\n"
            "【输出结构要求】：请严格按照以下三个标题分段输出（每段2~3句话，紧扣血流动力学、病理生理学与国际国内急救指南AHA/ESC）：\n"
            "1. 【AI特聘专家考官·临床决策思维白盒诊断】：针对学员本次具体操作序列的决策亮点或认知盲区进行客观分析。\n"
            "2. 【血流动力学与时序因果根因剖析】：从主动脉壁剪切力dP/dt、真假腔破裂机制、心包填塞、降压慢心率先后顺序等深度解析因果机制。\n"
            "3. 【国家胸痛中心循证规范进阶提升处方】：针对学员本次表现（如漏查体、顺序倒置或冗余检查），给出精准的下一阶段提升指导。"
        )

        user_content = (
            f"【学员考核档案】\n"
            f"- 最终评定总分: {total_score} 分 (百分制)\n"
            f"- 六维OSCE雷达指标: 急救处置力={radar_scores.get('critical_first_aid', 0)}%, "
            f"诊断精准度={radar_scores.get('diagnostic_accuracy', 0)}%, "
            f"鉴别思维广度={radar_scores.get('differential_thinking', 0)}%, "
            f"安全防范意识={radar_scores.get('safety_awareness', 0)}%, "
            f"医患沟通力={radar_scores.get('physician_patient_comm', 0)}%, "
            f"临床路径效率={radar_scores.get('clinical_efficiency', 0)}%\n"
            f"- 学员下的最终确诊结论: '{final_diagnosis or '未填写明确诊断'}'\n"
            f"- 是否发生致死性医疗差错: {'是！发生急性心包填塞/心脏停搏' if fatal_occurred else '否，未发生致命禁忌'}\n"
            f"- 致命差错详情: {', '.join(fatal_errors) if fatal_errors else '无'}\n"
            f"- 学员全流程真实操作序列清单 (按时序排列):\n{actions_str}\n\n"
            f"请为该学员生成针对性的深度临床复盘与因果点评："
        )

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content}
            ],
            "max_tokens": 500,
            "temperature": 0.6
        }

        try:
            with httpx.Client(timeout=10.0) as client:
                res = client.post(url, headers=headers, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    choices = data.get("choices", [])
                    if choices:
                        raw_review = choices[0].get("message", {}).get("content", "").strip()
                        if raw_review:
                            # 分段整理为列表呈现
                            paragraphs = [p.strip() for p in raw_review.split("\n\n") if p.strip()]
                            # 标注在线大模型生成标记
                            paragraphs.append(f"• [🟢 临床思维专家白盒复盘由在线大模型动态循证生成: {model}]")
                            return paragraphs
                else:
                    print(f"⚠️ [GEDEvaluator LLM Error] HTTP {res.status_code}: {res.text[:120]}")
        except Exception as e:
            print(f"⚠️ [GEDEvaluator LLM Exception] {e}")

        return None

    def _build_comparison_dag_export(self, student_node_ids: Set[str], student_graph: nx.DiGraph) -> Dict[str, Any]:
        """Construct graph nodes and links with temporal 2D coordinates for clear rendering."""
        # 时序阶段固定坐标布局 (横向时序递进，纵向并行展开)
        COORDS = {
            "N1": (60, 50), "N2": (60, 130), "N3": (60, 210),
            "N4": (190, 50), "N5": (190, 130), "N6": (190, 210),
            "N7": (320, 50), "N8": (320, 120), "N9": (320, 190), "N10": (320, 260),
            "N11": (450, 60), "N12": (450, 140), "N13": (450, 210), "N14": (450, 280),
            "N15": (580, 80), "N16": (580, 200),
            "N17": (700, 100), "N18": (700, 210)
        }

        nodes = []
        for nid, data in self.expert_graph.nodes(data=True):
            status = "completed" if nid in student_node_ids else "missed"
            coord = COORDS.get(nid, (100, 100))
            nodes.append({
                "id": nid,
                "name": f"{nid}: {data.get('name', '')}",
                "category": data.get("category", "General"),
                "status": status,
                "critical": data.get("critical", False),
                "score": data.get("score", 5.0),
                "x": coord[0],
                "y": coord[1],
                "value": coord
            })

        links = []
        for u, v, data in self.expert_graph.edges(data=True):
            traversed = (u in student_node_ids) and (v in student_node_ids)
            links.append({
                "source": u,
                "target": v,
                "relation": data.get("relation", "prerequisite"),
                "traversed": traversed
            })

        return {"nodes": nodes, "links": links}
