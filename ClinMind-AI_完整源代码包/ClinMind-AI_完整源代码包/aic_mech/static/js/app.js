/**
 * ClinMind-AI Main Application Controller.
 * Manages WebSocket feeds, clinical decision dispatching, multimodal chat stream,
 * monitor status indicators, and OSCE assessment modal displays.
 */

/**
 * Escape untrusted text (LLM dialogue, user input, backend-reflected strings)
 * before it is placed into any HTML template. All innerHTML rendering of
 * dynamic content MUST go through this helper.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class ClinMindApp {
  constructor() {
    this.sessionId = 'default';
    this.caseId = 'case_chest_pain_001';
    this.studentName = '参赛精英医师';
    this.ws = null;
    this.wsRetryCount = 0;
    this.ecgRenderer = null;
    this.currentTab = 'inquiry';
    this.actionCount = 0;
    this.elapsedSeconds = 0;
    this.timerInterval = null;
    this._lastCriticalAlarmAt = 0;

    this.init();
  }

  async init() {
    this.setupEventListeners();
    this.setupQuickButtons();

    // Initialize Canvas ECG (main trace + respiration trace)
    if (window.ECGCanvasRenderer) {
      this.ecgRenderer = new window.ECGCanvasRenderer('ecgCanvas', 'respiratoryCanvas');
    }

    // Initialize mini radar (绑定正确容器 miniRadarContainer)
    if (window.dagViewManager) {
      window.dagViewManager.initMiniRadar('miniRadarContainer');
    }

    // 浏览器音频自动播放策略要求用户手势：首次任意点击/按键时解锁 AudioContext
    const unlockAudio = () => {
      if (window.monitorAudio) window.monitorAudio.unlock();
      document.removeEventListener('pointerdown', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
    };
    document.addEventListener('pointerdown', unlockAudio);
    document.addEventListener('keydown', unlockAudio);

    // 默认装载并渲染首个 Tab (问诊) 的高频临床快捷指令
    this.renderQuickActions('inquiry');

    // Start clinical case session
    await this.startSession();
    this.fetchLlmConfig();
  }

  setupEventListeners() {
    // Action tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        this.switchTab(tab);
      });
    });

    // Send action button
    const sendBtn = document.getElementById('btnSendAction');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => this.handleCustomActionSubmit());
    }

    // Enter key in input
    const inputAction = document.getElementById('inputActionText');
    if (inputAction) {
      inputAction.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.handleCustomActionSubmit();
        }
      });
    }

    // Audio Mute toggle
    const muteBtn = document.getElementById('btnToggleMute');
    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        const isMuted = window.monitorAudio.toggleMute();
        muteBtn.innerHTML = isMuted ? '🔇 静音' : '🔊 警报音';
        muteBtn.className = isMuted ? 'text-xs px-2 py-1 bg-slate-800 text-slate-400 rounded' : 'text-xs px-2 py-1 bg-emerald-950 text-emerald-400 border border-emerald-600 rounded';
      });
    }

    // Evaluation modal trigger
    const evalBtn = document.getElementById('btnOpenEvalModal');
    if (evalBtn) {
      evalBtn.addEventListener('click', () => this.openEvaluationModal());
    }

    // Config modal trigger
    const cfgBtn = document.getElementById('btnOpenConfigModal');
    if (cfgBtn) {
      cfgBtn.addEventListener('click', () => this.openConfigModal());
    }

    // Submit evaluation button in modal
    const submitEvalBtn = document.getElementById('btnConfirmSubmitEval');
    if (submitEvalBtn) {
      submitEvalBtn.addEventListener('click', () => this.submitFinalEvaluation());
    }

    // Close evaluation modal
    const closeEvalBtn = document.getElementById('btnCloseEvalModal');
    if (closeEvalBtn) {
      closeEvalBtn.addEventListener('click', () => {
        document.getElementById('modalEvaluation').classList.add('hidden');
      });
    }

    // Config modal close & actions
    const closeCfg = document.getElementById('btnCloseConfigModal');
    if (closeCfg) closeCfg.addEventListener('click', () => this.closeConfigModal());
    const cancelCfg = document.getElementById('btnCancelConfig');
    if (cancelCfg) cancelCfg.addEventListener('click', () => this.closeConfigModal());
    const saveCfg = document.getElementById('btnSaveConfig');
    if (saveCfg) saveCfg.addEventListener('click', () => this.saveLlmConfig());

    // Config Presets
    const pDs = document.getElementById('presetDeepseek');
    if (pDs) pDs.addEventListener('click', () => this.applyConfigPreset('deepseek'));
    const pOa = document.getElementById('presetOpenai');
    if (pOa) pOa.addEventListener('click', () => this.applyConfigPreset('openai'));
    const pCu = document.getElementById('presetCustom');
    if (pCu) pCu.addEventListener('click', () => this.applyConfigPreset('custom'));
    const pOff = document.getElementById('presetOffline');
    if (pOff) pOff.addEventListener('click', () => this.applyConfigPreset('offline'));

    const toggleVisBtn = document.getElementById('btnToggleKeyVis');
    if (toggleVisBtn) {
      toggleVisBtn.addEventListener('click', () => {
        const inp = document.getElementById('cfgApiKey');
        if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
      });
    }
  }

  setupQuickButtons() {
    document.querySelectorAll('.quick-act-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = e.currentTarget.getAttribute('data-type');
        const content = e.currentTarget.getAttribute('data-content');
        this.executeAction(type, content);
      });
    });
  }

  switchTab(tab) {
    if (!tab) tab = 'inquiry';
    const aliasMap = {
      lab: 'order',
      rx: 'treat',
      disposition: 'dispo',
      ask: 'inquiry'
    };
    const normTab = aliasMap[tab] || tab;
    this.currentTab = normTab;

    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('active');
    });

    const activeBtn = document.querySelector(`.tab-btn[data-tab="${normTab}"]`) || document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (activeBtn) {
      activeBtn.classList.add('active');
    }

    // 动态渲染该分类下的临床预设指令
    this.renderQuickActions(normTab);

    // Update input placeholder
    const input = document.getElementById('inputActionText');
    const placeholders = {
      inquiry: '向患者/家属进行问诊（可点击上方预设指令，或输入自主提问）...',
      exam: '下达专科体格检查（可点击上方预设指令，或输入例如：测双臂血压）...',
      order: '开具辅助检查项目（可点击上方预设指令，或输入例如：查心电图、主动脉CTA）...',
      treat: '下达急救药物与微泵（可点击上方预设指令，或输入例如：艾司洛尔、硝普钠）...',
      dispo: '下达急救处置与转归（可点击上方预设指令，或输入例如：呼叫心胸外科会诊）...'
    };
    if (input) input.placeholder = placeholders[normTab] || '输入临床指令...';
  }

  renderQuickActions(tab) {
    const container = document.getElementById('quickActionContainer');
    if (!container) return;

    const PRESETS = {
      inquiry: [
        {
          title: '问诊：疼痛性质与放射范围',
          sub: 'PAIN CHARACTERS // 撕裂样？串至后背肩胛？',
          cmd: '您现在胸口具体是怎么个疼法？后背和肚子有没有牵扯着疼？',
          badge: '核心要点'
        },
        {
          title: '问诊：起病诱因与持续时长',
          sub: 'ONSET DURATION // 发病前活动诱因、持续时间有无缓解',
          cmd: '胸痛发作前在做什么？持续疼了几个小时了？中间有没有减轻一点？',
          badge: '病程初查'
        },
        {
          title: '问诊：高血压病史与规范服药',
          sub: 'HYPERTENSION HISTORY // 平时血压多高？今日是否服药？',
          cmd: '您平时血压高不高？今天吃降压药了吗？最近有没有擅自停药？',
          badge: '重要病因'
        },
        {
          title: '问诊：伴随症状与脑灌注状态',
          sub: 'CONCOMITANT // 有无视物模糊、大汗冷汗、下肢发麻？',
          cmd: '现在有没有觉得头晕眼花、呼吸费劲、或者下肢发麻无力？',
          badge: '危急鉴别'
        }
      ],
      exam: [
        {
          title: '体查：双上肢血压同步测量',
          sub: 'BILATERAL BP // 鉴别头臂干受累；压差>20mmHg具确诊提示意义',
          cmd: '测量患者双侧上肢血压并对比双臂压差',
          badge: '首要必查'
        },
        {
          title: '体查：快速心脏听诊',
          sub: 'CARDIAC AUSCULTATION // 听诊主动脉瓣听诊区杂音与心包摩擦音',
          cmd: '心脏听诊：听取主动脉瓣区杂音及心音强弱',
          badge: '瓣膜受累'
        },
        {
          title: '体查：双肺呼吸音听诊',
          sub: 'LUNG AUSCULTATION // 排查心衰肺水肿湿啰音或胸腔积液',
          cmd: '双肺呼吸音听诊：排查有无湿性啰音及哮鸣音',
          badge: '心衰肺水肿'
        },
        {
          title: '体查：四肢外周大动脉搏动触诊',
          sub: 'PULSE DEFICIT // 触诊双侧桡动脉、股动脉及足背动脉搏动',
          cmd: '触诊双侧股动脉、足背动脉搏动情况及皮温',
          badge: '周围缺血'
        }
      ],
      order: [
        {
          title: '检查：急诊床旁18导联心电图',
          sub: 'STAT 18-LEAD ECG // 黄金10分钟鉴别STEMI与主动脉夹层',
          cmd: '急查急诊床旁18导联心电图',
          badge: '首战鉴别'
        },
        {
          title: '检查：心肌损伤标志物 + D-二聚体',
          sub: 'TROPONIN & D-DIMER // 鉴别急性心梗，夹层D-二聚体特异性极高',
          cmd: '急查肌钙蛋白cTnI、CK-MB及D-二聚体定量',
          badge: '三联快检'
        },
        {
          title: '检查：急诊床旁超声心动图 PoCUS',
          sub: 'BEDSIDE ECHO // 评估升主动脉内径、主动脉瓣反流、有无心包积液',
          cmd: '行急诊床旁心脏超声评估心包积液与主动脉根部',
          badge: '床旁超声'
        },
        {
          title: '检查：全胸腹主动脉CTA增强扫描',
          sub: 'AORTIC CTA (GOLD STANDARD) // 确诊主动脉夹层分型的终极金标准',
          cmd: '急查全主动脉增强CTA确诊夹层累及范围与内膜破口',
          badge: '确诊金标准'
        }
      ],
      treat: [
        {
          title: '处置：吸氧、监护并开放双静脉通路',
          sub: 'ACCESS & O2 // 鼻导管高流量吸氧，快速建立左右双路大静脉通道',
          cmd: '立即鼻导管吸氧、多参数监护，快速建立双侧粗大静脉通道',
          badge: '生命通路'
        },
        {
          title: '处方：盐酸艾司洛尔微泵静脉注射',
          sub: 'ESMOLOL (β-BLOCKER) // 必须先降心率再降压，靶目标心率60-70次/分',
          cmd: '艾司洛尔静脉泵注控心率至60-70次/分',
          badge: '先慢心率'
        },
        {
          title: '处方：硝普钠微量泵静脉维持控压',
          sub: 'SODIUM NITROPRUSSIDE // 严密监测SBP控制于100-120mmHg靶目标',
          cmd: '硝普钠微量泵静脉滴注协同降压维持SBP 100-120mmHg',
          badge: '强效降压'
        },
        {
          title: '处方：酒石酸吗啡注射液静脉镇痛',
          sub: 'MORPHINE // 缓解剧烈交感神经兴奋张力，剧痛是血压顽固的源头',
          cmd: '吗啡注射液3mg缓慢静脉推注镇痛镇静',
          badge: '止痛镇静'
        },
        {
          title: '警示练习：抗血小板三联（阿司匹林+替格瑞洛）',
          sub: 'CONTRAINDICATION WARNING // 致命反向操作练习，体验破裂大出血警报',
          cmd: '口服阿司匹林肠溶片300mg加替格瑞洛180mg抗血小板',
          badge: '致命禁忌'
        }
      ],
      dispo: [
        {
          title: '会诊：急呼心胸外科与大血管外科会诊',
          sub: 'SURGICAL STAT CONSULT // A型夹层急诊手术指征明确，即刻启动抢救',
          cmd: '紧急呼叫心胸外科主任床旁急会诊准备急诊手术',
          badge: '急诊手术'
        },
        {
          title: '抢救：启动急诊抢救绿色通道与输血科备血',
          sub: 'GREEN CHANNEL & BLOOD // 备红细胞悬液8U、新鲜冰冻血浆及体外循环',
          cmd: '开辟急诊绿色通道紧急备红细胞悬液8U及血浆',
          badge: '急救备血'
        },
        {
          title: '沟通：家属病情危重交代并签署知情同意',
          sub: 'INFORMED CONSENT // 详细告知夹层破裂心包压塞极高猝死风险',
          cmd: '与患者家属李秀梅签署急诊开胸手术知情同意书及病危通知',
          badge: '知情同意'
        }
      ]
    };

    PRESETS.lab = PRESETS.order;
    PRESETS.rx = PRESETS.treat;
    PRESETS.disposition = PRESETS.dispo;
    PRESETS.ask = PRESETS.inquiry;

    const list = PRESETS[tab] || PRESETS.inquiry || [];
    container.innerHTML = '';

    list.forEach(item => {
      const card = document.createElement('div');
      card.className = 'group p-2.5 bg-white border border-slate-200 hover:border-slate-900 transition-all cursor-pointer shadow-xs flex flex-col justify-between';
      
      const isLethal = item.badge === '致命禁忌';
      const badgeStyle = isLethal ? 'bg-rose-100 text-rose-700 border-rose-300' : 'bg-slate-100 text-slate-700 border-slate-300';

      card.innerHTML = `
        <div class="flex items-center justify-between mb-1">
          <span class="font-bold text-xs text-slate-900 group-hover:text-blue-700 transition-colors">${item.title}</span>
          <span class="text-[9px] font-mono-swiss px-1 py-0.5 border ${badgeStyle} font-bold">${item.badge}</span>
        </div>
        <div class="text-[10px] text-slate-500 font-mono-swiss leading-tight mb-2">${item.sub}</div>
        <div class="flex items-center justify-between pt-1 border-t border-slate-100">
          <span class="text-[10px] text-slate-400 group-hover:text-slate-600 transition-colors">点击填入输入框</span>
          <button type="button" class="btn-direct-run px-2 py-0.5 text-[10px] bg-slate-900 hover:bg-emerald-600 text-white font-mono-swiss font-bold transition-colors">
            立即下达 EXEC
          </button>
        </div>
      `;

      // 点击卡片主体填入输入框
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-direct-run')) return;
        const input = document.getElementById('inputActionText');
        if (input) {
          input.value = item.cmd;
          input.focus();
        }
      });

      // 点击右侧按钮直接一键下达
      const runBtn = card.querySelector('.btn-direct-run');
      if (runBtn) {
        runBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const typeMapping = {
            inquiry: 'inquiry',
            exam: 'physical_exam',
            order: 'lab_order',
            treat: 'medication',
            dispo: 'rescue_disposition'
          };
          this.executeAction(typeMapping[tab] || tab, item.cmd);
        });
      }

      container.appendChild(card);
    });
  }

  async startSession() {
    try {
      const res = await fetch('/api/case/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_id: this.caseId,
          student_name: this.studentName
        })
      });
      if (!res.ok) {
        this.addSystemMessage(`无法开始实训（HTTP ${res.status}），请确认 main.py 是否启动。`);
        return;
      }
      const data = await res.json();
      this.sessionId = data.session_id;

      this.addSystemMessage(`抢救室实训已启动！患者孙建国（52岁）因“剧烈撕裂样胸痛3小时”急诊入院，已接入多参数心电监护仪。`);

      // Start Simulation Timer
      this.startTimer();

      // Connect WebSocket
      this.connectWebSocket();
    } catch (err) {
      console.error('Failed to start session', err);
      this.addSystemMessage('无法连接后端服务，请确认 main.py 是否启动。');
    }
  }

  startTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.elapsedSeconds = 0;
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds += 1;
      const min = String(Math.floor(this.elapsedSeconds / 60)).padStart(2, '0');
      const sec = String(this.elapsedSeconds % 60).padStart(2, '0');
      const dom = document.getElementById('sessionTimer');
      if (dom) dom.innerText = `${min}:${sec}`;
    }, 1000);
  }

  connectWebSocket() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/vitals/${this.sessionId}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('Telemetry WebSocket connected.');
      this.wsRetryCount = 0;
      const badge = document.getElementById('wsStatusBadge');
      if (badge) {
        badge.innerText = '1Hz 在线推演中';
        badge.className = 'px-2 py-0.5 rounded text-xs bg-emerald-950 text-emerald-400 border border-emerald-600';
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'vitals_update') {
          this.handleTelemetryUpdate(payload);
        }
      } catch (e) {
        console.error('WS parse error', e);
      }
    };

    this.ws.onclose = (event) => {
      // 1008/4404: the backend no longer knows this session (server restart or
      // TTL eviction). Reconnecting would loop forever — ask for a fresh start.
      if (event.code === 1008 || event.code === 4404) {
        const badge = document.getElementById('wsStatusBadge');
        if (badge) {
          badge.innerText = '会话已失效';
          badge.className = 'px-2 py-0.5 rounded text-xs bg-rose-950 text-rose-400 border border-rose-600';
        }
        this.addSystemMessage('当前实训会话已失效（后端可能已重启），请刷新页面重新开始实训。');
        return;
      }

      // Exponential backoff with a retry cap instead of a tight 2s loop.
      const badge = document.getElementById('wsStatusBadge');
      if (badge) {
        badge.innerText = '离线 / 重连中';
        badge.className = 'px-2 py-0.5 rounded text-xs bg-rose-950 text-rose-400 border border-rose-600';
      }
      if (this.wsRetryCount >= 5) {
        this.addSystemMessage('遥测连接已断开且多次重连失败，请刷新页面或重启 main.py。');
        return;
      }
      const delay = Math.min(2000 * Math.pow(2, this.wsRetryCount), 15000);
      this.wsRetryCount += 1;
      setTimeout(() => this.connectWebSocket(), delay);
    };
  }

  handleTelemetryUpdate(payload) {
    const v = payload.vitals;
    if (!v) return;

    // 1. Update numerical displays
    const hrVal = Math.round(v.hr);
    const sbpVal = Math.round(v.sbp);
    const dbpVal = Math.round(v.dbp);
    const spo2Val = Math.round(v.spo2);
    const rrVal = Math.round(v.rr);
    const painVal = v.pain_vas || 0;

    const elHr = document.getElementById('dispHR');
    const elBP = document.getElementById('dispBP');
    const elSpO2 = document.getElementById('dispSpO2');
    const elRR = document.getElementById('dispRR');
    const elPain = document.getElementById('dispPain');

    if (elHr) elHr.innerText = hrVal;
    if (elBP) elBP.innerText = `${sbpVal}/${dbpVal}`;
    if (elSpO2) elSpO2.innerText = spo2Val;
    if (elRR) elRR.innerText = rrVal;
    if (elPain) elPain.innerText = painVal;

    // 2. Update ECG Canvas Waveform
    const isArrest = (payload.patient_state === 'S5_AORTIC_RUPTURE' || payload.patient_state === 'S6_CARDIAC_ARREST');
    if (this.ecgRenderer) {
      this.ecgRenderer.updateVitals(hrVal, spo2Val, isArrest, rrVal);
    }

    // 3. Update Patient State Badge
    const stateBadge = document.getElementById('patientStateBadge');
    if (stateBadge) {
      const stateNames = {
        'S0_STABLE': 'S0: 初始高危稳定',
        'S1_HYPERTENSION_CRISIS': 'S1: 高血压急症危象',
        'S2_PHARMACO_CONTROLLED': 'S2: 药物靶向达标',
        'S3_PERICARDIAL_EFFUSION': 'S3: 早期破口渗血',
        'S4_CARDIAC_TAMPONADE': 'S4: 急性心包压塞 (Beck三联征)',
        'S5_AORTIC_RUPTURE': 'S5: 致命性大血管破裂',
        'S6_CARDIAC_ARREST': 'S6: 心搏骤停 (PEA/停搏)'
      };
      stateBadge.innerText = stateNames[payload.patient_state] || payload.patient_state;

      if (payload.patient_state === 'S2_PHARMACO_CONTROLLED') {
        stateBadge.className = 'text-[9px] font-mono-swiss px-2 py-0.5 bg-[#00e575]/15 text-[#00e575] border border-[#00e575]/40 font-bold uppercase tracking-wider';
      } else if (['S4_CARDIAC_TAMPONADE', 'S5_AORTIC_RUPTURE', 'S6_CARDIAC_ARREST'].includes(payload.patient_state)) {
        stateBadge.className = 'text-[9px] font-mono-swiss px-2 py-0.5 bg-[#ff1b2d] text-white font-bold uppercase tracking-wider swiss-alarm-active';
      } else {
        stateBadge.className = 'text-[9px] font-mono-swiss px-2 py-0.5 bg-white/10 text-zinc-200 border border-white/20 font-bold uppercase tracking-wider';
      }
    }

    // 4. Update Trust & Anxiety
    const trustPercent = Math.round((payload.trust_level || 0.4) * 100);
    const anxietyPercent = Math.round((payload.family_anxiety || 0.65) * 100);

    const trustBar = document.getElementById('barTrust');
    const trustText = document.getElementById('textTrust');
    if (trustBar) trustBar.style.width = `${trustPercent}%`;
    if (trustText) trustText.innerText = `${trustPercent}%`;

    const anxietyBar = document.getElementById('barAnxiety');
    const anxietyText = document.getElementById('textAnxiety');
    if (anxietyBar) anxietyBar.style.width = `${anxietyPercent}%`;
    if (anxietyText) anxietyText.innerText = `${anxietyPercent}%`;

    // 5. Rupture Countdown Alert
    const countdownBox = document.getElementById('ruptureCountdownBox');
    const countdownVal = document.getElementById('ruptureCountdownVal');
    if (payload.rupture_countdown !== null && payload.rupture_countdown > 0) {
      if (countdownBox) countdownBox.classList.remove('hidden');
      if (countdownVal) countdownVal.innerText = `${Math.ceil(payload.rupture_countdown)}s`;
      this.maybePlayCriticalAlarm();
    } else {
      if (countdownBox) countdownBox.classList.add('hidden');
    }

    // 6. Spontaneous dialogues (family interruption / nurse alarms)
    if (payload.spontaneous_dialogues && payload.spontaneous_dialogues.length > 0) {
      payload.spontaneous_dialogues.forEach(msg => {
        const actualText = msg.text || msg.content || msg.message || '';
        const actualRole = msg.role || msg.speaker || 'system';
        const actualSpeaker = msg.role_title || msg.speaker || '系统';
        if (actualText && actualText !== 'undefined') {
          this.addDialogueBubble(actualSpeaker, actualRole, actualText, msg.metadata);
        }
      });
    }

    // 危急警报以后端 alarms 通道为权威信号源（替代前端按 SBP 阈值+随机的
    // 自行推断——初始 S0 高血压状态不应每几秒随机触发"致命警报"）。
    if (Array.isArray(payload.alarms) && payload.alarms.length > 0) {
      this.maybePlayCriticalAlarm();
    }
  }

  /**
   * Critical alarm with a 3s cool-down: 1Hz 遥测下避免每秒连续轰炸造成警报疲劳。
   */
  maybePlayCriticalAlarm() {
    const now = performance.now();
    if (now - this._lastCriticalAlarmAt < 3000) return;
    this._lastCriticalAlarmAt = now;
    if (window.monitorAudio) window.monitorAudio.playCriticalAlarm();
  }

  handleCustomActionSubmit() {
    const input = document.getElementById('inputActionText');
    if (!input || !input.value.trim()) return;
    const content = input.value.trim();
    input.value = '';

    const typeMapping = {
      inquiry: 'inquiry',
      exam: 'physical_exam',
      order: 'lab_order',
      treat: 'medication',
      dispo: 'rescue_disposition'
    };
    this.executeAction(typeMapping[this.currentTab] || this.currentTab, content);
  }

  async executeAction(actionType, content) {
    this.actionCount += 1;
    const counterDom = document.getElementById('actionCountBadge');
    if (counterDom) counterDom.innerText = `已执行指令: ${this.actionCount}`;

    // Add Doctor message bubble immediately
    this.addDialogueBubble('您（主治医生）', 'doctor', `下达指令：【${content}】`);

    try {
      const res = await fetch('/api/action/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: this.sessionId,
          action_type: actionType,
          content: content,
          params: {}
        })
      });

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const errData = await res.json();
          if (errData && errData.detail) detail = errData.detail;
        } catch (_) { /* body was not JSON */ }
        this.addSystemMessage(`指令执行失败：${detail}`);
        return;
      }

      const data = await res.json();
      if (!data.success) {
        this.addSystemMessage(`执行失败：${data.message || '未知错误'}`);
        return;
      }

      // Render returned dialogues
      if (data.dialogues && data.dialogues.length > 0) {
        data.dialogues.forEach(d => {
          const actualText = d.text || d.content || d.message || '';
          const actualSpeaker = d.role_title || d.speaker || '系统';
          const actualRole = d.role || d.speaker || 'system';
          if (actualText && actualText !== 'undefined') {
            this.addDialogueBubble(actualSpeaker, actualRole, actualText, d.metadata);
          }
        });
      }

      // Render objective clinical report card
      if (data.report) {
        this.renderReportCard(data.report);
      }

      // Render warning
      if (data.warning) {
        this.addSystemMessage(`⚠️ 严重危险预警：${data.warning}`);
      }
    } catch (err) {
      console.error('Execute action error', err);
      this.addSystemMessage('指令传输异常，请检查网络。');
    }
  }

  // NOTE: 微缩雷达只在结案评测（renderEvaluationReport → renderOSCERadar）时
  // 用后端真实分数更新；不再于操作过程中用前端编造的公式刷新，避免伪造考核数据。

  addDialogueBubble(speaker, role, text, meta) {
    if (!text || text === 'undefined' || String(text).trim() === '') return;
    const stream = document.getElementById('dialogueStream');
    if (!stream) return;

    const div = document.createElement('div');
    div.className = 'dialogue-log-entry ';

    let roleClass = 'log-entry-system';
    let roleBadge = 'SYS // 系统通知';

    if (role === 'doctor') {
      roleClass = 'log-entry-doctor';
      roleBadge = 'DR // 主治医师';
    } else if (role === 'patient') {
      roleClass = 'log-entry-patient';
      roleBadge = 'PT // 患者 孙建国';
    } else if (role === 'family') {
      roleClass = 'log-entry-family';
      roleBadge = 'FM // 家属 李秀梅';
    } else if (role === 'nurse') {
      roleClass = 'log-entry-nurse';
      roleBadge = 'RN // 责任护士 林美琴';
    }

    div.className += roleClass;
    div.innerHTML = `
      <div class="flex items-center justify-between mb-1.5 pb-1 border-b border-slate-200/80">
        <span class="text-[10px] font-mono-swiss font-bold tracking-wider uppercase text-slate-800">
          ${roleBadge}
        </span>
        <span class="text-[10px] font-mono-swiss text-slate-500 font-medium">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="text-xs text-slate-900 leading-relaxed whitespace-pre-wrap font-medium select-text">${escapeHtml(text)}</div>
    `;

    stream.appendChild(div);
    // 长会话防 DOM 无限增长：超过 200 条时移除最旧记录
    while (stream.children.length > 200) {
      stream.removeChild(stream.firstChild);
    }
    stream.scrollTop = stream.scrollHeight;
  }

  addSystemMessage(text) {
    if (!text || text === 'undefined' || String(text).trim() === '') return;
    const stream = document.getElementById('dialogueStream');
    if (!stream) return;

    const div = document.createElement('div');
    div.className = 'dialogue-log-entry log-entry-system text-xs bg-amber-50/70 border border-amber-200/90 border-l-4 border-l-amber-500 mb-2.5 p-2.5 shadow-xs';
    div.innerHTML = `
      <div class="flex items-center justify-between mb-1 pb-1 border-b border-amber-200/60">
        <span class="text-[10px] font-mono-swiss text-amber-900 font-bold uppercase tracking-wider">[DISPATCH SYSTEM NOTICE // 系统调度]</span>
        <span class="text-[10px] font-mono-swiss text-slate-500 font-medium">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="text-slate-900 font-medium text-xs leading-relaxed select-text">${escapeHtml(text)}</div>
    `;
    stream.appendChild(div);
    // 长会话防 DOM 无限增长：超过 200 条时移除最旧记录
    while (stream.children.length > 200) {
      stream.removeChild(stream.firstChild);
    }
    stream.scrollTop = stream.scrollHeight;
  }

  renderReportCard(report) {
    const grid = document.getElementById('reportGrid');
    if (!grid) return;

    // 清理空状态提示
    const emptyHint = grid.querySelector('.col-span-2');
    if (emptyHint) {
      emptyHint.remove();
    }

    const card = document.createElement('div');
    card.className = 'p-3 bg-white border border-slate-300 shadow-xs flex flex-col justify-between transition-all hover:border-slate-900';

    let detailsObj = (report.details && typeof report.details === 'object' && Object.keys(report.details).length > 0) ? report.details : {};
    if (Object.keys(detailsObj).length === 0) {
      if (report.right_arm) {
        detailsObj['右上臂血压'] = report.right_arm;
        detailsObj['左上臂血压'] = report.left_arm;
        detailsObj['双臂压差'] = report.difference;
      } else if (report.result) {
        detailsObj['测定数值'] = report.result;
        if (report.ref_range) detailsObj['参考范围'] = report.ref_range;
        if (report.status) detailsObj['临床状态'] = report.status;
      } else if (report.parameters && typeof report.parameters === 'object') {
        for (const [pk, pv] of Object.entries(report.parameters)) {
          detailsObj[pk.toUpperCase()] = String(pv);
        }
      } else if (report.findings) {
        if (Array.isArray(report.findings)) {
          report.findings.forEach((f, idx) => { detailsObj[`征象 ${idx + 1}`] = f; });
        } else {
          detailsObj['查体所见'] = String(report.findings);
        }
      }
    }

    let tableHtml = '';
    if (Object.keys(detailsObj).length > 0) {
      tableHtml = '<div class="my-2 border-t border-b border-slate-200 py-1.5 space-y-1">';
      for (const [k, v] of Object.entries(detailsObj)) {
        const valStr = String(v);
        const isAlertValue = valStr.includes('↑') || valStr.includes('高') || valStr.includes('阳性') || valStr.includes('危急') || valStr.includes('压差') || valStr.includes('撕裂') || valStr.includes('增宽');
        tableHtml += `
          <div class="flex items-start justify-between text-[11px] font-mono-swiss gap-2">
            <span class="text-slate-500 shrink-0 font-medium">${escapeHtml(k)}:</span>
            <span class="font-bold ${isAlertValue ? 'text-rose-600' : 'text-slate-900'} text-right leading-tight">${escapeHtml(valStr)}</span>
          </div>`;
      }
      tableHtml += '</div>';
    }

    const isCritical = report.critical_alert || false;

    const cardTitle = escapeHtml(report.title || report.item_name || report.name || '客观检查凭证');
    const cardConclusion = escapeHtml(report.conclusion || report.interpretation || (Array.isArray(report.findings) ? report.findings.join('；') : report.findings) || '客观指标测定完毕，详见明细');
    const cardModality = escapeHtml(report.modality || 'STAT_REPORT');

    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between pb-1.5 mb-1 border-b border-slate-200">
          <div class="flex items-center gap-1.5">
            <span class="text-[9px] font-mono-swiss px-1.5 py-0.5 font-bold uppercase tracking-wider ${isCritical ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}">
              ${cardModality}
            </span>
            <span class="font-bold text-slate-900 text-xs tracking-tight">${cardTitle}</span>
          </div>
          <span class="text-[9px] font-mono-swiss text-slate-400 font-medium">${report.timestamp || new Date().toLocaleTimeString()}</span>
        </div>
        ${tableHtml}
      </div>
      <div class="mt-2 p-2 bg-slate-50 border border-slate-200 text-xs">
        <div class="text-[9px] font-mono-swiss text-slate-500 uppercase font-bold tracking-wider mb-0.5">OBJECTIVE DIAGNOSTIC CONCLUSION // 客观医学结论：</div>
        <div class="text-slate-900 font-bold text-[11px] leading-snug">${cardConclusion}</div>
      </div>
    `;

    // 插入网格顶部
    grid.insertBefore(card, grid.firstChild);

    // 抽屉角标提示
    const drawerBadge = document.querySelector('#reportCardDrawer .bilingual-title-zh');
    if (drawerBadge && !drawerBadge.innerText.includes('(')) {
      drawerBadge.innerText += ' [已调阅客观单据]';
    }

    this.addSystemMessage(`已接收客观检查报告：【${cardTitle}】，已送达右侧客观凭证抽屉。`);
  }

  openEvaluationModal() {
    const modal = document.getElementById('modalEvaluation');
    if (modal) modal.classList.remove('hidden');
  }

  async submitFinalEvaluation() {
    const diagInput = document.getElementById('evalFinalDiag');
    const finalDiag = diagInput ? diagInput.value.trim() : 'Stanford A型主动脉夹层';

    const modal = document.getElementById('modalEvaluation');
    const loadingDom = document.getElementById('evalLoading');
    const resultDom = document.getElementById('evalResultContainer');

    if (loadingDom) loadingDom.classList.remove('hidden');
    if (resultDom) resultDom.classList.add('hidden');

    try {
      const res = await fetch('/api/eval/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: this.sessionId,
          final_diagnosis: finalDiag,
          differential_diagnoses: ['急性心肌梗死', '肺栓塞', '急性心包炎'],
          clinical_rationale: '患者突发剧烈胸背撕裂样痛伴极高血压，双上肢压差33mmHg，ECG排除STEMI，CTA确诊升主动脉夹层破口。'
        })
      });

      const data = await res.json();
      if (loadingDom) loadingDom.classList.add('hidden');
      if (resultDom) resultDom.classList.remove('hidden');

      this.renderEvaluationReport(data);
    } catch (err) {
      console.error('Submit evaluation error', err);
      if (loadingDom) loadingDom.innerText = '评测生成失败，请稍后重试。';
    }
  }

  renderEvaluationReport(data) {
    // 1. Total score & Badges
    const totalScoreDom = document.getElementById('resTotalScore');
    if (totalScoreDom) totalScoreDom.innerText = data.total_score;

    // 1. Core Score & Metrics
    const scoreDom = document.getElementById('resTotalScore');
    const score = Number(data.total_score || 0);
    if (scoreDom) scoreDom.innerText = score.toFixed(1);

    const passBadge = document.getElementById('resPassBadge');
    if (passBadge) {
      if (score >= 85) {
        passBadge.className = 'font-bold px-2 py-0.5 text-[10px] font-mono-swiss bg-emerald-600 text-white';
        passBadge.innerText = '优秀 / EXCELLENT';
      } else if (score >= 60) {
        passBadge.className = 'font-bold px-2 py-0.5 text-[10px] font-mono-swiss bg-teal-600 text-white';
        passBadge.innerText = '合格 / PASSED';
      } else {
        passBadge.className = 'font-bold px-2 py-0.5 text-[10px] font-mono-swiss bg-rose-600 text-white';
        passBadge.innerText = '不合格 / FAILED';
      }
    }

    const gedDom = document.getElementById('resGedDistance');
    if (gedDom) gedDom.innerText = data.ged_distance !== undefined ? data.ged_distance : '14.0';

    const topoDom = document.getElementById('resTopoSim');
    const simVal = Math.round((Number(data.topological_similarity) || 0) * 100);
    if (topoDom) topoDom.innerText = `拓扑相似度: ${simVal}%`;

    // 2. Overtest Cost & Cognitive Bias
    const overtestDom = document.getElementById('resOvertestCost');
    if (overtestDom) {
      const effScore = Number(data.radar_scores && data.radar_scores.clinical_efficiency) || 75;
      const overtestVal = Math.max(5, Math.min(65, Math.round((100 - effScore) * 0.75)));
      overtestDom.innerText = String(overtestVal);
    }

    const biasDom = document.getElementById('resBiasType');
    if (biasDom) {
      let biasText = '逻辑缜密-指南对齐型';
      if (data.clinical_feedback && data.clinical_feedback.length > 0) {
        for (const fb of data.clinical_feedback) {
          const m = fb.match(/【(?:典型认知偏差诊断|思维模式评价|AI主考官·临床决策思维白盒诊断|AI专家思维诊断)：(.*?)】/);
          if (m && m[1]) {
            biasText = m[1];
            break;
          }
          if (fb.includes('AI动态复盘') || fb.includes('AI主考官') || fb.includes('白盒诊断')) {
            biasText = 'AI专家级白盒归因';
          }
        }
      }
      biasDom.innerText = biasText;
      biasDom.className = 'text-xs font-bold ' + (biasText.includes('对齐') || biasText.includes('AI') ? 'text-emerald-700' : 'text-amber-700');
    }

    // 3. Fatal Errors Warning Box
    const fatalBox = document.getElementById('resFatalErrors');
    const fatalList = document.getElementById('resFatalErrorsList');
    if (fatalBox) {
      fatalBox.classList.remove('hidden');
      if (data.fatal_errors && data.fatal_errors.length > 0) {
        fatalBox.className = 'bg-rose-50 border-2 border-rose-400 p-3.5 text-rose-900';
        if (fatalList) {
          fatalList.innerHTML = '';
          data.fatal_errors.forEach(f => {
            const li = document.createElement('li');
            li.className = 'font-bold text-rose-700';
            li.innerText = `🚨 致命红线违规：${f}`;
            fatalList.appendChild(li);
          });
        }
      } else {
        fatalBox.className = 'bg-emerald-50 border border-emerald-300 p-3 text-emerald-900';
        if (fatalList) {
          fatalList.innerHTML = '<li class="font-bold text-emerald-700 list-none">✓ 安全守则：本次演练未触发任何致命禁忌用药或红线操作，患者救治生命通道安全！</li>';
        }
      }
    }

    // 4. Clinical Evidence-based Feedback
    const fbContainer = document.getElementById('resFeedbackList');
    if (fbContainer) {
      fbContainer.innerHTML = '';
      (data.clinical_feedback || []).forEach(item => {
        const li = document.createElement('li');
        li.className = 'text-xs text-slate-800 bg-slate-50 border border-slate-200 p-2.5 font-medium leading-relaxed';
        if (item.includes('🟢 来自国家级特聘急诊专家 AI 动态复盘') || item.includes('AI主考官')) {
          li.className = 'text-xs text-teal-950 bg-teal-50/70 border border-teal-300 p-3 font-semibold leading-relaxed shadow-sm';
        } else if (item.startsWith('【')) {
          li.className += ' font-bold text-slate-900 bg-slate-100 border-slate-300';
        }
        li.innerText = item;
        fbContainer.appendChild(li);
      });
    }

    // 5. Render Radar Chart & DAG Topology Comparison (Correct Container IDs)
    if (window.dagViewManager) {
      // 延迟确保弹窗布局尺寸完全生效
      setTimeout(() => {
        window.dagViewManager.renderOSCERadar('radarChartContainer', data.radar_scores || {});
        window.dagViewManager.renderDAGComparison('dagChartContainer', data.comparison_dag || {});
      }, 150);
    }
  }

  openConfigModal() {
    const modal = document.getElementById('modalConfig');
    if (modal) modal.classList.remove('hidden');
    this.fetchLlmConfig();
  }

  closeConfigModal() {
    const modal = document.getElementById('modalConfig');
    if (modal) modal.classList.add('hidden');
  }

  applyConfigPreset(type) {
    const pProv = document.getElementById('cfgProvider');
    const pBase = document.getElementById('cfgBaseUrl');
    const pModel = document.getElementById('cfgModel');
    const pKey = document.getElementById('cfgApiKey');
    if (type === 'deepseek') {
      if (pProv) pProv.value = 'deepseek';
      if (pBase) pBase.value = 'https://api.deepseek.com';
      if (pModel) pModel.value = 'deepseek-chat';
    } else if (type === 'openai') {
      if (pProv) pProv.value = 'openai';
      if (pBase) pBase.value = 'https://api.openai.com/v1';
      if (pModel) pModel.value = 'gpt-4o-mini';
    } else if (type === 'custom') {
      if (pProv) pProv.value = 'custom';
    } else if (type === 'offline') {
      if (pKey) pKey.value = '';
      // 后端 /api/config/llm 以 provider="offline" 识别免 Key 离线模式，
      // 误填 deepseek 会在保存时因缺少 API Key 被 400 拒绝。
      if (pProv) pProv.value = 'offline';
      if (pBase) pBase.value = '';
      if (pModel) pModel.value = 'offline-rule-engine';
    }
  }

  async fetchLlmConfig() {
    try {
      const res = await fetch('/api/config/llm');
      const data = await res.json();
      const pProv = document.getElementById('cfgProvider');
      const pBase = document.getElementById('cfgBaseUrl');
      const pModel = document.getElementById('cfgModel');
      const pKey = document.getElementById('cfgApiKey');
      const txtMode = document.getElementById('llmModeText');
      const badge = document.getElementById('llmModeBadge');
      if (pProv && data.provider) pProv.value = data.provider;
      if (pBase && data.base_url) pBase.value = data.base_url;
      if (pModel && data.model) pModel.value = data.model;
      if (pKey && data.masked_key) pKey.placeholder = '当前密钥: ' + data.masked_key;
      if (txtMode) {
        if (data.use_online) {
          txtMode.textContent = '🟢 模式: 在线大模型 (' + (data.model || 'LLM') + ')';
          if (badge) badge.className = 'flex items-center gap-1.5 text-[10px] font-mono-swiss text-emerald-800 bg-emerald-50 border border-emerald-300 px-2.5 py-1 select-none font-bold';
        } else {
          txtMode.textContent = '⚪ 模式: 离线规则仿真 (免Key)';
          if (badge) badge.className = 'flex items-center gap-1.5 text-[10px] font-mono-swiss text-slate-700 bg-slate-100 border border-slate-300 px-2.5 py-1 select-none';
        }
      }
    } catch (e) {
      console.warn('Failed to fetch LLM config:', e);
    }
  }

  async saveLlmConfig() {
    const pProv = document.getElementById('cfgProvider')?.value || 'deepseek';
    const pBase = document.getElementById('cfgBaseUrl')?.value || '';
    const pModel = document.getElementById('cfgModel')?.value || '';
    const pKey = document.getElementById('cfgApiKey')?.value || '';
    const statusBox = document.getElementById('configStatusText');
    const saveBtn = document.getElementById('btnSaveConfig');
    const saveBtnText = document.getElementById('btnSaveConfigText');

    // 立即给出高可见度点击反馈
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.classList.add('opacity-75', 'cursor-not-allowed');
    }
    if (saveBtnText) {
      saveBtnText.innerText = '⏳ 正在测试并保存 / SAVING...';
    }
    if (statusBox) {
      statusBox.className = 'mt-3 p-2.5 text-xs font-mono-swiss border border-blue-400 bg-blue-50 text-blue-800 min-h-[38px] flex items-center justify-center transition-all';
      statusBox.innerHTML = '<span class="font-bold">⏳ 正在同步配置并测试接口连通性，请稍候...</span>';
    }

    try {
      const res = await fetch('/api/config/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: pProv,
          api_key: pKey,
          base_url: pBase,
          model: pModel,
          test_connection: true
        })
      });

      if (!res.ok) {
        let errMsg = 'HTTP ' + res.status;
        try {
          const errData = await res.json();
          errMsg = errData.detail || errData.message || errMsg;
        } catch (_) {}
        if (res.status === 404) {
          errMsg = '404 路由未找到 (当前运行的后端是旧进程，请在终端按 Ctrl+C 停止并重新执行 python main.py 即可)';
        }
        throw new Error(errMsg);
      }

      const data = await res.json();
      if (data.success || data.status === 'success' || data.use_online !== undefined) {
        if (statusBox) {
          statusBox.className = 'mt-3 p-2.5 text-xs font-mono-swiss border border-emerald-500 bg-emerald-50 text-emerald-800 min-h-[38px] flex items-center justify-center transition-all';
          statusBox.innerHTML = '<span class="font-bold">✓ ' + escapeHtml(data.message || '配置已成功保存并生效！') + '</span>';
        }
        await this.fetchLlmConfig();
        setTimeout(() => this.closeConfigModal(), 1500);
      } else {
        if (statusBox) {
          statusBox.className = 'mt-3 p-2.5 text-xs font-mono-swiss border border-rose-500 bg-rose-50 text-rose-800 min-h-[38px] flex items-center justify-center transition-all';
          statusBox.innerHTML = '<span class="font-bold">✗ 保存失败: ' + escapeHtml(data.detail || data.message || '未知错误') + '</span>';
        }
      }
    } catch (e) {
      if (statusBox) {
        statusBox.className = 'mt-3 p-2.5 text-xs font-mono-swiss border border-rose-500 bg-rose-50 text-rose-800 min-h-[38px] flex items-center justify-center transition-all';
        statusBox.innerHTML = '<span class="font-bold">✗ 请求异常: ' + escapeHtml(e.message) + '</span>';
      }
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.classList.remove('opacity-75', 'cursor-not-allowed');
      }
      if (saveBtnText) {
        saveBtnText.innerText = '保存并即时生效 SAVE & APPLY';
      }
    }
  }
}

// Bootstrap application on DOM ready & export global handlers
document.addEventListener('DOMContentLoaded', () => {
  window.clinmindApp = new ClinMindApp();
});

// Window-level fallback helpers for inline event triggers
window.openConfigModal = () => window.clinmindApp && window.clinmindApp.openConfigModal();
window.closeConfigModal = () => window.clinmindApp && window.clinmindApp.closeConfigModal();
window.saveLlmConfig = () => window.clinmindApp && window.clinmindApp.saveLlmConfig();
window.applyConfigPreset = (type) => window.clinmindApp && window.clinmindApp.applyConfigPreset(type);
