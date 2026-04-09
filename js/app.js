/**
 * Pulsetto Web Controller Application
 * 
 * Main application that coordinates BLE connection, session clock,
 * and mode engines. Handles background/foreground transitions.
 */

class PulsettoApp {
  constructor() {
    // Core components - ASCII protocol (confirmed in official app v2.2.91)
    this.ble = new PulsettoBluetooth();
    this.clock = new SessionClock();
    this.modeEngine = null;
    this.timeline = null;
    
    // State
    this.selectedMode = 'calm';
    this.baseStrength = 8;
    this.timerMinutes = 10;
    this.effectiveStrength = null;
    this.isStimulationActive = false;
    this.activeChannel = ActiveChannel.OFF;
    this.breathingPhase = null;
    this.channelOverride = 'auto'; // 'auto', 'left', 'right', 'bilateral'
    this._isSeeking = false;
    this._seekTimeout = null;
    
    // Fade state: 'off', 'in', 'out', 'pulse'
    this._fadeState = 'off';
    this._fadeAbortController = null;
    this._fadeExecuting = false; // true while fade is actively running
    this._lastFadeIntensity = null; // track last intensity set by fade

    // Logging state
    this.autoScroll = true;
    this.logsExpanded = false;

    // Timers
    this.keepaliveTimer = null;
    this.statusPollTimer = null;
    this.breathingUpdateTimer = null;
    
    // Background keepalive system
    this.bgKeepalive = new BackgroundKeepalive({
      onKeepaliveTick: (data) => this._onBackgroundTick(data)
      // onWarn removed - avoid notification spam
    });
    
    // DOM references
    this.ui = {};
    
    this.init();
  }

  init() {
    this._cacheDOM();
    this._bindEvents();
    this._bindBLEEvents();
    this._bindClockEvents();
    this._initTimeline();

    // Set initial mode from HTML default (Sleep)
    const defaultMode = this.ui.modeSelect.value;
    this.selectMode(defaultMode);

    this._updateUI();

    this.log('Pulsetto Web Controller initialized (ASCII protocol)', 'info');
    this.log('Click "Scan for Device" to connect', 'info');
    this.log('Using ASCII protocol (verified with official app v2.2.91)', 'info');
  }

  _initTimeline() {
    if (!this.ui.timelineRoot) return;
    
    this.timeline = new SessionTimeline('timeline-root', {
      height: 120,
      scrubEnabled: true,
      showLabels: true
    });
    
    // Handle timeline scrubbing (seeking)
    // The callback receives (elapsed, doneCallback) - doneCallback must be called when seek is complete
    this.timeline.onScrub((newElapsed, doneCallback) => {
      this._seekSession(newElapsed, doneCallback);
    });
  }

  _seekSession(newElapsed, doneCallback = null) {
    if (!this.clock.isRunning && !this.clock.isPaused) return;
    
    // Clamp to valid range
    const clamped = Math.max(0, Math.min(this.clock.totalDuration, newElapsed));
    
    // Cancel any pending seek
    if (this._seekTimeout) {
      clearTimeout(this._seekTimeout);
    }
    
    // Debounce seek operations (300ms to match command queue debounce)
    // This prevents rapid scrubbing from queuing overlapping command sequences
    this._seekTimeout = setTimeout(async () => {
      // Set seeking flag to prevent mode engine ticks from queuing commands
      this._isSeeking = true;
      try {
        await this._executeSeek(clamped, doneCallback);
      } finally {
        this._isSeeking = false;
      }
    }, 300);
  }

  async _executeSeek(clamped, doneCallback = null) {
    const wasRunning = this.clock.isRunning;
    
    if (wasRunning) {
      // Pause briefly while seeking
      this.clock.pause();
    }
    
    // Adjust the session start time to reflect the new elapsed
    const now = Date.now();
    const newElapsedMs = clamped * 1000;
    
    // Recalculate session start time
    this.clock.sessionStartTime = now - newElapsedMs - this.clock.accumulatedPauseTime;
    this.clock.elapsedSeconds = clamped;
    this.clock.remainingSeconds = this.clock.totalDuration - clamped;
    
    // Send updated commands to device for the new position
    if (this.modeEngine && this.ble.canSendCommands) {
      let commands = this.modeEngine.reconnectCommands(
        clamped,
        this.clock.totalDuration,
        this.baseStrength
      );
      
      // Apply channel override if set
      if (this.channelOverride !== 'auto') {
        commands = applyChannelOverride(commands, this.channelOverride);
      }
      
      if (commands.length > 0) {
        // Wait for any pending/in-flight commands to complete before seeking
        // This prevents interleaving seek commands with ongoing sequences
        await this.ble.waitForCommandsComplete(5000);
        
        // Clear any remaining pending commands (just in case)
        this.ble.clearCommandQueue();
        
        // Send seek commands with standard 2s delays between them
        for (const cmd of commands) {
          await this.ble.sendCommand(cmd);
          if (cmd !== commands[commands.length - 1]) {
            await new Promise(r => setTimeout(r, 2000));
          }
        }
        
        this.isStimulationActive = !commands.includes(PulsettoProtocol.Commands.stop);
        this.log(`Seek: ${this._formatTime(clamped)}`, 'info');
      }
    }
    
    // Update timeline (which will clear seeking flag via callback)
    this.timeline.updateProgress(clamped, wasRunning);
    
    // Signal seek complete to timeline
    if (doneCallback) {
      doneCallback();
    }
    this.timeline.seekComplete();
    
    // Resume if was running
    if (wasRunning) {
      this.clock.resume();
    }
    
    // Update UI
    this._onTick({
      remaining: this.clock.remainingSeconds,
      elapsed: clamped,
      progress: clamped / this.clock.totalDuration
    });
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  _cacheDOM() {
    // Connection panel
    this.ui.btnScan = document.getElementById('btn-scan');
    this.ui.btnDisconnect = document.getElementById('btn-disconnect');
    this.ui.deviceInfo = document.getElementById('device-info');
    this.ui.deviceName = document.getElementById('device-name');
    this.ui.deviceId = document.getElementById('device-id');
    
    // Status bar
    this.ui.connectionStatus = document.getElementById('connection-status');
    this.ui.statusText = document.getElementById('status-text');
    this.ui.batteryLevel = document.getElementById('battery-level');
    this.ui.chargingIndicator = document.getElementById('charging-indicator');
    
    // Session panel
    this.ui.modeSelect = document.getElementById('mode-select');
    this.ui.timerValue = document.getElementById('timer-value');
    this.ui.timerSlider = document.getElementById('timer-slider');
    this.ui.btnTimerUp = document.getElementById('btn-timer-up');
    this.ui.btnTimerDown = document.getElementById('btn-timer-down');
    this.ui.intensitySlider = document.getElementById('intensity-slider');
    this.ui.intensityValue = document.getElementById('intensity-value');

    // Mode description
    this.ui.modeDescription = document.getElementById('mode-description');
    this.ui.modeSummary = document.querySelector('#mode-description .mode-summary');
    this.ui.modeChannel = document.getElementById('mode-channel');
    this.ui.modePattern = document.getElementById('mode-pattern');
    this.ui.modeTiming = document.getElementById('mode-timing');

    // Channel override
    this.ui.channelAuto = document.getElementById('channel-auto');
    this.ui.channelLeft = document.getElementById('channel-left');
    this.ui.channelRight = document.getElementById('channel-right');
    this.ui.channelBoth = document.getElementById('channel-both');
    this.ui.fadeSelect = document.getElementById('fade-select');
    
    // Breathing guide
    this.ui.breathingGuide = document.getElementById('breathing-guide');
    this.ui.breathingCircle = document.getElementById('breathing-circle');
    this.ui.breathingText = document.getElementById('breathing-text');
    
    // Action buttons
    this.ui.btnStart = document.getElementById('btn-start');
    this.ui.btnPause = document.getElementById('btn-pause');
    this.ui.btnResume = document.getElementById('btn-resume');
    this.ui.btnStop = document.getElementById('btn-stop');
    
    // Progress
    this.ui.sessionProgress = document.getElementById('session-progress');
    this.ui.progressFill = document.getElementById('progress-fill');
    this.ui.elapsedTime = document.getElementById('elapsed-time');
    this.ui.remainingTime = document.getElementById('remaining-time');

    // Timeline
    this.ui.timelinePanel = document.getElementById('timeline-panel');
    this.ui.timelineRoot = document.getElementById('timeline-root');

    // Footer
    this.ui.wakeLockStatus = document.getElementById('wake-lock-status');
    this.ui.visibilityStatus = document.getElementById('visibility-status');
    
    // Logs
    this.ui.logContainer = document.getElementById('log-container');
    this.ui.btnClearLogs = document.getElementById('btn-clear-logs');
    this.ui.btnAutoScroll = document.getElementById('btn-auto-scroll');
    this.ui.btnExpandLogs = document.getElementById('btn-expand-logs');
  }

  _bindEvents() {
    // Connection
    this.ui.btnScan.addEventListener('click', () => this.scanAndConnect());
    this.ui.btnDisconnect.addEventListener('click', () => this.disconnect());

    // Mode selection
    this.ui.modeSelect.addEventListener('change', (e) => this.selectMode(e.target.value));
    
    // Timer controls
    this.ui.timerSlider.addEventListener('input', (e) => this.setTimerMinutes(parseInt(e.target.value)));
    this.ui.btnTimerUp.addEventListener('click', () => this.adjustTimer(1));
    this.ui.btnTimerDown.addEventListener('click', () => this.adjustTimer(-1));
    
    // Intensity
    this.ui.intensitySlider.addEventListener('input', (e) => this.setIntensity(parseInt(e.target.value)));
    
    // Session actions
    this.ui.btnStart.addEventListener('click', () => this.startSession());
    this.ui.btnPause.addEventListener('click', () => this.pauseSession());
    this.ui.btnResume.addEventListener('click', () => this.resumeSession());
    this.ui.btnStop.addEventListener('click', () => this.stopSession());

    // Channel override buttons
    [this.ui.channelAuto, this.ui.channelLeft, this.ui.channelRight, this.ui.channelBoth].forEach(btn => {
      btn?.addEventListener('click', (e) => this.setChannelOverride(e.target.dataset.channel));
    });
    
    // Fade dropdown
    this.ui.fadeSelect?.addEventListener('change', (e) => this._onFadeSelect(e.target.value));

    // Logs
    this.ui.btnClearLogs.addEventListener('click', () => this.clearLogs());
    this.ui.btnAutoScroll.addEventListener('click', () => this.toggleAutoScroll());
    this.ui.btnExpandLogs.addEventListener('click', () => this.toggleLogExpansion());

    // Track manual scrolling to disable auto-scroll when user scrolls up
    this.ui.logContainer.addEventListener('scroll', () => this._onLogScroll());
  }

  _bindBLEEvents() {
    this.ble.on('stateChange', ({ newState }) => {
      this._updateConnectionStatus(newState);
    });
    
    this.ble.on('connected', ({ name, id }) => {
      this.ui.deviceName.textContent = name;
      this.ui.deviceId.textContent = id.substring(0, 8);
      this.ui.deviceInfo.classList.remove('hidden');
      this.ui.btnScan.classList.add('hidden');
      this.ui.btnDisconnect.classList.remove('hidden');

      this.log(`Connected to ${name}`, 'success');
      
      // Query status immediately
      this.ble.queryStatus();
      this._startStatusPoll();
      
      this._enableSessionControls(true);
    });
    
    this.ble.on('disconnected', ({ unexpected }) => {
      this.ui.deviceInfo.classList.add('hidden');
      this.ui.btnScan.classList.remove('hidden');
      this.ui.btnDisconnect.classList.add('hidden');
      this.ui.batteryLevel.classList.add('hidden');
      this.ui.chargingIndicator.classList.add('hidden');
      
      this._stopKeepalive();
      this._stopStatusPoll();
      
      // Reset session state
      this.isStimulationActive = false;
      this.effectiveStrength = null;
      this.activeChannel = ActiveChannel.OFF;
      
      // Stop any running session
      if (this.clock.isRunning || this.clock.isPaused) {
        this.clock.stop();
        this.log('Session stopped due to disconnect', 'warning');
      }
      
      // Clear mode engine and timeline
      this.modeEngine = null;
      if (this.timeline) {
        this.timeline.seekComplete(); // Clear any pending seek
      }
      
      // Cancel any active fade
      this._cancelFade();
      
      if (unexpected) {
        this.log('Connection lost unexpectedly', 'error');
      } else {
        this.log('Disconnected', 'info');
      }
      
      this._enableSessionControls(false);
      this._updateActionButtons();
    });
    
    this.ble.on('notification', ({ text, parsed }) => {
      this._handleNotification(parsed);
    });
    
    this.ble.on('commandSending', ({ command }) => {
      // This fires when a command is about to be sent (after debounce)
      const clean = command.replace('\n', '');
      const label = /^[1-9]$/.test(clean) ? `intensity ${clean}` : 
                    clean === 'A' ? 'left' :
                    clean === 'C' ? 'right' :
                    clean === 'D' ? 'bilateral' :
                    clean === '-' ? 'stop' : clean;
      this.log(`Sending ${label}...`, 'info');
    });
    
    this.ble.on('commandSent', ({ command, bytes }) => {
      this.log(`→ ${command.replace('\n', '')}`, 'command', bytes);
    });
    
    this.ble.on('commandError', ({ command, error }) => {
      this.log(`✗ ${command.replace('\n', '')}: ${error}`, 'error');
    });

    this.ble.on('error', ({ error }) => {
      this.log(`Error: ${error.message}`, 'error');
    });
    
    this.ble.on('visibilityChange', ({ hidden }) => {
      this.ui.visibilityStatus.textContent = hidden ? 'Background' : 'Visible';
      this.ui.visibilityStatus.classList.toggle('hidden-state', hidden);

      // Reset throttle warning when tab becomes visible
      if (!hidden) {
        this._throttleWarned = false;
      }
    });
  }

  _bindClockEvents() {
    this.clock.on('started', ({ duration }) => {
      this.log(`Session started: ${SessionClock.formatTime(duration)}`, 'success');
      this._startKeepalive();
      this.bgKeepalive.start(); // Start background keepalive prevention
      this._updateActionButtons();
    });
    
    this.clock.on('tick', ({ remaining, elapsed, progress }) => {
      this._onTick({ remaining, elapsed, progress });
    });
    
    this.clock.on('paused', () => {
      this.log('Session paused', 'warning');
      this._stopKeepalive();
      this.bgKeepalive.stop();
      
      // Deactivate device
      this._sendStopCommand();
      
      this._updateActionButtons();
    });
    
    this.clock.on('resumed', () => {
      this.log('Session resumed', 'success');
      this._startKeepalive();
      this.bgKeepalive.start();
      
      // Resume on device
      this._resumeSessionOnDevice();
      this._updateActionButtons();
    });
    
    this.clock.on('stopped', () => {
      this.log('Session stopped', 'info');
      this._stopKeepalive();
      this._stopStatusPoll();
      this.bgKeepalive.stop();
      
      // Deactivate device
      this._sendStopCommand();
      
      this._updateActionButtons();
      this._resetSessionUI();
    });
    
    this.clock.on('completed', () => {
      this.log('Session completed!', 'success');
      this._stopKeepalive();
      this.bgKeepalive.stop();
      
      // Deactivate device
      this._sendStopCommand();
      
      this._updateActionButtons();
      this._resetSessionUI();
    });
    
    this.clock.on('backgrounded', () => {
      // Silent background transition - keepalive handles this automatically
      // Only log to console to avoid UI notification spam
      console.log('[App] Backgrounded - keepalive active');
    });
    
    this.clock.on('foregrounded', () => {
      this.log('App foregrounded - resuming', 'success');
      
      if (this.clock.isRunning) {
        this._resumeSessionOnDevice();
        this._startKeepalive();
      }
    });
    
    this.clock.on('wakeLockAcquired', () => {
      this.ui.wakeLockStatus.classList.remove('hidden');
    });
    
    this.clock.on('wakeLockReleased', () => {
      this.ui.wakeLockStatus.classList.add('hidden');
    });
  }

  // Actions
  async scanAndConnect() {
    try {
      await this.ble.scanAndConnect();
    } catch (error) {
      this.log(`Scan failed: ${error.message}`, 'error');
    }
  }

  async disconnect() {
    await this.ble.disconnect();
  }

  selectMode(mode) {
    this.selectedMode = mode;
    const modeConfig = PulsettoProtocol.Modes[mode];
    const description = ModeEngineFactory.getDescription(mode);

    if (modeConfig && !this.clock.isRunning && !this.clock.isPaused) {
      this.timerMinutes = modeConfig.duration;
      this.baseStrength = modeConfig.strength;

      this.ui.timerSlider.value = this.timerMinutes;
      this.ui.intensitySlider.value = this.baseStrength;
      this.ui.intensityValue.textContent = this.baseStrength;
      this.ui.timerValue.textContent = SessionClock.formatTime(this.timerMinutes * 60);
    }

    // Update mode description display
    if (this.ui.modeSummary) {
      this.ui.modeSummary.textContent = description.summary;
      this.ui.modeChannel.textContent = description.channel;
      this.ui.modePattern.textContent = description.pattern;
      this.ui.modeTiming.textContent = description.timing;
    }

    // Update timeline preview when not in session
    if (this.timeline && !this.clock.isRunning && !this.clock.isPaused) {
      this.ui.timelinePanel.classList.remove('hidden');
      // Defer render to ensure container has dimensions
      requestAnimationFrame(() => {
        this.timeline.setMode(mode, this.timerMinutes * 60, this.baseStrength);
        this.timeline.updateProgress(0, false);
      });
    }

    this._updateBreathingUI();
    this.log(`Mode selected: ${description.name}`, 'info');
  }

  setChannelOverride(channel) {
    this.channelOverride = channel;

    // Update button states
    [this.ui.channelAuto, this.ui.channelLeft, this.ui.channelRight, this.ui.channelBoth].forEach(btn => {
      if (btn) btn.classList.toggle('active', btn.dataset.channel === channel);
    });

    // If session is active (running or paused), send channel command with 2s delay then intensity
    const sessionActive = this.clock.isRunning || this.clock.isPaused;
    if (sessionActive && this.ble.canSendCommands) {
      // Determine target activation command
      let targetCmd;
      switch (channel) {
        case 'left': targetCmd = PulsettoProtocol.Commands.activateLeft; break;
        case 'right': targetCmd = PulsettoProtocol.Commands.activateRight; break;
        case 'bilateral': targetCmd = PulsettoProtocol.Commands.activateBilateral; break;
        default: 
          // For 'auto', use the mode engine's current channel preference
          if (this.modeEngine) {
            const result = this.modeEngine.tick(
              this.clock.elapsedSeconds,
              this.clock.totalDuration,
              this.baseStrength
            );
            switch (result.activeChannel) {
              case 'left': targetCmd = PulsettoProtocol.Commands.activateLeft; break;
              case 'right': targetCmd = PulsettoProtocol.Commands.activateRight; break;
              case 'bilateral': targetCmd = PulsettoProtocol.Commands.activateBilateral; break;
              default: targetCmd = PulsettoProtocol.Commands.stop;
            }
          }
      }
      
      if (targetCmd) {
        // Queue channel command (debounced, will coalesce with intensity)
        this.ble.queueChannel(targetCmd);
        // Always queue intensity after channel change
        this.ble.queueIntensity(PulsettoProtocol.Commands.intensity(this.baseStrength));
        this.isStimulationActive = targetCmd !== PulsettoProtocol.Commands.stop;
        this.log(`Channel: ${channel}`, 'info');
      }
    } else {
      this.log(`Channel: ${channel} (${sessionActive ? 'will apply on resume' : 'ready'})`, 'info');
    }
  }

  // Handle fade dropdown selection
  _onFadeSelect(mode) {
    // Cancel any existing fade first
    if (this._fadeAbortController) {
      this._fadeAbortController.abort();
      this._fadeAbortController = null;
    }
    
    this._fadeState = mode;
    
    if (mode === 'off') {
      this._cancelFade();
      this.log('Fade: off', 'info');
      return;
    }
    
    // Start the fade
    this._triggerFade(mode);
  }
  
  // Reset fade select dropdown to off
  _resetFadeSelect() {
    if (this.ui.fadeSelect) {
      this.ui.fadeSelect.value = 'off';
    }
    this._fadeState = 'off';
  }
  
  // Cancel any running fade
  _cancelFade() {
    this._fadeExecuting = false;
    this._lastFadeIntensity = null;
    if (this._fadeAbortController) {
      this._fadeAbortController.abort();
      this._fadeAbortController = null;
    }
    this._fadeState = 'off';
    this._resetFadeSelect();
  }

  // Trigger fade action with specified mode
  async _triggerFade(mode) {
    const sessionActive = this.clock.isRunning || this.clock.isPaused;
    if (!sessionActive || !this.ble.canSendCommands) {
      this.log('Fade: Start session first', 'warning');
      this._cancelFade();
      return;
    }

    // Cancel any previous fade
    if (this._fadeAbortController) {
      this._fadeAbortController.abort();
    }
    
    // Create new abort controller for this fade
    this._fadeAbortController = new AbortController();
    const signal = this._fadeAbortController.signal;
    
    this.log(`Fade ${mode} starting...`, 'info');
    
    // Determine current channel
    let currentChannel = PulsettoProtocol.Commands.activateBilateral;
    if (this.channelOverride !== 'auto') {
      switch (this.channelOverride) {
        case 'left': currentChannel = PulsettoProtocol.Commands.activateLeft; break;
        case 'right': currentChannel = PulsettoProtocol.Commands.activateRight; break;
        case 'bilateral': currentChannel = PulsettoProtocol.Commands.activateBilateral; break;
      }
    } else if (this.modeEngine) {
      const result = this.modeEngine.tick(
        this.clock.elapsedSeconds,
        this.clock.totalDuration,
        this.baseStrength
      );
      switch (result.activeChannel) {
        case 'left': currentChannel = PulsettoProtocol.Commands.activateLeft; break;
        case 'right': currentChannel = PulsettoProtocol.Commands.activateRight; break;
        case 'bilateral': currentChannel = PulsettoProtocol.Commands.activateBilateral; break;
      }
    }

    const targetStrength = this.baseStrength;
    const fadeCommands = [];
    
    // Activate channel first
    fadeCommands.push({ cmd: currentChannel, step: 0, total: 0, label: 'activate' });
    
    // Get starting intensity (current effective strength or base)
    const startStrength = this.effectiveStrength || this.baseStrength;
    
    // Build intensity sequence based on mode
    if (mode === 'in') {
      // Ramp up: startStrength -> target over ~15 seconds
      const rampSteps = Math.ceil(Math.abs(targetStrength - startStrength) / 2);
      if (rampSteps > 0) {
        for (let i = 0; i < rampSteps; i++) {
          const level = Math.min(Math.ceil(startStrength + (targetStrength - startStrength) * ((i + 1) / rampSteps)), 9);
          fadeCommands.push({ cmd: PulsettoProtocol.Commands.intensity(level), step: i + 1, total: rampSteps, label: `intensity ${level}` });
        }
      } else {
        // Already at target
        fadeCommands.push({ cmd: PulsettoProtocol.Commands.intensity(targetStrength), step: 1, total: 1, label: `intensity ${targetStrength}` });
      }
    } else if (mode === 'out') {
      // Start at current, then ramp down: startStrength -> 1 over ~15 seconds
      const rampSteps = Math.ceil((startStrength - 1) / 2);
      if (rampSteps > 0) {
        for (let i = rampSteps - 1; i >= 0; i--) {
          const level = Math.max(Math.ceil(1 + (startStrength - 1) * (i / rampSteps)), 1);
          fadeCommands.push({ cmd: PulsettoProtocol.Commands.intensity(level), step: rampSteps - i, total: rampSteps, label: `intensity ${level}` });
        }
      } else {
        // Already at minimum
        fadeCommands.push({ cmd: PulsettoProtocol.Commands.intensity(1), step: 1, total: 1, label: `intensity 1` });
      }
    } else if (mode === 'pulse') {
      // Ramp up then down, starting from current intensity
      const midPoint = (startStrength + targetStrength) / 2;
      const upSteps = Math.ceil(Math.abs(targetStrength - startStrength) / 2);
      const downSteps = Math.ceil((targetStrength - 1) / 2);
      
      // Ramp up to target
      if (upSteps > 0) {
        for (let i = 0; i < upSteps; i++) {
          const level = Math.min(Math.ceil(startStrength + (targetStrength - startStrength) * ((i + 1) / upSteps)), 9);
          fadeCommands.push({ cmd: PulsettoProtocol.Commands.intensity(level), step: i + 1, total: upSteps + downSteps, label: `intensity ${level} (up)` });
        }
      }
      
      // Ramp down to 1
      if (downSteps > 0) {
        for (let i = downSteps - 1; i >= 0; i--) {
          const level = Math.max(Math.ceil(1 + (targetStrength - 1) * (i / downSteps)), 1);
          fadeCommands.push({ cmd: PulsettoProtocol.Commands.intensity(level), step: upSteps + (downSteps - i), total: upSteps + downSteps, label: `intensity ${level} (down)` });
        }
      }
      
      if (fadeCommands.length === 1) {
        // Only channel activation, add intensity commands
        fadeCommands.push({ cmd: PulsettoProtocol.Commands.intensity(targetStrength), step: 1, total: 1, label: `intensity ${targetStrength}` });
      }
    }

    // Execute fade sequence with step-by-step logging
    this._fadeExecuting = true;
    
    for (let i = 0; i < fadeCommands.length; i++) {
      // Check if cancelled
      if (signal.aborted) {
        this._fadeExecuting = false;
        this._lastFadeIntensity = null;
        this.log('Fade cancelled', 'warning');
        return;
      }
      
      const item = fadeCommands[i];
      
      // Log step progress
      if (item.total > 0) {
        this.log(`Fade ${mode}: step ${item.step}/${item.total} - ${item.label}`, 'info');
      } else {
        this.log(`Fade ${mode}: ${item.label}`, 'info');
      }
      
      // Update intensity UI if this is an intensity command (matches "5\n" pattern)
      const intensityMatch = item.cmd.match(/^([1-9])\n$/);
      if (intensityMatch) {
        const level = parseInt(intensityMatch[1]);
        this._lastFadeIntensity = level; // track so setIntensity knows it's from fade
        this.ui.intensitySlider.value = level;
        this.ui.intensityValue.textContent = level;
        this.effectiveStrength = level;
      }
      
      // Send command
      await this.ble.sendCommand(item.cmd);
      
      // Delay between commands (except last one)
      if (i < fadeCommands.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    this._fadeExecuting = false;
    
    // Keep the final intensity - update baseStrength so mode engine uses it
    const finalIntensity = this.effectiveStrength || this.baseStrength;
    this.baseStrength = finalIntensity;
    
    // Ensure UI reflects the retained intensity
    this.ui.intensitySlider.value = finalIntensity;
    this.ui.intensityValue.textContent = finalIntensity;
    
    this.log(`Fade ${mode} complete - intensity stays at ${finalIntensity}`, 'success');
    
    // Auto-reset to off after completion
    this._fadeState = 'off';
    this._fadeAbortController = null;
    this._lastFadeIntensity = null;
    this._resetFadeSelect();
  }

  setTimerMinutes(minutes) {
    this.timerMinutes = Math.max(1, Math.min(60, minutes));
    this.ui.timerValue.textContent = SessionClock.formatTime(this.timerMinutes * 60);
  }

  adjustTimer(delta) {
    this.setTimerMinutes(this.timerMinutes + delta);
    this.ui.timerSlider.value = this.timerMinutes;
  }

  setIntensity(value) {
    // If fade is executing and value matches what fade just set, it's a programmatic update - skip
    if (this._fadeExecuting && value === this._lastFadeIntensity) {
      this.baseStrength = value;
      return;
    }
    
    this.baseStrength = value;
    this.ui.intensityValue.textContent = value;
    
    // Cancel any active fade when user manually sets intensity
    if (this._fadeState !== 'off' || this._fadeExecuting) {
      this.log(`Manual intensity ${value} - cancelling fade`, 'warning');
      this._cancelFade();
    }
    
    // Queue intensity command (debounced, coalesces with pending channel)
    const sessionActive = this.clock.isRunning || this.clock.isPaused;
    if (this.ble.canSendCommands && sessionActive && this.isStimulationActive) {
      this.ble.queueIntensity(PulsettoProtocol.Commands.intensity(this.baseStrength));
      // Don't log here - the manager will process it
    }
  }

  async startSession() {
    if (!this.ble.isConnected) {
      this.log('Not connected to device', 'error');
      return;
    }

    this.log(`Starting session: ${this.selectedMode}, ${this.timerMinutes}min, intensity ${this.baseStrength}`, 'info');

    // Initialize mode engine
    this.modeEngine = ModeEngineFactory.create(this.selectedMode);
    const duration = this.timerMinutes * 60;
    
    // Initialize timeline
    if (this.timeline) {
      this.ui.timelinePanel.classList.remove('hidden');
      // Defer render to ensure container has dimensions
      requestAnimationFrame(() => {
        this.timeline.setMode(this.selectedMode, duration, this.baseStrength);
        this.timeline.updateProgress(0, true);
      });
    }
    
    // Get initial commands
    let initialCommands = this.modeEngine.start(this.baseStrength, duration);

    // Apply channel override if set
    if (this.channelOverride !== 'auto') {
      initialCommands = applyChannelOverride(initialCommands, this.channelOverride);
    }

    this.log(`Commands to send: ${JSON.stringify(initialCommands)}`, 'info');

    // Send activation commands (uses manager's sendImmediate for blocking send)
    if (initialCommands.length > 0) {
      try {
        await this.ble.sendCommands(initialCommands);
        this.log('Device commands sent successfully', 'success');
      } catch (err) {
        this.log(`Failed to send commands: ${err.message}`, 'error');
        return;
      }
    }
    
    this.isStimulationActive = true;
    this.effectiveStrength = this.baseStrength;
    
    // Start clock
    this.clock.start(duration);
    
    // Show progress
    this.ui.sessionProgress.classList.remove('hidden');
    this._updateBreathingUI();
  }

  pauseSession() {
    this.clock.pause();
  }

  resumeSession() {
    this.clock.resume();
  }

  stopSession() {
    this.clock.stop();
  }

  _onTick({ remaining, elapsed, progress }) {
    this.ui.timerValue.textContent = SessionClock.formatTime(remaining);
    this.ui.remainingTime.textContent = SessionClock.formatTime(remaining);
    this.ui.elapsedTime.textContent = SessionClock.formatTime(elapsed);
    this.ui.progressFill.style.width = `${progress * 100}%`;
    
    // Update timeline
    if (this.timeline && (this.clock.isRunning || this.clock.isPaused)) {
      this.timeline.updateProgress(elapsed, this.clock.isRunning);
    }
    
    // Process tick for mode engine
    if (this.modeEngine && this.clock.isRunning) {
      this._processModeTick(elapsed);
    }
  }

  // Send stop command (clears queue, bypasses debounce)
  async _sendStopCommand() {
    if (!this.ble.canSendCommands) return;
    
    const success = await this.ble.sendStop();
    this.isStimulationActive = false;
    this.log(success ? 'Stop sent' : 'Stop failed', success ? 'info' : 'warning');
  }

  // Handle background keepalive ticks from Web Worker
  _onBackgroundTick(data) {
    // Track if we've already warned about throttling this session
    if (data.drift > 500 && !this._throttleWarned) {
      this._throttleWarned = true;
      this.log('⚠️ Timer throttled - keep tab visible for best results', 'warning');
    }

    // Ensure audio context stays alive (prevents suspension)
    if (this.bgKeepalive.audioContext?.state === 'suspended') {
      this.bgKeepalive.audioContext.resume();
    }
  }

  // Mode engine tick processing
  _processModeTick(elapsed) {
    // Skip if currently seeking - seek will send its own commands
    if (this._isSeeking) return;
    
    const result = this.modeEngine.tick(
      elapsed,
      this.clock.totalDuration,
      this.baseStrength
    );

    // Apply channel override if set
    let commands = result.commands;
    if (this.channelOverride !== 'auto' && commands.length > 0) {
      commands = applyChannelOverride(commands, this.channelOverride);
    }

    // Queue commands (coalesced with any pending user changes)
    if (commands.length > 0 && this.ble.canSendCommands) {
      // Only send if not currently processing user-triggered commands
      // The manager will coalesce these with any pending user channel/intensity changes
      for (const cmd of commands) {
        if (cmd === PulsettoProtocol.Commands.activateLeft ||
            cmd === PulsettoProtocol.Commands.activateRight ||
            cmd === PulsettoProtocol.Commands.activateBilateral ||
            cmd === PulsettoProtocol.Commands.stop) {
          this.ble.queueChannel(cmd);
        } else if (/^[1-9]\n$/.test(cmd)) {
          this.ble.queueIntensity(cmd);
        }
      }
    }
    
    // Update state
    this.isStimulationActive = result.isStimulationActive;
    this.effectiveStrength = result.effectiveStrength;
    this.activeChannel = result.activeChannel;
    this.breathingPhase = result.breathingPhase;
    
    // Update breathing UI
    this._updateBreathingAnimation(result);
  }

  _resumeSessionOnDevice() {
    if (!this.modeEngine) return;

    const elapsed = this.clock.elapsedSeconds;
    let commands = this.modeEngine.reconnectCommands(
      elapsed,
      this.clock.totalDuration,
      this.baseStrength
    );

    // Apply channel override if set
    if (this.channelOverride !== 'auto') {
      commands = applyChannelOverride(commands, this.channelOverride);
    }

    if (commands.length > 0 && this.ble.canSendCommands) {
      // Queue resume commands
      for (const cmd of commands) {
        if (cmd === PulsettoProtocol.Commands.activateLeft ||
            cmd === PulsettoProtocol.Commands.activateRight ||
            cmd === PulsettoProtocol.Commands.activateBilateral ||
            cmd === PulsettoProtocol.Commands.stop) {
          this.ble.queueChannel(cmd);
        } else if (/^[1-9]\n$/.test(cmd)) {
          this.ble.queueIntensity(cmd);
        }
      }
    }
  }

  // Keepalive
  _startKeepalive() {
    this._stopKeepalive();
    
    const interval = PulsettoProtocol.Timing.keepaliveIntervalSeconds * 1000;
    this.keepaliveTimer = setInterval(() => {
      if (this.ble.canSendCommands && this.clock.isRunning && this.isStimulationActive) {
        const strength = this.effectiveStrength || this.baseStrength;
        
        // Determine current channel
        let channelCmd;
        if (this.channelOverride !== 'auto') {
          switch (this.channelOverride) {
            case 'left': channelCmd = PulsettoProtocol.Commands.activateLeft; break;
            case 'right': channelCmd = PulsettoProtocol.Commands.activateRight; break;
            case 'bilateral': channelCmd = PulsettoProtocol.Commands.activateBilateral; break;
            default: channelCmd = null;
          }
        } else if (this.modeEngine) {
          const result = this.modeEngine.tick(
            this.clock.elapsedSeconds,
            this.clock.totalDuration,
            this.baseStrength
          );
          switch (result.activeChannel) {
            case 'left': channelCmd = PulsettoProtocol.Commands.activateLeft; break;
            case 'right': channelCmd = PulsettoProtocol.Commands.activateRight; break;
            case 'bilateral': channelCmd = PulsettoProtocol.Commands.activateBilateral; break;
            default: channelCmd = null;
          }
        }
        
        if (channelCmd) {
          // Queue keepalive commands (low priority, will coalesce with user changes)
          this.ble.queueChannel(channelCmd);
          this.ble.queueIntensity(PulsettoProtocol.Commands.keepalive(strength));
        }
      }
    }, interval);
  }

  _stopKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  // Status polling
  _startStatusPoll() {
    this._stopStatusPoll();
    
    const interval = PulsettoProtocol.Timing.statusPollIntervalSeconds * 1000;
    this.statusPollTimer = setInterval(() => {
      if (this.ble.canSendCommands) {
        this.ble.queryStatus();
      }
    }, interval);
  }

  _stopStatusPoll() {
    if (this.statusPollTimer) {
      clearInterval(this.statusPollTimer);
      this.statusPollTimer = null;
    }
  }

  // Notification handling
  _handleNotification(parsed) {
    switch (parsed.type) {
      case PulsettoProtocol.ResponseType.batteryVoltage:
        if (parsed.value != null) {
          const percentage = PulsettoProtocol.Battery.calculatePercentage(parsed.value);
          this.ui.batteryLevel.textContent = `${percentage}%`;
          this.ui.batteryLevel.classList.remove('hidden');
          this.log(`Battery: ${parsed.value.toFixed(2)}V (${percentage}%)`, 'info');
        }
        break;
        
      case PulsettoProtocol.ResponseType.chargingStatus:
        if (parsed.value === true) {
          this.ui.chargingIndicator.classList.remove('hidden');
          this.log('Charging: Yes', 'info');
        } else if (parsed.value === false) {
          this.ui.chargingIndicator.classList.add('hidden');
          this.log('Charging: No', 'info');
        }
        break;
        
      case PulsettoProtocol.ResponseType.strengthAck:
        this.log(`Strength acknowledged: ${parsed.value}`, 'success');
        break;
        
      case PulsettoProtocol.ResponseType.startAck:
        this.log('Device activated', 'success');
        break;
        
      case PulsettoProtocol.ResponseType.stopAck:
        this.log('Device deactivated', 'info');
        break;
    }
  }

  // UI Updates
  _updateUI() {
    this._updateConnectionStatus(this.ble.connectionState);
    this._updateActionButtons();
    this._updateBreathingUI();
    this._updateChannelButtons();

    // Sync auto-scroll button state
    if (this.ui.btnAutoScroll) {
      this.ui.btnAutoScroll.classList.toggle('active', this.autoScroll);
    }
  }

  _updateChannelButtons() {
    // Update channel override buttons to reflect current state (fade handled separately)
    [this.ui.channelAuto, this.ui.channelLeft, this.ui.channelRight, this.ui.channelBoth].forEach(btn => {
      if (btn) btn.classList.toggle('active', btn.dataset.channel === this.channelOverride);
    });
  }

  _updateConnectionStatus(state) {
    const statusClasses = {
      disconnected: 'disconnected',
      scanning: 'scanning',
      connecting: 'connecting',
      discovering: 'connecting',
      ready: 'ready',
      error: 'error'
    };
    
    const statusTexts = {
      disconnected: 'Disconnected',
      scanning: 'Scanning...',
      connecting: 'Connecting...',
      discovering: 'Discovering...',
      ready: 'Connected',
      error: 'Error'
    };
    
    this.ui.connectionStatus.className = `status-dot ${statusClasses[state] || 'disconnected'}`;
    this.ui.statusText.textContent = statusTexts[state] || state;
  }

  _updateActionButtons() {
    // Show/hide logic based on session state
    const isIdle = !this.clock.isRunning && !this.clock.isPaused;
    const isRunning = this.clock.isRunning;
    const isPaused = this.clock.isPaused;
    
    // Start button visible when idle (disabled if not connected)
    this.ui.btnStart.classList.toggle('hidden', !isIdle);
    this.ui.btnStart.disabled = !this.ble.isConnected;
    
    // Pause visible when running
    this.ui.btnPause.classList.toggle('hidden', !isRunning);
    this.ui.btnPause.disabled = !this.ble.isConnected;
    
    // Resume visible when paused
    this.ui.btnResume.classList.toggle('hidden', !isPaused);
    this.ui.btnResume.disabled = !this.ble.isConnected;
    
    // Stop visible when running or paused
    this.ui.btnStop.classList.toggle('hidden', !(isRunning || isPaused));
    this.ui.btnStop.disabled = !this.ble.isConnected;
    
    // Ensure button shows Start when idle
    if (isIdle) {
      this.ui.btnStart.textContent = 'Start';
    }
    
    // Enable/disable controls during session
    const sessionActive = isRunning || isPaused;
    this.ui.modeSelect.disabled = sessionActive;
    this.ui.timerSlider.disabled = sessionActive;
    this.ui.btnTimerUp.disabled = sessionActive;
    this.ui.btnTimerDown.disabled = sessionActive;
    
    // Enable fade only when session is active
    if (this.ui.fadeSelect) {
      this.ui.fadeSelect.disabled = !sessionActive || !this.ble.isConnected;
    }
  }

  _enableSessionControls(enabled) {
    this.ui.modeSelect.disabled = !enabled;
    this.ui.timerSlider.disabled = !enabled;
    this.ui.intensitySlider.disabled = !enabled;
    this.ui.btnTimerUp.disabled = !enabled;
    this.ui.btnTimerDown.disabled = !enabled;
    this.ui.btnStart.disabled = !enabled;
    // Disable fade dropdown when not connected
    if (this.ui.fadeSelect) {
      this.ui.fadeSelect.disabled = !enabled;
    }
  }

  _updateBreathingUI() {
    const modeConfig = PulsettoProtocol.Modes[this.selectedMode];
    const isBreathing = modeConfig?.breathing || false;
    
    this.ui.breathingGuide.classList.toggle('hidden', !isBreathing);
  }

  _updateBreathingAnimation(result) {
    if (!result.breathingPhase) return;
    
    const circle = this.ui.breathingCircle;
    const text = this.ui.breathingText;
    
    // Remove old classes
    circle.classList.remove('inhale', 'hold', 'exhale');
    
    // Add new class
    circle.classList.add(result.breathingPhase);
    
    // Update text
    const phaseLabels = {
      [BreathingPhase.INHALE]: 'Inhale',
      [BreathingPhase.HOLD]: 'Hold',
      [BreathingPhase.EXHALE]: 'Exhale'
    };
    text.textContent = phaseLabels[result.breathingPhase] || '';
  }

  _resetSessionUI() {
    this.ui.sessionProgress.classList.add('hidden');
    this.ui.progressFill.style.width = '0%';
    this.ui.timerValue.textContent = SessionClock.formatTime(this.timerMinutes * 60);
    this.ui.breathingCircle.classList.remove('inhale', 'hold', 'exhale');
    
    // Hide timeline
    if (this.ui.timelinePanel) {
      this.ui.timelinePanel.classList.add('hidden');
    }
    
    this.modeEngine = null;
    this.isStimulationActive = false;
    this.effectiveStrength = null;
    this.activeChannel = ActiveChannel.OFF;
    this.breathingPhase = null;
    
    // Cancel any active fade
    this._cancelFade();
  }

  // Logging
  log(message, type = 'info', payload = null) {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'log-entry';

    let html = `<span class="log-time">${time}</span><span class="log-${type}">${message}</span>`;

    // Add full payload if provided (for commands/packets)
    if (payload !== null) {
      const payloadStr = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
      html += `<span class="log-payload">${payloadStr}</span>`;
    }

    entry.innerHTML = html;
    this.ui.logContainer.appendChild(entry);

    // Auto-scroll to bottom if enabled (use rAF to ensure DOM is updated)
    if (this.autoScroll) {
      requestAnimationFrame(() => {
        this.ui.logContainer.scrollTop = this.ui.logContainer.scrollHeight;
      });
    }

    // Also log to console
    console.log(`[${time}] ${message}`, payload || '');
  }

  // Check if we should auto-scroll based on position and toggle state
  _shouldAutoScroll() {
    if (!this.autoScroll) return false;

    const container = this.ui.logContainer;
    const threshold = 50; // pixels from bottom to still consider "at bottom"
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;

    return isAtBottom;
  }

  // Handle manual scroll to detect when user scrolls up
  _onLogScroll() {
    const container = this.ui.logContainer;
    const threshold = 50;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;

    // If user manually scrolls up, disable auto-scroll
    if (!isAtBottom && this.autoScroll) {
      this.autoScroll = false;
      this.ui.btnAutoScroll.classList.remove('active');
    }
  }

  // Toggle auto-scroll on/off
  toggleAutoScroll() {
    this.autoScroll = !this.autoScroll;
    this.ui.btnAutoScroll.classList.toggle('active', this.autoScroll);

    if (this.autoScroll) {
      // If turning on, scroll to bottom immediately
      this.ui.logContainer.scrollTop = this.ui.logContainer.scrollHeight;
    }

    this.log(`Auto-scroll ${this.autoScroll ? 'enabled' : 'disabled'}`, 'info');
  }

  // Toggle log container expanded/collapsed height
  toggleLogExpansion() {
    this.logsExpanded = !this.logsExpanded;
    this.ui.logContainer.classList.toggle('expanded', this.logsExpanded);
    this.ui.btnExpandLogs.classList.toggle('active', this.logsExpanded);

    if (this.autoScroll) {
      this.ui.logContainer.scrollTop = this.ui.logContainer.scrollHeight;
    }
  }

  clearLogs() {
    this.ui.logContainer.innerHTML = '';
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new PulsettoApp();
});
