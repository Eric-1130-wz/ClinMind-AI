/**
 * Real-Time Bedside ECG Lead II / SpO2 Plethysmogram / Respiration Waveform Renderer.
 *
 * Timing is driven by requestAnimationFrame timestamps (delta-time), so heart rate,
 * sweep speed and respiration rate stay accurate on ANY refresh rate (60/120/144Hz+).
 * Backing stores are scaled by devicePixelRatio for crisp high-DPI rendering.
 *
 * Clinical sweep convention: 25 mm/s at 4 px/mm = 100 logical px per second.
 */

class ECGCanvasRenderer {
  constructor(canvasId, respiratoryCanvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    this.respCanvas = respiratoryCanvasId ? document.getElementById(respiratoryCanvasId) : null;
    this.respCtx = this.respCanvas ? this.respCanvas.getContext('2d') : null;

    // Logical (CSS pixel) dimensions; backing store is CSS size × devicePixelRatio.
    this.width = 0;
    this.height = 0;
    this.respWidth = 0;
    this.respHeight = 0;

    // Simulation state
    this.hr = 108;
    this.spo2 = 96;
    this.rr = 20;
    this.isArrest = false;

    // Sweep cursor (logical px) and clinical sweep speed.
    this.cursorX = 0;
    this.sweepSpeed = 100; // px per second (25 mm/s @ 4 px/mm)
    this.clearWidth = 14;

    // Cardiac / respiratory cycle phase in [0, 1)
    this.phase = 0.0;
    this.respPhase = 0.0;
    this.lastQRS = false;

    // Last drawn sample points (logical px)
    this.lastEcgY = 0;
    this.lastPlethY = 0;
    this.lastRespY = 0;

    this.animationId = null;
    this.lastTimestamp = null;

    this._resize();
    this._startLoop();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
  }

  /** Fit canvas backing stores to their CSS size × devicePixelRatio. */
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const fit = (canvas, ctx) => {
      if (!canvas || !ctx) return null;
      const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || canvas.width;
      const cssH = canvas.clientHeight || canvas.height;
      if (cssW <= 0 || cssH <= 0) return null;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#05080c';
      ctx.fillRect(0, 0, cssW, cssH);
      return { w: cssW, h: cssH };
    };

    const main = fit(this.canvas, this.ctx);
    if (main) {
      this.width = main.w;
      this.height = main.h;
      this.lastEcgY = this.height * 0.35;
      this.lastPlethY = this.height * 0.82;
    }
    const resp = fit(this.respCanvas, this.respCtx);
    if (resp) {
      this.respWidth = resp.w;
      this.respHeight = resp.h;
      this.lastRespY = this.respHeight * 0.55;
    }
  }

  /** Stop the animation loop and release listeners (for SPA teardown). */
  destroy() {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    this.animationId = null;
    if (this._onResize) window.removeEventListener('resize', this._onResize);
  }

  updateVitals(hr, spo2, isArrest = false, rr) {
    this.hr = Math.max(0, Math.min(220, hr));
    this.spo2 = Math.max(0, Math.min(100, spo2));
    this.isArrest = isArrest || (this.hr === 0);
    if (Number.isFinite(rr)) {
      this.rr = Math.max(0, Math.min(60, rr));
    }
  }

  _startLoop() {
    const render = (timestamp) => {
      // Delta time from the rAF clock: refresh-rate independent. Clamp dt so a
      // backgrounded tab resuming after seconds of sleep does not fast-forward.
      let dt = 1 / 60;
      if (this.lastTimestamp !== null) {
        dt = (timestamp - this.lastTimestamp) / 1000;
        dt = Math.max(0, Math.min(dt, 0.25));
      }
      this.lastTimestamp = timestamp;

      this._renderFrame(dt);
      this.animationId = requestAnimationFrame(render);
    };
    this.animationId = requestAnimationFrame(render);
  }

  _renderFrame(dt) {
    if (!this.ctx || this.width === 0) return;

    // 1. Advance sweep cursor by real elapsed time. On wrap, draw the trailing
    //    segment to the right edge and continue from the left on the next frame.
    const prevCursorX = this.cursorX;
    let nextX = this.cursorX + this.sweepSpeed * dt;
    let wrapped = false;
    if (nextX >= this.width) {
      nextX = 0;
      wrapped = true;
    }
    this.cursorX = nextX;
    const segEnd = wrapped ? this.width : this.cursorX;

    // 2. Clear the sweep curtain ahead of the cursor and redraw grid in the slice.
    this._clearSlice(this.ctx, this.cursorX, this.height);

    // 3. Advance cardiac cycle phase using true delta time.
    const cycleDurationSec = this.hr > 0 ? (60.0 / this.hr) : 999.0;
    this.phase = (this.phase + dt / cycleDurationSec) % 1.0;

    // Detect R-peak for audio beep
    if (this.phase >= 0.14 && this.phase <= 0.17 && !this.lastQRS && !this.isArrest) {
      this.lastQRS = true;
      if (window.monitorAudio) {
        window.monitorAudio.playQRSBeep(this.spo2);
      }
    } else if (this.phase > 0.25) {
      this.lastQRS = false;
    }

    // 4. Compute ECG waveform Y
    let ecgY = this.height * 0.35;
    if (this.isArrest) {
      // Flatline with micro baseline fluctuation
      ecgY += (Math.random() - 0.5) * 1.5;
    } else {
      ecgY += this._calculateECGAmplitude(this.phase) * (this.height * 0.32);
    }

    // Draw Lead II (Green). On wrap, skip the bridge line across the screen.
    if (!wrapped) {
      this.ctx.strokeStyle = '#00ff66';
      this.ctx.lineWidth = 2.0;
      this.ctx.shadowColor = 'rgba(0, 255, 102, 0.7)';
      this.ctx.shadowBlur = 4;
      this.ctx.beginPath();
      this.ctx.moveTo(prevCursorX, this.lastEcgY);
      this.ctx.lineTo(this.cursorX, ecgY);
      this.ctx.stroke();
    } else {
      this.ctx.strokeStyle = '#00ff66';
      this.ctx.shadowColor = 'rgba(0, 255, 102, 0.7)';
      this.ctx.shadowBlur = 4;
    }
    this.lastEcgY = ecgY;

    // 5. Compute SpO2 Pleth waveform Y
    let plethY = this.height * 0.82;
    if (this.isArrest || this.spo2 < 20) {
      plethY += (Math.random() - 0.5) * 1.0;
    } else {
      plethY -= this._calculatePlethAmplitude(this.phase) * (this.height * 0.15);
    }

    // Draw Pleth (Cyan)
    if (!wrapped) {
      this.ctx.strokeStyle = '#00e5ff';
      this.ctx.lineWidth = 1.8;
      this.ctx.shadowColor = 'rgba(0, 229, 255, 0.6)';
      this.ctx.shadowBlur = 3;
      this.ctx.beginPath();
      this.ctx.moveTo(prevCursorX, this.lastPlethY);
      this.ctx.lineTo(this.cursorX, plethY);
      this.ctx.stroke();
    } else {
      this.ctx.strokeStyle = '#00e5ff';
      this.ctx.shadowColor = 'rgba(0, 229, 255, 0.6)';
      this.ctx.shadowBlur = 3;
    }
    this.lastPlethY = plethY;

    // Reset shadow
    this.ctx.shadowBlur = 0;

    // 6. Respiration trace on its own canvas (same time base and sweep cursor).
    this._renderRespiration(dt, prevCursorX, wrapped);
  }

  _renderRespiration(dt, prevCursorX, wrapped) {
    if (!this.respCtx || this.respWidth === 0) return;

    this._clearSlice(this.respCtx, Math.min(this.cursorX, this.respWidth), this.respHeight);

    const cycleSec = this.rr > 0 ? (60.0 / this.rr) : 999.0;
    this.respPhase = (this.respPhase + dt / cycleSec) % 1.0;

    let respY = this.respHeight * 0.55;
    if (this.isArrest || this.rr <= 0) {
      respY += (Math.random() - 0.5) * 0.8;
    } else {
      respY -= Math.sin(this.respPhase * 2 * Math.PI) * (this.respHeight * 0.30);
    }

    if (!wrapped) {
      this.respCtx.strokeStyle = '#e2e8f0';
      this.respCtx.lineWidth = 1.6;
      this.respCtx.shadowColor = 'rgba(226, 232, 240, 0.5)';
      this.respCtx.shadowBlur = 2;
      this.respCtx.beginPath();
      this.respCtx.moveTo(prevCursorX, this.lastRespY);
      this.respCtx.lineTo(this.cursorX, respY);
      this.respCtx.stroke();
      this.respCtx.shadowBlur = 0;
    }
    this.lastRespY = respY;
  }

  _clearSlice(ctx, cursorX, height) {
    ctx.fillStyle = '#05080c';
    ctx.fillRect(cursorX, 0, this.clearWidth, height);
    ctx.strokeStyle = 'rgba(0, 255, 102, 0.04)';
    ctx.lineWidth = 1;
    for (let y = 0; y < height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(cursorX, y);
      ctx.lineTo(cursorX + this.clearWidth, y);
      ctx.stroke();
    }
  }

  _calculateECGAmplitude(phase) {
    // Mathematical P-Q-R-S-T curve synthesis
    // Normal normalized cycle:
    // 0.00 - 0.08: Isoelectric
    // 0.08 - 0.12: P wave (atrial depolarization)
    // 0.12 - 0.14: PR segment
    // 0.14 - 0.15: Q wave (septal depolarization, small negative deflection)
    // 0.15 - 0.17: R peak (ventricular depolarization, sharp tall spike)
    // 0.17 - 0.19: S wave (negative deflection)
    // 0.19 - 0.28: ST segment
    // 0.28 - 0.42: T wave (ventricular repolarization)
    // 0.42 - 1.00: TP baseline

    if (phase >= 0.08 && phase < 0.12) {
      const pT = (phase - 0.08) / 0.04;
      return -Math.sin(pT * Math.PI) * 0.18; // P wave
    } else if (phase >= 0.135 && phase < 0.148) {
      const qT = (phase - 0.135) / 0.013;
      return Math.sin(qT * Math.PI) * 0.15; // Q dip
    } else if (phase >= 0.148 && phase < 0.172) {
      const rT = (phase - 0.148) / 0.024;
      return -Math.sin(rT * Math.PI) * 1.0; // Tall R spike
    } else if (phase >= 0.172 && phase < 0.190) {
      const sT = (phase - 0.172) / 0.018;
      return Math.sin(sT * Math.PI) * 0.32; // S dip
    } else if (phase >= 0.28 && phase < 0.44) {
      const tT = (phase - 0.28) / 0.16;
      return -Math.sin(tT * Math.PI) * 0.28; // T wave
    }

    return 0.0;
  }

  _calculatePlethAmplitude(phase) {
    // Dicrotic notch waveform
    const p = (phase + 0.8) % 1.0; // shifted slightly relative to R peak
    if (p < 0.3) {
      return Math.sin((p / 0.3) * (Math.PI / 2));
    } else if (p < 0.45) {
      const down = (p - 0.3) / 0.15;
      return Math.cos(down * (Math.PI / 4)) * 0.85;
    } else if (p < 0.55) {
      // Dicrotic notch reflection bump
      const notch = (p - 0.45) / 0.1;
      return 0.65 + Math.sin(notch * Math.PI) * 0.15;
    } else {
      const decay = (p - 0.55) / 0.45;
      return Math.max(0, 0.65 * (1 - decay * 0.9));
    }
  }
}

window.ECGCanvasRenderer = ECGCanvasRenderer;
