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
    try {
      const saved = JSON.parse(localStorage.getItem('clinmind-audio') || '{}');
      if (typeof saved.muted === 'boolean') this.isMuted = saved.muted;
      if (typeof saved.volume === 'number' && Number.isFinite(saved.volume)) this.volume = Math.max(0, Math.min(1, saved.volume));
    } catch (_) { /* Storage can be unavailable in private browser sessions. */ }
  }

  _initContext() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this._savePreferences();
    return this.isMuted;
  }

  _savePreferences() {
    try { localStorage.setItem('clinmind-audio', JSON.stringify({muted: this.isMuted, volume: this.volume})); } catch (_) {}
  }

  /**
   * Call from a user gesture (pointerdown/keydown) to satisfy browser
   * autoplay policies — without it the first beeps/alarms stay silent.
   */
  unlock() {
    this._initContext();
    return !!(this.audioCtx && this.audioCtx.state === 'running');
  }

  setVolume(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) this.volume = Math.max(0, Math.min(1, numeric));
    this._savePreferences();
    return this.volume;
  }

  /**
   * Play single QRS contraction beep (pitch scales with SpO2: higher pitch = higher SpO2)
   */
  playQRSBeep(spo2 = 98) {
    if (this.isMuted || this.volume <= 0 || this.audioCtx?.state !== 'running') return;

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
    if (this.isMuted || this.volume <= 0 || this.audioCtx?.state !== 'running') return;

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
