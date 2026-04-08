/**
 * Pulsetto Session Clock
 * 
 * Manages session timing with wall-clock reconciliation for accuracy
 * across background/foreground transitions.
 * 
 * Based on: open-pulse/OpenPulse/ViewModels/SessionViewModel.swift
 */

const SessionClockState = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed'
};

class SessionClock {
  constructor() {
    this.state = SessionClockState.IDLE;
    this.totalDuration = 0;
    this.remainingSeconds = 0;
    this.elapsedSeconds = 0;
    
    // Wall-clock tracking
    this.sessionStartTime = null;
    this.accumulatedPauseTime = 0;
    this.pauseStartTime = null;
    this.backgroundEntryTime = null;
    
    // Timer
    this.tickTimer = null;
    this.tickInterval = 1000; // 1 second
    
    // Event listeners
    this.listeners = new Map();
    
    // Bind handlers
    this._onTick = this._onTick.bind(this);
    this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
    
    // Listen for visibility changes
    document.addEventListener('visibilitychange', this._handleVisibilityChange);
    
    // Wake lock
    this.wakeLock = null;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => {
        try { cb(data); } catch (e) { console.error('SessionClock event error:', e); }
      });
    }
  }

  get isIdle() { return this.state === SessionClockState.IDLE; }
  get isRunning() { return this.state === SessionClockState.RUNNING; }
  get isPaused() { return this.state === SessionClockState.PAUSED; }
  get isCompleted() { return this.state === SessionClockState.COMPLETED; }
  
  get progress() {
    if (this.totalDuration === 0) return 0;
    return 1.0 - (this.remainingSeconds / this.totalDuration);
  }

  async start(durationSeconds) {
    if (this.state === SessionClockState.RUNNING) {
      this.stop();
    }

    this.state = SessionClockState.RUNNING;
    this.totalDuration = durationSeconds;
    this.remainingSeconds = durationSeconds;
    this.elapsedSeconds = 0;
    
    this.sessionStartTime = Date.now();
    this.accumulatedPauseTime = 0;
    this.pauseStartTime = null;
    this.backgroundEntryTime = null;

    this._startTickTimer();
    await this._requestWakeLock();

    this.emit('started', {
      duration: this.totalDuration,
      timestamp: this.sessionStartTime
    });

    this.emit('tick', {
      remaining: this.remainingSeconds,
      elapsed: this.elapsedSeconds,
      progress: this.progress,
      state: this.state
    });

    return true;
  }

  pause() {
    if (this.state !== SessionClockState.RUNNING) return false;

    this.state = SessionClockState.PAUSED;
    this.pauseStartTime = Date.now();
    this._stopTickTimer();

    this.emit('paused', {
      remaining: this.remainingSeconds,
      elapsed: this.elapsedSeconds,
      timestamp: this.pauseStartTime
    });

    return true;
  }

  async resume() {
    if (this.state !== SessionClockState.PAUSED) return false;

    if (this.pauseStartTime) {
      this.accumulatedPauseTime += Date.now() - this.pauseStartTime;
      this.pauseStartTime = null;
    }

    this._recalculateFromWallClock();

    if (this.remainingSeconds <= 0) {
      this.complete();
      return false;
    }

    this.state = SessionClockState.RUNNING;
    this._startTickTimer();
    await this._requestWakeLock();

    this.emit('resumed', {
      remaining: this.remainingSeconds,
      elapsed: this.elapsedSeconds,
      timestamp: Date.now()
    });

    return true;
  }

  stop() {
    if (this.state === SessionClockState.IDLE) return false;

    const wasRunning = this.state === SessionClockState.RUNNING;
    
    this.state = SessionClockState.IDLE;
    this._stopTickTimer();
    this._releaseWakeLock();

    this.emit('stopped', {
      wasRunning,
      totalDuration: this.totalDuration,
      elapsed: this.elapsedSeconds,
      timestamp: Date.now()
    });

    this.totalDuration = 0;
    this.remainingSeconds = 0;
    this.elapsedSeconds = 0;
    this.sessionStartTime = null;
    this.accumulatedPauseTime = 0;
    this.pauseStartTime = null;
    this.backgroundEntryTime = null;

    return true;
  }

  complete() {
    if (this.state === SessionClockState.IDLE) return false;

    this.state = SessionClockState.COMPLETED;
    this._stopTickTimer();
    this._releaseWakeLock();

    this.remainingSeconds = 0;
    this.elapsedSeconds = this.totalDuration;

    this.emit('completed', {
      totalDuration: this.totalDuration,
      timestamp: Date.now()
    });

    return true;
  }

  adjustTime(deltaSeconds) {
    if (this.state === SessionClockState.IDLE || this.state === SessionClockState.COMPLETED) {
      return false;
    }

    const newRemaining = Math.max(60, this.remainingSeconds + deltaSeconds);
    const delta = newRemaining - this.remainingSeconds;
    
    this.remainingSeconds = newRemaining;
    this.totalDuration += delta;

    this.emit('adjusted', {
      remaining: this.remainingSeconds,
      totalDuration: this.totalDuration,
      delta: delta
    });

    return true;
  }

  _onTick() {
    this._recalculateFromWallClock();

    if (this.remainingSeconds <= 0) {
      this.complete();
      return;
    }

    this.emit('tick', {
      remaining: this.remainingSeconds,
      elapsed: this.elapsedSeconds,
      progress: this.progress,
      state: this.state
    });
  }

  _recalculateFromWallClock() {
    if (!this.sessionStartTime) return;

    const now = Date.now();
    let totalElapsed = now - this.sessionStartTime;
    let activeElapsed = totalElapsed - this.accumulatedPauseTime;
    
    if (this.pauseStartTime) {
      activeElapsed -= (now - this.pauseStartTime);
    }

    const elapsedSeconds = Math.floor(activeElapsed / 1000);
    const newRemaining = Math.max(0, this.totalDuration - elapsedSeconds);

    this.elapsedSeconds = elapsedSeconds;
    this.remainingSeconds = newRemaining;

    return newRemaining;
  }

  _startTickTimer() {
    this._stopTickTimer();
    this.tickTimer = setInterval(this._onTick, this.tickInterval);
  }

  _stopTickTimer() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  _handleVisibilityChange() {
    const hidden = document.hidden;

    if (hidden && this.isRunning) {
      this.backgroundEntryTime = Date.now();
      // NOTE: We intentionally do NOT stop the tick timer here.
      // The background-keepalive system keeps the tab alive so that
      // the mode engine continues sending commands to the device.
      // Stopping the timer would pause stimulation, which is undesirable.

      this.emit('backgrounded', {
        remaining: this.remainingSeconds,
        timestamp: this.backgroundEntryTime
      });

    } else if (!hidden && this.isRunning && this.backgroundEntryTime) {
      this.backgroundEntryTime = null;
      this._recalculateFromWallClock();

      this.emit('foregrounded', {
        remaining: this.remainingSeconds,
        elapsed: this.elapsedSeconds,
        timestamp: Date.now()
      });

      // Timer was already running, but ensure it's active after visibility change
      this._startTickTimer();

      if (this.remainingSeconds <= 0) {
        this.complete();
      }
    }
  }

  async _requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        
        this.wakeLock.addEventListener('release', () => {
          this.emit('wakeLockReleased', { timestamp: Date.now() });
        });

        this.emit('wakeLockAcquired', { timestamp: Date.now() });
      } catch (err) {
        console.warn('Wake Lock request failed:', err);
        this.emit('wakeLockError', { error: err, timestamp: Date.now() });
      }
    }
  }

  _releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release();
      this.wakeLock = null;
    }
  }

  static formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this._handleVisibilityChange);
    this.listeners.clear();
  }
}

if (typeof window !== 'undefined') {
  window.SessionClock = SessionClock;
  window.SessionClockState = SessionClockState;
}
