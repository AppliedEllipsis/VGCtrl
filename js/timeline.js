/**
 * Pulsetto Session Timeline (Line Graph Visualization)
 *
 * Renders session as a line graph where:
 * - Y-axis = intensity (0-9)
 * - X-axis = time
 * - Line color = channel (green=left, blue=right, purple=both, gray=off)
 * - Arrows mark channel transitions
 *
 * Timeline notifies app of script steps; commands sent only on manual seek.
 */

class SessionTimeline {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Timeline container #${containerId} not found`);
    }

    this.options = {
      height: options.height || 150,
      scrubEnabled: options.scrubEnabled !== false,
      showLabels: options.showLabels !== false,
      padding: { top: 20, right: 10, bottom: 30, left: 40 },
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
        <div class="timeline-legend">
          <span class="legend-item"><span class="legend-color" style="background:#238636"></span>Left</span>
          <span class="legend-item"><span class="legend-color" style="background:#1f6feb"></span>Right</span>
          <span class="legend-item"><span class="legend-color" style="background:#8957e5"></span>Both</span>
          <span class="legend-item"><span class="legend-color" style="background:#484f58"></span>Off</span>
        </div>
      </div>
    `;

    this.canvas = this.container.querySelector('.timeline-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.scrubber = this.container.querySelector('.timeline-scrubber');
    this.tooltip = this.container.querySelector('.scrubber-tooltip');
    this.positionDisplay = this.container.querySelector('.timeline-position');
    this.playStatus = this.container.querySelector('.play-status');

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

    // Calculate graph area
    const p = this.options.padding;
    this.graphX = p.left;
    this.graphY = p.top;
    this.graphWidth = this.width - p.left - p.right;
    this.graphHeight = this.height - p.top - p.bottom;
  }

  _bindEvents() {
    window.addEventListener('resize', () => {
      this._resizeCanvas();
      this.render();
    });

    if (this.options.scrubEnabled) {
      this._bindScrubber();
    }

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
      const graphStart = this.graphX;
      const graphEnd = this.graphX + this.graphWidth;
      const progress = Math.max(0, Math.min(1, (x - rect.left - graphStart) / this.graphWidth));
      return progress * this.state.totalDuration;
    };

    const startDrag = (e) => {
      isDragging = true;
      this.scrubber.classList.add('dragging');
      const x = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
      const elapsed = getElapsedFromX(x);
      this._setScrubberPosition(elapsed);
      if (this.onScrubCallback) {
        this.onScrubCallback(elapsed, null);
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
        this.onScrubCallback(elapsed, () => {});
      }
    };

    this.scrubber.addEventListener('mousedown', startDrag);
    this.scrubber.addEventListener('touchstart', startDrag, { passive: false });

    document.addEventListener('mousemove', moveDrag);
    document.addEventListener('touchmove', moveDrag, { passive: false });

    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);

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

    this.script = new TimelineScript(mode, totalDuration, baseStrength);
    this.currentInstruction = null;
    this._lastReportedIntensity = null;

    this.render();
    this._updatePositionDisplay();
  }

  startTracking() {
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
    const currentIntensity = this.script.getIntensityAt(this.state.elapsed);

    // Check if we stepped to a new instruction
    const instructionChanged = instruction && instruction !== this.currentInstruction;

    // Check if intensity changed during a fade (same instruction, different intensity)
    const intensityChanged = instruction?.type === 'fade' &&
                           currentIntensity !== this._lastReportedIntensity;

    if (instructionChanged || intensityChanged) {
      this.currentInstruction = instruction;
      this._lastReportedIntensity = currentIntensity;

      if (this.onScriptStepCallback) {
        const step = {
          channel: instruction.channel,
          intensity: currentIntensity,
          label: instruction.label,
          type: instruction.type,
          start: instruction.start,
          end: instruction.end,
          isSeek: false,
          isFadeUpdate: intensityChanged && !instructionChanged
        };
        this.onScriptStepCallback(step);
      }
    }

    this.tickTimer = setTimeout(() => this._tick(), 1000);
  }

  seek(elapsedSeconds) {
    this.state.elapsed = elapsedSeconds;

    if (this.script) {
      const instruction = this.script.getInstructionAt(elapsedSeconds);

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

  seekComplete() {}

  _timeToX(elapsed) {
    return this.graphX + (elapsed / this.state.totalDuration) * this.graphWidth;
  }

  _intensityToY(intensity) {
    const maxIntensity = 9;
    return this.graphY + this.graphHeight - (intensity / maxIntensity) * this.graphHeight;
  }

  _updateScrubber() {
    if (this.state.totalDuration === 0) return;

    const x = this._timeToX(this.state.elapsed);
    this.scrubber.style.left = `${x}px`;

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

    const ctx = this.ctx;
    const instructions = this.script.getInstructions();

    // Clear
    ctx.clearRect(0, 0, this.width, this.height);

    // Draw grid
    this._drawGrid(ctx);

    // Draw the intensity line
    this._drawIntensityLine(ctx, instructions);

    // Draw channel arrows at transitions
    this._drawChannelArrows(ctx, instructions);

    // Draw axes
    this._drawAxes(ctx);

    // Draw current position
    this._drawPositionIndicator(ctx);
  }

  _drawGrid(ctx) {
    const { graphX, graphY, graphWidth, graphHeight } = this;

    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;

    // Horizontal grid lines (intensity levels 0-9)
    for (let i = 0; i <= 9; i++) {
      const y = this._intensityToY(i);
      ctx.beginPath();
      ctx.moveTo(graphX, y);
      ctx.lineTo(graphX + graphWidth, y);
      ctx.stroke();

      // Y-axis labels
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(i.toString(), graphX - 5, y + 3);
    }

    // Vertical time markers every minute
    const minutes = Math.floor(this.state.totalDuration / 60);
    for (let i = 1; i <= minutes; i++) {
      const x = this._timeToX(i * 60);
      ctx.beginPath();
      ctx.moveTo(x, graphY);
      ctx.lineTo(x, graphY + graphHeight);
      ctx.stroke();
    }
  }

  _drawIntensityLine(ctx, instructions) {
    if (instructions.length === 0) return;

    // Draw each segment with appropriate color
    instructions.forEach((instruction) => {
      const startX = this._timeToX(instruction.start);
      const endX = this._timeToX(instruction.end);
      const color = this._getChannelColor(instruction.channel);

      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (instruction.type === 'fade') {
        // Draw fade as gradient line
        const startY = this._intensityToY(instruction.startIntensity ?? this.state.baseStrength);
        const endY = this._intensityToY(instruction.endIntensity ?? 0);

        const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, '#484f58');
        ctx.strokeStyle = gradient;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      } else {
        // Draw constant intensity line
        const y = this._intensityToY(instruction.intensity ?? 0);

        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
      }
    });

    // Draw fill under the line
    ctx.save();
    ctx.beginPath();
    const firstX = this._timeToX(instructions[0].start);
    ctx.moveTo(firstX, this.graphY + this.graphHeight);

    instructions.forEach((instruction) => {
      const startX = this._timeToX(instruction.start);
      const endX = this._timeToX(instruction.end);

      if (instruction.type === 'fade') {
        const startY = this._intensityToY(instruction.startIntensity ?? this.state.baseStrength);
        const endY = this._intensityToY(instruction.endIntensity ?? 0);
        ctx.lineTo(startX, startY);
        ctx.lineTo(endX, endY);
      } else {
        const y = this._intensityToY(instruction.intensity ?? 0);
        ctx.lineTo(startX, y);
        ctx.lineTo(endX, y);
      }
    });

    ctx.lineTo(this._timeToX(instructions[instructions.length - 1].end), this.graphY + this.graphHeight);
    ctx.closePath();

    const fillGradient = ctx.createLinearGradient(0, this.graphY, 0, this.graphY + this.graphHeight);
    fillGradient.addColorStop(0, 'rgba(137, 87, 229, 0.2)');
    fillGradient.addColorStop(1, 'rgba(137, 87, 229, 0.05)');
    ctx.fillStyle = fillGradient;
    ctx.fill();
    ctx.restore();
  }

  _drawChannelArrows(ctx, instructions) {
    const arrowSize = 8;

    instructions.forEach((instruction, index) => {
      if (index === 0) return; // Skip first

      const prevInstruction = instructions[index - 1];
      if (prevInstruction.channel === instruction.channel) return; // No change

      const x = this._timeToX(instruction.start);
      const y = this._intensityToY(instruction.intensity ?? 0);
      const color = this._getChannelColor(instruction.channel);

      // Draw arrow pointing in channel direction
      ctx.fillStyle = color;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;

      ctx.beginPath();
      if (instruction.channel === 'left') {
        // Point left
        ctx.moveTo(x - arrowSize, y);
        ctx.lineTo(x, y - arrowSize/2);
        ctx.lineTo(x, y + arrowSize/2);
      } else if (instruction.channel === 'right') {
        // Point right
        ctx.moveTo(x + arrowSize, y);
        ctx.lineTo(x, y - arrowSize/2);
        ctx.lineTo(x, y + arrowSize/2);
      } else if (instruction.channel === 'bilateral') {
        // Diamond for both
        ctx.moveTo(x, y - arrowSize);
        ctx.lineTo(x + arrowSize, y);
        ctx.lineTo(x, y + arrowSize);
        ctx.lineTo(x - arrowSize, y);
      } else {
        // X for off
        ctx.moveTo(x - arrowSize/2, y - arrowSize/2);
        ctx.lineTo(x + arrowSize/2, y + arrowSize/2);
        ctx.moveTo(x + arrowSize/2, y - arrowSize/2);
        ctx.lineTo(x - arrowSize/2, y + arrowSize/2);
        ctx.stroke();
        return;
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
  }

  _drawAxes(ctx) {
    const { graphX, graphY, graphWidth, graphHeight } = this;

    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;

    // Y-axis
    ctx.beginPath();
    ctx.moveTo(graphX, graphY);
    ctx.lineTo(graphX, graphY + graphHeight);
    ctx.stroke();

    // X-axis
    ctx.beginPath();
    ctx.moveTo(graphX, graphY + graphHeight);
    ctx.lineTo(graphX + graphWidth, graphY + graphHeight);
    ctx.stroke();

    // X-axis labels (time)
    const totalMinutes = Math.ceil(this.state.totalDuration / 60);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';

    for (let i = 0; i <= totalMinutes; i += Math.ceil(totalMinutes / 4)) {
      const x = this._timeToX(i * 60);
      ctx.fillText(`${i}m`, x, graphY + graphHeight + 15);
    }

    // Y-axis label
    ctx.save();
    ctx.translate(15, graphY + graphHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('Intensity', 0, 0);
    ctx.restore();
  }

  _drawPositionIndicator(ctx) {
    const x = this._timeToX(this.state.elapsed);
    const y = this._intensityToY(
      this.script ? this.script.getIntensityAt(this.state.elapsed) : 0
    );

    // Vertical line
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x, this.graphY);
    ctx.lineTo(x, this.graphY + this.graphHeight);
    ctx.stroke();
    ctx.setLineDash([]);

    // Current point circle
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();

    // Outer ring
    ctx.strokeStyle = this._getChannelColor(
      this.script?.getInstructionAt(this.state.elapsed)?.channel ?? 'off'
    );
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  _getChannelColor(channel) {
    switch (channel) {
      case 'left': return '#238636';
      case 'right': return '#1f6feb';
      case 'bilateral': return '#8957e5';
      default: return '#484f58';
    }
  }

  setChannelOverride(channel) {}
  setIntensity(intensity) {}

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
