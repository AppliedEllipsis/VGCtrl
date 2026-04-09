/**
 * Pulsetto Session Timeline (Visual Script Display)
 *
 * Visualizes the session as timestamp-based script instructions.
 * Each instruction defines channel and intensity for a time range.
 *
 * The timeline:
 * 1. Renders script instructions as visual segments
 * 2. Tracks current position and highlights active instruction
 * 3. Notifies app when active instruction changes (for UI updates)
 * 4. No BLE commands sent - purely informational
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
      ...options
    };

    this.state = {
      mode: null,
      totalDuration: 0,
      elapsed: 0,
      isPlaying: false,
      baseStrength: 8
    };

    this.script = null;
    this.currentInstruction = null;
    this.tickTimer = null;

    // Callbacks
    this.onScrubCallback = null;
    this.onScriptStepCallback = null;

    this._init();
  }

  _init() {
    this._buildDOM();
    this._bindEvents();

    requestAnimationFrame(() => {
      this._resizeCanvas();
      this.render();
    });

    window.addEventListener('load', () => {
      this._resizeCanvas();
      this.render();
    });
  }

  _buildDOM() {
    this.container.innerHTML = `
      <div class="timeline-container">
        <div class="timeline-header">
          <span class="timeline-title">Session Script</span>
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
      </div>
    `;

    this.canvas = this.container.querySelector('.timeline-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.scrubber = this.container.querySelector('.timeline-scrubber');
    this.tooltip = this.container.querySelector('.scrubber-tooltip');
    this.positionDisplay = this.container.querySelector('.timeline-position');
    this.playStatus = this.container.querySelector('.play-status');

    // Handle high-DPI displays
    this._setupHighDPI();
  }

  _setupHighDPI() {
    const dpr = window.devicePixelRatio || 1;
    this.ctx.scale(dpr, dpr);
  }

  _resizeCanvas() {
    const wrapper = this.container.querySelector('.timeline-canvas-wrapper');
    const rect = wrapper.getBoundingClientRect();
    this.width = rect.width;
    this.height = this.options.height;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _bindEvents() {
    // Window resize
    window.addEventListener('resize', () => {
      this._resizeCanvas();
      this.render();
    });

    // Scrubber drag
    if (this.options.scrubEnabled) {
      this._bindScrubber();
    }

    // Control buttons
    this.container.querySelector('.btn-back-30').addEventListener('click', () => this.scrub(-30));
    this.container.querySelector('.btn-back-10').addEventListener('click', () => this.scrub(-10));
    this.container.querySelector('.btn-fwd-10').addEventListener('click', () => this.scrub(10));
    this.container.querySelector('.btn-fwd-30').addEventListener('click', () => this.scrub(30));
    this.container.querySelector('.btn-rewind').addEventListener('click', () => this.scrub(-Infinity));
    this.container.querySelector('.btn-fast-fwd').addEventListener('click', () => this.scrub(Infinity));
  }

  _bindScrubber() {
    let isDragging = false;

    const getElapsedFromX = (x) => {
      const rect = this.canvas.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
      return progress * this.state.totalDuration;
    };

    const startDrag = (e) => {
      isDragging = true;
      this.scrubber.classList.add('dragging');
      const x = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
      const elapsed = getElapsedFromX(x);
      this._setScrubberPosition(elapsed);
      if (this.onScrubCallback) {
        this.onScrubCallback(elapsed, null); // null = not done yet
      }
    };

    const moveDrag = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      const x = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
      const elapsed = getElapsedFromX(x);
      this._setScrubberPosition(elapsed);
      if (this.onScrubCallback) {
        this.onScrubCallback(elapsed, null);
      }
    };

    const endDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;
      this.scrubber.classList.remove('dragging');
      const x = e.type.includes('touch') ? e.changedTouches[0].clientX : e.clientX;
      const elapsed = getElapsedFromX(x);
      if (this.onScrubCallback) {
        this.onScrubCallback(elapsed, () => {}); // done callback
      }
    };

    this.scrubber.addEventListener('mousedown', startDrag);
    this.scrubber.addEventListener('touchstart', startDrag, { passive: false });

    document.addEventListener('mousemove', moveDrag);
    document.addEventListener('touchmove', moveDrag, { passive: false });

    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);

    // Click on canvas to seek
    this.canvas.addEventListener('click', (e) => {
      const elapsed = getElapsedFromX(e.clientX);
      if (this.onScrubCallback) {
        this.onScrubCallback(elapsed, () => {});
      }
    });
  }

  onScrub(callback) {
    this.onScrubCallback = callback;
  }

  onScriptStep(callback) {
    this.onScriptStepCallback = callback;
  }

  setMode(mode, totalDuration, baseStrength = 8) {
    this.state.mode = mode;
    this.state.totalDuration = totalDuration;
    this.state.baseStrength = baseStrength;
    this.state.elapsed = 0;

    // Generate script instructions
    this.script = new TimelineScript(mode, totalDuration, baseStrength);
    this.currentInstruction = null;

    this.render();
    this._updatePositionDisplay();
  }

  startTracking() {
    // Start tick loop to check for script step changes
    this._tick();
  }

  stopTracking() {
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  pauseTracking() {
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  resumeTracking() {
    this._tick();
  }

  _tick() {
    if (!this.script || this.state.totalDuration === 0) return;

    const instruction = this.script.getInstructionAt(this.state.elapsed);

    // Check if we stepped to a new instruction
    if (instruction && instruction !== this.currentInstruction) {
      this.currentInstruction = instruction;

      // Notify app of script step change
      // Note: isSeek=false for natural progression - app should NOT send commands
      if (this.onScriptStepCallback) {
        const step = {
          channel: instruction.channel,
          intensity: this.script.getIntensityAt(this.state.elapsed),
          label: instruction.label,
          type: instruction.type,
          start: instruction.start,
          end: instruction.end,
          isSeek: false  // Natural progression, not user seek
        };
        this.onScriptStepCallback(step);
      }
    }

    // Continue ticking
    this.tickTimer = setTimeout(() => this._tick(), 1000);
  }

  seek(elapsedSeconds) {
    this.state.elapsed = elapsedSeconds;

    if (this.script) {
      const instruction = this.script.getInstructionAt(elapsedSeconds);

      // Always notify on seek (user jumped to different point)
      if (instruction && this.onScriptStepCallback) {
        const step = {
          channel: instruction.channel,
          intensity: this.script.getIntensityAt(elapsedSeconds),
          label: instruction.label,
          type: instruction.type,
          start: instruction.start,
          end: instruction.end,
          isSeek: true
        };
        this.onScriptStepCallback(step);
      }

      this.currentInstruction = instruction;
    }

    this._updateScrubber();
    this._updatePositionDisplay();
    this.render();
  }

  updateProgress(elapsed, isPlaying = true) {
    this.state.elapsed = elapsed;
    this.state.isPlaying = isPlaying;
    this._updateScrubber();
    this._updatePositionDisplay();
    this._updatePlayStatus();
    this.render();
  }

  _setScrubberPosition(elapsed) {
    this.state.elapsed = Math.max(0, Math.min(this.state.totalDuration, elapsed));
    this._updateScrubber();
    this._updatePositionDisplay();
    this.render();
  }

  scrub(deltaSeconds) {
    const newElapsed = Math.max(0, Math.min(
      this.state.totalDuration,
      this.state.elapsed + deltaSeconds
    ));

    this.seek(newElapsed);

    if (this.onScrubCallback) {
      this.onScrubCallback(newElapsed);
    }

    return newElapsed;
  }

  seekComplete() {
    // No-op for compatibility
  }

  _updateScrubber() {
    if (this.state.totalDuration === 0) return;

    const progress = this.state.elapsed / this.state.totalDuration;
    const x = progress * this.width;

    this.scrubber.style.left = `${x}px`;

    // Update tooltip with current script step info
    if (this.script) {
      const instruction = this.script.getInstructionAt(this.state.elapsed);
      const intensity = this.script.getIntensityAt(this.state.elapsed);
      const chLabel = instruction?.channel === 'left' ? 'L' :
                     instruction?.channel === 'right' ? 'R' :
                     instruction?.channel === 'bilateral' ? 'B' : 'OFF';
      this.tooltip.textContent = `${this._formatTime(this.state.elapsed)} ${chLabel}${intensity}`;
    } else {
      this.tooltip.textContent = this._formatTime(this.state.elapsed);
    }
  }

  _updatePositionDisplay() {
    if (this.script && this.state.totalDuration > 0) {
      const instruction = this.script.getInstructionAt(this.state.elapsed);
      const intensity = this.script.getIntensityAt(this.state.elapsed);
      const chLabel = instruction?.channel === 'left' ? 'L' :
                     instruction?.channel === 'right' ? 'R' :
                     instruction?.channel === 'bilateral' ? 'B' : 'OFF';
      this.positionDisplay.textContent =
        `${this._formatTime(this.state.elapsed)} / ${this._formatTime(this.state.totalDuration)} | ${chLabel}${intensity}`;
    } else {
      this.positionDisplay.textContent =
        `${this._formatTime(this.state.elapsed)} / ${this._formatTime(this.state.totalDuration)}`;
    }
  }

  _updatePlayStatus() {
    const status = this.state.isPlaying ? 'Playing' : 'Paused';
    this.playStatus.textContent = status;
    this.playStatus.className = `play-status ${this.state.isPlaying ? 'playing' : 'paused'}`;
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  render() {
    if (!this.ctx || !this.script) return;
    this._resizeCanvas();

    this.ctx.clearRect(0, 0, this.width, this.height);

    const instructions = this.script.getInstructions();
    const barY = (this.height - this.options.segmentHeight) / 2;

    // Draw each instruction as a segment
    instructions.forEach((instruction) => {
      const startX = (instruction.start / this.state.totalDuration) * this.width;
      const endX = (instruction.end / this.state.totalDuration) * this.width;
      const width = endX - startX;

      // Color based on channel
      let color = this._getChannelColor(instruction.channel);

      // Draw segment background
      this.ctx.fillStyle = color;
      this.ctx.fillRect(startX, barY, width, this.options.segmentHeight);

      // Draw intensity overlay
      const intensity = instruction.type === 'fade'
        ? (instruction.startIntensity + instruction.endIntensity) / 2
        : instruction.intensity;
      const opacity = (intensity / 9) * 0.4;
      this.ctx.fillStyle = `rgba(255,255,255,${opacity})`;
      this.ctx.fillRect(startX, barY, width, this.options.segmentHeight);

      // Draw fade gradient if applicable
      if (instruction.type === 'fade') {
        const gradient = this.ctx.createLinearGradient(startX, 0, endX, 0);
        gradient.addColorStop(0, `rgba(255,255,255,${(instruction.startIntensity / 9) * 0.4})`);
        gradient.addColorStop(1, `rgba(0,0,0,0.3)`);
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(startX, barY, width, this.options.segmentHeight);

        // Draw fade indicator arrow
        this.ctx.fillStyle = '#fff';
        this.ctx.beginPath();
        const arrowY = barY + this.options.segmentHeight - 8;
        this.ctx.moveTo(startX + 5, arrowY);
        this.ctx.lineTo(startX + 12, arrowY - 3);
        this.ctx.lineTo(startX + 12, arrowY + 3);
        this.ctx.fill();
      }

      // Draw wave pattern indicator
      if (instruction.type === 'wave') {
        this.ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        const waveHeight = 8;
        const waveY = barY + this.options.segmentHeight / 2;
        for (let x = 0; x < width; x += 2) {
          const y = waveY + Math.sin((x / width) * Math.PI * 4) * waveHeight;
          if (x === 0) this.ctx.moveTo(startX + x, y);
          else this.ctx.lineTo(startX + x, y);
        }
        this.ctx.stroke();
      }

      // Draw label
      if (width > 30) {
        this.ctx.fillStyle = '#fff';
        this.ctx.font = 'bold 10px system-ui, sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(instruction.label, startX + width / 2, barY + 16);

        // Draw type indicator for rest/breathing phases
        if (instruction.type === 'rest') {
          this.ctx.font = '9px system-ui, sans-serif';
          this.ctx.fillStyle = 'rgba(255,255,255,0.7)';
          this.ctx.fillText('OFF', startX + width / 2, barY + 26);
        }
      }
    });

    // Draw current position indicator
    const progress = this.state.elapsed / this.state.totalDuration;
    const x = progress * this.width;
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(x, barY - 5);
    this.ctx.lineTo(x, barY + this.options.segmentHeight + 5);
    this.ctx.stroke();
  }

  _getChannelColor(channel) {
    switch (channel) {
      case 'left': return '#238636';
      case 'right': return '#1f6feb';
      case 'bilateral': return '#8957e5';
      default: return '#484f58';
    }
  }

  // Placeholders for compatibility
  setChannelOverride(channel) {
    // Timeline just displays, override is handled by app
  }

  setIntensity(intensity) {
    // Timeline just displays, intensity is handled by app
  }

  notifyExternalChange(type, value) {
    console.log('[Timeline] External change:', type, value);
  }

  destroy() {
    this.stopTracking();
    this.container.innerHTML = '';
    this.onScrubCallback = null;
    this.onScriptStepCallback = null;
  }
}

if (typeof window !== 'undefined') {
  window.SessionTimeline = SessionTimeline;
}
