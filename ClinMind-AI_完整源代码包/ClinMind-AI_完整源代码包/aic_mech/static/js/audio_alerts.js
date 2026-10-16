/**
 * Web Audio API Bedside Monitor Sound Synthesizer.
 * Synthesizes realistic ECG QRS beeps and critical medical alarms with zero audio files.
 */

class MonitorAudioAlerts {
  constructor() {
    this.audioCtx = null;
    this.isMuted = false;
    this.volume = 0.08;
    this.lastBeepTime = 0;
  }

  _initContext() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }

  setVolume(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) this.volume = Math.max(0, Math.min(1, numeric));
    return this.volume;
  }

  /**
   * Play single QRS contraction beep (pitch scales with SpO2: higher pitch = higher SpO2)
   */
  playQRSBeep(spo2 = 98) {
    if (this.isMuted) return;
    this._initContext();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      // Pitch calculation: 90% SpO2 ~ 700Hz, 100% SpO2 ~ 950Hz
      const freq = Math.max(400, Math.min(1200, 600 + (spo2 - 80) * 18));
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(this.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.09);
    } catch (e) {
      // Audio context error ignore
    }
  }

  /**
   * Play IEC 60601-1-8 style high priority medical critical alarm sound pattern
   */
  playCriticalAlarm() {
    if (this.isMuted) return;
    this._initContext();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const notes = [900, 900, 900]; // 3 quick pulses
      notes.forEach((freq, idx) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        const start = now + idx * 0.12;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(Math.min(1, this.volume * 1.5), start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.08);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(start);
        osc.stop(start + 0.09);
      });
    } catch (e) {
      // Audio context error ignore
    }
  }
}

window.monitorAudio = new MonitorAudioAlerts();
