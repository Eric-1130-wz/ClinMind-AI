/**
 * GameUI — 《急诊小诊室》界面层：大厅、说明书UI、接诊记录、自定义病人、
 * 设置、AI助教、免责声明、背景故事卡、结案报告，以及与 GameCore 的全部
 * DOM 绑定（对话流/操作坞/监护仪/信任焦虑条/动画调度）。
 * 数据源：/api/game/cases（CaseRepository）+ localStorage。
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LS = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const K = { stars: 'clinmind.stars', records: 'clinmind.records', customs: 'clinmind.customs', agree: 'clinmind.agree', settings: 'clinmind.settings' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const AVATAR_COLORS = { 'case_gam_001_common_cold': '#c76b8a', 'case_gam_002_gastroenteritis': '#d69a3d', 'case_gam_003_asthma': '#5aa88c', 'case_gam_004_hypoglycemia': '#5b7ba6', 'case_gam_005_appendicitis': '#8a8f7a', 'case_chest_pain_001': '#a05f5f' };

  const settings = Object.assign({ sound: true, volume: 40, speed: 55, hints: true, scale: 1 }, LS.get(K.settings, {}));
  let indexData = { patients: [] };
  let currentCase = null;

  /* ============ 工具 ============ */
  function showModal(id) { $(id).classList.remove('hidden'); }
  function hideModal(id) { $(id).classList.add('hidden'); }
  function toast(text, bad) {
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:99;padding:10px 22px;border-radius:12px;
      font-weight:700;font-size:13px;box-shadow:0 6px 20px #0003;${bad ? 'background:#b86c60;color:#fff' : 'background:#4a8a72;color:#fff9e6'}`;
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function saveSettings() { LS.set(K.settings, settings); applySettings(); }
  function applySettings() {
    GameCore.Sfx.enabled = settings.sound;
    GameCore.Sfx.volume = settings.volume / 100;
    $('statusHint').style.display = settings.hints ? '' : 'none';
    document.documentElement.style.fontSize = `${16 * settings.scale}px`;
  }

  /* ============ 大厅 ============ */
  async function loadIndex() {
    try {
      const res = await fetch('/api/game/cases');
      if (res.ok) indexData = await res.json();
    } catch (e) { /* 离线兜底：仅自定义病人 */ }
    renderLobby();
  }

  function renderLobby() {
    const stars = LS.get(K.stars, {});
    const total = Object.values(stars).filter(v => v > 0).length;
    $('starCount').textContent = total;
    const customs = LS.get(K.customs, []);
    const grid = $('patientGrid');
    grid.innerHTML = '';
    const card = (o) => {
      const locked = o.hiddenCase && total < 5;
      const el = document.createElement('div');
      el.className = 'pcard' + (locked ? ' locked' : '') + (o.custom ? ' custom' : '');
      const st = stars[o.case_id] || 0;
      el.innerHTML = `
        <div class="pcard-top">
          <canvas class="pcard-avatar" width="52" height="52" data-color="${o.color}" data-g="${o.gender}" data-age="${o.age}"></canvas>
          <div><div class="pcard-name">${esc(o.name)}</div>
          <div class="pcard-meta">${esc(o.age)}岁 · ${esc(o.gender)} · ${esc(o.difficulty || '')}</div></div>
          <div class="pcard-stars">${'⭐'.repeat(o.stars || 0)}</div>
        </div>
        <div class="pcard-line">${esc(o.one_liner || '')}</div>
        <div class="pcard-tags">${(o.tag || []).map(t => `<span class="tagchip">${esc(t)}</span>`).join('')}
          ${st ? `<span class="tagchip" style="color:#a37d46">最佳 ${'★'.repeat(st)}</span>` : ''}</div>
        <div class="pcard-actions">
          <button class="nav-btn ${locked ? '' : 'primary'}" ${locked ? 'disabled' : ''}>${locked ? '🔒 未解锁' : '接诊'}</button>
          ${o.custom ? `<button class="nav-btn danger" data-del="${esc(o.case_id)}">删除</button>` : ''}
        </div>`;
      if (!locked) el.querySelector('.nav-btn').onclick = () => startCase(o);
      const del = el.querySelector('[data-del]');
      if (del) del.onclick = () => {
        LS.set(K.customs, LS.get(K.customs, []).filter(c => c.case_id !== o.case_id));
        renderLobby();
      };
      grid.appendChild(el);
    };
    (indexData.patients || []).forEach(p => card({
      case_id: p.case_id, name: p.name, age: p.age, gender: p.gender,
      difficulty: p.difficulty, one_liner: p.one_liner, tag: p.tag || [],
      stars: p.difficulty_stars || 0, color: AVATAR_COLORS[p.case_id] || '#7a9b7d',
      hiddenCase: p.case_id === 'case_chest_pain_001'
    }));
    customs.forEach(c => card(Object.assign({ custom: true, color: '#b08a5e', one_liner: `自定义 · 基于 ${c.base_name}`, stars: 1, tag: ['自定义'] }, c)));
    grid.querySelectorAll('.pcard-avatar').forEach(drawAvatar);
  }

  function drawAvatar(cv) {
    const c = cv.getContext('2d'), W = cv.width, H = cv.height;
    c.fillStyle = '#e9f0e6'; c.fillRect(0, 0, W, H);
    c.fillStyle = cv.dataset.color || '#7a9b7d';
    c.fillRect(8, 26, W - 16, H - 30);
    c.fillStyle = '#f2c9a6';
    c.beginPath(); c.arc(W / 2, 18, 10, 0, 7); c.fill();
    c.fillStyle = '#4a443c';
    c.beginPath(); c.arc(W / 2, 15, 10, Math.PI, 0); c.fill();
    if (cv.dataset.g === '女') { c.fillRect(4, 14, 4, 16); c.fillRect(W - 8, 14, 4, 16); }
    c.fillStyle = '#3a352f';
    c.fillRect(W / 2 - 5, 17, 2, 2); c.fillRect(W / 2 + 3, 17, 2, 2);
    c.strokeStyle = '#8a5a4a'; c.beginPath(); c.arc(W / 2, 23, 3, .2, Math.PI - .2); c.stroke();
  }

  /* ============ 开始病例 ============ */
  async function startCase(o) {
    let caseData = null;
    if (!o.custom) {
      try {
        const res = await fetch('/api/game/cases/' + encodeURIComponent(o.case_id));
        if (res.ok) caseData = await res.json();
      } catch (e) {}
      if (!caseData) { toast('病例数据加载失败，请确认后端已启动', true); return; }
      const prof = caseData.patient_profile || {};
      o = Object.assign({ name: prof.name, gender: prof.gender, age: prof.age }, o);
    } else {
      const c = LS.get(K.customs, []).find(x => x.case_id === o.case_id);
      let base = null;
      try { const r = await fetch('/api/game/cases/' + encodeURIComponent(c.base_id)); if (r.ok) base = await r.json(); } catch (e) {}
      if (!base) { toast('基础病例加载失败', true); return; }
      caseData = JSON.parse(JSON.stringify(base));
      caseData.case_id = c.case_id;
      caseData.patient_profile = Object.assign({}, caseData.patient_profile, { name: c.name, gender: c.gender, age: c.age });
      caseData.chief_complaint = c.complaint;
      (caseData.game_extensions = caseData.game_extensions || {}).short_intro = `自定义病人 · ${c.persona}`;
    }
    currentCase = caseData;
    // 背景故事卡
    const ge = () => caseData.game_extensions || (GameCore.CONFIG[caseData.case_id].fallbackGe || {});
    $('storyName').textContent = `${(caseData.patient_profile || {}).name || ''} · ${(caseData.index_entry || {}).disease || ''}`;
    typeWrite($('storyText'), (ge().backstory || (caseData.game_extensions || {}).short_intro || '一位新病人走进了诊室……'), 18);
    showModal('modalStory');
    $('btnStoryGo').onclick = () => { hideModal('modalStory'); enterGame(o); };
  }

  /* ============ 诊室 ============ */
  let renderer = null, ecg = null;
  function enterGame(meta) {
    $('lobby').hidden = true;
    $('gameScreen').hidden = false;
    $('gameTitle').textContent = `接诊 · ${meta.name}（${meta.age}岁 · ${meta.gender}）`;
    $('pName').textContent = meta.name;
    $('pMeta').textContent = `${meta.age}岁 · ${meta.gender} · ${(currentCase.chief_complaint || '').slice(0, 18)}`;
    $('dlgStream').innerHTML = '';
    $('actionLog').innerHTML = '';
    $('logCount').textContent = '0 条';
    $('chipUrgency').classList.add('hidden');
    $('emotionChip').classList.add('hidden');
    renderer = new window.PatientRenderer($('patientCanvas'), { color: meta.color || AVATAR_COLORS[currentCase.case_id] || '#7a9b7d', gender: meta.gender, age: meta.age });
    ecg = new window.GameECG($('ecgCanvas'));
    bindCore();
    GameCore.start(currentCase);
    switchTab('inquiry');
  }

  function bindCore() {
    const D = $('dlgStream');
    GameCore.on('dialogue', ({ role, name, text }) => {
      const m = String(text).match(/^\(([^)]+)\)\s*([\s\S]*)$/);
      const emo = m ? m[1] : ''; const body = m ? m[2] : text;
      const div = document.createElement('div');
      div.className = 'bubble ' + role;
      const roleIcon = { doctor: '🧑‍⚕️', patient: '🧑', family: '👩', nurse: '👩‍⚕️', surgeon: '👨‍⚕️', system: '💠' }[role] || '';
      div.innerHTML = `<div class="b-role">${roleIcon} ${esc(name || role)}${emo ? ` <span class="dim">· ${esc(emo)}</span>` : ''}</div><div class="b-text"></div>`;
      D.appendChild(div);
      while (D.children.length > 60) D.removeChild(D.firstChild);
      typeWrite(div.querySelector('.b-text'), body, settings.speed);
      D.scrollTop = D.scrollHeight;
      if (emo) { const e = $('emotionChip'); e.textContent = emo; e.classList.remove('hidden'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.add('hidden'), 2600); }
    });
    GameCore.on('relation', ({ trust, anxiety }) => {
      $('trustBar').style.width = Math.round(trust * 100) + '%';
      $('trustVal').textContent = Math.round(trust * 100) + '%';
      $('anxietyBar').style.width = Math.round(anxiety * 100) + '%';
      $('anxietyVal').textContent = Math.round(anxiety * 100) + '%';
    });
    GameCore.on('vitals', ({ vitals, temp, rhythm }) => {
      $('vHR').textContent = Math.round(vitals.hr);
      $('vBP').textContent = `${Math.round(vitals.sbp)}/${Math.round(vitals.dbp)}`;
      $('vSpO2').textContent = Math.round(vitals.spo2);
      $('vTemp').textContent = temp.toFixed(1);
      $('rhythmLabel').textContent = rhythm.includes('过速') ? '窦性心动过速' : '窦性心律';
      ecg && ecg.setVitals(vitals.hr, rhythm, { alert: false });
    });
    GameCore.on('timer', ({ elapsed, left }) => {
      const mm = String(Math.floor(elapsed / 60)).padStart(2, '0'), ss = String(elapsed % 60).padStart(2, '0');
      $('chipTimer').textContent = `⏱ ${mm}:${ss}`;
      if (left != null && left > 0) {
        const c = $('chipUrgency'); c.classList.remove('hidden');
        c.textContent = `⏳ 处置窗口 ${left}s`;
        if (left <= 90) { c.classList.add('warn'); ecg && ecg.setVitals(GameCore.state.vitals.hr, GameCore.state.rhythm, { alert: true }); }
      }
    });
    GameCore.on('anim', (state) => { renderer && renderer.setState(state); });
    GameCore.on('hint', (t) => { if (settings.hints) $('statusHint').textContent = t; });
    GameCore.on('alert', (on) => {
      document.querySelector('.monitor-body').style.boxShadow = on ? '0 0 0 3px #e2695c' : 'none';
      if (!on && ecg) ecg.setVitals(GameCore.state.vitals.hr, GameCore.state.rhythm, {});
    });
    GameCore.on('progress', () => renderDock());
    GameCore.on('log', (rec) => {
      const L = $('actionLog');
      const d = document.createElement('div');
      d.className = 'log-item' + (rec.bad ? ' bad' : ' good');
      d.innerHTML = `<time>${rec.t.toTimeString().slice(0, 8)}</time><span>${rec.icon} ${esc(rec.what)} <b>${esc(rec.note || '')}</b></span>`;
      L.appendChild(d); L.scrollTop = L.scrollHeight;
      $('logCount').textContent = `${GameCore.state.logs.length} 条`;
    });
    GameCore.on('ended', (report) => {
      setTimeout(() => showReport(report), 1600);
    });
  }

  function typeWrite(el, text, speedVal) {
    const delay = 130 - speedVal; // speedVal 10..120 → 快
    el.textContent = '';
    let i = 0;
    clearInterval(el._tw);
    el._tw = setInterval(() => {
      el.textContent = text.slice(0, ++i);
      if (i >= text.length) clearInterval(el._tw);
    }, Math.max(8, delay));
  }

  /* ============ 操作坞 ============ */
  let curTab = 'inquiry';
  function switchTab(tab) {
    curTab = tab;
    document.querySelectorAll('.dock-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    renderDock();
  }
  function renderDock() {
    const s = GameCore.state; if (!s) return;
    const P = $('dockPanel'); P.innerHTML = '';
    const mk = (label, fn, opts = {}) => {
      const b = document.createElement('button');
      b.className = 'act-btn' + (opts.done ? ' done' : '') + (opts.danger ? ' danger' : '') + (opts.req && settings.hints ? ' req' : '');
      b.innerHTML = label + (opts.done ? ' ✓' : '');
      b.onclick = fn;
      P.appendChild(b);
    };
    if (curTab === 'inquiry') {
      ['症状', '诱因', '既往史', '伴随症状'].forEach(t => mk(`💬 ${t}`, () => GameCore.inquiry(t), { done: s.doneTopics.has(t) }));
      mk('🤝 安抚病人', () => GameCore.comfort());
    } else if (curTab === 'exam') {
      s.cfg.exams.forEach(e => mk(`🔍 ${e}`, () => GameCore.exam(e), { done: s.doneExams.has(e), req: s.cfg.required.some(r => e.includes(r)) }));
    } else if (curTab === 'lab') {
      s.cfg.labs.forEach(l => mk(`🧪 ${l}`, () => GameCore.lab(l), { done: s.doneLabs.has(l), req: s.cfg.required.some(r => l.includes(r) || r.includes(l.slice(0, 2))) }));
    } else if (curTab === 'rx') {
      if (!s.diagnosis) { P.innerHTML = '<div class="dim small" style="padding:8px">请先在「转归」前的诊断环节确认诊断（转归页提交诊断）。</div>'; return; }
      s.cfg.rx.forEach((r, i) => mk(`💉 ${r.n}`, () => GameCore.prescribe(i), { done: s.doneRx.has(i), danger: r.t === 'red' }));
    } else if (curTab === 'dispo') {
      const ge = s.ge || {};
      const diagTruth = ge.confirmed_diagnosis || '';
      const options = new Set([diagTruth, ...(ge.decoy_diagnoses || []).map(d => d.name)]);
      mk('🩺 提交诊断：' + diagTruth, () => GameCore.diagnose(diagTruth), { done: s.diagnosis === diagTruth });
      [...options].filter(o => o && o !== diagTruth).forEach(o => mk('🩺 诊断：' + o, () => GameCore.diagnose(o)));
      mk('👨‍⚕️ 呼叫外科会诊', () => GameCore.callSurgeon(), { done: s.surgeonCalled });
      ['治愈出院', '留观', '转诊手术', '转专科门诊'].forEach(d => mk(`📋 ${d}`, () => GameCore.dispose(d)));
    }
  }

  /* ============ 结案报告 ============ */
  function showReport(r) {
    const body = $('reportBody');
    const stars = LS.get(K.stars, {});
    if (!r.failed && r.stars > (stars[r.caseId] || 0)) { stars[r.caseId] = r.stars; LS.set(K.stars, stars); }
    const recs = LS.get(K.records, []);
    recs.unshift({ time: new Date().toLocaleString('zh-CN'), patient: r.patient, disease: r.disease, score: r.total, stars: r.stars, red: r.redLines.length, caseId: r.caseId, failed: r.failed });
    LS.set(K.records, recs.slice(0, 60));
    body.innerHTML = `
      <div class="rep-score"><span class="big">${r.total}</span>
        <div><div style="font-weight:800">${r.failed ? '救治失败 · 教学复盘' : '结案 · OSCE 六维复盘'}</div>
        <div class="stars">${'⭐'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}　${esc(r.patient)} · ${esc(r.disease)}</div>
        <div class="dim small">用时 ${Math.floor(r.time / 60)}分${r.time % 60}秒 ${r.redLines.length ? `· 红线 ${r.redLines.length} 次` : ''}</div></div></div>
      <div class="rep-dims">${Object.entries(r.dims).map(([k, v]) => `
        <div class="rep-dim ${v < 60 ? 'low' : ''}"><span>${k}</span><div class="line"><span style="width:${v}%"></span></div><b class="mono">${v}</b></div>`).join('')}</div>
      <div class="rep-notes"><h4>📌 复盘要点</h4><ul>
        ${r.redLines.map(x => `<li style="color:#a15046">红线违规：${esc(x)}</li>`).join('')}
        ${r.missed.map(x => `<li>遗漏必查项：${esc(x)}</li>`).join('')}
        ${r.failed ? `<li>${esc(r.reason)}</li>` : '<li style="color:#3f7c68">✓ 诊断与转归正确，完成救治！</li>'}
      </ul></div>
      <p class="dim small" style="margin-top:10px">⚠️ 本报告为虚构教学复盘，不构成真实医疗建议。</p>`;
    showModal('modalReport');
  }
  $('btnReportRetry').onclick = () => { hideModal('modalReport'); backToLobby(true); startCase({ case_id: currentCase.case_id }); };
  $('btnReportBack').onclick = () => { hideModal('modalReport'); backToLobby(); };
  function backToLobby(restart) {
    if (!restart) { $('gameScreen').hidden = true; $('lobby').hidden = false; }
    GameCore.stop();
    renderLobby();
  }
  $('btnExit').onclick = () => {
    if (!GameCore.state || GameCore.state.finished) return backToLobby();
    if (confirm('中途退出将按当前进度结案，确定吗？')) { GameCore.giveUp('中途退出'); }
  };

  /* ============ 说明书 UI ============ */
  const MANUAL = [
    ['实训规则', `<h3>五步法</h3><table><tr><th>步骤</th><th>要做的事</th></tr>
      <tr><td>① 观察</td><td>看病人动作/表情，初步判断病情</td></tr><tr><td>② 问诊</td><td>四个话题收集主诉与病史</td></tr>
      <tr><td>③ 检查</td><td>体查+检验，只查必要的（冗余扣分）</td></tr><tr><td>④ 确诊</td><td>在转归页提交诊断（误诊有教学反馈）</td></tr>
      <tr><td>⑤ 治疗</td><td>处方按步骤执行+护理，红线绝不碰</td></tr></table>
      <h3>三条铁律</h3><ul><li>先问后查、先查后诊、先诊后治</li><li>诊断不明前慎用强效镇痛</li><li>各病历「禁忌事项」绝对不能碰</li></ul>
      <h3>计分</h3><p>六维雷达：确诊决策度/鉴别思维/安全意识/临床效率/医患沟通/急救处置力。集齐5个病例星星解锁隐藏病例。</p>`],
    ['判断流程', `<h3>问诊口诀 P-Q-R-S-T</h3><ul><li><b>P</b> 诱因：什么引起/加重/缓解？</li><li><b>Q</b> 性质：刺痛？胀痛？绞痛？</li>
      <li><b>R</b> 部位与放射：哪里疼？窜到哪？</li><li><b>S</b> 程度与时间：多严重？多久？</li><li><b>T</b> 伴随症状：还有啥不舒服？</li></ul>
      <h3>生命体征速查</h3><table><tr><th>指标</th><th>正常</th><th>异常提示</th></tr>
      <tr><td>心率</td><td>60–100</td><td>↑发热/疼痛/低血糖</td></tr><tr><td>血压</td><td>90–139/60–89</td><td>↑↑危象 ↓↓休克</td></tr>
      <tr><td>SpO₂</td><td>≥95%</td><td>&lt;93% 呼吸急症警示</td></tr><tr><td>呼吸</td><td>12–20</td><td>讲话断句=中度发作</td></tr><tr><td>疼痛VAS</td><td>0–10</td><td>≥7 优先处理</td></tr></table>`],
    ['速查卡·感冒', `<div class="mcard"><h4>病毒性感冒 ★</h4><p><b>典型</b>：低热+清涕+喷嚏+咽痒<br><b>鉴别</b>：细菌扁桃体炎(高热+脓点+WBC↑)/流感(高热+剧酸痛)/肺炎(湿啰音+胸片)<br><b>治疗</b>：休息+饮水+对乙酰氨基酚<br><b>禁忌</b>：❌抗生素 ❌叠加感冒药</p></div>`],
    ['速查卡·胃肠炎', `<div class="mcard"><h4>急性胃肠炎 ★</h4><p><b>典型</b>：不洁饮食+脐周阵痛+水样泻<br><b>鉴别</b>：阑尾炎(转移性右下腹痛+麦氏点固定压痛)/菌痢(脓血便)/食物中毒(群体发病)<br><b>治疗</b>：口服补液盐Ⅲ+蒙脱石散+益生菌<br><b>禁忌</b>：❌强力止泻 ❌直接抗生素</p></div>`],
    ['速查卡·哮喘', `<div class="mcard"><h4>哮喘中度发作 ★★</h4><p><b>典型</b>：呼气性呼吸困难+哮鸣音+讲话短句<br><b>鉴别</b>：心源性哮喘(老年+粉红泡沫痰)/气胸(一侧呼吸音消失)/COPD(老年吸烟史)<br><b>治疗</b>：坐位→沙丁胺醇吸入→吸氧→激素<br><b>禁忌</b>：❌β阻滞剂 ❌阿司匹林 ❌镇静剂</p></div>`],
    ['速查卡·低血糖', `<div class="mcard"><h4>低血糖症 ★★</h4><p><b>典型</b>：心悸+冷汗+手抖+饥饿（四联）+用药未进餐<br><b>鉴别</b>：卒中(有局灶体征)/癫痫(抽搐)/醉酒——<b>先测指尖血糖！</b><br><b>治疗</b>：15-15规则（15g糖→15min复测→追正餐）<br><b>禁忌</b>：❌意识不清喂食 ❌不测糖先做CT</p></div>`],
    ['速查卡·阑尾炎', `<div class="mcard"><h4>急性阑尾炎 ★★★</h4><p><b>典型</b>：转移性右下腹痛+麦氏点固定压痛+反跳痛+先痛后热<br><b>鉴别</b>：胃肠炎(先吐泻后痛)/结石(绞痛+血尿)/穿孔(板状腹)<br><b>治疗</b>：禁食禁水→补液→腹腔镜阑尾切除<br><b>禁忌</b>：❌泻药灌肠 ❌术前强镇痛 ❌热敷</p></div>`],
    ['速查卡·夹层(隐藏)', `<div class="mcard hi"><h4>Stanford A 型主动脉夹层 ★★★★（隐藏）</h4><p><b>典型</b>：撕裂样胸背痛+双上肢压差&gt;20mmHg<br><b>铁律</b>：❌绝对禁止抗血小板/抗凝/溶栓；先β阻滞剂控心率再降压；CTA确诊+心胸外科会诊</p></div>`],
    ['安全须知', `<h3>教学免责</h3><ul><li>全部病例、人物、数值均为<b>虚构教学内容</b></li><li>用药方案为教学逻辑简化版，真实用药遵循医嘱与说明书</li><li>红线操作在现实中可能造成严重后果——游戏让你安全地犯错、低成本地记住</li><li>遇真实急症立即拨打 <b>120</b> 或前往正规医疗机构</li></ul>`]
  ];
  function renderManual(active = 0) {
    const tabs = $('manualTabs'); tabs.innerHTML = '';
    MANUAL.forEach(([name], i) => {
      const b = document.createElement('button');
      b.textContent = name; b.className = i === active ? 'active' : '';
      b.onclick = () => renderManual(i);
      tabs.appendChild(b);
    });
    $('manualBody').innerHTML = MANUAL[active][1];
  }

  /* ============ 接诊记录 ============ */
  function renderRecords() {
    const recs = LS.get(K.records, []);
    $('recordsBody').innerHTML = recs.length ? recs.map(r => `
      <div class="rec-item"><div class="rec-top"><span>${esc(r.patient)} · ${esc(r.disease)}</span>
      <span class="rec-stars">${'⭐'.repeat(r.stars)}${r.failed ? ' <span style="color:#a15046">未完成</span>' : ''}</span></div>
      <div class="dim small">${esc(r.time)} · 得分 <b>${r.score}</b>${r.red ? ` · 红线 ${r.red} 次` : ''}</div></div>`).join('')
      : '<p class="dim">暂无接诊记录，去大厅接一位病人吧。</p>';
  }
  $('btnExportRecords').onclick = () => {
    const blob = new Blob([JSON.stringify(LS.get(K.records, []), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'clinmind-records.json'; a.click();
  };
  $('btnClearRecords').onclick = () => { LS.set(K.records, []); renderRecords(); toast('记录已清空'); };

  /* ============ 自定义病人 ============ */
  function fillBaseSelect() {
    const sel = $('cfBase'); sel.innerHTML = '';
    (indexData.patients || []).forEach(p => {
      if (p.case_id === 'case_chest_pain_001') return;
      const o = document.createElement('option');
      o.value = p.case_id; o.textContent = `${p.name} · ${p.disease}（${p.difficulty}）`;
      sel.appendChild(o);
    });
  }
  $('btnSaveCustom').onclick = () => {
    const name = $('cfName').value.trim();
    if (!name) { toast('请填写病人姓名', true); return; }
    const customs = LS.get(K.customs, []);
    const base = (indexData.patients || []).find(p => p.case_id === $('cfBase').value);
    customs.unshift({
      case_id: 'custom_' + Date.now().toString(36), name,
      age: +$('cfAge').value || 30, gender: $('cfGender').value,
      complaint: $('cfComplaint').value.trim() || '不适就诊',
      persona: $('cfPersona').value.trim() || '普通市民',
      base_id: $('cfBase').value, base_name: base ? base.disease : '',
      hr: +$('cfHR').value, sbp: +$('cfSBP').value, spo2: +$('cfSpO2').value, temp: +$('cfTemp').value
    });
    LS.set(K.customs, customs.slice(0, 20));
    hideModal('modalCustom');
    renderLobby();
    toast('自定义病人已加入病例库');
  };
  ['cfHR', 'cfSBP', 'cfSpO2', 'cfTemp'].forEach(id => {
    const out = $(id + 'v'); const src = $(id);
    src.oninput = () => out.textContent = id === 'cfTemp' ? (+src.value).toFixed(1) : src.value;
  });

  /* ============ AI 助教 ============ */
  const AI_KB = [
    [['感冒', '抗生素'], '感冒多由病毒引起，抗生素对病毒无效哦～滥用反而催生耐药。休息+多饮水+必要时对乙酰氨基酚就够啦（说明书卡1）。'],
    [['止泻', '腹泻'], '急性胃肠炎腹泻是身体在排病原，早期强力止泻（洛哌丁胺）可能延长病程。第一位永远是口服补液盐防脱水（卡2）。'],
    [['哮喘', 'β', '阻滞'], '哮喘是气道痉挛，β受体阻滞剂（如普萘洛尔）会让支气管收缩得更紧——绝对禁区！救星是沙丁胺醇吸入（卡3）。'],
    [['低血糖', '血糖'], '心悸+冷汗+手抖+饥饿=低血糖四联。别猜，先测指尖血糖！<3.9就执行15-15规则：15g糖→15分钟复测（卡4）。'],
    [['阑尾炎', '转移'], '转移性右下腹痛+麦氏点固定压痛是阑尾炎招牌；先痛后热、压痛不固定则更像胃肠炎。禁泻药、禁热敷（卡5）。'],
    [['夹层', '抗栓'], '主动脉夹层的红线：绝对禁止抗血小板/抗凝/溶栓！先β阻滞剂控心率，再降压，CTA确诊+外科会诊（卡6）。'],
    [['流程', '怎么玩'], '五步法：观察动作→问诊（四话题）→必要检查→确诊→按步骤治疗。红线别碰，冗余检查会扣效率分哦！']
  ];
  async function aiSend() {
    const input = $('aiInput'); const text = input.value.trim();
    if (!text) return; input.value = '';
    const chat = $('aiChat');
    const q = document.createElement('div'); q.className = 'bubble doctor'; q.innerHTML = `<div class="b-role">🧑‍⚕️ 你</div><div>${esc(text)}</div>`;
    chat.appendChild(q); chat.scrollTop = chat.scrollHeight;
    const a = document.createElement('div'); a.className = 'bubble system'; a.textContent = '…';
    chat.appendChild(a); chat.scrollTop = chat.scrollHeight;
    let reply = '', src = 'offline';
    try {
      const res = await fetch('/api/game/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, case_context: currentCase ? (currentCase.chief_complaint || '') : '' }) });
      if (res.ok) { const d = await res.json(); reply = d.reply; src = d.source; }
    } catch (e) {}
    if (!reply) {
      const hit = AI_KB.find(([kws]) => kws.some(k => text.includes(k)));
      reply = hit ? hit[1] : '这个问题可以先翻翻📖说明书里的疾病速查卡～每张卡都有典型症状、鉴别要点和禁忌红线。（离线知识卡模式：在设置中接入在线大模型可获得更强解答）';
    }
    a.innerHTML = `<div class="b-role">🤖 AI助教 ${src === 'llm' ? '· <span style="color:#4a8a72">在线大模型</span>' : '· 离线知识卡'}</div><div>${esc(reply)}</div>`;
    chat.scrollTop = chat.scrollHeight;
  }
  $('btnAiSend').onclick = aiSend;
  $('aiInput').addEventListener('keydown', e => { if (e.key === 'Enter') aiSend(); });
  async function refreshAiStatus() {
    let mode = '离线（内置知识卡）';
    try {
      const r = await fetch('/api/config/llm');
      if (r.ok) { const d = await r.json(); if (d.use_online) mode = `在线大模型（${d.model || ''}）`; }
    } catch (e) {}
    $('aiStatus').textContent = '当前模式：' + mode;
    $('setAiMode').textContent = mode;
  }

  /* ============ 设置 ============ */
  function bindSettings() {
    $('setSound').checked = settings.sound;
    $('setVolume').value = settings.volume;
    $('setSpeed').value = settings.speed;
    $('setHints').checked = settings.hints;
    $('setScale').value = String(settings.scale);
    $('setSound').onchange = e => { settings.sound = e.target.checked; saveSettings(); };
    $('setVolume').oninput = e => { settings.volume = +e.target.value; saveSettings(); };
    $('setSpeed').oninput = e => { settings.speed = +e.target.value; $('setSpeedVal').textContent = settings.speed > 80 ? '快' : settings.speed > 35 ? '中' : '慢'; saveSettings(); };
    $('setHints').onchange = e => { settings.hints = e.target.checked; saveSettings(); };
    $('setScale').onchange = e => { settings.scale = +e.target.value; saveSettings(); };
    $('btnResetRecords').onclick = () => { LS.set(K.records, []); toast('接诊记录已清空'); };
    $('btnResetCustom').onclick = () => { LS.set(K.customs, []); renderLobby(); toast('自定义病人已清空'); };
    $('btnResetAll').onclick = () => { [K.stars, K.records, K.customs].forEach(k => LS.set(k, k === K.customs ? [] : {})); renderLobby(); toast('已重置全部本地数据'); };
  }

  /* ============ 初始化 ============ */
  function init() {
    applySettings(); bindSettings(); renderManual();
    document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => hideModal(b.dataset.close));
    $('btnManual').onclick = $('btnManual2').onclick = () => showModal('modalManual');
    $('btnRecords').onclick = () => { renderRecords(); showModal('modalRecords'); };
    $('btnSettings').onclick = () => { refreshAiStatus(); showModal('modalSettings'); };
    $('btnAiTutor').onclick = () => { refreshAiStatus(); showModal('modalAi'); };
    $('btnCustom').onclick = () => { fillBaseSelect(); showModal('modalCustom'); };
    $('btnFreeSend').onclick = () => { const i = $('freeInput'); GameCore.freeInput(i.value); i.value = ''; };
    $('freeInput').addEventListener('keydown', e => { if (e.key === 'Enter') { GameCore.freeInput(e.target.value); e.target.value = ''; } });
    document.querySelectorAll('.dock-tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
    // 首次免责声明
    if (!LS.get(K.agree, false)) {
      showModal('modalDisclaimer');
      $('disclaimerAgree').onchange = e => { $('btnDisclaimerOk').disabled = !e.target.checked; };
      $('btnDisclaimerOk').onclick = () => { LS.set(K.agree, true); hideModal('modalDisclaimer'); };
    }
    loadIndex(); refreshAiStatus();
    // 音频手势解锁
    const unlock = () => { GameCore.Sfx._c(); };
    document.addEventListener('pointerdown', unlock, { once: true });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
