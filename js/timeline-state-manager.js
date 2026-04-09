/**
 * Timeline State Manager (Visual Only)
 *
 * Tracks expected device state for the timeline visualization.
 * Does NOT send commands to the device - purely informational.
 *
 * State tracking:
 * 1. Timeline zones (from mode engine) - defines expected channel at time T
 * 2. Channel override - user can override the timeline's expected channel
 * 3. On phase changes, notifies via onStateChange callback (for UI updates)
 */

class TimelineStateManager {
  constructor(options = {}) {
    this.clock = options.clock;
    this.modeEngine = null;

    // Configuration
    this.tickIntervalMs = options.tickIntervalMs || 1000; // Update every second for display

    // State
    this.isRunning = false;
    this.tickTimer = null;
    this.totalDuration = 0;
    this.baseStrength = 8;

    // Current expected state (what the timeline expects at current time)
    this.expectedState = {
      channel: 'off',
      intensity: 0,
      channelOverride: options.channelOverride || 'auto',
      lastUpdateTime: 0
    };

    // Callbacks
    this.onStateChange = options.onStateChange || null;

    // Track previous state for change detection
    this._previousChannel = null;
    this._previousIntensity = null;

    // Bind methods
    this._tick = this._tick.bind(this);
  }

  /**
   * Start tracking
   */
  start(mode, totalDuration, baseStrength) {
    if (!this.clock) {
      console.error('[TimelineStateManager] Missing clock reference');
      return;
    }

    this.modeEngine = ModeEngineFactory.create(mode);
    this.totalDuration = totalDuration;
    this.baseStrength = baseStrength;
    this.isRunning = true;

    // Initialize expected state from mode engine at time 0
    this._updateExpectedState(0);
    this._previousChannel = this.expectedState.channel;
    this._previousIntensity = this.expectedState.intensity;

    // Start ticking
    this._tick();

    console.log('[TimelineStateManager] Started', { mode, totalDuration, baseStrength });
  }

  /**
   * Stop tracking
   */
  stop() {
    this.isRunning = false;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.modeEngine = null;
    console.log('[TimelineStateManager] Stopped');
  }

  /**
   * Pause (stop ticks)
   */
  pause() {
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /**
   * Resume ticking
   */
  resume() {
    if (this.isRunning) {
      this._tick();
    }
  }

  /**
   * Seek to new position - update expected state and notify
   */
  seek(elapsedSeconds) {
    if (!this.isRunning || !this.modeEngine) return;

    const oldState = { ...this.expectedState };
    this._updateExpectedState(elapsedSeconds);

    // Always notify on seek (user jumped to new phase)
    if (this.onStateChange) {
      this.onStateChange({
        previous: oldState,
        current: { ...this.expectedState },
        type: 'seek',
        elapsed: elapsedSeconds
      });
    }

    this._previousChannel = this.expectedState.channel;
    this._previousIntensity = this.expectedState.intensity;

    console.log('[TimelineStateManager] Seek to', elapsedSeconds, this.expectedState);
  }

  /**
   * Set channel override
   */
  setChannelOverride(override) {
    const oldState = { ...this.expectedState };
    this.expectedState.channelOverride = override;

    // Recalculate effective channel
    this._recalculateEffectiveChannel();
    this.expectedState.lastUpdateTime = Date.now();

    // Notify state change
    if (this.onStateChange) {
      this.onStateChange({
        previous: oldState,
        current: { ...this.expectedState },
        type: 'channelOverride'
      });
    }

    this._previousChannel = this.expectedState.channel;

    console.log('[TimelineStateManager] Channel override:', override);
  }

  /**
   * Set intensity
   */
  setIntensity(intensity) {
    const oldState = { ...this.expectedState };
    this.expectedState.intensity = intensity;
    this.expectedState.lastUpdateTime = Date.now();

    if (this.onStateChange) {
      this.onStateChange({
        previous: oldState,
        current: { ...this.expectedState },
        type: 'intensity'
      });
    }

    this._previousIntensity = this.expectedState.intensity;
  }

  /**
   * Get current expected state
   */
  getExpectedState() {
    return { ...this.expectedState };
  }

  /**
   * Tick - update expected state and notify on phase changes
   */
  _tick() {
    if (!this.isRunning || !this.clock) return;

    const elapsed = this.clock.elapsedSeconds;
    const oldState = { ...this.expectedState };

    this._updateExpectedState(elapsed);

    // Check if phase changed (channel or intensity)
    const channelChanged = this.expectedState.channel !== this._previousChannel;
    const intensityChanged = this.expectedState.intensity !== this._previousIntensity;

    if ((channelChanged || intensityChanged) && this.onStateChange) {
      this.onStateChange({
        previous: oldState,
        current: { ...this.expectedState },
        type: 'phase'
      });
    }

    this._previousChannel = this.expectedState.channel;
    this._previousIntensity = this.expectedState.intensity;

    // Schedule next tick
    this.tickTimer = setTimeout(this._tick, this.tickIntervalMs);
  }

  /**
   * Update expected state from mode engine
   */
  _updateExpectedState(elapsedSeconds) {
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

  destroy() {
    this.stop();
    this.clock = null;
    this.onStateChange = null;
  }
}

if (typeof window !== 'undefined') {
  window.TimelineStateManager = TimelineStateManager;
}
