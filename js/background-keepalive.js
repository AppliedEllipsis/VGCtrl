/**
 * Background Keepalive System
 *
 * Prevents Chrome from pausing Web Bluetooth connections when tab is hidden.
 * Uses a minimal set of effective techniques to avoid memory pressure.
 *
 * Techniques:
 * 1. Wake Lock API - keeps screen on (essential)
 * 2. Web Worker - runs timer in separate thread (lightweight, effective)
 * 3. Silent Audio - keeps audio context alive (sub-20Hz, zero gain = truly silent)
 * 4. Gentle keepalive ping - only when hidden (4 second interval)
 */

class BackgroundKeepalive {
  constructor(options = {}) {
    this.onKeepaliveTick = options.onKeepaliveTick || (() => {});
    this.onWarn = options.onWarn || (() => {});

    this.isRunning = false;
    this.worker = null;
    this.workerUrl = null;
    this.audioContext = null;
    this.silentOscillator = null;
    this.wakeLock = null;
    this._pingInterval = null;

    this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('[Keepalive] Starting lightweight background keepalive');

    this._startWorker();
    this._startSilentAudio();
    this._acquireWakeLock();

    document.addEventListener('visibilitychange', this._handleVisibilityChange);

    // Start pinging if already hidden
    if (document.hidden) {
      this._startHiddenPing();
    }
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;

    console.log('[Keepalive] Stopping keepalive');

    this._stopWorker();
    this._stopSilentAudio();
    this._releaseWakeLock();
    this._stopHiddenPing();

    document.removeEventListener('visibilitychange', this._handleVisibilityChange);
  }

  // Web Worker - lightweight background timer
  _startWorker() {
    const workerCode = `
      let intervalId = null;
      let lastTick = Date.now();

      self.onmessage = (e) => {
        if (e.data === 'start') {
          if (intervalId) clearInterval(intervalId);
          intervalId = setInterval(() => {
            const now = Date.now();
            const drift = now - lastTick - 1000;
            lastTick = now;
            self.postMessage({ type: 'tick', drift, timestamp: now });
          }, 1000);
        } else if (e.data === 'stop') {
          if (intervalId) clearInterval(intervalId);
          intervalId = null;
          self.close();
        }
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    this.workerUrl = URL.createObjectURL(blob);
    this.worker = new Worker(this.workerUrl);

    this.worker.onmessage = (e) => {
      if (e.data.type === 'tick') {
        this.onKeepaliveTick(e.data);
      }
    };

    this.worker.postMessage('start');
  }

  _stopWorker() {
    if (this.worker) {
      this.worker.postMessage('stop');
      // Worker closes itself via self.close()
      this.worker = null;
    }
    if (this.workerUrl) {
      URL.revokeObjectURL(this.workerUrl);
      this.workerUrl = null;
    }
  }

  // Silent Audio - sub-20Hz oscillator with zero gain
  _startSilentAudio() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;

      this.audioContext = new AudioContext();
      this.silentOscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      // 5 Hz is below human hearing threshold (~20 Hz)
      this.silentOscillator.frequency.value = 5;
      // Zero gain = completely silent
      gainNode.gain.value = 0;

      this.silentOscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      this.silentOscillator.start();

      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
    } catch (e) {
      console.warn('[Keepalive] Silent audio failed:', e);
    }
  }

  _stopSilentAudio() {
    if (this.silentOscillator) {
      try {
        this.silentOscillator.stop();
      } catch (e) {
        // Ignore if already stopped
      }
      this.silentOscillator = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  // Wake Lock - prevents screen sleep
  async _acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => {
        if (this.isRunning) {
          setTimeout(() => this._acquireWakeLock(), 100);
        }
      });
    } catch (err) {
      // Wake lock may fail silently - not critical
    }
  }

  _releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release();
      this.wakeLock = null;
    }
  }

  // Gentle ping only when hidden - prevents throttling
  _startHiddenPing() {
    if (this._pingInterval) return;

    this.onWarn('Tab hidden - gentle keepalive active');

    // Ping every 4 seconds - enough to stay alive, not enough to cause memory pressure
    this._pingInterval = setInterval(() => {
      if (!this.isRunning) return;

      // Ping the worker to keep thread alive
      if (this.worker) {
        this.worker.postMessage('ping');
      }

      // Resume audio if suspended
      if (this.audioContext?.state === 'suspended') {
        this.audioContext.resume();
      }

      // Re-acquire wake lock if lost
      if (!this.wakeLock && 'wakeLock' in navigator) {
        this._acquireWakeLock();
      }
    }, 4000);
  }

  _stopHiddenPing() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }

  // Visibility change handler
  _handleVisibilityChange() {
    if (document.hidden && this.isRunning) {
      this._startHiddenPing();
    } else {
      this._stopHiddenPing();
    }
  }
}

if (typeof window !== 'undefined') {
  window.BackgroundKeepalive = BackgroundKeepalive;
}
