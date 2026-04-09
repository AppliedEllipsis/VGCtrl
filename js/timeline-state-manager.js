/**
 * Timeline State Manager
 *
 * Tracks expected device state (channel, intensity, fade/pulse) based on mode engine
 * and periodically sends heartbeat commands to ensure device matches expected state.
 *
 * If manual controls overwrite the state, that becomes the new expected state
 * until the next phase transition or heartbeat correction.
 */

class TimelineStateManager {
  constructor(options = {}) {
    this.ble = options.ble; // PulsettoBluetooth instance
    this.clock = options.clock; // SessionClock instance
    this.modeEngine = null;
    this.timeline = null;

    // Expected state - this is what the timeline thinks the device should be
    this.expectedState = {
      channel: 'off', // 'off', 'left', 'right', 'bilateral'
      intensity: 0,   // 0-9 (0 = stopped)
      isFadeActive: false,
      fadeMode: 'off', // 'off', 'in', 'out', 'pulse'
      fadeStartTime: null,
      lastUpdateTime: 0
    };

    // Heartbeat configuration
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 5000; // 5 second default
    this.heartbeatTimer = null;
    this.isRunning = false;

    // External state change handlers
    this.onStateChange = options.onStateChange || null;
    this.onHeartbeat = options.onHeartbeat || null;

    // Bind methods
    this._heartbeatTick = this._heartbeatTick.bind(this);
  }

  /**
   * Start tracking and heartbeating
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

    // Initialize expected state from mode engine
    this._updateExpectedStateFromEngine(0);

    // Start heartbeat
    this._startHeartbeat();

    console.log('[TimelineStateManager] Started tracking', { mode, totalDuration, baseStrength });
  }

  /**
   * Stop tracking and heartbeating
   */
  stop() {
    this.isRunning = false;
    this._stopHeartbeat();
    this.modeEngine = null;

    // Reset expected state
    this.expectedState = {
      channel: 'off',
      intensity: 0,
      isFadeActive: false,
      fadeMode: 'off',
      fadeStartTime: null,
      lastUpdateTime: 0
    };

    console.log('[TimelineStateManager] Stopped');
  }

  /**
   * Pause heartbeat (when session paused)
   */
  pause() {
    this._stopHeartbeat();
    // Don't reset expected state - just stop correcting
  }

  /**
   * Resume heartbeat
   */
  resume() {
    if (this.isRunning) {
      this._startHeartbeat();
    }
  }

  /**
   * Notify that external controls changed the state
   * This updates the expected state to match what was manually set
   */
  notifyExternalChange(type, value) {
    if (!this.isRunning) return;

    const oldState = { ...this.expectedState };

    switch (type) {
      case 'channel':
        // Manual channel override - update expected channel
        this.expectedState.channel = value;
        // If channel changed to active, keep intensity; if to off, set intensity 0
        if (value === 'off') {
          this.expectedState.intensity = 0;
        }
        break;

      case 'intensity':
        // Manual intensity change - update expected intensity
        this.expectedState.intensity = value;
        // If intensity > 0, assume channel is active (unless explicitly off)
        if (value > 0 && this.expectedState.channel === 'off') {
          // Default to bilateral if no channel set
          this.expectedState.channel = 'bilateral';
        } else if (value === 0) {
          this.expectedState.channel = 'off';
        }
        // Cancel any active fade when user manually changes intensity
        if (this.expectedState.isFadeActive) {
          this.expectedState.isFadeActive = false;
          this.expectedState.fadeMode = 'off';
          this.expectedState.fadeStartTime = null;
        }
        break;

      case 'fade':
        // Fade started externally
        this.expectedState.isFadeActive = true;
        this.expectedState.fadeMode = value.mode; // 'in', 'out', 'pulse'
        this.expectedState.fadeStartTime = Date.now();
        break;

      case 'fadeComplete':
        // Fade completed or cancelled
        this.expectedState.isFadeActive = false;
        this.expectedState.fadeMode = 'off';
        this.expectedState.fadeStartTime = null;
        // If fade ended at a specific intensity, update expected
        if (value.finalIntensity !== undefined) {
          this.expectedState.intensity = value.finalIntensity;
          this.expectedState.channel = value.finalIntensity > 0 ? this.expectedState.channel : 'off';
        }
        break;
    }

    this.expectedState.lastUpdateTime = Date.now();

    // Notify if state changed
    if (this._stateChanged(oldState, this.expectedState) && this.onStateChange) {
      this.onStateChange({
        previous: oldState,
        current: { ...this.expectedState },
        type: 'external'
      });
    }

    console.log('[TimelineStateManager] External change applied:', type, value, this.expectedState);
  }

  /**
   * Seek to a new position - recalculate expected state at that time
   */
  seek(elapsedSeconds) {
    if (!this.isRunning || !this.modeEngine) return;

    const oldState = { ...this.expectedState };

    // Update expected state from engine at new position
    this._updateExpectedStateFromEngine(elapsedSeconds);

    // Notify if state changed
    if (this._stateChanged(oldState, this.expectedState) && this.onStateChange) {
      this.onStateChange({
        previous: oldState,
        current: { ...this.expectedState },
        type: 'seek',
        elapsed: elapsedSeconds
      });
    }

    // Send correction immediately on seek
    this._sendCorrection();

    console.log('[TimelineStateManager] Seek to', elapsedSeconds, this.expectedState);
  }

  /**
   * Get current expected state
   */
  getExpectedState() {
    return { ...this.expectedState };
  }

  /**
   * Update expected state from mode engine at current elapsed time
   */
  _updateExpectedStateFromEngine(elapsedSeconds) {
    if (!this.modeEngine) return;

    const result = this.modeEngine.tick(
      elapsedSeconds,
      this.totalDuration,
      this.baseStrength
    );

    // Update channel from engine result
    this.expectedState.channel = result.activeChannel || 'off';

    // Update intensity from engine result
    // If fade is active, let fade manage intensity
    if (!this.expectedState.isFadeActive) {
      this.expectedState.intensity = result.effectiveStrength || this.baseStrength;
    }

    this.expectedState.lastUpdateTime = Date.now();
  }

  /**
   * Heartbeat tick - check if device matches expected state and correct if needed
   */
  _heartbeatTick() {
    if (!this.isRunning || !this.clock || (!this.clock.isRunning && !this.clock.isPaused)) {
      return;
    }

    const elapsed = this.clock.elapsedSeconds;

    // Update expected state from engine (handles phase transitions)
    const oldState = { ...this.expectedState };
    this._updateExpectedStateFromEngine(elapsed);

    // Check if fade should complete (based on elapsed time)
    if (this.expectedState.isFadeActive && this.expectedState.fadeStartTime) {
      const fadeElapsed = Date.now() - this.expectedState.fadeStartTime;
      const fadeDuration = this._getFadeDuration(this.expectedState.fadeMode);

      if (fadeElapsed >= fadeDuration) {
        // Fade should be complete
        this.expectedState.isFadeActive = false;
        this.expectedState.fadeMode = 'off';
        this.expectedState.fadeStartTime = null;
        // Fade out/pulse end at 0
        if (this.expectedState.fadeMode === 'out' || this.expectedState.fadeMode === 'pulse') {
          this.expectedState.intensity = 0;
          this.expectedState.channel = 'off';
        }
      }
    }

    // Notify if state changed due to phase transition
    if (this._stateChanged(oldState, this.expectedState) && this.onStateChange) {
      this.onStateChange({
        previous: oldState,
        current: { ...this.expectedState },
        type: 'phase'
      });
    }

    // Send correction commands
    this._sendCorrection();

    // Notify heartbeat occurred
    if (this.onHeartbeat) {
      this.onHeartbeat({
        expectedState: { ...this.expectedState },
        elapsed: elapsed
      });
    }
  }

  /**
   * Send correction commands to make device match expected state
   */
  _sendCorrection() {
    if (!this.ble || !this.ble.canSendCommands) return;

    const commands = [];

    // Determine channel command
    let channelCmd = null;
    switch (this.expectedState.channel) {
      case 'left': channelCmd = PulsettoProtocol.Commands.activateLeft; break;
      case 'right': channelCmd = PulsettoProtocol.Commands.activateRight; break;
      case 'bilateral': channelCmd = PulsettoProtocol.Commands.activateBilateral; break;
      case 'off': channelCmd = PulsettoProtocol.Commands.stop; break;
    }

    // Determine intensity command
    let intensityCmd = null;
    if (this.expectedState.intensity === 0) {
      intensityCmd = PulsettoProtocol.Commands.stop;
    } else if (this.expectedState.intensity > 0 && this.expectedState.intensity <= 9) {
      intensityCmd = PulsettoProtocol.Commands.intensity(this.expectedState.intensity);
    }

    // Queue commands via BLE manager (will coalesce with other commands)
    if (channelCmd) {
      this.ble.queueChannel(channelCmd);
    }
    if (intensityCmd && intensityCmd !== channelCmd) {
      this.ble.queueIntensity(intensityCmd);
    }

    console.log('[TimelineStateManager] Heartbeat correction:', {
      channel: this.expectedState.channel,
      intensity: this.expectedState.intensity,
      fade: this.expectedState.isFadeActive ? this.expectedState.fadeMode : 'off'
    });
  }

  /**
   * Get expected duration of a fade mode in milliseconds
   */
  _getFadeDuration(fadeMode) {
    switch (fadeMode) {
      case 'in': return 15000;  // ~15 seconds to ramp up
      case 'out': return 15000; // ~15 seconds to ramp down + stop
      case 'pulse': return 30000; // ~30 seconds for full pulse
      default: return 0;
    }
  }

  /**
   * Check if state changed meaningfully
   */
  _stateChanged(oldState, newState) {
    return oldState.channel !== newState.channel ||
           oldState.intensity !== newState.intensity ||
           oldState.isFadeActive !== newState.isFadeActive ||
           oldState.fadeMode !== newState.fadeMode;
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(this._heartbeatTick, this.heartbeatIntervalMs);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  destroy() {
    this.stop();
    this.ble = null;
    this.clock = null;
    this.onStateChange = null;
    this.onHeartbeat = null;
  }
}

if (typeof window !== 'undefined') {
  window.TimelineStateManager = TimelineStateManager;
}
