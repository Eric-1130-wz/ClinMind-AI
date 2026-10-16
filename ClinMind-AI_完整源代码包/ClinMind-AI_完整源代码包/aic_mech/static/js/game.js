/* Interactive adapter for the two supplied UI designs. No external libraries. */
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const names = {doctor: '接诊医生', patient: '患者 · 孙建国', family: '家属 · 李秀梅', nurse: '责任护士', system: '系统'};
  const menu = [
    {label: '问诊', type: 'inquiry', items: [
      ['疼痛性质与放射范围', '怎么疼？疼痛向哪里放射？'],
      ['起病诱因与持续时长', '什么时候开始发作，有什么诱因？'],
      ['高血压病史与规律服药', '您有高血压病史吗？平时服药规律吗？'],
      ['安抚患者与家属', '别紧张，我们全力救治，马上给您止痛。']
    ]},
    {label: '体查', type: 'physical_exam', items: [
      ['双上肢血压对比', '测量双侧上肢血压'], ['心脏听诊', '心脏听诊主动脉瓣杂音'],
      ['周围动脉搏动', '触诊双侧桡动脉脉搏'], ['神经系统检查', '检查瞳孔与四肢肌力']
    ]},
    {label: '检验', type: 'lab_order', items: [
      ['床旁心电图', '急查18导联心电图'], ['心肌损伤标志物', '急查高敏肌钙蛋白I'],
      ['D-二聚体', '急查D-二聚体'], ['全主动脉增强 CTA', '急诊胸腹主动脉全长增强CTA']
    ]},
    {label: '处方', type: 'medication', items: [
      ['艾司洛尔', '艾司洛尔'], ['硝普钠', '硝普钠'],
      ['吗啡镇痛', '吗啡镇痛'], ['阿司匹林 · 训练风险选项', '阿司匹林']
    ]},
    {label: '转归', type: 'rescue_disposition', items: [
      ['建立急救通路与监护', '建立双通道静脉通路并吸氧监护'],
      ['心胸外科急会诊', '紧急呼叫心胸外科急会诊'],
      ['病危沟通与知情同意', '签署急诊手术知情同意书及病危通知书'],
      ['抢救处置', '心肺复苏评估']
    ]}
  ];
  let sessionId, tab = 0, snapshot, busy = false, stopped = false, ws, noticeTimer, reconnectTimer, speechTimer;
  let speechSignature = '';
  const monitorState = {hr: 108, spo2: 96, sbp: 195, dbp: 115, pain: 9, patientState: 'S0_STABLE'};
  const waveSvg = $('.wave-svg');
  const waveLines = waveSvg ? $$('polyline', waveSvg) : [];
  const canvas = $('.canvas');
  const workstation = !!$('.computer');
  const notice = document.createElement('div'); notice.className = 'game-notice'; notice.setAttribute('role', 'status'); document.body.append(notice);
  const alert = document.createElement('div'); alert.className = 'game-alert'; canvas.append(alert);
  const log = document.createElement('aside'); log.className = 'game-log'; log.hidden = true;
  log.innerHTML = '<div class="game-log-head"><b>接诊记录</b><button aria-label="关闭记录">×</button></div><div class="game-log-body"></div>';
  document.body.append(log); $('button', log).onclick = () => { log.hidden = true; };
  const dialog = document.createElement('dialog'); dialog.className = 'game-dialog'; document.body.append(dialog);
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  function fit() { canvas.style.transform = `scale(${Math.min(innerWidth / 1600, innerHeight / 900)})`; }
  addEventListener('resize', fit); fit();
  function toast(text, error = false) {
    notice.textContent = text; notice.classList.toggle('game-error', error);
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.textContent = ''; }, error ? 7000 : 3500);
  }
  async function api(path, body) {
    const res = await fetch(path, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(typeof data.detail === 'string' ? data.detail : `请求失败（${res.status}），请检查输入`), {status: res.status});
    return data;
  }
  function interactive(el, handler, label) {
    if (!el) return;
    el.setAttribute('role', 'button'); el.tabIndex = 0;
    if (label) el.setAttribute('aria-label', label);
    el.addEventListener('click', handler);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(e); } });
  }
  function openDialog(title) {
    dialog.replaceChildren();
    const head = document.createElement('div'); head.className = 'game-dialog-head';
    const h = document.createElement('h2'); h.textContent = title;
    const close = document.createElement('button'); close.className = 'secondary'; close.textContent = '关闭'; close.onclick = () => dialog.close();
    head.append(h, close); const body = document.createElement('div'); body.className = 'game-dialog-body'; dialog.append(head, body);
    if (!dialog.open) dialog.showModal();
    return body;
  }
  function element(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
  function showLog() {
    const body = $('.game-log-body', log); body.replaceChildren();
    const messages = snapshot?.dialogues || [];
    if (!messages.length) body.append(element('p', '尚无操作记录。选择页签或输入指令开始接诊。'));
    messages.forEach(m => {
      const div = element('div', undefined, `game-message ${m.speaker}`);
      div.append(element('b', names[m.speaker] || m.role_title || '系统'), document.createTextNode(m.text)); body.append(div);
    });
    log.hidden = false; body.scrollTop = body.scrollHeight;
  }
  function reportCard(report) {
    const card = element('article', undefined, 'game-report'); card.append(element('h3', report.title || report.item_name || '检查报告'));
    const details = report.details || {};
    Object.entries(details).forEach(([k,v]) => card.append(element('p', `${k}：${v}`)));
    if (!Object.keys(details).length && report.result) card.append(element('p', `结果：${report.result}`));
    card.append(element('p', report.conclusion || report.interpretation || '报告已签发'));
    return card;
  }
  function showReports(filter = '') {
    const body = openDialog(filter || '客观检查报告');
    const reports = (snapshot?.reports || []).filter(r => !filter || (filter === '心电图' ? r.modality === 'ECG' : filter === '影像检查' ? ['CTA','ECHO','IMAGING','ULTRASOUND'].includes(r.modality) || /CTA|超声/.test(r.title) : ['LAB','EXAM'].includes(r.modality)));
    if (!reports.length) body.append(element('p', '尚未取得该类报告。请先在“体查”或“检验”页签下达指令。'));
    reports.slice().reverse().forEach(r => body.append(reportCard(r)));
  }
  function updateSpeech() {
    const latestAction = (snapshot?.actions || []).at(-1);
    const actionTime = Number(latestAction?.timestamp || 0);
    const actionType = String(latestAction?.action_type || '');
    const latestHuman = (snapshot?.dialogues || []).filter(m => m.speaker === 'patient' || m.speaker === 'family').at(-1);
    const latestHumanTime = Number(latestHuman?.timestamp || 0);
    const latestHumanSignature = latestHuman ? `${latestHuman.timestamp}:${latestHuman.speaker}:${latestHuman.text}` : '';
    const isRecentSpontaneous = latestHumanTime > 0 && (Date.now() / 1000 - latestHumanTime) < 12;
    const hasCurrentResponse = latestHuman && (latestHumanTime >= actionTime || (actionType === 'INQUIRY' && actionTime - latestHumanTime < 5));
    const shouldShow = !!latestHuman && (hasCurrentResponse || isRecentSpontaneous);
    if (shouldShow && latestHumanSignature !== speechSignature) {
      speechSignature = latestHumanSignature;
      clearTimeout(speechTimer);
      speechTimer = setTimeout(() => {
        $$('.speech.patient,.speech.family').forEach(el => { el.hidden = true; });
      }, 12000);
    }
    for (const role of ['patient', 'family']) {
      const last = (snapshot?.dialogues || []).filter(m => m.speaker === role).at(-1);
      const p = $(`.speech.${role} p`);
      const bubble = $(`.speech.${role}`);
      const messageTime = Number(last?.timestamp || 0);
      const roleVisible = shouldShow && (messageTime >= actionTime || (actionType === 'INQUIRY' && actionTime - messageTime < 5) || (Date.now() / 1000 - messageTime) < 12);
      if (roleVisible && p && bubble) {
        p.textContent = last.text; p.style.fontSize = last.text.length > 70 ? '16px' : ''; bubble.hidden = false;
      } else if (p && bubble) {
        p.textContent = ''; bubble.hidden = true;
      }
    }
  }
  function radar(scores) {
    const svg = $('.radar-svg'); if (!svg) return;
    const keys = ['critical_first_aid','clinical_efficiency','physician_patient_comm','safety_awareness','differential_thinking','diagnostic_accuracy'];
    const points = keys.map((k,i) => { const a = -Math.PI/2 + i*Math.PI/3, r = Math.max(0, Math.min(100, scores?.[k] || 0)) * .9; return [306+Math.cos(a)*r,128+Math.sin(a)*r]; });
    const shape = $('polygon[fill-opacity]', svg); if (shape) shape.setAttribute('points', points.map(p=>p.join(',')).join(' '));
    $$('circle', svg).forEach((c,i) => { if (points[i]) { c.setAttribute('cx',points[i][0]); c.setAttribute('cy',points[i][1]); }});
    const legend = $('.radar-legend'); if (legend) legend.textContent = '依据已执行操作计算 · 规则评分';
  }
  function ecgY(phase, t, baseline) {
    // One normalized heartbeat: P wave, sharp QRS complex, then T wave.
    const noise = Math.sin(t * 3.7 + phase * 31) * .65;
    if (phase < .12) return baseline - 3.5 * Math.sin(Math.PI * phase / .12);
    if (phase >= .18 && phase < .205) return baseline + 5 * (phase - .18) / .025;
    if (phase >= .205 && phase < .225) return baseline + 5 - 58 * (phase - .205) / .02;
    if (phase >= .225 && phase < .255) return baseline - 53 + 98 * (phase - .225) / .03;
    if (phase >= .255 && phase < .28) return baseline + 45 - 45 * (phase - .255) / .025;
    if (phase >= .40 && phase < .54) return baseline - 8 * Math.sin(Math.PI * (phase - .40) / .14);
    return baseline + noise;
  }
  function renderDynamicWaveform(timestamp) {
    if (waveLines.length) {
      const t = timestamp / 1000;
      const hr = Math.max(0, Number(monitorState.hr) || 0);
      // The strip represents roughly four seconds at 25 mm/s, so a 100–120
      // bpm rhythm shows about 6–8 QRS complexes across the monitor.
      const beats = Math.max(.1, hr / 60 * 4);
      const flat = hr <= 1 || monitorState.patientState === 'S6_CARDIAC_ARREST';
      const ecg = [], pleth = [];
      for (let x = 0; x <= 560; x += 4) {
        const phase = ((x / 560 * beats + t * Math.max(.2, hr / 60)) % 1 + 1) % 1;
        const y = flat ? 35 + Math.sin(t * 2 + x * .08) * .4 : ecgY(phase, t, 35);
        const plethPhase = ((x / 560 * beats + t * Math.max(.2, hr / 60)) % 1 + 1) % 1;
        const plethY = flat ? 76 : 76 - 9 * Math.pow(Math.max(0, Math.sin(Math.PI * plethPhase)), 1.8);
        ecg.push(`${x},${y.toFixed(1)}`); pleth.push(`${x},${plethY.toFixed(1)}`);
      }
      waveLines[0].setAttribute('points', ecg.join(' '));
      if (waveLines[1]) waveLines[1].setAttribute('points', pleth.join(' '));
    }
    requestAnimationFrame(renderDynamicWaveform);
  }
  requestAnimationFrame(renderDynamicWaveform);
  function telemetry(data) {
    snapshot = {...snapshot, ...data};
    const v = data.vitals;
    if (v) {
      monitorState.hr = Number(v.hr) || 0; monitorState.spo2 = Number(v.spo2) || 0;
      monitorState.sbp = Number(v.sbp) || 0; monitorState.dbp = Number(v.dbp) || 0;
      monitorState.pain = Number(v.pain_vas) || 0; monitorState.patientState = data.patient_state || snapshot.patient_state || 'S0_STABLE';
      const values = [Math.round(v.hr), `${Math.round(v.sbp)}/${Math.round(v.dbp)}`, `${Math.round(v.spo2)} %`, `${v.pain_vas} / 10`];
      $$('.vital strong').forEach((el,i) => { el.textContent = values[i]; });
      const wave = $('.wave-svg'); if (wave) wave.style.opacity = v.hr === 0 ? '.15' : '1';
      if (window.monitorAudio && monitorState.hr > 0 && !snapshot?.is_finished) window.monitorAudio.playQRSBeep(monitorState.spo2);
    }
    const seconds = snapshot.virtual_seconds || 0;
    const timer = $('.timer'); if (timer) timer.textContent = `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    const trust = Math.round((snapshot.trust_level ?? .4)*100), anxiety = Math.round((snapshot.family_anxiety ?? .65)*100);
    [['.status-tag.trust',trust],['.status-tag.anxiety',anxiety]].forEach(([s,val]) => { const el=$(s); if(el){$('strong',el).textContent=`${val}%`;$('.bar span',el).style.width=`${val}%`;}});
    $$('.relation').forEach((el,i) => { const val=i===0?trust:anxiety; $('b',el).textContent=`${val}%`;$('.line span',el).style.width=`${val}%`; });
    alert.textContent = snapshot.rupture_countdown != null ? `模拟危急状态 · ${snapshot.patient_state} · 倒计时 ${snapshot.rupture_countdown} 秒` : '';
    document.body.classList.toggle('is-finished',!!snapshot.is_finished);
    input.disabled = !!snapshot.is_finished;
    if (snapshot.is_finished) { const live=$('.live'); if(live) live.textContent='已结案 · 监护冻结'; }
    if (data.spontaneous_dialogues?.length) {
      const existing = new Set((snapshot.dialogues || []).map(m=>`${m.timestamp}:${m.text}`));
      snapshot.dialogues = [...(snapshot.dialogues || []),...data.spontaneous_dialogues.filter(m=>!existing.has(`${m.timestamp}:${m.text}`))]; updateSpeech();
    }
  }
  function setTab(i) {
    tab = i; $$('.dock-tab,.tab').forEach((el,j) => el.classList.toggle('active', j === i));
    const questions = $('.questions');
    if (questions) {
      questions.replaceChildren(element('div', `选择${menu[i].label}方向 · 所有操作均为虚拟训练`, 'questions-label'));
      menu[i].items.forEach(([title,cmd],j) => {
        const row=element('div',undefined,'inquiry'); row.append(element('div',String(j+1).padStart(2,'0'),'inquiry-num'));
        const desc=element('div'); desc.append(element('div',title,'inquiry-text'),element('div',cmd,'inquiry-hint'));
        const run=element('div',i===0?'询问':'执行','inquiry-button'); interactive(run,()=>execute(cmd)); row.append(desc,run); questions.append(row);
      });
    }
    input.placeholder=`输入${menu[i].label}指令……`;
    if (!workstation) {
      const body=openDialog(`${menu[i].label} · 快捷操作`);
      const choices=element('div',undefined,'game-actions');
      menu[i].items.forEach(([title,cmd])=>{const b=element('button',title);b.onclick=()=>{dialog.close();execute(cmd);};choices.append(b);});
      body.append(choices,element('p','也可以关闭此窗口，在底部输入自定义指令。','game-footnote'));
    }
  }
  const inputWrapper = $('.question-entry .text-input') || $('.action-dock .text-input');
  const input = document.createElement('input'); input.className='game-input'; input.placeholder='输入追问或诊疗指令……'; input.setAttribute('aria-label','问诊或诊疗指令'); input.maxLength=4000;
  inputWrapper.replaceChildren(input); input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing)submit();});
  function submit(){if(input.value.trim())execute(input.value.trim());}
  interactive($('.send'),submit,'发送指令');
  $$('.dock-tab,.tab').forEach((el,i)=>interactive(el,()=>setTab(i),menu[i].label));
  async function refresh() {
    snapshot=await api(`/api/case/session/${encodeURIComponent(sessionId)}/workspace`);
    telemetry(snapshot); radar(snapshot.radar_scores); updateSpeech();
    $$('.report .paper-bottom span').forEach(el=>{el.textContent=(snapshot.reports?.length?'可查看':'未获取');});
  }
  async function execute(content) {
    if (busy || !sessionId) return;
    if(snapshot?.is_finished){toast('本次训练已结案，可查看报告或开始下一次训练。');return;}
    busy=true;document.body.classList.add('is-busy');
    try {
      const result=await api('/api/action/execute',{session_id:sessionId,action_type:menu[tab].type,content,params:{}});
      input.value='';await refresh();showLog();
      if(result.report){const body=openDialog('客观检查报告');body.append(reportCard(result.report));}
      toast(result.warning || result.message,!!result.warning);
    } catch(e){toast(e.message,true);}finally{busy=false;document.body.classList.remove('is-busy');}
  }
  function connect() {
    if(stopped || !sessionId)return;
    const proto=location.protocol==='https:'?'wss:':'ws:';
    ws=new WebSocket(`${proto}//${location.host}/ws/vitals/${encodeURIComponent(sessionId)}`);
    ws.onmessage=e=>{try{const data=JSON.parse(e.data);if(data.type==='vitals_update')telemetry(data);}catch(err){toast('监护数据解析失败',true);}};
    ws.onopen=()=>{const el=$('.live');if(el)el.textContent=snapshot?.is_finished?'已结案 · 监护冻结':'实时监护 · 1 Hz';};
    ws.onclose=e=>{if(!stopped && e.code!==1008){const el=$('.live');if(el)el.textContent='监护重连中';reconnectTimer=setTimeout(connect,2000);}};
  }
  function renderAssessment(data) {
    const body=openDialog('OSCE 临床思维训练报告');
    const metrics=element('div',undefined,'game-metrics');
    [['训练总分',`${data.total_score} / 100`],['拓扑相似度',`${Math.round(data.topological_similarity*100)}%`],['图编辑距离',data.ged_distance]].forEach(([label,val])=>{const d=element('div');d.append(element('small',label),element('b',val));metrics.append(d);});body.append(metrics);
    const table=document.createElement('table');Object.entries(data.radar_scores).forEach(([key,val])=>{const tr=table.insertRow();tr.insertCell().textContent=({critical_first_aid:'急救处置力',diagnostic_accuracy:'确诊决策度',differential_thinking:'鉴别思维',safety_awareness:'安全意识',physician_patient_comm:'医患沟通',clinical_efficiency:'临床效率'})[key]||key;tr.insertCell().textContent=`${val} / 100`;});body.append(table);
    body.append(element('h3','复盘反馈'));
    [...data.fatal_errors,...data.clinical_feedback].forEach(t=>body.append(element('p',t)));
    const steps=document.createElement('details');steps.append(element('summary',`操作时间线（${data.action_sequence_summary.length} 项）`));data.action_sequence_summary.forEach((a,i)=>steps.append(element('p',`${i+1}. ${a.content}`)));body.append(steps);
    const actions=element('div',undefined,'game-actions');const download=element('button','导出 JSON 报告');download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`ClinMind-${sessionId}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};const next=element('button','开始下一次训练','secondary');next.onclick=()=>startNew();actions.append(download,next);body.append(actions,element('p','此报告由演示病例与规则评分生成，用于临床思维教学模拟。','game-footnote'));
  }
  function evaluation() {
    if(snapshot?.assessment){renderAssessment({...snapshot.assessment,session_id:sessionId});return;}
    const body=openDialog('结案生成报告');body.append(element('p','填写本次训练的最终判断，结案后将停止计时并冻结本次操作。'));
    const label=element('label','最终诊断');const diagnosis=element('input');diagnosis.placeholder='请输入最终诊断';diagnosis.maxLength=1000;label.append(diagnosis);body.append(label);
    const button=element('button','提交并生成报告');const status=element('p');body.append(button,status);
    button.onclick=async()=>{if(!diagnosis.value.trim()){status.textContent='请填写最终诊断';return;}button.disabled=true;status.textContent='正在计算评分……';try{const report=await api('/api/eval/submit',{session_id:sessionId,final_diagnosis:diagnosis.value.trim()});await refresh();renderAssessment(report);}catch(e){status.textContent=e.message;button.disabled=false;}};
  }
  function startNew() {
    const body=openDialog('开始下一次训练');body.append(element('p','当前仅提供 1 个胸痛演示病例。继续将归档本次训练并重新开始同一病例，原报告保存在本地数据库。'));
    const b=element('button','重新开始演示病例');body.append(b);b.onclick=async()=>{b.disabled=true;try{if(sessionId && !snapshot?.is_finished)await api(`/api/case/session/${encodeURIComponent(sessionId)}/pause`,{});localStorage.removeItem('clinmind-game-session');stopped=true;ws?.close();sessionId=null;await initialize();dialog.close();toast('新的训练已开始');}catch(e){toast(e.message,true);b.disabled=false;}};
  }
  function settings() {
    const body=openDialog('AI 模型配置');body.classList.add('game-settings');
    body.append(element('p','默认离线即可完成全部训练。在线模式会将模拟对话发送至所选服务商。'));
    const select=document.createElement('select');[['offline','离线规则引擎（免 Key）'],['deepseek','DeepSeek'],['openai','OpenAI'],['custom','自定义兼容接口']].forEach(([v,t])=>{const o=element('option',t);o.value=v;select.append(o);});body.append(select);
    const key=element('input');key.type='password';key.placeholder='API Key（仅保存在本机 .env）';const base=element('input');base.placeholder='接口 Base URL';const model=element('input');model.placeholder='模型名称';body.append(key,base,model);
    const volumeLabel = element('label','监护音量'); const volume = document.createElement('input'); volume.type='range'; volume.min='0'; volume.max='1'; volume.step='.01'; volume.value=String(window.monitorAudio?.volume ?? .08); volumeLabel.append(volume); body.append(volumeLabel);
    volume.oninput=()=>window.monitorAudio?.setVolume(volume.value);
    const presets={deepseek:['https://api.deepseek.com/v1','deepseek-chat'],openai:['https://api.openai.com/v1','gpt-4o-mini'],offline:['','offline-rule-engine'],custom:['http://127.0.0.1:11434/v1','']};
    select.onchange=()=>{[base.value,model.value]=presets[select.value];key.required=select.value!=='offline';};
    const actions=element('div',undefined,'game-actions'); const test=element('button','测试连接并保存'); const save=element('button','仅保存','secondary'); actions.append(test,save); body.append(actions);
    const status=element('p'); status.className='connection-status'; body.append(status);
    const statusLabel=element('span','连接状态：'); const statusValue=element('strong','尚未测试'); const statusRow=element('div',undefined,'connection-state connection-unknown'); statusRow.append(statusLabel,statusValue); body.insertBefore(statusRow,status);
    function showConnection(ok, message, testedAt='') {
      statusRow.classList.toggle('connection-ok', ok === true); statusRow.classList.toggle('connection-failed', ok === false); statusRow.classList.toggle('connection-unknown', ok !== true && ok !== false);
      statusValue.textContent = ok === true ? '已连接' : ok === false ? '连接失败' : '尚未测试';
      status.textContent = message || (testedAt ? `最近测试：${testedAt}` : '点击“测试连接并保存”验证服务。');
    }
    async function persist(testConnection){
      test.disabled=true; save.disabled=true;
      try { const r=await api('/api/config/llm',{provider:select.value,api_key:key.value,base_url:base.value,model:model.value,test_connection:testConnection}); showConnection(r.connection_ok, r.message, r.connection_tested_at); key.value=''; }
      catch(e){status.textContent=e.message;}
      finally{test.disabled=false;save.disabled=false;}
    }
    test.onclick=()=>persist(true); save.onclick=()=>persist(false);
    api('/api/config/llm').then(current=>{select.value=current.provider || 'offline'; base.value=current.base_url || ''; model.value=current.model || ''; select.onchange(); if(current.provider !== 'offline') { base.value=current.base_url || base.value; model.value=current.model || model.value; } showConnection(current.connection_ok, current.connection_message, current.connection_tested_at); }).catch(()=>showConnection(false,'无法读取当前连接状态，请检查服务是否启动。'));
    select.onchange();
  }
  const tools=element('div',undefined,'game-tools');
  [['接诊记录',showLog],['报告',()=>showReports()],['结案报告',evaluation],['AI 配置',settings]].forEach(([text,fn])=>{const b=element('button',text);b.onclick=fn;tools.append(b);});
  ($('.work-header') || $('.hud')).append(tools);
  interactive($('.monitor-label'),()=>{location.href='/static/workstation.html';},'打开工作站');
  // The monitor illustration itself is a hit target as well.
  if(!workstation){const hit=element('div');Object.assign(hit.style,{position:'absolute',left:'85px',top:'402px',width:'397px',height:'220px',cursor:'pointer'});canvas.append(hit);interactive(hit,()=>{location.href='/static/workstation.html';},'打开电脑工作站');}
  interactive($('.return-btn'),()=>{location.href='/static/reception.html';});
  interactive($('.next-btn'),startNew);interactive($('.end-btn'),evaluation);
  $$('.report').forEach((el,i)=>interactive(el,()=>showReports(['心电图','检验报告','影像检查'][i])));
  $$('.square-button').forEach((el,i)=>{
    if(i === 0) interactive(el,()=>{ const muted=window.monitorAudio?.toggleMute() ?? false; el.setAttribute('aria-label',muted?'打开声音':'关闭声音'); el.title=muted?'打开声音':'关闭声音'; el.classList.toggle('is-muted',muted); toast(muted?'声音已关闭':'声音已打开'); },'关闭声音');
    else if(i === 1) interactive(el,settings,'打开设置');
  });
  addEventListener('keydown',e=>{
    const tag=document.activeElement?.tagName;
    if(e.key==='Escape'&&!dialog.open&&workstation&&document.activeElement!==input)location.href='/static/reception.html';
    if(!workstation && e.key.toLowerCase()==='e' && !dialog.open && !['INPUT','TEXTAREA','SELECT'].includes(tag)) location.href='/static/workstation.html';
    if(!workstation && /^[1-5]$/.test(e.key) && !dialog.open && !['INPUT','TEXTAREA','SELECT'].includes(tag)) setTab(Number(e.key)-1);
  });
  addEventListener('beforeunload',()=>{stopped=true;clearTimeout(reconnectTimer);ws?.close();});
  async function initialize() {
    stopped=false;
    sessionId=localStorage.getItem('clinmind-game-session');
    if(sessionId){try{await refresh();}catch(e){if(e.status!==404)throw e;sessionId=null;localStorage.removeItem('clinmind-game-session');}}
    if(!sessionId){const data=await api('/api/case/start',{case_id:'case_chest_pain_001',student_name:'临床思维训练学员'});sessionId=data.session_id;localStorage.setItem('clinmind-game-session',sessionId);await refresh();}
    if(workstation)setTab(0);
    connect();
  }
  // Keep the visual draft's unknown history consistent with the case engine.
  const history=$('.record-row.history .value');if(history)history.textContent='高血压病史，具体年限与用药待问诊。';
  const familySpeech=$('.speech.family p');if(familySpeech)familySpeech.textContent='他平时有高血压，具体用药情况还需要问他。';
  initialize().catch(e=>toast(`服务连接失败：${e.message}。请使用 start.cmd 启动后访问页面。`,true));
})();
