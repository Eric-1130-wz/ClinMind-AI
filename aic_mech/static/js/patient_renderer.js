/**
 * PatientRenderer — 程序化 2D 卡通病人渲染器（无美术资产也能动起来）。
 *
 * 以"人偶 + 行为参数"驱动各病例 animation_states 定义的专属动作：
 * 弯腰角度 / 手部目标 / 颤抖幅度 / 出汗粒子 / 呼吸频率 / 表情 / 道具。
 * 时间基于 rAF delta，任意刷新率下节律稳定。
 *
 * 用法：const r = new PatientRenderer(canvas, {color:'#7a9b7d', gender:'女'});
 *      r.setState('hold_belly_bend');   // 播放该状态（循环或单次）
 *      r.tick(dt 由内部 rAF 驱动)
 */
(function () {
  'use strict';

  // 手部目标位置（相对人偶坐标，比例）
  const HANDS = {
    none: null, nose: { x: 0.13, y: -0.52 }, mouth: { x: 0.15, y: -0.44 },
    belly: { x: 0.02, y: -0.1 }, rlq: { x: 0.2, y: -0.16 }, both_belly: { x: 0.02, y: -0.1, both: true },
    knee: { x: 0.16, y: 0.18 }, head: { x: 0.02, y: -0.58 }, phone: { x: 0.17, y: -0.42 },
    chest: { x: -0.02, y: -0.3 }, fan: { x: 0.22, y: -0.35 }, out: { x: 0.3, y: -0.15 },
    ivpole: { x: 0.34, y: -0.1 }
  };
  // 表情: eyes/mouth 组合
  const FACES = {
    normal: { brow: 0, mouth: 'smile' }, pain: { brow: 1, mouth: 'grit' },
    happy: { brow: 0, mouth: 'laugh' }, dizzy: { brow: 0, mouth: 'wave', eyes: 'dizzy' },
    breathless: { brow: 1, mouth: 'open', eyes: 'squeeze' }, smirk: { brow: 0, mouth: 'smirk' },
    proud: { brow: -1, mouth: 'smile' }, urgent: { brow: 1, mouth: 'open' }
  };
  // 道具绘制开关
  const PROPS = { handkerchief: 1, sketchbook: 1, candy: 1, inhaler: 1, cup: 1, phone: 1, ivpole: 1, TaiChiFan: 1 };

  /** 行为映射：状态id → 动画参数（覆盖 5 病例 + 通用态全部状态） */
  const BEHAVIORS = {
    idle_normal: { bend: 0, breath: 1, face: 'normal', sway: .5 },
    sneeze: { bend: 16, breath: 2.2, face: 'pain', once: 'sneeze', hand: 'nose', prop: 'handkerchief' },
    wipe_nose: { bend: 6, breath: 1.2, face: 'pain', hand: 'nose', prop: 'handkerchief', loopWipe: 1 },
    hot_flush: { bend: 2, breath: 1.3, face: 'urgent', hand: 'head', blush: 1, sweat: .3 },
    chat_gesture: { bend: 0, breath: 1, face: 'happy', hand: 'out', sway: 1.2, once: 'wave' },
    cured_cheer: { bend: 0, breath: 1, face: 'happy', hand: 'out', once: 'wave', bounce: 1 },
    hold_belly_bend: { bend: 34, breath: 1.6, face: 'pain', hand: 'both_belly', sweat: .8 },
    toilet_rush: { bend: 26, breath: 2.4, face: 'pain', hand: 'belly', moveX: 1, once: 'exitrun' },
    nausea_cover_mouth: { bend: 12, breath: 1.8, face: 'pain', hand: 'mouth', heave: 1, sweat: .5 },
    sip_orz_water: { bend: 4, breath: 1.1, face: 'pain', hand: 'mouth', prop: 'cup' },
    cured_thumbsup: { bend: 0, breath: 1, face: 'happy', hand: 'out', once: 'thumbsup' },
    tripod_sit: { bend: 18, breath: 2.6, face: 'breathless', hand: 'knee', bothKnees: 1, shoulders: 1 },
    shoulder_breath: { bend: 10, breath: 3, face: 'breathless', hand: 'knee', shoulders: 1, pursed: 1 },
    use_inhaler: { bend: 2, breath: 2.2, face: 'breathless', hand: 'mouth', prop: 'inhaler', once: 'inhale' },
    anxious_fidget: { bend: 4, breath: 1.4, face: 'urgent', hand: 'none', fidget: 1, lookDown: 1, prop: 'sketchbook', hold: 1 },
    cured_relief: { bend: -4, breath: 1, face: 'happy', hand: 'chest', once: 'deepbreath' },
    cold_sweat_wipe: { bend: 6, breath: 1.5, face: 'pain', hand: 'head', sweat: 1, pale: 1 },
    hand_tremor: { bend: 4, breath: 1.4, face: 'urgent', hand: 'out', tremor: 1, bothHands: 1, pale: 1 },
    sway_dizzy: { bend: 8, breath: 1.2, face: 'dizzy', hand: 'none', sway: 3, sweat: 1, pale: 1 },
    eat_candy: { bend: 2, breath: 1.2, face: 'pain', hand: 'mouth', prop: 'candy', once: 'chew' },
    cured_pat_chest: { bend: 0, breath: 1, face: 'proud', hand: 'chest', once: 'pat', prop: 'none' },
    guard_rlq_bend: { bend: 30, breath: 1.5, face: 'pain', hand: 'rlq', sweat: .8 },
    rebound_flinch: { bend: 20, breath: 2, face: 'pain', hand: 'rlq', once: 'flinch', sweat: 1 },
    walking_hunched: { bend: 24, breath: 1.4, face: 'pain', hand: 'rlq', moveX: .5, walkLegs: 1, sweat: .6 },
    phone_anxious: { bend: 8, breath: 1.3, face: 'urgent', hand: 'phone', prop: 'phone', tremor: .5 },
    postop_recovery: { bend: 10, breath: 1, face: 'smirk', hand: 'ivpole', prop: 'ivpole', walkLegs: .6 },
    cured_relax: { bend: -2, breath: 1, face: 'happy', hand: 'none', once: 'stretch' },
    // 隐藏病例（孙建国）通用态
    agony_chest: { bend: 12, breath: 2.6, face: 'pain', hand: 'chest', sweat: 1 },
    unconscious: { bend: 55, breath: .3, face: 'dizzy', hand: 'none' }
  };

  const DEFAULTS = { bend: 0, breath: 1, face: 'normal', sway: .5 };

  class PatientRenderer {
    constructor(canvas, opts = {}) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = Object.assign({ color: '#7a9b7d', gender: '女', age: 40 }, opts);
      this.t = 0;                 // 状态内时间(秒)
      this.state = null;
      this.beh = DEFAULTS;
      this.sweatDrops = [];
      this._loop = this._loop.bind(this);
      this._lastTs = null;
      this.onFrame = null;        // 每帧回调（情绪浮标等）
      requestAnimationFrame(this._loop);
    }

    setLook(opts) { Object.assign(this.opts, opts); }

    setState(id, oneshotDone) {
      if (this.state === id) return;
      this.state = id;
      this.beh = Object.assign({}, DEFAULTS, BEHAVIORS[id] || {});
      this.t = 0;
      this._oneshotDone = false;
      this._oneshotDoneCb = oneshotDone;
    }

    _loop(ts) {
      let dt = 1 / 60;
      if (this._lastTs != null) dt = Math.min(0.1, Math.max(0, (ts - this._lastTs) / 1000));
      this._lastTs = ts;
      this.t += dt;
      this._draw(dt);
      requestAnimationFrame(this._loop);
    }

    /* ---------- 绘制 ---------- */
    _draw(dt) {
      const c = this.ctx, W = this.cv.width, H = this.cv.height;
      const b = this.beh;
      c.clearRect(0, 0, W, H);

      // 摇摆 / 移动偏移
      const sway = Math.sin(this.t * (1.5 * b.sway)) * 4 * b.sway;
      let ox = Math.sin(this.t * .6) * 3;
      if (b.moveX) ox += Math.sin(this.t * 2.2) * 26 * b.moveX;
      const cx = W / 2 + ox, groundY = H * .93;
      const scale = H / 300;                      // 人偶基准高 300
      const breathAmp = 3.5 * b.breath;
      const breathe = Math.sin(this.t * (1.8 * b.breath)) * breathAmp;
      const bend = (b.bend * Math.PI / 180) * (1 + Math.sin(this.t * 1.2) * .06);
      const tremor = b.tremor ? Math.sin(this.t * 26) * 2.2 * (b.tremor === 1 ? 1 : b.tremor) : 0;

      c.save();
      c.translate(cx + sway + tremor, groundY);
      c.rotate(bend * .35);                       // 整体前倾

      const S = scale;
      const bodyColor = this.opts.color;
      const skin = this.opts.pale || b.pale ? '#e8cdb8' : '#f2c9a6';

      // 腿（走动时的摆动）
      const legSwing = b.walkLegs ? Math.sin(this.t * 6) * .35 * b.walkLegs : 0;
      this._limb(c, S, -6 * S, 0, 62 * S, legSwing, '#5a6b78', 7 * S);
      this._limb(c, S, 6 * S, 0, 62 * S, -legSwing, '#4c5d6a', 7 * S);
      // 躯干
      const torsoH = 92 * S;
      const torsoW = 40 * S;
      c.fillStyle = bodyColor;
      this._rrect(c, -torsoW / 2, -torsoH - 62 * S + breathe, torsoW, torsoH + breathe, 12 * S);
      // 裙装（女性年长角色）
      if (this.opts.gender === '女' && this.opts.age >= 50) {
        c.fillStyle = bodyColor;
        c.beginPath();
        c.moveTo(-torsoW * .75, -70 * S); c.lineTo(torsoW * .75, -70 * S);
        c.lineTo(torsoW * .55, -30 * S); c.lineTo(-torsoW * .55, -30 * S); c.closePath(); c.fill();
      }
      // 头
      const headY = -torsoH - 62 * S - 26 * S + breathe * .6;
      const headR = 24 * S;
      c.fillStyle = skin;
      c.beginPath(); c.arc(0, headY, headR, 0, Math.PI * 2); c.fill();
      // 头发
      c.fillStyle = this.opts.hair || '#4a443c';
      c.beginPath(); c.arc(0, headY - 3 * S, headR * 1.02, Math.PI * .95, Math.PI * 2.05); c.fill();
      if (this.opts.gender === '女') { // 两侧发
        c.beginPath(); c.ellipse(-headR * .92, headY + 6 * S, 6 * S, 16 * S, 0, 0, 7); c.fill();
        c.beginPath(); c.ellipse(headR * .92, headY + 6 * S, 6 * S, 16 * S, 0, 0, 7); c.fill();
      }
      if ((this.opts.age || 0) >= 60) { c.fillStyle = '#cfcac0'; c.beginPath(); c.arc(0, headY - 12 * S, 9 * S, 0, 7); c.fill(); }

      // 表情
      this._face(c, S, headY, headR, b.face, this.t, b);
      // 腮红（发热）
      if (b.blush) {
        c.fillStyle = '#f0999966';
        c.beginPath(); c.ellipse(-headR * .55, headY + 6 * S, 6 * S, 4 * S, 0, 0, 7); c.fill();
        c.beginPath(); c.ellipse(headR * .55, headY + 6 * S, 6 * S, 4 * S, 0, 0, 7); c.fill();
      }

      // 手臂
      const shoulderY = -torsoH - 56 * S + breathe;
      const hand = b.hand ? HANDS[b.hand] : null;
      const hipY = -60 * S;
      const wig = b.loopWipe ? Math.sin(this.t * 7) * 5 * S : (b.fidget ? Math.sin(this.t * 9) * 4 * S : 0);
      if (hand && hand.both) { // 双手捧腹
        this._arm(c, S, -18 * S, shoulderY, hand.x * S - 12 * S, hipY + hand.y * S, skin);
        this._arm(c, S, 18 * S, shoulderY, hand.x * S + 12 * S, hipY + hand.y * S, skin);
      } else if (b.bothHands) { // 双手平举（手抖）
        this._arm(c, S, -18 * S, shoulderY, -30 * S + tremor * 2, shoulderY + 26 * S, skin);
        this._arm(c, S, 18 * S, shoulderY, 30 * S + tremor * 2, shoulderY + 26 * S, skin);
      } else {
        this._arm(c, S, -18 * S, shoulderY, (hand ? hand.x * S : -26 * S) + wig, hipY + (hand ? hand.y * S : 8 * S), skin);
        this._arm(c, S, 18 * S, shoulderY, 24 * S + sway * .4, hipY + 6 * S, skin);
      }
      if (b.shoulders) { // 耸肩（呼吸辅助肌）
        c.fillStyle = bodyColor;
        c.beginPath(); c.ellipse(-20 * S, shoulderY - 4 * S + Math.abs(breathe) * .8, 9 * S, 6 * S, 0, 0, 7); c.fill();
        c.beginPath(); c.ellipse(20 * S, shoulderY - 4 * S + Math.abs(breathe) * .8, 9 * S, 6 * S, 0, 0, 7); c.fill();
      }
      // 道具
      if (b.prop && PROPS[b.prop]) this._prop(c, S, b.prop, hand, hipY, shoulderY, this.t);

      // 一次性动作特效
      if (b.once && !this._oneshotDone) this._oneshot(c, S, b.once, headY, this.t);
      if (b.once && this.t > 0.9 && !this._oneshotDone) {
        this._oneshotDone = true;
        if (this._oneshotDoneCb) this._oneshotDoneCb();
      }
      c.restore();

      // 汗滴粒子
      if (b.sweat) this._sweat(c, dt, b.sweat, cx, groundY - 190 * S);
      if (this.onFrame) this.onFrame(b);
    }

    _limb(c, S, x1, y1, len, swing, color, w) {
      c.save(); c.translate(x1, y1); c.rotate(swing * .3);
      c.fillStyle = color; this._rrect(c, -w / 2, 0, w, len, w / 2);
      c.fillStyle = '#3b3f45'; this._rrect(c, -w * .8, len - 4 * S, w * 1.6, 8 * S, 3 * S); // 鞋
      c.restore();
    }
    _arm(c, S, x1, y1, x2, y2, skin) {
      c.strokeStyle = skin; c.lineWidth = 8 * S; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x1, y1);
      const mx = (x1 + x2) / 2 + 10 * S, my = (y1 + y2) / 2 + 6 * S;
      c.quadraticCurveTo(mx, my, x2, y2); c.stroke();
    }
    _rrect(c, x, y, w, h, r) {
      c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); c.fill();
    }
    _face(c, S, headY, R, faceId, t, b) {
      const f = FACES[faceId] || FACES.normal;
      const ey = headY - 2 * S;
      c.fillStyle = '#3a352f';
      if (f.eyes === 'dizzy') {
        c.strokeStyle = '#3a352f'; c.lineWidth = 1.6 * S;
        [[-R * .38], [R * .38]].forEach(([ex]) => {
          c.beginPath(); c.moveTo(ex - 3 * S, ey - 3 * S); c.lineTo(ex + 3 * S, ey + 3 * S);
          c.moveTo(ex + 3 * S, ey - 3 * S); c.lineTo(ex - 3 * S, ey + 3 * S); c.stroke();
        });
      } else if (f.eyes === 'squeeze') {
        c.beginPath(); c.moveTo(-R * .5, ey); c.lineTo(-R * .24, ey - 2 * S);
        c.moveTo(R * .5, ey); c.lineTo(R * .24, ey - 2 * S); c.lineWidth = 2 * S; c.stroke();
      } else {
        c.beginPath(); c.ellipse(-R * .36, ey, 2.6 * S, 3.2 * S, 0, 0, 7); c.fill();
        c.beginPath(); c.ellipse(R * .36, ey, 2.6 * S, 3.2 * S, 0, 0, 7); c.fill();
      }
      // 眉
      if (f.brow) {
        c.strokeStyle = '#3a352f'; c.lineWidth = 1.8 * S;
        c.beginPath(); c.moveTo(-R * .5, ey - 7 * S); c.lineTo(-R * .2, ey - 5 * S);
        c.moveTo(R * .5, ey - 7 * S); c.lineTo(R * .2, ey - 5 * S); c.stroke();
      }
      // 嘴
      c.strokeStyle = '#8a5a4a'; c.lineWidth = 2 * S; c.fillStyle = '#8a5a4a';
      const my = headY + R * .38;
      c.beginPath();
      switch (f.mouth) {
        case 'smile': c.arc(0, my - 2 * S, 6 * S, .25 * Math.PI, .75 * Math.PI); break;
        case 'laugh': c.arc(0, my - 3 * S, 8 * S, .15 * Math.PI, .85 * Math.PI); c.fillStyle = '#7a4038'; c.fill(); break;
        case 'grit': c.moveTo(-7 * S, my); c.lineTo(7 * S, my); c.moveTo(-4 * S, my); c.lineTo(-4 * S, my + 2.6 * S); c.moveTo(4 * S, my); c.lineTo(4 * S, my + 2.6 * S); break;
        case 'open': c.ellipse(0, my, 4.4 * S, 5.5 * S, 0, 0, 7); c.fillStyle = '#7a4038'; c.fill(); break;
        case 'wave': c.moveTo(-6 * S, my + Math.sin(t * 8) * 2 * S); c.quadraticCurveTo(0, my + 3 * S, 6 * S, my + Math.sin(t * 8 + 1) * 2 * S); break;
        case 'smirk': c.moveTo(-6 * S, my); c.quadraticCurveTo(2 * S, my + 4 * S, 7 * S, my - 2 * S); break;
        default: c.moveTo(-5 * S, my); c.lineTo(5 * S, my);
      }
      c.stroke();
      // 缩唇呼吸（哮喘）
      if (b.pursed) { c.fillStyle = '#e08d7a'; c.beginPath(); c.ellipse(0, my, 3 * S, 2.4 * S, 0, 0, 7); c.fill(); }
    }
    _prop(c, S, prop, hand, hipY, shoulderY, t) {
      const px = hand ? hand.x * S : 26 * S, py = hipY + (hand ? hand.y * S : 8 * S);
      c.save(); c.translate(px, py);
      switch (prop) {
        case 'handkerchief': c.fillStyle = '#f6f2e2'; this._rrect(c, -6 * S, -6 * S, 12 * S, 12 * S, 2 * S); c.fillStyle = '#d9a3a3'; c.fillRect(-3 * S, -3 * S, 6 * S, 6 * S); break;
        case 'sketchbook': c.fillStyle = '#c98d5e'; this._rrect(c, -9 * S, -11 * S, 18 * S, 22 * S, 2 * S); c.fillStyle = '#fdf8e8'; c.fillRect(-6.5 * S, -8 * S, 13 * S, 17 * S); c.strokeStyle = '#b9c4a8'; c.beginPath(); c.moveTo(-4 * S, -4 * S); c.quadraticCurveTo(0, -8 * S, 5 * S, -2 * S); c.stroke(); break;
        case 'candy': c.fillStyle = '#e8b64c'; c.beginPath(); c.arc(0, 0, 4 * S, 0, 7); c.fill(); c.fillStyle = '#f6d98a'; c.beginPath(); c.moveTo(-4 * S, 0); c.lineTo(-9 * S, -4 * S); c.lineTo(-9 * S, 4 * S); c.closePath(); c.fill(); break;
        case 'inhaler': c.fillStyle = '#5b8fa8'; this._rrect(c, -3.4 * S, -8 * S, 7 * S, 15 * S, 2 * S); c.fillStyle = '#dfeaf0'; c.fillRect(-2 * S, -8 * S, 4 * S, 4 * S); break;
        case 'cup': c.fillStyle = '#eef1e4'; this._rrect(c, -6 * S, -7 * S, 12 * S, 13 * S, 2 * S); c.strokeStyle = '#b9c4a8'; c.beginPath(); c.moveTo(-4 * S, -4 * S); c.lineTo(4 * S, -4 * S); c.stroke(); break;
        case 'phone': c.fillStyle = '#2f3a40'; this._rrect(c, -4.4 * S, -7 * S, 9 * S, 15 * S, 2 * S); c.fillStyle = '#9fd8c0'; c.fillRect(-3 * S, -5.4 * S, 6 * S, 10 * S); break;
        case 'ivpole': c.strokeStyle = '#9aa796'; c.lineWidth = 2.4 * S; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -150 * S); c.stroke(); c.fillStyle = '#cfe3d5'; c.beginPath(); c.arc(0, -156 * S, 10 * S, 0, 7); c.fill(); c.strokeStyle = '#9aa796'; c.beginPath(); c.moveTo(-10 * S, -156 * S); c.lineTo(10 * S, -156 * S); c.stroke(); break;
      }
      c.restore();
    }
    _oneshot(c, S, kind, headY, t) {
      const p = Math.min(1, t / .8);
      c.save();
      switch (kind) {
        case 'sneeze': {
          c.strokeStyle = '#ffffffaa'; c.lineWidth = 1.6 * S;
          for (let i = 0; i < 5; i++) { const a = -0.5 + i * .3; const r0 = 14 * S + p * 20 * S;
            c.beginPath(); c.moveTo(Math.cos(a) * r0, headY + Math.sin(a) * r0 * .6 + 10 * S);
            c.lineTo(Math.cos(a) * (r0 + 10 * S), headY + Math.sin(a) * (r0 + 10 * S) * .6 + 10 * S); c.stroke(); }
          break; }
        case 'wave': case 'thumbsup': case 'pat': case 'stretch': case 'deepbreath': {
          c.fillStyle = '#f2c14e';
          for (let i = 0; i < 3; i++) { const a = t * 4 + i * 2.1; const r = 26 * S + Math.sin(t * 6) * 3 * S;
            c.beginPath(); c.arc(Math.cos(a) * r, headY - 18 * S + Math.sin(a) * r * .4, 2.4 * S, 0, 7); c.fill(); }
          if (kind === 'thumbsup') { c.font = `${13 * S}px sans-serif`; c.fillText('👍', 20 * S, -120 * S - Math.sin(t * 5) * 4 * S); }
          break; }
        case 'flinch': {
          c.strokeStyle = '#e2695c'; c.lineWidth = 2 * S;
          const r = 20 * S + p * 16 * S;
          c.beginPath(); c.arc(14 * S, -80 * S, r, .6, 2.4); c.stroke();
          if (p < .5) { c.font = `${11 * S}px sans-serif`; c.fillStyle = '#e2695c'; c.fillText('💢', 6 * S, headY - 20 * S); }
          break; }
        case 'chew': { c.font = `${10 * S}px sans-serif`; c.fillStyle = '#c98d5e'; c.fillText('🍬', -22 * S, headY + 4 * S); break; }
        case 'inhale': {
          c.strokeStyle = '#9fd8c0'; c.lineWidth = 2 * S;
          for (let i = 0; i < 3; i++) { const yy = headY + 8 * S + i * 7 * S - p * 10 * S;
            c.beginPath(); c.moveTo(26 * S, yy); c.quadraticCurveTo(38 * S, yy - 5 * S, 50 * S, yy); c.stroke(); }
          break; }
      }
      c.restore();
    }
    _sweat(c, dt, rate, cx, y) {
      if (Math.random() < rate * dt * 6 && this.sweatDrops.length < 14) {
        this.sweatDrops.push({ x: (Math.random() - .5) * 34, y: y, v: 30 + Math.random() * 40 });
      }
      c.fillStyle = '#8fc3e8';
      this.sweatDrops = this.sweatDrops.filter(d => d.y < y + 60);
      this.sweatDrops.forEach(d => {
        d.y += d.v * dt;
        c.beginPath(); c.ellipse(cx + d.x, d.y, 2.2, 3.4, 0, 0, 7); c.fill();
      });
    }
  }

  window.PatientRenderer = PatientRenderer;
})();
