/**
 * GameCore — 《急诊小诊室》客户端游戏引擎。
 *
 * 职责：病例状态机（问诊/体查/检验/处方/转归五类操作）、五层对话调度、
 * 信任度与焦虑度升降、生命体征演化、红线判定、六维计分、外科医生NPC、
 * 危急时限与恶化分支。通过 GameCore.on/emit 事件总线与 UI 解耦。
 * 全部为虚构教学逻辑。
 */
(function () {
  'use strict';

  /* ============ 每病例游戏配置（case_id → 运行参数） ============ */
  const CONFIG = {
    'case_gam_001_common_cold': {
      trust: .55, anxiety: .35, limit: 0, temp: 37.8,
      targets: { hr: 82, sbp: 118, dbp: 76, temp: 37.1 },
      required: ['体温', '咽部', '肺听诊', '血常规'],
      exams: ['测体温', '咽部视诊', '肺部听诊', '心脏听诊', '血压测量'],
      labs: ['血常规', 'C反应蛋白CRP', '胸片'],
      rx: [
        { n: '健康宣教：休息+多饮水', t: 'ok' },
        { n: '对乙酰氨基酚 0.5g（发热不适时）', t: 'ok' },
        { n: '生理盐水漱口', t: 'ok' },
        { n: '❌ 头孢类抗生素（病毒无效）', t: 'red' },
        { n: '❌ 叠加第二种感冒药（伤肝）', t: 'red' }
      ],
      dispo: '治愈出院', surgeon: false
    },
    'case_gam_002_gastroenteritis': {
      trust: .5, anxiety: .45, limit: 0, temp: 37.5,
      targets: { hr: 84, sbp: 114, dbp: 72, temp: 37.0 },
      required: ['腹部查体', '麦氏点', '血常规', '大便常规'],
      exams: ['测体温', '腹部查体（压痛定位）', '麦氏点+反跳痛检查', '肠鸣音听诊', '血压测量'],
      labs: ['血常规', '大便常规', '尿常规'],
      rx: [
        { n: '口服补液盐Ⅲ（少量多次）', t: 'ok' },
        { n: '蒙脱石散 3g（空腹）', t: 'ok' },
        { n: '益生菌（间隔2小时）', t: 'ok' },
        { n: '❌ 洛哌丁胺强力止泻', t: 'red' },
        { n: '❌ 直接上抗生素（无细菌证据）', t: 'red' }
      ],
      dispo: '治愈出院', surgeon: false
    },
    'case_gam_003_asthma': {
      trust: .4, anxiety: .6, limit: 300, temp: 36.8,
      targets: { hr: 92, sbp: 118, dbp: 76, spo2: 97, rr: 20 },
      required: ['肺部听诊', '血氧', '峰流速', '过敏史'],
      exams: ['肺部听诊', '测体温', '血压测量', '口唇发绀查看'],
      labs: ['峰流速PEF', '血常规', '血气分析（病情加重时）'],
      rx: [
        { n: '协助端坐位+脱离过敏原', t: 'ok' },
        { n: '沙丁胺醇气雾剂 2喷吸入', t: 'ok' },
        { n: '鼻导管吸氧（目标SpO₂≥95%）', t: 'ok' },
        { n: '布地奈德雾化/泼尼松短期', t: 'ok' },
        { n: '❌ 普萘洛尔（β阻滞剂）', t: 'red' },
        { n: '❌ 阿司匹林', t: 'red' }
      ],
      dispo: '治愈出院', surgeon: false
    },
    'case_gam_004_hypoglycemia': {
      trust: .35, anxiety: .55, limit: 240, temp: 36.5,
      targets: { hr: 80, sbp: 134, dbp: 80 },
      required: ['指尖血糖', '神志', '心电图', '用药进餐史'],
      exams: ['神志与神经系统查体', '瞳孔对光反射', '测体温', '血压测量'],
      labs: ['指尖血糖', '12导联心电图', '血常规'],
      rx: [
        { n: '葡萄糖片15g口服（15-15规则）', t: 'ok' },
        { n: '15分钟后复测血糖', t: 'ok' },
        { n: '达标后追加含碳水正餐', t: 'ok' },
        { n: '❌ 意识不清仍经口喂糖', t: 'red' },
        { n: '❌ 未测血糖直接送头颅CT', t: 'red' }
      ],
      dispo: '治愈出院', surgeon: false
    },
    'case_gam_005_appendicitis': {
      trust: .45, anxiety: .5, limit: 420, temp: 38.2,
      targets: {},
      required: ['腹部查体', '麦氏点', '血常规', '尿常规', '腹部超声'],
      exams: ['测体温', '腹部查体（压痛定位）', '麦氏点+反跳痛检查', '闭孔内肌征', '血压测量'],
      labs: ['血常规+CRP', '尿常规', '腹部超声'],
      rx: [
        { n: '禁食禁水', t: 'ok' },
        { n: '建立静脉通路补液', t: 'ok' },
        { n: '围术期预防性抗生素', t: 'ok' },
        { n: '❌ 泻药/灌肠（诱发穿孔）', t: 'red' },
        { n: '❌ 强效镇痛（诊断未明前）', t: 'red' },
        { n: '❌ 右下腹热敷（炎症扩散）', t: 'red' }
      ],
      dispo: '转诊手术', surgeon: true
    },
    'case_chest_pain_001': {
      trust: .4, anxiety: .65, limit: 420, temp: 36.9,
      targets: {},
      required: ['双上肢血压', '心电图', '心肌酶', 'D-二聚体', '主动脉CTA'],
      exams: ['双上肢血压对比', '心脏听诊', '测体温', '血压测量'],
      labs: ['18导联心电图', '心肌损伤标志物', 'D-二聚体', '主动脉CTA'],
      rx: [
        { n: '艾司洛尔静脉泵注控心率', t: 'ok' },
        { n: '硝普钠微泵降压', t: 'ok' },
        { n: '❌ 阿司匹林+替格瑞洛双抗', t: 'red' },
        { n: '❌ 肝素抗凝', t: 'red' },
        { n: '❌ 溶栓治疗', t: 'red' }
      ],
      dispo: '转诊手术', surgeon: true,
      fallbackGe: {
        short_intro: '撕裂样胸背痛+双上肢压差——绝对禁止抗栓的红线病例。',
        persona: { personality: '坚强隐忍的老工人', tone: '痛苦压抑、断续', speech_style: '短句呻吟' },
        backstory: '孙建国，52岁建筑工人，高血压十年、近期擅自停药。搬运重物时突发胸背部撕裂样剧痛……',
        animation_states: [
          { state: 'idle_normal', name: '虚弱站立', trigger: '接诊默认' },
          { state: 'agony_chest', name: '捂胸痛苦', trigger: '问诊症状' },
          { state: 'unconscious', name: '意识丧失', trigger: '恶化' }
        ],
        dialogue_layers: {
          greeting: ['(痛苦压抑) 大夫……胸口……像被撕开了……'],
          inquiry: {
            '症状': ['(呻吟) 后背也疼……两个肩胛骨中间……', '(冷汗) 疼得喘不上气……'],
            '诱因': ['(回忆) 下午搬水泥……一使劲就炸开了……'],
            '既往史': ['(迟疑) 高血压十年……药……最近没吃……'],
            '伴随症状': ['(虚弱) 出冷汗……头晕……']
          },
          misdiagnosis_feedback: {
            '急性心肌梗死': ['(系统·教学) 双上肢压差33mmHg+D-二聚体极高——先排除夹层再谈心梗抗栓！']
          },
          correct_treatment_feedback: ['(药泵起效) 血压……下来点了……好受些了……'],
          cure_farewell: ['(术后苏醒) 谢谢大夫……捡回一条命……']
        },
        status_hints: {
          initial: '【状态提示】HR 108 · BP 195/115 · 撕裂样胸背痛 —— 控心率控血压，绝对禁抗栓',
          cured: '【状态提示】血压心率达标 · 外科手术衔接 —— 转归完成'
        }
      }
    }
  };

  /* ============ 检查结果文案（按病例取 JSON 数据，无则诚实回绝） ============ */
  function examFinding(caseData, btn, cfg) {
    const pe = caseData.physical_exam_findings || {};
    const v = GameCore.state.vitals;
    if (btn.includes('体温')) return { text: `体温 ${GameCore.state.temp.toFixed(1)} ℃`, req: '体温' };
    if (btn.includes('血压') && btn.includes('双上肢')) {
      const f = pe.vitals_bilateral_bp || {};
      return { text: `右上臂 ${f.right_arm || '195/115'}，左上臂 ${f.left_arm || '162/98'}，${f.difference || '压差33mmHg'}`, req: '双上肢血压' };
    }
    if (btn.includes('血压')) return { text: `血压 ${Math.round(v.sbp)}/${Math.round(v.dbp)} mmHg，心率 ${Math.round(v.hr)} 次/分`, req: '生命体征' };
    if (btn.includes('咽部')) return { text: pe.general && pe.general.includes('咽') ? pe.general : '咽部轻度充血，扁桃体无脓苔', req: '咽部' };
    if (btn.includes('肺')) return { text: pe.general && (pe.general.includes('肺') || pe.general.includes('哮鸣')) ? pe.general : '双肺呼吸音清', req: '肺听诊' };
    if (btn.includes('心脏')) return { text: pe.general && pe.general.includes('杂音') ? pe.general : '心律齐，未闻及明显杂音', req: '心脏听诊' };
    if (btn.includes('麦氏点') || btn.includes('反跳痛')) return { text: pe.general && pe.general.includes('麦氏点') ? pe.general : '麦氏点压痛、反跳痛待查', req: '麦氏点' };
    if (btn.includes('腹部')) return { text: pe.general || '腹软，压痛待定位', req: '腹部查体' };
    if (btn.includes('神志') || btn.includes('瞳孔')) return { text: pe.general && (pe.general.includes('神志') || pe.general.includes('瞳孔')) ? pe.general : '神志清楚，瞳孔等大等圆，无局灶神经体征', req: '神志' };
    if (btn.includes('发绀')) return { text: '口唇无发绀', req: '生命体征' };
    if (btn.includes('闭孔')) return { text: pe.general && pe.general.includes('闭孔') ? pe.general : '闭孔内肌征待查', req: '腹部查体' };
    if (btn.includes('肠鸣音')) return { text: pe.general && pe.general.includes('肠鸣音') ? pe.general : '肠鸣音正常', req: '腹部查体' };
    return { text: '本病例未配置该项查体的确定性结果（护栏拒绝编造）。', req: null };
  }
  function labFinding(caseData, btn) {
    const lr = caseData.lab_and_imaging_reports || {};
    const keyMap = [
      ['血常规+CRP', 'blood_routine'], ['血常规', 'blood_routine'], ['CRP', 'blood_routine'],
      ['尿常规', 'urine_routine'], ['大便常规', 'stool_routine'],
      ['指尖血糖', 'fingerstick_glucose'], ['血糖', 'fingerstick_glucose'],
      ['12导联心电图', 'ecg_12lead'], ['心电图', 'ecg_18_lead'], ['18导联心电图', 'ecg_18_lead'],
      ['心肌', 'hs_ctni'], ['D-二聚体', 'd_dimer'], ['二聚体', 'd_dimer'],
      ['峰流速', 'peak_flow'], ['血气', 'blood_gas'],
      ['腹部超声', 'abdominal_ultrasound'], ['超声', 'bedside_echo'],
      ['CTA', 'aortic_cta'], ['胸片', 'chest_xray']
    ];
    for (const [kw, key] of keyMap) {
      if (btn.includes(kw) && lr[key]) {
        const r = lr[key];
        return { text: `${r.result || JSON.stringify(r).slice(0, 120)}\n结论：${r.conclusion || r.interpretation || ''}`, critical: !!r.critical_alert };
      }
    }
    return { text: '本病例未配置该项检查的确定性数据（防幻觉护栏拒绝编造结果）。', critical: false };
  }

  /* ============ 事件总线 ============ */
  const listeners = {};
  const GameCore = {
    CONFIG, state: null,
    on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    emit(name, data) { (listeners[name] || []).forEach(fn => fn(data)); }
  };

  /* ============ 音效（极简 WebAudio，无资产） ============ */
  const Sfx = {
    ctx: null, enabled: true, volume: .4,
    _c() { if (!this.ctx) { const A = window.AudioContext || window.webkitAudioContext; if (A) this.ctx = new A(); } return this.ctx; },
    beep(freq, dur, type) {
      if (!this.enabled) return;
      const c = this._c(); if (!c) return;
      if (c.state === 'suspended') c.resume();
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.value = this.volume * .15;
      o.connect(g); g.connect(c.destination);
      o.start(); g.gain.exponentialRampToValueAtTime(.001, c.currentTime + dur);
      o.stop(c.currentTime + dur);
    },
    ok() { this.beep(880, .12); setTimeout(() => this.beep(1320, .15), 90); },
    warn() { this.beep(220, .3, 'square'); },
    red() { this.beep(180, .45, 'sawtooth'); setTimeout(() => this.beep(160, .45, 'sawtooth'), 350); }
  };
  GameCore.Sfx = Sfx;

  /* ============ 开始/重置 ============ */
  GameCore.start = function (caseData) {
    const id = caseData.case_id;
    const cfg = CONFIG[id] || CONFIG['case_gam_001_common_cold'];
    const ge = caseData.game_extensions || (cfg.fallbackGe || {});
    const iv = caseData.initial_vitals || {};
    this.state = {
      caseId: id, caseData, cfg, ge,
      vitals: { hr: iv.hr || 88, sbp: iv.sbp || 120, dbp: iv.dbp || 76, spo2: iv.spo2 || 98, rr: iv.rr || 18, pain: iv.pain_vas || 2 },
      temp: cfg.temp,
      rhythm: iv.ecg_rhythm || '窦性心律',
      trust: cfg.trust, anxiety: cfg.anxiety,
      timeLeft: cfg.limit, elapsed: 0,
      doneTopics: new Set(), doneExams: new Set(), doneLabs: new Set(), doneRx: new Set(),
      redLines: [], misTried: new Set(), logs: [],
      empathyCount: 0, redundant: 0,
      diagnosis: null, finished: false, worsened: false,
      surgeonCalled: false, interruptionDone: false, deepUnlocked: false
    };
    this._tickTimer = setInterval(() => this._tick(), 1000);
    this.emit('started', { caseData, ge, cfg });
    this.say('nurse', `【接诊】${(caseData.patient_profile || {}).name || '病人'}已接入诊室，生命体征已上监护。`);
    (ge.dialogue_layers && ge.dialogue_layers.greeting || []).forEach(t => this.say('patient', t));
    this.emit('hint', (ge.status_hints && ge.status_hints.initial) || '【状态提示】接诊开始，先观察病人的动作吧。');
    return this.state;
  };

  GameCore.stop = function () { if (this._tickTimer) clearInterval(this._tickTimer); this._tickTimer = null; };

  /* ============ 每秒节拍：时限/体征演化/焦虑打断 ============ */
  GameCore._tick = function () {
    const s = this.state; if (!s || s.finished) return;
    s.elapsed++;
    this.emit('timer', { elapsed: s.elapsed, left: s.timeLeft > 0 ? --s.timeLeft : null });
    // 体征朝目标缓动（治疗后）
    const tg = s.cfg.targets || {};
    ['hr', 'sbp', 'dbp', 'spo2', 'rr'].forEach(k => {
      if (tg[k] != null) s.vitals[k] += (tg[k] - s.vitals[k]) * .04;
    });
    if (tg.temp != null && s.doneRx.size > 0) s.temp += (tg.temp - s.temp) * .05;
    this.emit('vitals', { vitals: s.vitals, temp: s.temp, rhythm: s.rhythm });
    // 家属焦虑打断（一次性）
    if (!s.interruptionDone && s.anxiety >= .9 && s.elapsed > 30) {
      s.interruptionDone = true;
      this.say('family', '(焦急打断) 医生！你们商量得怎么样了？他到底要不要紧啊！');
      this.emit('anim', 'anxious_fidget');
    }
    // 危急时限
    if (s.timeLeft === 90) {
      this.emit('hint', '【状态提示】⚠️ 病情正在加重，剩余处置时间不多——关键治疗刻不容缓！');
      Sfx.warn();
    }
    if (s.timeLeft === 0 && s.cfg.limit > 0 && s.doneRx.size === 0) {
      this._worsen('处置延误，病情恶化。');
    }
  };

  GameCore._worsen = function (reason) {
    const s = this.state;
    if (s.worsened || s.finished) return;
    s.worsened = true;
    s.vitals.spo2 = Math.max(78, s.vitals.spo2 - 12);
    s.vitals.hr += 26;
    this.emit('anim', s.caseId === 'case_gam_004_hypoglycemia' ? 'sway_dizzy' : (s.caseId === 'case_gam_003_asthma' ? 'shoulder_breath' : 'guard_rlq_bend'));
    this.emit('alert', true);
    this.say('nurse', `【危急警报】${reason}病人情况恶化，立即重新评估！`);
    Sfx.red();
  };

  /* ============ 对话 ============ */
  GameCore.say = function (role, text, extra) {
    const names = { doctor: '你（接诊医生）', patient: null, family: null, nurse: '责任护士 · 林美琴', surgeon: '外科 · 卓致远主任', system: '系统' };
    const p = this.state ? this.state.caseData.patient_profile : null;
    if (role === 'patient') names.patient = `患者 · ${p ? p.name : ''}`;
    if (role === 'family') names.family = `家属 · ${(p && p.family_companion || '家属').replace(/[（）()（].*/, '').slice(0, 12)}`;
    this.emit('dialogue', { role, name: names[role], text, extra });
  };

  GameCore.inquiry = function (topic) {
    const s = this.state;
    if (s.finished) return;
    this.say('doctor', `【问诊·${topic}】`);
    s.trust = Math.min(1, s.trust + (s.doneTopics.has(topic) ? 0 : .05));
    s.doneTopics.add(topic);
    this._emitRelation();
    const layers = (s.ge.dialogue_layers || {}).inquiry || {};
    const answers = layers[topic] || ['……(病人一时没有作声，换个话题试试)'];
    const pick = answers[(s.doneTopics.size + topic.length) % answers.length];
    this._patientSay(pick);
    // 深度解锁（高信任）
    if (!s.deepUnlocked && s.trust >= .7 && s.ge.persona) {
      s.deepUnlocked = true;
      setTimeout(() => this.say('system', `💡 信任度突破70%：${s.ge.persona.personality}——病人开始向你敞开心扉，问诊信息更完整了。`), 600);
    }
    this.emit('anim', this._animForTopic(topic));
  };

  GameCore.freeInput = function (text) {
    const s = this.state; if (s.finished) return;
    const t = text.trim(); if (!t) return;
    this.say('doctor', t);
    const EMPATHY = ['别担心', '别紧张', '别害怕', '放心', '全力', '慢慢来', '不着急', '一定', '安心', '别慌'];
    if (EMPATHY.some(k => t.includes(k))) {
      s.empathyCount++;
      s.trust = Math.min(1, s.trust + .12);
      s.anxiety = Math.max(0, s.anxiety - .1);
      this._emitRelation();
      const dh = (s.caseData.dialogue_scripts || {}).trust_high || '谢谢你，医生……我心里踏实多了。';
      this._patientSay(`(放松了些) ${dh}`);
      Sfx.ok();
      return;
    }
    const TOPIC_KEYS = [
      ['症状', ['怎么疼', '疼', '烧', '咳', '喘', '吐', '泻', '晕', '汗', '心慌', '不舒服', '感觉']],
      ['诱因', ['为什么', '怎么引起', '之前', '吃了', '干了', '诱因', '什么时候开始']],
      ['既往史', ['以前', '病史', '过敏', '药', '慢性', '手术史']],
      ['伴随症状', ['还有', '其他', '别的', '伴随']]
    ];
    for (const [topic, kws] of TOPIC_KEYS) {
      if (kws.some(k => t.includes(k))) { this.inquiry(topic); return; }
    }
    // 人设兜底
    const fb = (s.ge.persona && s.ge.persona.tone) ? `（${s.ge.persona.tone}）……${['嗯……你说的这个……', '唉……', '医生你听我说……'][t.length % 3]}` : '……';
    this._patientSay(fb);
    s.anxiety = Math.min(1, s.anxiety + .02);
    this._emitRelation();
  };

  GameCore.comfort = function () {
    const s = this.state; if (s.finished) return;
    this.say('doctor', '别紧张，我们全力以赴。先深呼吸，慢慢说，我们一起把问题找出来。');
    s.empathyCount++;
    s.trust = Math.min(1, s.trust + .1);
    s.anxiety = Math.max(0, s.anxiety - .12);
    this._emitRelation();
    this._patientSay('(情绪缓和) 好……好，我听你的。');
    this.emit('anim', 'chat_gesture');
    Sfx.ok();
  };

  GameCore._patientSay = function (text) {
    this.say('patient', text);
  };
  GameCore._animForTopic = function (topic) {
    const map = {
      '症状': { 'case_gam_001_common_cold': 'sneeze', 'case_gam_002_gastroenteritis': 'hold_belly_bend', 'case_gam_003_asthma': 'shoulder_breath', 'case_gam_004_hypoglycemia': 'hand_tremor', 'case_gam_005_appendicitis': 'guard_rlq_bend', 'case_chest_pain_001': 'agony_chest' },
      '诱因': 'idle_normal', '既往史': 'anxious_fidget', '伴随症状': 'idle_normal'
    };
    const m = map[topic];
    if (typeof m === 'object' && m) return m[this.state.caseId] || 'idle_normal';
    return m || 'idle_normal';
  };

  /* ============ 体查 / 检验 ============ */
  GameCore.exam = function (btn) {
    const s = this.state; if (s.finished) return;
    this.say('doctor', `【体查】${btn}`);
    const f = examFinding(s.caseData, btn, s.cfg);
    s.doneExams.add(btn);
    const reqKey = this._matchRequired(f.req || btn);
    if (reqKey) {
      this.say('nurse', `📄 体查回报：${f.text}`);
      if (btn.includes('反跳痛')) { this.emit('anim', 'rebound_flinch'); Sfx.warn(); }
      this.emit('progress', { type: 'exam', btn, required: true });
      Sfx.ok();
    } else {
      s.redundant++;
      this.say('nurse', `体查回报：${f.text}`);
      this.emit('progress', { type: 'exam', btn, required: false });
    }
    this.log('🔍 体查', btn, !reqKey ? '冗余' : '必查项✓');
  };

  GameCore.lab = function (btn) {
    const s = this.state; if (s.finished) return;
    this.say('doctor', `【开单】${btn}`);
    const f = labFinding(s.caseData, btn);
    s.doneLabs.add(btn);
    const reqKey = this._matchRequired(btn);
    this.say('nurse', `🧪 检验回报：${f.text}${f.critical ? '\n⚠️ 危急值！已按危急值流程通报！' : ''}`);
    if (f.critical) { this.emit('alert', true); Sfx.warn(); }
    else Sfx.ok();
    if (reqKey) this.emit('progress', { type: 'lab', btn, required: true });
    else { s.redundant++; this.emit('progress', { type: 'lab', btn, required: false }); }
    this.log('🧪 检验', btn, reqKey ? '必查项✓' : (f.text.includes('未配置') ? '未配置(护栏)' : '冗余'));
  };

  GameCore._matchRequired = function (label) {
    const req = this.state.cfg.required || [];
    const L = label || '';
    return req.find(r => L.includes(r) || r.includes(L)) || null;
  };

  /* ============ 处方 ============ */
  GameCore.prescribe = function (idx) {
    const s = this.state; if (s.finished) return;
    const item = s.cfg.rx[idx];
    if (s.doneRx.has(idx)) return;
    this.say('doctor', `【处方】${item.n.replace('❌ ', '')}`);
    s.doneRx.add(idx);
    if (item.t === 'red') {
      s.redLines.push(item.n);
      s.trust = Math.max(0, s.trust - .2);
      s.anxiety = Math.min(1, s.anxiety + .25);
      this._emitRelation();
      this.say('nurse', `🚨 红线警告！${item.n} 属于本病例禁忌操作——操作被拦截。请复习禁忌事项。`);
      this.emit('alert', true);
      this.emit('anim', this.state.caseId === 'case_gam_003_asthma' ? 'shoulder_breath' : 'hold_belly_bend');
      Sfx.red();
      this.log('💉 处方', item.n, '红线拦截', true);
      return;
    }
    // 正确治疗反馈
    s.trust = Math.min(1, s.trust + .06);
    s.anxiety = Math.max(0, s.anxiety - .05);
    this._emitRelation();
    const fb = ((s.ge.dialogue_layers || {}).correct_treatment_feedback || []);
    this._patientSay(fb[s.doneRx.size % Math.max(1, fb.length)] || '(治疗起效中)');
    // 治疗动画映射
    const animMap = {
      '葡萄糖片': 'eat_candy', '吸入': 'use_inhaler', '补液盐': 'sip_orz_water', '禁食': 'idle_normal',
      '静脉通路': 'walking_hunched', '端坐': 'tripod_sit', '吸氧': 'shoulder_breath'
    };
    for (const k in animMap) if (item.n.includes(k)) { this.emit('anim', animMap[k]); break; }
    // 关键治疗解除危急
    if (this.state.timeLeft > 0 && this.state.doneRx.size >= 1) this.state.timeLeft = Math.max(this.state.timeLeft, 120);
    this.emit('alert', false);
    Sfx.ok();
    this.log('💉 处方', item.n, '正确步骤✓');
    this.emit('progress', { type: 'rx', idx });
  };

  /* ============ 诊断（转归前置） ============ */
  GameCore.diagnose = function (name) {
    const s = this.state; if (s.finished) return;
    this.say('doctor', `【诊断】${name}`);
    const truth = s.ge.confirmed_diagnosis || (s.caseData.index_entry && s.caseData.index_entry.disease) || '';
    const isRight = name === truth || truth.includes(name) || name.includes(truth.slice(0, 4));
    if (isRight) {
      s.diagnosis = truth;
      this.say('system', `✅ 诊断正确：${truth}。进入治疗与转归阶段。`);
      Sfx.ok();
      this.log('📋 诊断', name, '正确✓');
    } else {
      s.misTried.add(name);
      s.trust = Math.max(0, s.trust - .1);
      s.anxiety = Math.min(1, s.anxiety + .15);
      this._emitRelation();
      const decoy = (s.ge.decoy_diagnoses || []).find(d => d.name === name);
      const fb = (s.ge.dialogue_layers || {}).misdiagnosis_feedback || {};
      const pair = fb[name] || ['(系统·教学) 诊断依据不足——回到问诊与检查，重新梳理鉴别要点。'];
      this.say('system', `❌ 误诊反馈：${decoy ? decoy.differentiation : pair[0]}`);
      if (pair[1]) this._patientSay(pair[1]);
      Sfx.warn();
      this.log('📋 诊断', name, '误诊(教学反馈)', true);
    }
    return isRight;
  };

  /* ============ 外科医生 ============ */
  GameCore.callSurgeon = function () {
    const s = this.state; if (s.finished || s.surgeonCalled) return;
    s.surgeonCalled = true;
    this.say('doctor', '【会诊】呼叫外科急会诊！');
    const lines = {
      'case_gam_005_appendicitis': '(快步进场，看完报告) 化脓性阑尾炎，未穿孔——腹腔镜阑尾切除，我马上安排手术。术前禁食禁水执行了吗？好，准备接台！',
      'case_chest_pain_001': '(看完CTA) Stanford A型夹层，没有犹豫余地——急诊开胸，体外循环组备台！降压控心率维持住，马上送手术室！',
      'default': '(看过病历) 目前没有明确手术指征，先按内科方案处理，有情况随时叫我。'
    };
    this.say('surgeon', lines[s.caseId] || lines['default']);
    this.emit('anim', s.caseId === 'case_gam_005_appendicitis' ? 'rebound_flinch' : 'agony_chest');
    if (s.cfg.surgeon) {
      s.trust = Math.min(1, s.trust + .1);
      this._emitRelation();
      this.log('👨‍⚕️ 会诊', '外科·卓致远主任', '已到场');
      Sfx.ok();
    } else {
      this.log('👨‍⚕️ 会诊', '外科·卓致远主任', '无手术指征');
    }
  };

  /* ============ 转归 ============ */
  GameCore.dispose = function (choice) {
    const s = this.state;
    if (s.finished) return;
    this.say('doctor', `【转归】${choice}`);
    const right = s.cfg.dispo;
    const needSurgeon = s.cfg.surgeon && !s.surgeonCalled;
    if (choice !== right || needSurgeon || !s.diagnosis) {
      const why = !s.diagnosis ? '尚未确诊' : needSurgeon ? '外科病例须先完成外科会诊' : '转归方式与本病例不符';
      this.say('system', `⛔ 转归被退回：${why}。`);
      Sfx.warn();
      this.log('📋 转归', choice, `退回（${why}）`, true);
      return;
    }
    s.finished = true;
    this.stop();
    // 治愈演出
    const cureAnim = { 'case_gam_001_common_cold': 'cured_cheer', 'case_gam_002_gastroenteritis': 'cured_thumbsup', 'case_gam_003_asthma': 'cured_relief', 'case_gam_004_hypoglycemia': 'cured_pat_chest', 'case_gam_005_appendicitis': 'cured_relax', 'case_chest_pain_001': 'cured_relief' }[s.caseId] || 'cured_cheer';
    this.emit('anim', cureAnim);
    this.emit('alert', false);
    (s.ge.dialogue_layers || {}).cure_farewell && s.ge.dialogue_layers.cure_farewell.forEach(t => this.say('patient', t));
    this.emit('hint', (s.ge.status_hints || {}).cured || '【状态提示】救治完成。');
    const report = this._score();
    this.emit('ended', report);
    this.log('🏁 结案', choice, `得分 ${report.total}`);
  };

  GameCore.giveUp = function (reason) {
    const s = this.state;
    if (s.finished) return;
    s.finished = true; this.stop();
    const report = this._score(true, reason);
    this.emit('ended', report);
  };

  /* ============ 六维计分 ============ */
  GameCore._score = function (failed, reason) {
    const s = this.state;
    const req = s.cfg.required || [];
    const reqHit = req.filter(r => [...s.doneExams, ...s.doneLabs].some(d => d.includes(r) || r.includes(d))).length;
    const ratio = req.length ? reqHit / req.length : 1;
    const okRx = [...s.doneRx].filter(i => s.cfg.rx[i] && s.cfg.rx[i].t === 'ok').length;
    const totalRx = s.cfg.rx.filter(r => r.t === 'ok').length;
    const dims = {
      '确诊决策度': !failed && s.diagnosis ? 100 : (s.misTried.size ? 45 : 20),
      '鉴别思维': Math.round(Math.min(100, 40 + ratio * 40 + (s.misTried.size ? 20 : 0))),
      '安全意识': Math.max(0, 100 - s.redLines.length * 25 - (s.worsened ? 15 : 0)),
      '临床效率': Math.max(0, Math.round(100 - s.redundant * 8)),
      '医患沟通': Math.round(Math.min(100, 45 + s.trust * 55)),
      '急救处置力': failed ? 20 : Math.round(okRx / Math.max(1, totalRx) * 100)
    };
    const total = Math.round(Object.values(dims).reduce((a, b) => a + b, 0) / 6);
    const stars = total >= 85 ? 3 : total >= 70 ? 2 : total >= 50 ? 1 : 0;
    return {
      failed: !!failed, reason: reason || '', dims, total, stars,
      redLines: s.redLines, missed: req.filter(r => ![...s.doneExams, ...s.doneLabs].some(d => d.includes(r) || r.includes(d))),
      diagnosis: s.diagnosis, time: s.elapsed, caseId: s.caseId,
      patient: (s.caseData.patient_profile || {}).name || '', disease: (s.ge.confirmed_diagnosis || (s.caseData.index_entry || {}).disease || '')
    };
  };

  /* ============ 杂项 ============ */
  GameCore._emitRelation = function () {
    this.emit('relation', { trust: this.state.trust, anxiety: this.state.anxiety });
  };
  GameCore.log = function (icon, what, note, bad) {
    const s = this.state;
    const rec = { t: new Date(), icon, what, note, bad };
    s.logs.push(rec);
    this.emit('log', rec);
  };

  window.GameCore = GameCore;
})();
