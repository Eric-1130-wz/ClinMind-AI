/**
 * GameECG — 游戏诊室内的迷你心电监护波形。
 *
 * 与病例联动：HR/节律来自当前生命体征与病例 rhythm 标签；
 * 时间基于 rAF delta，任意刷新率下扫速稳定（25mm/s @ 4px/mm = 100px/s）。
 * 支持危急红闪（恶化事件时）与停搏直线。
 */
(function () {
  'use strict';

  const RHYTHM_PROFILE = {
    '窦性心律': { rAmp: 1.0, tAmp: 1.0, noise: .06 },
    '窦性心律（稍快）': { rAmp: 1.05, tAmp: 1.0, noise: .08 },
    '窦性心动过速': { rAmp: .92, tAmp: .85, noise: .1 },
    'default': { rAmp: 1.0, tAmp: 1.0, noise: .06 }
  };

  class GameECG {
    constructor(canvas) {
      this.cv = canvas; this.ctx = canvas.getContext('2d');
      this.hr = 88; this.arrest = false; this.alert = false;
      this.phase = 0; this.cursor = 0; this.lastY = 0; this.lastTs = null;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 288, h = canvas.clientHeight || 70;
      canvas.width = w * dpr; canvas.height = h * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = w; this.H = h; this.lastY = h * .5;
      this.profile = RHYTHM_PROFILE['default'];
      const loop = (ts) => {
        let dt = 1 / 60;
        if (this.lastTs != null) dt = Math.min(.25, Math.max(0, (ts - this.lastTs) / 1000));
        this.lastTs = ts;
        this._frame(dt);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    setVitals(hr, rhythmLabel, opts = {}) {
      this.hr = Math.max(0, Math.min(220, hr));
      this.arrest = !!opts.arrest;
      this.alert = !!opts.alert;
      const key = String(rhythmLabel || '').trim();
      this.profile = RHYTHM_PROFILE[key] || RHYTHM_PROFILE['default'];
      if (opts.tachyBoost) this.profile = Object.assign({}, this.profile, { rAmp: this.profile.rAmp * .95 });
    }

    _frame(dt) {
      const c = this.ctx, W = this.W, H = this.H;
      const speed = 100;                       // px/s，25mm/s@4px/mm
      const prev = this.cursor;
      let next = prev + speed * dt;
      let wrapped = false;
      if (next >= W) { next = 0; wrapped = true; }
      this.cursor = next;

      // 危急红闪底色
      if (this.alert) {
        const flash = .12 + Math.abs(Math.sin(performance.now() / 300)) * .16;
        c.fillStyle = `rgba(226,80,70,${flash})`;
        c.fillRect(0, 0, W, H);
      }
      // 清扫窗帘
      c.fillStyle = '#0e2321';
      c.fillRect(this.cursor, 0, 14, H);
      c.strokeStyle = 'rgba(80,220,170,.07)';
      for (let y = 0; y < H; y += 12) {
        c.beginPath(); c.moveTo(this.cursor, y); c.lineTo(this.cursor + 14, y); c.stroke();
      }

      const cyc = this.hr > 0 ? 60 / this.hr : 999;
      this.phase = (this.phase + dt / cyc) % 1;
      let y = H * .5;
      if (this.arrest) {
        y += (Math.random() - .5) * 1.6;
      } else {
        y += this._wave(this.phase) * (H * .38);
      }
      if (!wrapped) {
        c.strokeStyle = this.alert ? '#ff6a5c' : '#39e6a3';
        c.lineWidth = 1.8;
        c.shadowColor = this.alert ? 'rgba(255,106,92,.8)' : 'rgba(57,230,163,.55)';
        c.shadowBlur = 4;
        c.beginPath(); c.moveTo(prev, this.lastY); c.lineTo(this.cursor, y); c.stroke();
        c.shadowBlur = 0;
      }
      this.lastY = y;
    }

    _wave(p) {
      const pr = this.profile, n = pr.noise;
      if (p < .08) return (Math.random() - .5) * n;
      if (p < .12) return -Math.sin((p - .08) / .04 * Math.PI) * .16;          // P
      if (p < .135) return 0;
      if (p < .148) return Math.sin((p - .135) / .013 * Math.PI) * .13;        // Q
      if (p < .172) return -Math.sin((p - .148) / .024 * Math.PI) * pr.rAmp;   // R
      if (p < .19) return Math.sin((p - .172) / .018 * Math.PI) * .28;         // S
      if (p < .28) return 0;
      if (p < .44) return -Math.sin((p - .28) / .16 * Math.PI) * .26 * pr.tAmp; // T
      return (Math.random() - .5) * n;
    }
  }

  window.GameECG = GameECG;
})();
