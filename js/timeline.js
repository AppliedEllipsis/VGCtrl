/**
 * Pulsetto Session Timeline
 * 
 * Visual timeline showing mode patterns with progress tracking
 * and scrubbing controls for rewind/fast-forward.
 */

class SessionTimeline {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Timeline container #${containerId} not found`);
    }

    this.options = {
      height: options.height || 120,
      segmentHeight: options.segmentHeight || 32,
      scrubEnabled: options.scrubEnabled !== false,
      showLabels: options.showLabels !== false,
      heartbeatIntervalMs: options.heartbeatIntervalMs || 5000,
      ...options
    };

    this.state = {
      mode: null,
      totalDuration: 0,
      elapsed: 0,
      isPlaying: false,
      baseStrength: 8
    };

    this.modeEngine = null;
    this.scrubbing = false;
    this.seeking = false;  // Track when a seek operation is in progress
    this.onScrubCallback = null;

    // State manager for tracking expected device state
    this.stateManager = null;

    this._init();
  }

  _init() {
    this._buildDOM();
    this._bindEvents();
    
    // Defer initial resize until container is laid out
    requestAnimationFrame(() => {
      this._resizeCanvas();
      this.render();
    });
    
    // Also resize on window load to ensure proper dimensions
    window.addEventListener('load', () => {
      this._resizeCanvas();
      this.render();
    });
  }

  _buildDOM() {
    this.container.innerHTML = `
      <div class="timeline-container">
        <div class="timeline-header">
          <span class="timeline-title">Session Timeline</span>
          <span class="timeline-position">00:00 / 00:00</span>
        </div>

        <div class="timeline-canvas-wrapper">
          <canvas class="timeline-canvas"></canvas>
          <div class="timeline-intensity-scale">
            <span>9</span>
            <span>5</span>
            <span>0</span>
          </div>
          <div class="timeline-scrubber">
            <div class="scrubber-handle">
              <div class="scrubber-tooltip">00:00</div>
            </div>
          </div>
          <div class="timeline-hover-tooltip hidden"></div>
        </div>

        <div class="timeline-controls">
          <button class="btn-timeline btn-rewind" title="Rewind 10s">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="currentColor" d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/>
            </svg>
          </button>
          <button class="btn-timeline btn-back-30" title="Back 30s">-30s</button>
          <button class="btn-timeline btn-back-10" title="Back 10s">-10s</button>
          <div class="timeline-play-indicator">
            <span class="play-status">Ready</span>
          </div>
          <button class="btn-timeline btn-fwd-10" title="Forward 10s">+10s</button>
          <button class="btn-timeline btn-fwd-30" title="Forward 30s">+30s</button>
          <button class="btn-timeline btn-fast-fwd" title="Fast Forward 10s">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="currentColor" d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>
            </svg>
          </button>
        </div>

        <div class="timeline-legend">
          <div class="legend-item">
            <span class="legend-color active-left"></span>
            <span>Left</span>
          </div>
          <div class="legend-item">
            <span class="legend-color active-right"></span>
            <span>Right</span>
          </div>
          <div class="legend-item">
            <span class="legend-color active-both"></span>
            <span>Both</span>
          </div>
          <div class="legend-item">
            <span class="legend-color active-rest"></span>
            <span>Off</span>
          </div>
          <div class="legend-item breathing hidden">
            <span class="legend-color active-breathing"></span>
            <span>Breathing</span>
          </div>
        </div>
      </div>
    `;

    this.canvas = this.container.querySelector('.timeline-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.scrubber = this.container.querySelector('.timeline-scrubber');
    this.handle = this.container.querySelector('.scrubber-handle');
    this.tooltip = this.container.querySelector('.scrubber-tooltip');
    this.hoverTooltip = this.container.querySelector('.timeline-hover-tooltip');
    this.positionDisplay = this.container.querySelector('.timeline-position');
    this.playStatus = this.container.querySelector('.play-status');

    this._resizeCanvas();
  }

  _resizeCanvas() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = this.options.height * window.devicePixelRatio;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${this.options.height}px`;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.width = rect.width;
    this.height = this.options.height;
  }

  _bindEvents() {
    // Window resize
    window.addEventListener('resize', () => {
      this._resizeCanvas();
      this.render();
    });

    // Scrubbing
    if (this.options.scrubEnabled) {
      const wrapper = this.canvas.parentElement;
      
      wrapper.addEventListener('mousedown', (e) => this._startScrub(e));
      wrapper.addEventListener('mousemove', (e) => this._hover(e));
      wrapper.addEventListener('mouseleave', () => this._hideHover());
      
      document.addEventListener('mousemove', (e) => this._moveScrub(e));
      document.addEventListener('mouseup', () => this._endScrub());
      
      // Touch support
      wrapper.addEventListener('touchstart', (e) => this._startScrub(e.touches[0]));
      wrapper.addEventListener('touchmove', (e) => {
        e.preventDefault();
        this._moveScrub(e.touches[0]);
      });
      document.addEventListener('touchend', () => this._endScrub());
    }

    // Control buttons
    this.container.querySelector('.btn-rewind').addEventListener('click', () => this.scrub(-10));
    this.container.querySelector('.btn-back-30').addEventListener('click', () => this.scrub(-30));
    this.container.querySelector('.btn-back-10').addEventListener('click', () => this.scrub(-10));
    this.container.querySelector('.btn-fwd-10').addEventListener('click', () => this.scrub(10));
    this.container.querySelector('.btn-fwd-30').addEventListener('click', () => this.scrub(30));
    this.container.querySelector('.btn-fast-fwd').addEventListener('click', () => this.scrub(10));
  }

  _startScrub(e) {
    if (!this.options.scrubEnabled || this.state.totalDuration === 0) return;
    
    this.scrubbing = true;
    this.container.classList.add('scrubbing');
    this._updateFromMouse(e);
  }

  _moveScrub(e) {
    if (!this.scrubbing) return;
    this._updateFromMouse(e);
  }

  _endScrub() {
    if (!this.scrubbing) return;
    
    this.scrubbing = false;
    this.seeking = true;  // Mark seeking in progress
    this.container.classList.remove('scrubbing');
    
    if (this.onScrubCallback) {
      // Pass a done callback so app can signal when seek is complete
      this.onScrubCallback(this.state.elapsed, () => {
        this.seeking = false;
      });
    } else {
      this.seeking = false;
    }
  }

  // Called by app when seek is fully complete
  seekComplete() {
    this.seeking = false;
  }

  _updateFromMouse(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(this.width, e.clientX - rect.left));
    const progress = x / this.width;
    this.state.elapsed = Math.floor(progress * this.state.totalDuration);
    this._updateScrubber();
    this.render();
  }

  _hover(e) {
    if (this.scrubbing || this.state.totalDuration === 0) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(this.width, e.clientX - rect.left));
    const progress = x / this.width;
    const time = Math.floor(progress * this.state.totalDuration);

    // Show hover tooltip with mode state and intensity at that time
    const modeInfo = this._getModeStateAt(time);
    this.hoverTooltip.textContent = `${this._formatTime(time)} | ${modeInfo}`;
    this.hoverTooltip.style.left = `${x}px`;
    this.hoverTooltip.classList.remove('hidden');
  }

  _hideHover() {
    this.hoverTooltip.classList.add('hidden');
  }

  _getModeStateAt(time) {
    if (!this.modeEngine || !this.state.mode) return 'Unknown';

    const result = this.modeEngine.tick(time, this.state.totalDuration, this.state.baseStrength);
    const channel = result.activeChannel || 'off';
    const intensity = result.effectiveStrength !== undefined ? result.effectiveStrength : this.state.baseStrength;

    // Format: "Channel | Int 5" or "Off" if intensity is 0
    if (intensity === 0 || channel === 'off') {
      return 'Off';
    }

    const channelLabel = channel === 'left' ? 'Left' :
                        channel === 'right' ? 'Right' :
                        channel === 'bilateral' ? 'Both' : channel;

    return `${channelLabel} | Int ${intensity}`;
  }

  setMode(mode, totalDuration, baseStrength = 8) {
    this.state.mode = mode;
    this.state.totalDuration = totalDuration;
    this.state.baseStrength = baseStrength;
    this.state.elapsed = 0;

    this.modeEngine = ModeEngineFactory.create(mode);

    // Show/hide breathing legend
    const isBreathing = ['calm', 'meditation'].includes(mode);
    this.container.querySelector('.legend-item.breathing').classList.toggle('hidden', !isBreathing);

    this.render();
    this._updatePositionDisplay();
  }

  /**
   * Start timeline tracking with state manager
   */
  startTracking(ble, clock, channelOverride = 'auto') {
    // Initialize state manager with command scheduling config
    this.stateManager = new TimelineStateManager({
      ble: ble,
      clock: clock,
      channelOverride: channelOverride,
      tickIntervalMs: 5000,        // Tick every 5 seconds since last command
      transitionWindowMs: 3000,      // Defer if transition within 3 seconds
      minCommandSpacingMs: 2000,   // 2 seconds between commands
      onStateChange: (change) => this._onStateChange(change),
      onCommandScheduled: (data) => this._onCommandScheduled(data)
    });

    this.stateManager.start(this.state.mode, this.state.totalDuration, this.state.baseStrength);
  }

  /**
   * Stop timeline tracking
   */
  stopTracking() {
    if (this.stateManager) {
      this.stateManager.stop();
      this.stateManager = null;
    }
  }

  /**
   * Pause tracking (session paused)
   */
  pauseTracking() {
    if (this.stateManager) {
      this.stateManager.pause();
    }
  }

  /**
   * Resume tracking
   */
  resumeTracking() {
    if (this.stateManager) {
      this.stateManager.resume();
    }
  }

  /**
   * Set channel override (takes precedence over timeline zones)
   */
  setChannelOverride(channel) {
    if (this.stateManager) {
      this.stateManager.setChannelOverride(channel);
    }
  }

  /**
   * Set intensity directly
   */
  setIntensity(intensity) {
    if (this.stateManager) {
      this.stateManager.setIntensity(intensity);
    }
  }

  /**
   * Generic external change notification (for fade, etc.)
   * These are informational - actual commands handled by app.js
   */
  notifyExternalChange(type, value) {
    console.log('[Timeline] External change:', type, value);
    // Could trigger visual feedback in the future
  }

  /**
   * Get current expected state from state manager
   */
  getExpectedState() {
    return this.stateManager ? this.stateManager.getExpectedState() : null;
  }

  /**
   * Seek to new position - state manager recalculates and sends commands
   */
  seek(elapsedSeconds) {
    if (this.stateManager) {
      this.stateManager.seek(elapsedSeconds);
    }
  }

  _onStateChange(change) {
    // Visual feedback for state changes could go here
    console.log('[Timeline] State change:', change);
  }

  _onCommandScheduled(data) {
    // Visual feedback for scheduled commands could go here
    // console.log('[Timeline] Command scheduled:', data);
  }

  updateProgress(elapsed, isPlaying = true) {
    // Don't update from clock ticks while seeking - wait for seek to complete
    if (this.seeking) return;
    
    this.state.elapsed = elapsed;
    this.state.isPlaying = isPlaying;
    
    this._updateScrubber();
    this._updatePositionDisplay();
    this._updatePlayStatus();
    
    if (!this.scrubbing) {
      this.render();
    }
  }

  _updateScrubber() {
    if (this.state.totalDuration === 0) return;

    const progress = this.state.elapsed / this.state.totalDuration;
    const x = progress * this.width;

    // Get current intensity and channel for tooltip
    let currentIntensity = this.state.baseStrength;
    let currentChannel = 'off';

    if (this.modeEngine) {
      const result = this.modeEngine.tick(
        this.state.elapsed,
        this.state.totalDuration,
        this.state.baseStrength
      );
      currentIntensity = result.effectiveStrength !== undefined ? result.effectiveStrength : this.state.baseStrength;
      currentChannel = result.activeChannel || 'off';
    }

    const channelLabel = currentChannel === 'off' ? 'Off' :
                        currentChannel === 'left' ? 'L' :
                        currentChannel === 'right' ? 'R' : 'B';

    this.scrubber.style.left = `${x}px`;
    this.tooltip.textContent = `${this._formatTime(this.state.elapsed)} ${channelLabel}${currentIntensity}`;
  }

  _updatePositionDisplay() {
    // Get current intensity from mode engine or base strength
    let currentIntensity = this.state.baseStrength;
    let currentChannel = 'off';

    if (this.modeEngine && this.state.totalDuration > 0) {
      const result = this.modeEngine.tick(
        this.state.elapsed,
        this.state.totalDuration,
        this.state.baseStrength
      );
      currentIntensity = result.effectiveStrength !== undefined ? result.effectiveStrength : this.state.baseStrength;
      currentChannel = result.activeChannel || 'off';
    }

    const channelLabel = currentChannel === 'off' ? 'Off' :
                        currentChannel === 'left' ? 'L' :
                        currentChannel === 'right' ? 'R' : 'B';

    this.positionDisplay.textContent =
      `${this._formatTime(this.state.elapsed)} / ${this._formatTime(this.state.totalDuration)} | ${channelLabel}${currentIntensity}`;
  }

  _updatePlayStatus() {
    const status = this.state.isPlaying ? 'Playing' : 'Paused';
    this.playStatus.textContent = status;
    this.playStatus.className = `play-status ${this.state.isPlaying ? 'playing' : 'paused'}`;
  }

  scrub(deltaSeconds) {
    const newElapsed = Math.max(0, Math.min(
      this.state.totalDuration,
      this.state.elapsed + deltaSeconds
    ));
    
    this.state.elapsed = newElapsed;
    this._updateScrubber();
    this._updatePositionDisplay();
    this.render();
    
    if (this.onScrubCallback) {
      this.onScrubCallback(newElapsed);
    }
    
    return newElapsed;
  }

  onScrub(callback) {
    this.onScrubCallback = callback;
  }

  render() {
    if (!this.ctx) return;
    
    // Ensure dimensions are up to date
    this._resizeCanvas();
    
    if (!this.width || !this.height) return;
    
    this.ctx.clearRect(0, 0, this.width, this.height);
    
    if (!this.state.mode || this.state.totalDuration === 0) {
      this._renderEmpty();
      return;
    }
    
    switch (this.state.mode) {
      case 'sleep':
        this._renderSleepTimeline();
        break;
      case 'focus':
        this._renderFocusTimeline();
        break;
      case 'pain':
        this._renderPainTimeline();
        break;
      case 'headache':
        this._renderHeadacheTimeline();
        break;
      case 'calm':
      case 'meditation':
        this._renderBreathingTimeline();
        break;
      default:
        this._renderContinuousTimeline();
    }
    
    // Render current position marker
    this._renderPositionMarker();
  }

  _renderEmpty() {
    this.ctx.fillStyle = '#21262d';
    this.ctx.fillRect(0, this.height / 2 - 2, this.width, 4);
    
    this.ctx.fillStyle = '#8b949e';
    this.ctx.font = '12px system-ui, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Select a mode to see timeline', this.width / 2, this.height / 2 + 20);
  }

  _renderSleepTimeline() {
    const phases = ['D', 'A', 'D', 'C', 'D']; // bilateral, left, bilateral, right, bilateral
    const phaseDuration = this.state.totalDuration / phases.length;
    const phaseWidth = this.width / phases.length;
    const barY = (this.height - this.options.segmentHeight) / 2;
    const baseStrength = this.state.baseStrength;

    // Draw phase segments
    phases.forEach((phase, i) => {
      const x = i * phaseWidth;
      const isFadePhase = i >= 4; // Last phase has fade

      // Base color by channel
      let color = this._getChannelColor(phase);

      // Draw segment background
      this.ctx.fillStyle = color;
      this.ctx.fillRect(x + 1, barY, phaseWidth - 2, this.options.segmentHeight);

      // Draw intensity overlay (brightness = intensity level)
      const intensityOpacity = (baseStrength / 9) * 0.4; // max 40% opacity
      this.ctx.fillStyle = `rgba(255,255,255,${intensityOpacity})`;
      this.ctx.fillRect(x + 1, barY, phaseWidth - 2, this.options.segmentHeight);

      // Draw fade overlay for last phase (intensity drop)
      if (isFadePhase) {
        const fadeGradient = this.ctx.createLinearGradient(x, 0, x + phaseWidth, 0);
        fadeGradient.addColorStop(0, `rgba(255,255,255,${intensityOpacity})`);
        fadeGradient.addColorStop(0.5, `rgba(255,255,255,${intensityOpacity * 0.5})`);
        fadeGradient.addColorStop(1, 'rgba(0,0,0,0.5)');
        this.ctx.fillStyle = fadeGradient;
        this.ctx.fillRect(x + 1, barY, phaseWidth - 2, this.options.segmentHeight);
      }

      // Draw phase label
      this.ctx.fillStyle = '#fff';
      this.ctx.font = 'bold 10px system-ui, sans-serif';
      this.ctx.textAlign = 'center';
      const labels = { 'D': 'Both', 'A': 'Left', 'C': 'Right' };
      this.ctx.fillText(labels[phase], x + phaseWidth / 2, barY + 18);

      // Draw intensity label
      const displayIntensity = isFadePhase ? '↓' : baseStrength;
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '9px system-ui, sans-serif';
      this.ctx.fillText(displayIntensity, x + phaseWidth / 2, barY + 30);
    });

    // Draw intensity annotation
    this.ctx.fillStyle = '#f0883e';
    this.ctx.font = '9px system-ui, sans-serif';
    this.ctx.textAlign = 'right';
    this.ctx.fillText(`Intensity: ${baseStrength} → fade`, this.width - 5, barY + this.options.segmentHeight + 12);
  }

  _renderFocusTimeline() {
    const cycleDuration = 60; // 30s on, 30s off
    const numCycles = Math.ceil(this.state.totalDuration / cycleDuration);
    const cycleWidth = this.width / numCycles;
    const barY = (this.height - this.options.segmentHeight) / 2;
    const segmentHeight = this.options.segmentHeight;
    const baseStrength = this.state.baseStrength;
    const intensityHeight = segmentHeight * (baseStrength / 9);

    for (let i = 0; i < numCycles; i++) {
      const x = i * cycleWidth;
      const onWidth = cycleWidth * 0.5;
      const offWidth = cycleWidth * 0.5;

      // OFF segment (background)
      this.ctx.fillStyle = '#484f58';
      this.ctx.fillRect(x, barY, cycleWidth - 1, segmentHeight);

      // ON segment (left channel) - filled to intensity level
      this.ctx.fillStyle = '#1f6feb'; // left color
      this.ctx.fillRect(x, barY + segmentHeight - intensityHeight, onWidth - 1, intensityHeight);

      // Draw intensity stripes on ON segment
      this.ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      this.ctx.lineWidth = 1;
      for (let s = 0; s < intensityHeight; s += 6) {
        this.ctx.beginPath();
        this.ctx.moveTo(x, barY + segmentHeight - s);
        this.ctx.lineTo(x + onWidth - 1, barY + segmentHeight - s);
        this.ctx.stroke();
      }

      // Label
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '10px system-ui, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(`${i + 1}`, x + cycleWidth / 2, barY + 20);

      // Intensity label on ON segments
      this.ctx.fillStyle = 'rgba(255,255,255,0.9)';
      this.ctx.font = 'bold 9px system-ui, sans-serif';
      this.ctx.fillText(baseStrength, x + onWidth / 2, barY + segmentHeight - intensityHeight + 12);
    }

    // Legend annotation
    this.ctx.fillStyle = '#8b949e';
    this.ctx.font = '10px system-ui, sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(`${baseStrength} intensity | 30s ON / 30s OFF`, 5, barY - 8);
  }

  _renderPainTimeline() {
    const barY = (this.height - this.options.segmentHeight) / 2;
    const waveHeight = this.options.segmentHeight;
    const amplitude = waveHeight / 4;
    const centerY = barY + waveHeight / 2;
    const baseStrength = this.state.baseStrength;
    const intensityVariation = Math.min(2, baseStrength * 0.2); // ±20% or max ±2

    // Draw base intensity background
    const baseIntensityHeight = waveHeight * (baseStrength / 9);
    this.ctx.fillStyle = 'rgba(35, 134, 54, 0.3)'; // right color with alpha
    this.ctx.fillRect(0, barY + waveHeight - baseIntensityHeight, this.width, baseIntensityHeight);

    // Draw sine wave background showing intensity variation
    const gradient = this.ctx.createLinearGradient(0, barY, 0, barY + waveHeight);
    gradient.addColorStop(0, 'rgba(35, 134, 54, 0.8)');
    gradient.addColorStop(0.5, 'rgba(31, 111, 235, 0.6)');
    gradient.addColorStop(1, 'rgba(137, 87, 229, 0.4)');

    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.moveTo(0, centerY);

    const period = 20; // 20 second period
    const frequency = (this.state.totalDuration / period) * 2 * Math.PI / this.width;

    for (let x = 0; x <= this.width; x += 2) {
      const t = (x / this.width) * this.state.totalDuration;
      const sine = Math.sin((t % period) / period * 2 * Math.PI);
      // Wave shows intensity variation around baseStrength
      const intensityFactor = (baseStrength + sine * intensityVariation) / 9;
      const y = barY + waveHeight * (1 - intensityFactor);
      this.ctx.lineTo(x, y);
    }

    this.ctx.lineTo(this.width, barY + waveHeight);
    this.ctx.lineTo(0, barY + waveHeight);
    this.ctx.closePath();
    this.ctx.fill();

    // Draw intensity line
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    for (let x = 0; x <= this.width; x += 2) {
      const t = (x / this.width) * this.state.totalDuration;
      const sine = Math.sin((t % period) / period * 2 * Math.PI);
      const intensityFactor = Math.max(0, Math.min(1, (baseStrength + sine * intensityVariation) / 9));
      const y = barY + waveHeight * (1 - intensityFactor);
      if (x === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.stroke();

    // Labels for periods
    const numPeriods = Math.ceil(this.state.totalDuration / period);
    this.ctx.fillStyle = '#8b949e';
    this.ctx.font = '9px system-ui, sans-serif';
    this.ctx.textAlign = 'center';
    for (let i = 0; i < numPeriods; i++) {
      const x = (i * period / this.state.totalDuration) * this.width;
      this.ctx.fillText(`~${i + 1}`, x + 10, barY - 5);
    }

    // Annotation with current intensity
    this.ctx.fillStyle = '#8b949e';
    this.ctx.font = '10px system-ui, sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(`Intensity ${baseStrength} ±${intensityVariation.toFixed(1)} (20s wave)`, 5, barY - 8);
  }

  _renderHeadacheTimeline() {
    const burstOn = 120; // 2 minutes
    const burstOff = 30; // 30 seconds
    const cycle = burstOn + burstOff;
    const numCycles = Math.ceil(this.state.totalDuration / cycle);
    const cycleWidth = this.width / numCycles;
    const barY = (this.height - this.options.segmentHeight) / 2;
    const segmentHeight = this.options.segmentHeight;
    const baseStrength = this.state.baseStrength;
    const intensityHeight = segmentHeight * (baseStrength / 9);

    for (let i = 0; i < numCycles; i++) {
      const x = i * cycleWidth;
      const onWidth = cycleWidth * (burstOn / cycle);
      const offWidth = cycleWidth * (burstOff / cycle);

      // OFF segment (background)
      this.ctx.fillStyle = '#484f58';
      this.ctx.fillRect(x, barY, cycleWidth - 1, segmentHeight);

      // ON segment (both) - filled to intensity level
      this.ctx.fillStyle = '#8957e5'; // both color
      this.ctx.fillRect(x, barY + segmentHeight - intensityHeight, onWidth - 1, intensityHeight);

      // Burst pattern stripes showing intensity
      this.ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      this.ctx.lineWidth = 1;
      const burstCount = Math.max(3, Math.floor(baseStrength / 3));
      for (let b = 0; b < burstCount; b++) {
        const stripeY = barY + segmentHeight - (intensityHeight * (b + 1) / burstCount);
        this.ctx.beginPath();
        this.ctx.moveTo(x, stripeY);
        this.ctx.lineTo(x + onWidth - 1, stripeY);
        this.ctx.stroke();
      }

      // Label
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '10px system-ui, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(`B${i + 1}`, x + onWidth / 2, barY + 18);

      // Intensity label
      this.ctx.fillStyle = 'rgba(255,255,255,0.9)';
      this.ctx.font = 'bold 9px system-ui, sans-serif';
      this.ctx.fillText(baseStrength, x + onWidth / 2, barY + segmentHeight - intensityHeight + 12);
    }

    this.ctx.fillStyle = '#8b949e';
    this.ctx.font = '10px system-ui, sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(`${baseStrength} intensity | 2min ON / 30s OFF`, 5, barY - 8);
  }

  _renderBreathingTimeline() {
    const isCalm = this.state.mode === 'calm';
    const inhale = isCalm ? 5 : 5;
    const hold = isCalm ? 5 : 4;
    const exhale = isCalm ? 7 : 5;
    const cycle = inhale + hold + exhale;
    const baseStrength = this.state.baseStrength;
    const segmentHeight = this.options.segmentHeight;
    const intensityHeight = segmentHeight * (baseStrength / 9);

    const numCycles = Math.ceil(this.state.totalDuration / cycle);
    const cycleWidth = this.width / numCycles;
    const barY = (this.height - segmentHeight) / 2;
    const leadTime = 3;

    for (let i = 0; i < numCycles; i++) {
      const x = i * cycleWidth;
      const inhaleWidth = cycleWidth * (inhale / cycle);
      const holdWidth = cycleWidth * (hold / cycle);
      const exhaleWidth = cycleWidth * (exhale / cycle);

      // Lead portion (no stimulation)
      const leadWidth = cycleWidth * (leadTime / cycle);
      this.ctx.fillStyle = '#484f58';
      this.ctx.fillRect(x, barY, leadWidth - 1, segmentHeight);

      // Active inhale - filled to intensity level
      const activeInhaleWidth = inhaleWidth - leadWidth;
      const inhaleGrad = this.ctx.createLinearGradient(x + leadWidth, barY, x + inhaleWidth, barY);
      inhaleGrad.addColorStop(0, '#8957e5');
      inhaleGrad.addColorStop(1, '#238636');
      this.ctx.fillStyle = inhaleGrad;
      this.ctx.fillRect(x + leadWidth, barY + segmentHeight - intensityHeight, activeInhaleWidth - 1, intensityHeight);

      // Hold (active) - at intensity level
      this.ctx.fillStyle = '#238636';
      this.ctx.fillRect(x + inhaleWidth, barY + segmentHeight - intensityHeight, holdWidth - 1, intensityHeight);

      // Exhale (rest) - full height but dimmed
      this.ctx.fillStyle = '#484f58';
      this.ctx.fillRect(x + inhaleWidth + holdWidth, barY, exhaleWidth - 1, segmentHeight);

      // Intensity stripes on active segments
      this.ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      this.ctx.lineWidth = 1;
      for (let s = 0; s < intensityHeight; s += 5) {
        const y = barY + segmentHeight - s;
        this.ctx.beginPath();
        this.ctx.moveTo(x + leadWidth, y);
        this.ctx.lineTo(x + inhaleWidth + holdWidth - 1, y);
        this.ctx.stroke();
      }

      // Phase labels
      this.ctx.fillStyle = 'rgba(255,255,255,0.8)';
      this.ctx.font = '9px system-ui, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('▲', x + leadWidth + activeInhaleWidth / 2, barY + 12);
      this.ctx.fillText('●', x + inhaleWidth + holdWidth / 2, barY + 12);
      this.ctx.fillText('▼', x + inhaleWidth + holdWidth + exhaleWidth / 2, barY + 12);

      // Cycle number and intensity
      this.ctx.fillStyle = '#8b949e';
      this.ctx.font = '9px system-ui, sans-serif';
      this.ctx.fillText(`${i + 1}`, x + cycleWidth / 2, barY + segmentHeight + 10);
    }

    // Annotation with intensity
    this.ctx.fillStyle = '#8b949e';
    this.ctx.font = '10px system-ui, sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(`${baseStrength} intensity | ${inhale}s↑ ${hold}s● ${exhale}s↓`, 5, barY - 8);
  }

  _renderContinuousTimeline() {
    const barY = (this.height - this.options.segmentHeight) / 2;
    const segmentHeight = this.options.segmentHeight;
    const baseStrength = this.state.baseStrength;
    const intensityHeight = segmentHeight * (baseStrength / 9);

    // Background gradient
    const gradient = this.ctx.createLinearGradient(0, barY, 0, barY + segmentHeight);
    gradient.addColorStop(0, '#8957e5');
    gradient.addColorStop(0.5, '#1f6feb');
    gradient.addColorStop(1, '#238636');

    // Full height background (dimmed)
    this.ctx.fillStyle = gradient;
    this.ctx.globalAlpha = 0.3;
    this.ctx.fillRect(0, barY, this.width, segmentHeight);
    this.ctx.globalAlpha = 1.0;

    // Active intensity level (brighter)
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, barY + segmentHeight - intensityHeight, this.width, intensityHeight);

    // Intensity stripes
    this.ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    this.ctx.lineWidth = 1;
    for (let s = 0; s < intensityHeight; s += 6) {
      const y = barY + segmentHeight - s;
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.width, y);
      this.ctx.stroke();
    }

    // Current intensity indicator line
    this.ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(0, barY + segmentHeight - intensityHeight);
    this.ctx.lineTo(this.width, barY + segmentHeight - intensityHeight);
    this.ctx.stroke();

    // Annotation with intensity
    this.ctx.fillStyle = '#8b949e';
    this.ctx.font = '10px system-ui, sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(`${baseStrength} intensity | Continuous bilateral`, 5, barY - 8);

    // Intensity value on right
    this.ctx.fillStyle = '#fff';
    this.ctx.font = 'bold 11px system-ui, sans-serif';
    this.ctx.textAlign = 'right';
    this.ctx.fillText(baseStrength, this.width - 5, barY + segmentHeight - intensityHeight - 4);
  }

  _renderPositionMarker() {
    if (this.state.totalDuration === 0) return;
    
    const progress = this.state.elapsed / this.state.totalDuration;
    const x = progress * this.width;
    
    // Draw playhead line
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(x, 10);
    this.ctx.lineTo(x, this.height - 10);
    this.ctx.stroke();
    
    // Draw playhead head
    this.ctx.fillStyle = this.state.isPlaying ? '#3fb950' : '#f85149';
    this.ctx.beginPath();
    this.ctx.arc(x, 10, 5, 0, Math.PI * 2);
    this.ctx.fill();
    
    // Glow effect
    this.ctx.shadowColor = this.state.isPlaying ? '#3fb950' : '#f85149';
    this.ctx.shadowBlur = 10;
    this.ctx.beginPath();
    this.ctx.arc(x, 10, 3, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.shadowBlur = 0;
  }

  _getChannelColor(phase) {
    switch (phase) {
      case 'A': return '#1f6feb'; // left
      case 'C': return '#238636'; // right
      case 'D': return '#8957e5'; // bilateral
      default: return '#484f58';
    }
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  destroy() {
    this.container.innerHTML = '';
    this.onScrubCallback = null;
  }
}

if (typeof window !== 'undefined') {
  window.SessionTimeline = SessionTimeline;
}
