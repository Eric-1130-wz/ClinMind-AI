/**
 * 60fps Real-Time Bedside ECG Lead II & SpO2 Plethysmogram Waveform Renderer.
 * Simulates clinical sweep monitor with realistic P-QRS-T complexes and dicrotic notches.
 */

class ECGCanvasRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    this.width = this.canvas.width;
    this.height = this.canvas.height;

    // Simulation state
    this.hr = 108;
    this.spo2 = 96;
    this.isArrest = false;

    // Sweep cursor position
    this.cursorX = 0;
    this.sweepSpeed = 2.2; // pixels per frame

    // Cardiac cycle phase [0.0, 1.0)
    this.phase = 0.0;
    this.lastQRS = false;

    // Pre-allocated history buffers
    this.lastEcgY = this.height * 0.35;
    this.lastPlethY = this.height * 0.8;

    this.animationId = null;
    this._startLoop();
  }

  updateVitals(hr, spo2, isArrest = false) {
    this.hr = Math.max(0, Math.min(220, hr));
    this.spo2 = Math.max(0, Math.min(100, spo2));
    this.isArrest = isArrest || (this.hr === 0);
  }

  _startLoop() {
    const render = () => {
      this._renderFrame();
      this.animationId = requestAnimationFrame(render);
    };
    this.animationId = requestAnimationFrame(render);
  }

  _renderFrame() {
    if (!this.ctx) return;

    // 1. Clear sweep curtain ahead of cursor (width: 15px)
    const clearWidth = 14;
    this.ctx.fillStyle = '#05080c';
    this.ctx.fillRect(this.cursorX, 0, clearWidth, this.height);

    // Re-draw subtle grid lines in cleared slice
    this.ctx.strokeStyle = 'rgba(0, 255, 102, 0.04)';
    this.ctx.lineWidth = 1;
    for (let y = 0; y < this.height; y += 20) {
      this.ctx.beginPath();
      this.ctx.moveTo(this.cursorX, y);
      this.ctx.lineTo(this.cursorX + clearWidth, y);
      this.ctx.stroke();
    }

    // 2. Advance Cardiac Cycle Phase
    const prevCursorX = this.cursorX;
    this.cursorX += this.sweepSpeed;

    if (this.cursorX >= this.width) {
      this.cursorX = 0;
      this.lastEcgY = this.height * 0.35;
      this.lastPlethY = this.height * 0.8;
    }

    let cycleDurationSec = this.hr > 0 ? (60.0 / this.hr) : 999.0;
    const dt = 1.0 / 60.0; // 60fps nominal
    this.phase += dt / cycleDurationSec;

    let isQRSJustNow = false;
    if (this.phase >= 1.0) {
      this.phase -= 1.0;
    }

    // Detect R-peak for audio beep
    if (this.phase >= 0.14 && this.phase <= 0.17 && !this.lastQRS && !this.isArrest) {
      this.lastQRS = true;
      if (window.monitorAudio) {
        window.monitorAudio.playQRSBeep(this.spo2);
      }
    } else if (this.phase > 0.25) {
      this.lastQRS = false;
    }

    // 3. Compute ECG Waveform Y
    let ecgY = this.height * 0.35;
    if (this.isArrest) {
      // Flatline with micro baseline fluctuation
      ecgY += (Math.random() - 0.5) * 1.5;
    } else {
      ecgY += this._calculateECGAmplitude(this.phase) * (this.height * 0.32);
    }

    // Draw Lead II (Green)
    this.ctx.strokeStyle = '#00ff66';
    this.ctx.lineWidth = 2.0;
    this.ctx.shadowColor = 'rgba(0, 255, 102, 0.7)';
    this.ctx.shadowBlur = 4;
    this.ctx.beginPath();
    this.ctx.moveTo(prevCursorX, this.lastEcgY);
    this.ctx.lineTo(this.cursorX, ecgY);
    this.ctx.stroke();
    this.lastEcgY = ecgY;

    // 4. Compute SpO2 Pleth Waveform Y
    let plethY = this.height * 0.82;
    if (this.isArrest || this.spo2 < 20) {
      plethY += (Math.random() - 0.5) * 1.0;
    } else {
      plethY -= this._calculatePlethAmplitude(this.phase) * (this.height * 0.15);
    }

    // Draw Pleth (Cyan)
    this.ctx.strokeStyle = '#00e5ff';
    this.ctx.lineWidth = 1.8;
    this.ctx.shadowColor = 'rgba(0, 229, 255, 0.6)';
    this.ctx.shadowBlur = 3;
    this.ctx.beginPath();
    this.ctx.moveTo(prevCursorX, this.lastPlethY);
    this.ctx.lineTo(this.cursorX, plethY);
    this.ctx.stroke();
    this.lastPlethY = plethY;

    // Reset shadow
    this.ctx.shadowBlur = 0;
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
