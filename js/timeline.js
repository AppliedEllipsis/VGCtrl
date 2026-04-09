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
          <div class="timeline-scrubber">
            <div class="scrubber-handle">
              <div class="scrubber-tooltip">00:00</div>
            </div>
          </div>
          <div class="timeline-hover-tooltip hidden"></div>
        </div>
        
        <div class="timeline-controls">
          <button class="btn-timeline btn-rewind" title="Rewind 10s">
            <svg viewBox="0 0 24 24" width="18" height="18">
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
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>
            </svg>
          </button>
        </div>
        
        <div class="timeline-legend">
          <div class="legend-item">
            <span class="legend-color active-left"></span>
            <span>Left Active</span>
          </div>
          <div class="legend-item">
            <span class="legend-color active-right"></span>
            <span>Right Active</span>
          </div>
          <div class="legend-item">
            <span class="legend-color active-both"></span>
            <span>Both Active</span>
          </div>
          <div class="legend-item">
            <span class="legend-color active-rest"></span>
            <span>Rest/Off</span>
          </div>
          <div class="legend-item breathing">
            <span class="legend-color active-breathing"></span>
            <span>Breathing-gated</span>
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
    
    // Show hover tooltip with mode state at that time
    const modeInfo = this._getModeStateAt(time);
    this.hoverTooltip.textContent = `${this._formatTime(time)} - ${modeInfo}`;
    this.hoverTooltip.style.left = `${x}px`;
    this.hoverTooltip.classList.remove('hidden');
  }

  _hideHover() {
    this.hoverTooltip.classList.add('hidden');
  }

  _getModeStateAt(time) {
    if (!this.modeEngine || !this.state.mode) return 'Unknown';
    
    const result = this.modeEngine.tick(time, this.state.totalDuration, this.state.baseStrength);
    return result.statusText || 'Unknown';
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
  startTracking(ble, clock) {
    // Initialize state manager
    this.stateManager = new TimelineStateManager({
      ble: ble,
      clock: clock,
      heartbeatIntervalMs: this.options.heartbeatIntervalMs,
      onStateChange: (change) => this._onStateChange(change),
      onHeartbeat: (data) => this._onHeartbeat(data)
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
   * Notify state manager of external changes (manual controls)
   */
  notifyExternalChange(type, value) {
    if (this.stateManager) {
      this.stateManager.notifyExternalChange(type, value);
    }
  }

  /**
   * Get current expected state from state manager
   */
  getExpectedState() {
    return this.stateManager ? this.stateManager.getExpectedState() : null;
  }

  _onStateChange(change) {
    // Visual feedback for state changes could go here
    console.log('[Timeline] State change:', change);
  }

  _onHeartbeat(data) {
    // Visual feedback for heartbeat could go here
    // console.log('[Timeline] Heartbeat:', data);
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
    
    this.scrubber.style.left = `${x}px`;
    this.tooltip.textContent = this._formatTime(this.state.elapsed);
  }

  _updatePositionDisplay() {
    this.positionDisplay.textContent = 
      `${this._formatTime(this.state.elapsed)} / ${this._formatTime(this.state.totalDuration)}`;
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
    
    // Draw phase segments
    phases.forEach((phase, i) => {
      const x = i * phaseWidth;
      const isFadePhase = i >= 4; // Last phase has fade
      
      // Base color by channel
      let color = this._getChannelColor(phase);
      
      // Draw segment background
      this.ctx.fillStyle = color;
      this.ctx.fillRect(x + 1, barY, phaseWidth - 2, this.options.segmentHeight);
      
      // Draw fade overlay for last phase
      if (isFadePhase) {
        const gradient = this.ctx.createLinearGradient(x, 0, x + phaseWidth, 0);
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(0.5, 'rgba(0,0,0,0.3)');
        gradient.addColorStop(1, 'rgba(0,0,0,0.5)');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(x + 1, barY, phaseWidth - 2, this.options.segmentHeight);
      }
      
      // Draw phase label
      this.ctx.fillStyle = '#fff';
      this.ctx.font = 'bold 11px system-ui, sans-serif';
      this.ctx.textAlign = 'center';
      const labels = { 'D': 'Both', 'A': 'Left', 'C': 'Right' };
      this.ctx.fillText(labels[phase], x + phaseWidth / 2, barY + 20);
      
      // Draw time label
      this.ctx.fillStyle = '#8b949e';
      this.ctx.font = '10px system-ui, sans-serif';
      const startTime = i * phaseDuration;
      this.ctx.fillText(this._formatTime(startTime), x + 5, barY - 5);
    });
    
    // Draw fade annotation
    this.ctx.fillStyle = '#f0883e';
    this.ctx.font = '10px system-ui, sans-serif';
    this.ctx.textAlign = 'right';
    this.ctx.fillText('↓ Fade -1, -2', this.width - 5, barY + this.options.segmentHeight + 15);
  }

  _renderFocusTimeline() {
    const cycleDuration = 60; // 30s on, 30s off
    const numCycles = Math.ceil(this.state.totalDuration / cycleDuration);
    const cycleWidth = this.width / numCycles;
    const barY = (this.height - this.options.segmentHeight) / 2;
    const segmentHeight = this.options.segmentHeight;
    
    for (let i = 0; i < numCycles; i++) {
      const x = i * cycleWidth;
      const onWidth = cycleWidth * 0.5;
      const offWidth = cycleWidth * 0.5;
      
      // ON segment (left channel)
      this.ctx.fillStyle = '#1f6feb'; // left color
      this.ctx.fillRect(x, barY, onWidth - 1, segmentHeight);
      
      // OFF segment
      this.ctx.fillStyle = '#484f58';
      this.ctx.fillRect(x + onWidth, barY, offWidth - 1, segmentHeight);
      
      // Draw stripes on ON segment
      this.ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      this.ctx.lineWidth = 1;
      for (let s = 10; s < onWidth; s += 10) {
        this.ctx.beginPath();
        this.ctx.moveTo(x + s, barY);
        this.ctx.lineTo(x + s, barY + segmentHeight);
        this.ctx.stroke();
      }
      
      // Label
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '10px system-ui, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(`${i + 1}`, x + cycleWidth / 2, barY + 20);
    }
    
    // Legend annotation
    this.ctx.fillStyle = '#8b949e';
    this.ctx.font = '11px system-ui, sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.fillText('30s ON / 30s OFF cycles', 5, barY - 10);
  }

  _renderPainTimeline() {
    const barY = (this.height - this.options.segmentHeight) / 2;
    const waveHeight = this.options.segmentHeight;
    const amplitude = waveHeight / 4;
    const centerY = barY + waveHeight / 2;
    
    // Draw sine wave background
    const gradient = this.ctx.createLinearGradient(0, barY, 0, barY + waveHeight);
    gradient.addColorStop(0, '#238636');
    gradient.addColorStop(1, '#1f6feb');
    
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.moveTo(0, centerY);
    
    const period = 20; // 20 second period
    const frequency = (this.state.totalDuration / period) * 2 * Math.PI / this.width;
    
    for (let x = 0; x <= this.width; x += 2) {
      const t = (x / this.width) * this.state.totalDuration;
      const sine = Math.sin((t % period) / period * 2 * Math.PI);
      const y = centerY + sine * amplitude;
      this.ctx.lineTo(x, y);
    }
    
    this.ctx.lineTo(this.width, barY + waveHeight);
    this.ctx.lineTo(0, barY + waveHeight);
    this.ctx.closePath();
    this.ctx.fill();
    
    // Draw wave line
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    for (let x = 0; x <= this.width; x += 2) {
      const t = (x / this.width) * this.state.totalDuration;
      const sine = Math.sin((t % period) / period * 2 * Math.PI);
      const y = centerY + sine * amplitude;
      if (x === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.stroke();
    
    // Labels for periods
    const numPeriods = Math.ceil(this.state.totalDuration / period);
    this.ctx.fillStyle = '#8b949e';
    this.ctx.font = '10px system-ui, sans-serif';
    this.ctx.textAlign = 'center';
    for (let i = 0; i < numPeriods; i++) {
      const x = (i * period / this.state.totalDuration) * this.width;
      this.ctx.fillText(`~${i + 1}`, x + 10, barY - 5);
    }
    
    // Annotation
    this.ctx.fillStyle = '#8b949e';
    this.ctx.textAlign = 'right';
    this.ctx.fillText('±1 intensity wave (20s period)', this.width - 5, barY - 10);
  }

  _renderHeadacheTimeline() {
    const burstOn = 120; // 2 minutes
    const burstOff = 30; // 30 seconds
    const cycle = burstOn + burstOff;
    const numCycles = Math.ceil(this.state.totalDuration / cycle);
    const cycleWidth = this.width / numCycles;
    const barY = (this.height - this.options.segmentHeight) / 2;
    
    for (let i = 0; i < numCycles; i++) {
      const x = i * cycleWidth;
      const onWidth = cycleWidth * (burstOn / cycle);
      const offWidth = cycleWidth * (burstOff / cycle);
      
      // ON segment (both)
      this.ctx.fillStyle = '#8957e5'; // both color
      this.ctx.fillRect(x, barY, onWidth - 1, this.options.segmentHeight);
      
      // Burst pattern stripes
      this.ctx.fillStyle = 'rgba(255,255,255,0.15)';
      const burstCount = 4;
      const stripeWidth = onWidth / burstCount / 2;
      for (let b = 0; b < burstCount * 2; b += 2) {
        this.ctx.fillRect(x + b * stripeWidth, barY, stripeWidth - 1, this.options.segmentHeight);
      }
      
      // OFF segment
      this.ctx.fillStyle = '#484f58';
      this.ctx.fillRect(x + onWidth, barY, offWidth - 1, this.options.segmentHeight);
      
      // Label
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '10px system-ui, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(`B${i + 1}`, x + onWidth / 2, barY + 20);
    }
    
    this.ctx.fillStyle = '#8b949e';
    this.ctx.font = '11px system-ui, sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.fillText('2min ON / 30s OFF burst cycles', 5, barY - 10);
  }

  _renderBreathingTimeline() {
    const isCalm = this.state.mode === 'calm';
    const inhale = isCalm ? 5 : 5;
    const hold = isCalm ? 5 : 4;
    const exhale = isCalm ? 7 : 5;
    const cycle = inhale + hold + exhale;
    
    const numCycles = Math.ceil(this.state.totalDuration / cycle);
    const cycleWidth = this.width / numCycles;
    const barY = (this.height - this.options.segmentHeight) / 2;
    const leadTime = 3;
    
    for (let i = 0; i < numCycles; i++) {
      const x = i * cycleWidth;
      const inhaleWidth = cycleWidth * (inhale / cycle);
      const holdWidth = cycleWidth * (hold / cycle);
      const exhaleWidth = cycleWidth * (exhale / cycle);
      
      // Inhale (stimulation starts after lead time)
      const leadWidth = cycleWidth * (leadTime / cycle);
      const activeInhaleWidth = inhaleWidth - leadWidth;
      
      // Lead portion (no stimulation)
      this.ctx.fillStyle = '#484f58';
      this.ctx.fillRect(x, barY, leadWidth - 1, this.options.segmentHeight);
      
      // Active inhale
      const inhaleGrad = this.ctx.createLinearGradient(x + leadWidth, barY, x + inhaleWidth, barY);
      inhaleGrad.addColorStop(0, '#8957e5');
      inhaleGrad.addColorStop(1, '#238636');
      this.ctx.fillStyle = inhaleGrad;
      this.ctx.fillRect(x + leadWidth, barY, activeInhaleWidth - 1, this.options.segmentHeight);
      
      // Hold (active)
      this.ctx.fillStyle = '#238636';
      this.ctx.fillRect(x + inhaleWidth, barY, holdWidth - 1, this.options.segmentHeight);
      
      // Exhale (rest)
      this.ctx.fillStyle = '#484f58';
      this.ctx.fillRect(x + inhaleWidth + holdWidth, barY, exhaleWidth - 1, this.options.segmentHeight);
      
      // Phase labels inside
      this.ctx.fillStyle = 'rgba(255,255,255,0.7)';
      this.ctx.font = '9px system-ui, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('▲', x + leadWidth + activeInhaleWidth / 2, barY + 12);
      this.ctx.fillText('●', x + inhaleWidth + holdWidth / 2, barY + 12);
      this.ctx.fillText('▼', x + inhaleWidth + holdWidth + exhaleWidth / 2, barY + 12);
      
      // Cycle number
      this.ctx.fillStyle = '#8b949e';
      this.ctx.font = '10px system-ui, sans-serif';
      this.ctx.fillText(`${i + 1}`, x + cycleWidth / 2, barY + this.options.segmentHeight + 12);
    }
    
    // Annotation
    this.ctx.fillStyle = '#8b949e';
    this.ctx.font = '11px system-ui, sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(`${inhale}s inhale → ${hold}s hold → ${exhale}s exhale`, 5, barY - 10);
  }

  _renderContinuousTimeline() {
    const barY = (this.height - this.options.segmentHeight) / 2;
    const gradient = this.ctx.createLinearGradient(0, barY, 0, barY + this.options.segmentHeight);
    gradient.addColorStop(0, '#8957e5');
    gradient.addColorStop(0.5, '#1f6feb');
    gradient.addColorStop(1, '#238636');
    
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, barY, this.width, this.options.segmentHeight);
    
    // Add subtle pulse animation indication
    this.ctx.fillStyle = 'rgba(255,255,255,0.1)';
    const pulseX = (Date.now() / 1000 % 1) * this.width;
    this.ctx.fillRect(pulseX - 20, barY, 40, this.options.segmentHeight);
    
    this.ctx.fillStyle = '#8b949e';
    this.ctx.font = '11px system-ui, sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.fillText('Continuous bilateral stimulation', 5, barY - 10);
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
