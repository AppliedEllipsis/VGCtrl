/**
 * Timeline State Manager
 *
 * Manages expected device state based on:
 * 1. Timeline zones (from mode engine) - defines expected channel at time T
 * 2. Channel override - user can override the timeline's expected channel
 *
 * Command Scheduler:
 * - Ticks every 5 seconds since last command
 * - Calculates expected state: mode engine state + channel override
 * - If next transition is within 3 seconds, wait and batch with that transition
 * - Sends commands to make device match expected state
 */

class TimelineStateManager {
  constructor(options = {}) {
    this.ble = options.ble;
    this.clock = options.clock;
    this.modeEngine = null;

    // Configuration
    this.tickIntervalMs = options.tickIntervalMs || 5000; // 5 second base tick
    this.transitionWindowMs = options.transitionWindowMs || 3000; // 3 second defer window
    this.minCommandSpacingMs = options.minCommandSpacingMs || 2000; // 2s between commands

    // State
    this.isRunning = false;
    this.lastCommandTime = 0;
    this.nextScheduledTick = null;
    this.tickTimer = null;
    this.pendingTransition = null;

    // Current expected state (what we want the device to be)
    this.expectedState = {
      channel: 'off',      // 'off', 'left', 'right', 'bilateral'
      intensity: 0,        // 0-9
      channelOverride: options.channelOverride || 'auto', // 'auto', 'left', 'right', 'bilateral'
      lastUpdateTime: 0
    };

    // Track what we last sent (to avoid redundant commands)
    this.lastSentState = {
      channel: null,
      intensity: null
    };

    // Callbacks
    this.onStateChange = options.onStateChange || null;
    this.onCommandScheduled = options.onCommandScheduled || null;

    // Bind methods
    this._scheduleNextTick = this._scheduleNextTick.bind(this);
    this._executeTick = this._executeTick.bind(this);
  }

  /**
   * Start tracking and command scheduling
   */
  start(mode, totalDuration, baseStrength) {
    if (!this.ble || !this.clock) {
      console.error('[TimelineStateManager] Missing BLE or clock reference');
      return;
    }

    this.modeEngine = ModeEngineFactory.create(mode);
    this.totalDuration = totalDuration;
    this.baseStrength = baseStrength;
    this.isRunning = true;
    this.lastCommandTime = 0;

    // Initialize expected state from mode engine at time 0
    this._updateExpectedStateFromEngine(0);

    // Send initial commands immediately
    this._executeTick(true); // true = initial (no deferral)

    // Schedule first regular tick
    this._scheduleNextTick();

    console.log('[TimelineStateManager] Started', { mode, totalDuration, baseStrength });
  }

  /**
   * Stop tracking
   */
  stop() {
    this.isRunning = false;
    this._clearTickTimer();
    this.modeEngine = null;
    this.pendingTransition = null;

    this.expectedState = {
      channel: 'off',
      intensity: 0,
      channelOverride: 'auto',
      lastUpdateTime: 0
    };

    console.log('[TimelineStateManager] Stopped');
  }

  /**
   * Pause (stop ticks, preserve state)
   */
  pause() {
    this._clearTickTimer();
  }

  /**
   * Resume ticking
   */
  resume() {
    if (this.isRunning) {
      this._scheduleNextTick();
    }
  }

  /**
   * Seek to new position - recalculate and send commands immediately
   */
  seek(elapsedSeconds) {
    if (!this.isRunning || !this.modeEngine) return;

    // Update expected state at new position
    const oldState = { ...this.expectedState };
    this._updateExpectedStateFromEngine(elapsedSeconds);

    // Notify state change
    if (this._stateChanged(oldState, this.expectedState) && this.onStateChange) {
      this.onStateChange({
        previous: oldState,
        current: { ...this.expectedState },
        type: 'seek',
        elapsed: elapsedSeconds
      });
    }

    // Note: Seek updates expected state but does NOT send commands immediately.
    // The periodic keepalive tick will sync the device state when it fires.
    // Reset lastSentState so the next periodic tick will send if state differs.
    this.lastSentState = { channel: null, intensity: null };

    // Reset tick scheduling from now
    this.lastCommandTime = Date.now();
    this._scheduleNextTick();

    console.log('[TimelineStateManager] Seek to', elapsedSeconds, this.expectedState, '(state only, commands deferred to periodic tick)');
  }

  /**
   * Notify of external channel override change
   */
  setChannelOverride(override) {
    const oldState = { ...this.expectedState };
    this.expectedState.channelOverride = override;

    // Recalculate effective channel
    this._recalculateEffectiveChannel();

    this.expectedState.lastUpdateTime = Date.now();

    // Notify state change
    if (this._stateChanged(oldState, this.expectedState) && this.onStateChange) {
      this.onStateChange({
        previous: oldState,
        current: { ...this.expectedState },
        type: 'channelOverride'
      });
    }

    // Schedule immediate correction (don't wait for tick)
    this._sendCorrection();
    this.lastCommandTime = Date.now();
    this._scheduleNextTick();

    console.log('[TimelineStateManager] Channel override:', override);
  }

  /**
   * Notify of external intensity change
   */
  setIntensity(intensity) {
    const oldState = { ...this.expectedState };
    this.expectedState.intensity = intensity;
    this.expectedState.lastUpdateTime = Date.now();

    // If intensity > 0 and channel is off, default to bilateral
    if (intensity > 0 && this.expectedState.channel === 'off') {
      this.expectedState.channel = 'bilateral';
    }

    // Notify state change
    if (this._stateChanged(oldState, this.expectedState) && this.onStateChange) {
      this.onStateChange({
        previous: oldState,
        current: { ...this.expectedState },
        type: 'intensity'
      });
    }

    // Send immediately
    this._sendCorrection();
    this.lastCommandTime = Date.now();
    this._scheduleNextTick();
  }

  /**
   * Get current expected state
   */
  getExpectedState() {
    return { ...this.expectedState };
  }

  /**
   * Schedule the next tick
   */
  _scheduleNextTick() {
    this._clearTickTimer();

    const now = Date.now();
    const timeSinceLastCommand = now - this.lastCommandTime;
    const nextTickDelay = Math.max(0, this.tickIntervalMs - timeSinceLastCommand);

    this.nextScheduledTick = now + nextTickDelay;
    this.tickTimer = setTimeout(this._executeTick, nextTickDelay);

    console.log('[TimelineStateManager] Next tick in', nextTickDelay, 'ms');
  }

  /**
   * Clear the tick timer
   */
  _clearTickTimer() {
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.nextScheduledTick = null;
  }

  /**
   * Execute a tick: calculate expected state, check for upcoming transitions, send commands
   * @param {boolean} isInitial - if true, don't defer (used for start/seek)
   */
  _executeTick(isInitial = false) {
    if (!this.isRunning || !this.clock) return;

    const now = Date.now();
    const elapsed = this.clock.elapsedSeconds;

    // Update expected state from mode engine
    const oldState = { ...this.expectedState };
    this._updateExpectedStateFromEngine(elapsed);

    // Check if state changed due to mode engine
    const stateChanged = this._stateChanged(oldState, this.expectedState);
    if (stateChanged && this.onStateChange) {
      this.onStateChange({
        previous: oldState,
        current: { ...this.expectedState },
        type: 'phase'
      });
    }

    // Execute tick - but only send commands if this is a periodic keepalive, not a phase transition
    // Phase transitions (stateChanged && !isInitial) update expected state but don't send commands;
    // the periodic keepalive (every 5s) will sync the device state when it fires.
    // User-initiated changes (setChannelOverride, setIntensity) still send immediately.
    const isPhaseTransition = stateChanged && !isInitial;
    if (!isPhaseTransition) {
      this._sendCorrection();
      this.lastCommandTime = Date.now();
    } else {
      console.log('[TimelineStateManager] Phase transition - state updated, commands deferred to periodic tick');
    }

    // Schedule next tick
    this._scheduleNextTick();
  }

  /**
   * Find the next upcoming transition from the mode engine
   * Returns { time: seconds, channel: string } or null
   */
  _findNextTransition(elapsed) {
    if (!this.modeEngine) return null;

    // Look ahead up to 10 seconds for transitions
    const lookAheadSeconds = 10;
    const step = 0.5; // Check every 500ms

    const currentResult = this.modeEngine.tick(elapsed, this.totalDuration, this.baseStrength);
    const currentChannel = this._applyOverride(currentResult.activeChannel);

    for (let t = elapsed + step; t <= elapsed + lookAheadSeconds; t += step) {
      const result = this.modeEngine.tick(t, this.totalDuration, this.baseStrength);
      const channelAtT = this._applyOverride(result.activeChannel);

      if (channelAtT !== currentChannel) {
        // Found a transition - find exact second
        return { time: Math.floor(t), channel: channelAtT };
      }
    }

    return null;
  }

  /**
   * Update expected state from mode engine at current elapsed time
   */
  _updateExpectedStateFromEngine(elapsedSeconds) {
    if (!this.modeEngine) return;

    const result = this.modeEngine.tick(elapsedSeconds, this.totalDuration, this.baseStrength);

    // Get channel from engine, then apply override
    const engineChannel = result.activeChannel || 'off';
    this.expectedState.channel = this._applyOverride(engineChannel);

    // Intensity from engine (or base if not specified)
    this.expectedState.intensity = result.effectiveStrength !== undefined
      ? result.effectiveStrength
      : (this.expectedState.channel !== 'off' ? this.baseStrength : 0);

    this.expectedState.lastUpdateTime = Date.now();
  }

  /**
   * Apply channel override to an engine channel
   */
  _applyOverride(engineChannel) {
    if (this.expectedState.channelOverride === 'auto') {
      return engineChannel;
    }
    return this.expectedState.channelOverride;
  }

  /**
   * Recalculate effective channel when override changes
   */
  _recalculateEffectiveChannel() {
    if (!this.modeEngine) return;

    const elapsed = this.clock.elapsedSeconds;
    const result = this.modeEngine.tick(elapsed, this.totalDuration, this.baseStrength);
    const engineChannel = result.activeChannel || 'off';

    this.expectedState.channel = this._applyOverride(engineChannel);
  }

  /**
   * Send correction commands to make device match expected state
   */
  _sendCorrection() {
    if (!this.ble || !this.ble.canSendCommands) return;

    const commands = [];
    const channel = this.expectedState.channel;
    const intensity = this.expectedState.intensity;

    // Determine if we need to send channel command
    const channelChanged = channel !== this.lastSentState.channel;
    const intensityChanged = intensity !== this.lastSentState.intensity;

    // Build channel command
    let channelCmd = null;
    if (channelChanged || (intensity > 0 && this.lastSentState.channel === null)) {
      switch (channel) {
        case 'left': channelCmd = PulsettoProtocol.Commands.activateLeft; break;
        case 'right': channelCmd = PulsettoProtocol.Commands.activateRight; break;
        case 'bilateral': channelCmd = PulsettoProtocol.Commands.activateBilateral; break;
        case 'off': channelCmd = PulsettoProtocol.Commands.stop; break;
      }
    }

    // Build intensity command
    let intensityCmd = null;
    if (intensityChanged && intensity > 0) {
      intensityCmd = PulsettoProtocol.Commands.intensity(intensity);
    }

    // Queue commands with proper spacing
    if (channelCmd) {
      this.ble.queueChannel(channelCmd);
      this.lastSentState.channel = channel;

      if (this.onCommandScheduled) {
        this.onCommandScheduled({ cmd: channelCmd, type: 'channel', time: Date.now() });
      }
    }

    if (intensityCmd && intensityCmd !== channelCmd) {
      this.ble.queueIntensity(intensityCmd);
      this.lastSentState.intensity = intensity;

      if (this.onCommandScheduled) {
        this.onCommandScheduled({ cmd: intensityCmd, type: 'intensity', time: Date.now() });
      }
    }

    // If channel is off, intensity is implicitly 0
    if (channel === 'off') {
      this.lastSentState.intensity = 0;
    }

    console.log('[TimelineStateManager] Correction:', {
      channel,
      intensity,
      commands: [channelCmd, intensityCmd].filter(Boolean)
    });
  }

  /**
   * Check if state changed meaningfully
   */
  _stateChanged(oldState, newState) {
    return oldState.channel !== newState.channel ||
           oldState.intensity !== newState.intensity;
  }

  destroy() {
    this.stop();
    this.ble = null;
    this.clock = null;
    this.onStateChange = null;
    this.onCommandScheduled = null;
  }
}

if (typeof window !== 'undefined') {
  window.TimelineStateManager = TimelineStateManager;
}
