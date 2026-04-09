/**
 * VG Ctrl Application
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
    this.channelOverride = 'bilateral'; // 'left', 'right', 'bilateral'
    this._isSeeking = false;
    this._seekTimeout = null;
    
    // Fade state: 'off', 'in', 'out', 'pulse'
    this._fadeState = 'off';
    this._fadeAbortController = null;
    this._fadeExecuting = false; // true while fade is actively running
    this._lastFadeIntensity = null; // track last intensity set by fade

    // Track if user manually set intensity (preserved across mode changes until connect)
    this._userSetIntensity = false;

    // Audio feedback settings (toggle UI coming in T04)
    this.audioEnabled = true;

    // Logging state
    this.autoScroll = true;
    this.logsExpanded = true;

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

    // Load saved mode from localStorage, or use HTML default
    const savedMode = localStorage.getItem('pulsetto_lastMode');
    const availableModes = Object.keys(PulsettoProtocol.Modes);
    const initialMode = savedMode && availableModes.includes(savedMode) 
      ? savedMode 
      : this.ui.modeSelect.value;
    
    // Update select element to match saved/default mode
    if (this.ui.modeSelect.value !== initialMode) {
      this.ui.modeSelect.value = initialMode;
    }
    this.selectMode(initialMode);

    this._updateUI();
    
    // Initialize audio toggle state from loaded preference
    if (this.ui.audioToggle) {
      this.ui.audioToggle.checked = this.audioEnabled;
    }
    
    // Initialize log expansion state
    if (this.ui.logContainer && this.ui.btnExpandLogs) {
      this.ui.logContainer.classList.toggle('expanded', this.logsExpanded);
      this.ui.btnExpandLogs.classList.toggle('active', this.logsExpanded);
    }

    this.log('VG Ctrl initialized (ASCII protocol)', 'info');
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
    this.timeline.onScrub((newElapsed, doneCallback) => {
      this._seekSession(newElapsed, doneCallback);
    });

    // Handle timeline script steps (UI updates only, no commands)
    this.timeline.onScriptStep((step) => {
      this._onTimelineScriptStep(step);
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
    // Use the clock's built-in seek method (updates elapsed/remaining and emits tick)
    this.clock.seek(clamped);

    // Notify timeline of seek - it will update to current script step and notify via onScriptStep
    if (this.timeline) {
      this.timeline.seek(clamped);
      this.log(`Seek: ${this._formatTime(clamped)}`, 'info');
    }

    // Signal seek complete to timeline
    if (doneCallback) {
      doneCallback();
    }
    this.timeline.seekComplete();
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
    this.ui.phaseCountdown = document.getElementById('phase-countdown');
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

    // Channel override (Left, Right, Both - no Auto)
    this.ui.channelLeft = document.getElementById('channel-left');
    this.ui.channelRight = document.getElementById('channel-right');
    this.ui.channelBoth = document.getElementById('channel-both');
    this.ui.fadeSelect = document.getElementById('fade-select');
    
    // Audio toggle
    this.ui.audioToggle = document.getElementById('audio-toggle');
    
    // Breathing guide
    this.ui.breathingGuide = document.getElementById('breathing-guide');
    this.ui.breathingCircle = document.getElementById('breathing-circle');
    this.ui.breathingText = document.getElementById('breathing-text');
    this.ui.breathingHint = document.getElementById('breathing-hint');
    
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

    // Channel override buttons (Left, Right, Both - no Auto)
    [this.ui.channelLeft, this.ui.channelRight, this.ui.channelBoth].forEach(btn => {
      btn?.addEventListener('click', (e) => this.setChannelOverride(e.target.dataset.channel));
    });
    
    // Fade dropdown
    this.ui.fadeSelect?.addEventListener('change', (e) => this._onFadeSelect(e.target.value));
    
    // Audio toggle
    this.ui.audioToggle?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this._saveAudioPreference(enabled);
      this.audioEnabled = enabled;
      this.log(`Audio feedback ${enabled ? 'enabled' : 'disabled'}`, 'info');
    });

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
      
      // Auto-start session with current mode settings
      this.log('Auto-starting session...', 'info');
      this.startSession();
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
      
      // Reset user intensity flag so next session starts fresh with mode defaults
      this._userSetIntensity = false;
    });
    
    this.clock.on('completed', () => {
      this.log('Session completed!', 'success');
      this._stopKeepalive();
      this.bgKeepalive.stop();
      
      // Deactivate device
      this._sendStopCommand();
      
      // Play completion sound after stop commands
      this.playCompletionSound();
      
      this._updateActionButtons();
      this._resetSessionUI();
      
      // Reset user intensity flag so next session starts fresh with mode defaults
      this._userSetIntensity = false;
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
      // Preserve user-set intensity - only update if never manually set (default is 8 from constructor)
      // User can pre-set intensity before connect; mode default only applies on fresh load
      if (!this._userSetIntensity) {
        this.baseStrength = modeConfig.strength;
        this.ui.intensitySlider.value = this.baseStrength;
        this.ui.intensityValue.textContent = this.baseStrength;
      }

      this.ui.timerSlider.value = this.timerMinutes;
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
        this.log(`Timeline setMode complete for ${mode}`, 'info');

        // Reset channel override to match new mode's initial channel
        this.log(`Reading first step for ${mode}...`, 'info');
        this.log(`  script exists: ${!!this.timeline.script}`, 'info');
        this.log(`  instructions count: ${this.timeline.script?.instructions?.length || 0}`, 'info');
        const firstStep = this.timeline.script?.getInstructionAt(0);
        this.log(`  firstStep: ${JSON.stringify(firstStep)}`, 'info');
        if (firstStep) {
          const initialChannel = firstStep.channel === 'off' ? 'bilateral' : (firstStep.channel || 'bilateral');
          this.channelOverride = initialChannel;

          // Update UI buttons
          [this.ui.channelLeft, this.ui.channelRight, this.ui.channelBoth].forEach(btn => {
            if (btn) btn.classList.remove('active');
          });
          let initialBtn = null;
          switch(initialChannel) {
            case 'left': initialBtn = this.ui.channelLeft; break;
            case 'right': initialBtn = this.ui.channelRight; break;
            case 'bilateral':
            default: initialBtn = this.ui.channelBoth;
          }
          if (initialBtn) initialBtn.classList.add('active');

          this.log(`Mode ${mode}: initial channel set to ${initialChannel}`, 'info');
        }
      });
    }

    this._updateBreathingUI();
    this.log(`Mode selected: ${description.name}`, 'info');

    // Save selected mode to localStorage for persistence
    try {
      localStorage.setItem('pulsetto_lastMode', mode);
    } catch (e) {
      // Ignore storage errors (e.g., private mode)
    }
  }

  async setChannelOverride(channel) {
    this.channelOverride = channel;

    // Update button states
    [this.ui.channelAuto, this.ui.channelLeft, this.ui.channelRight, this.ui.channelBoth].forEach(btn => {
      if (btn) btn.classList.toggle('active', btn.dataset.channel === channel);
    });

    // Notify timeline of override (visual only)
    const sessionActive = this.clock.isRunning || this.clock.isPaused;
    if (sessionActive && this.timeline) {
      this.timeline.setChannelOverride(channel);
    }

    // Send command directly to device (timeline is visual-only now)
    if (sessionActive && this.ble?.canSendCommands) {
      let cmd = null;
      switch (channel) {
        case 'left': cmd = PulsettoProtocol.Commands.activateLeft; break;
        case 'right': cmd = PulsettoProtocol.Commands.activateRight; break;
        case 'bilateral': cmd = PulsettoProtocol.Commands.activateBilateral; break;
        case 'off': cmd = PulsettoProtocol.Commands.stop; break;
      }
      if (cmd) {
        try {
          await this.ble.sendCommand(cmd);
          this.log(`Channel: ${channel}`, 'info');
        } catch (err) {
          this.log(`Failed to set channel: ${err.message}`, 'error');
        }
      }
    } else {
      this.log(`Channel: ${channel} (ready)`, 'info');
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

    // Notify timeline state manager that fade is starting
    if (this.timeline) {
      this.timeline.notifyExternalChange('fade', { mode: mode });
    }

    // Determine current channel (defaults to bilateral)
    let currentChannel = PulsettoProtocol.Commands.activateBilateral;
    switch (this.channelOverride) {
      case 'left': currentChannel = PulsettoProtocol.Commands.activateLeft; break;
      case 'right': currentChannel = PulsettoProtocol.Commands.activateRight; break;
      case 'bilateral':
      default: currentChannel = PulsettoProtocol.Commands.activateBilateral;
    }

    const fadeCommands = [];
    
    // Activate channel first
    fadeCommands.push({ cmd: currentChannel, step: 0, total: 0, label: 'activate' });
    
    // Get starting intensity (current effective strength or base)
    const startStrength = this.effectiveStrength || this.baseStrength;
    
    // Validate bounds - disable fades when already at extremes
    if (mode === 'in' && startStrength >= 9) {
      this.log('Fade In: Already at maximum intensity (9)', 'warning');
      this._resetFadeSelect();
      return;
    }
    if (mode === 'out' && startStrength <= 0) {
      this.log('Fade Out: Already at minimum intensity (0/stop)', 'warning');
      this._resetFadeSelect();
      return;
    }
    
    // Build intensity sequence based on mode
    if (mode === 'in') {
      // Ramp up: startStrength -> 9 (max)
      const target = 9;
      const rampSteps = Math.ceil((target - startStrength) / 2);
      if (rampSteps > 0) {
        for (let i = 0; i < rampSteps; i++) {
          const level = Math.min(Math.ceil(startStrength + (target - startStrength) * ((i + 1) / rampSteps)), 9);
          fadeCommands.push({ cmd: PulsettoProtocol.Commands.intensity(level), step: i + 1, total: rampSteps, label: `intensity ${level}` });
        }
      } else {
        // Already at max
        fadeCommands.push({ cmd: PulsettoProtocol.Commands.intensity(9), step: 1, total: 1, label: `intensity 9` });
      }
    } else if (mode === 'out') {
      // Ramp down: startStrength -> 0 (stop)
      const rampSteps = Math.ceil(startStrength / 2);
      if (rampSteps > 0) {
        for (let i = rampSteps - 1; i >= 0; i--) {
          const level = Math.max(Math.ceil(startStrength * (i / rampSteps)), 0);
          if (level === 0) {
            fadeCommands.push({ cmd: PulsettoProtocol.Commands.stop, step: rampSteps - i, total: rampSteps, label: 'stop' });
          } else {
            fadeCommands.push({ cmd: PulsettoProtocol.Commands.intensity(level), step: rampSteps - i, total: rampSteps, label: `intensity ${level}` });
          }
        }
      } else {
        // Already at 0, just stop
        fadeCommands.push({ cmd: PulsettoProtocol.Commands.stop, step: 1, total: 1, label: 'stop' });
      }
    } else if (mode === 'pulse') {
      // Ramp up to 9 then down to 0 (stop)
      const target = 9;
      const upSteps = Math.ceil((target - startStrength) / 2);
      const downSteps = Math.ceil(target / 2);
      
      // Ramp up to 9
      if (upSteps > 0) {
        for (let i = 0; i < upSteps; i++) {
          const level = Math.min(Math.ceil(startStrength + (target - startStrength) * ((i + 1) / upSteps)), 9);
          fadeCommands.push({ cmd: PulsettoProtocol.Commands.intensity(level), step: i + 1, total: upSteps + downSteps, label: `intensity ${level} (up)` });
        }
      }
      
      // Ramp down to 0 (stop)
      if (downSteps > 0) {
        for (let i = downSteps - 1; i >= 0; i--) {
          const level = Math.max(Math.ceil(target * (i / downSteps)), 0);
          if (level === 0) {
            fadeCommands.push({ cmd: PulsettoProtocol.Commands.stop, step: upSteps + (downSteps - i), total: upSteps + downSteps, label: `stop (down)` });
          } else {
            fadeCommands.push({ cmd: PulsettoProtocol.Commands.intensity(level), step: upSteps + (downSteps - i), total: upSteps + downSteps, label: `intensity ${level} (down)` });
          }
        }
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
      
      // Update intensity UI if this is an intensity command (matches "5\n" pattern) or stop (matches "-\n")
      const intensityMatch = item.cmd.match(/^([1-9])\n$/);
      const stopMatch = item.cmd === PulsettoProtocol.Commands.stop;
      if (intensityMatch || stopMatch) {
        const level = stopMatch ? 0 : parseInt(intensityMatch[1]);
        this._lastFadeIntensity = level; // track so setIntensity knows it's from fade
        this.ui.intensitySlider.value = level;
        this.ui.intensityValue.textContent = level;
        this.effectiveStrength = stopMatch ? null : level;
        this.isStimulationActive = !stopMatch;
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

    // Notify timeline state manager that fade completed
    if (this.timeline) {
      this.timeline.notifyExternalChange('fadeComplete', {
        mode: mode,
        finalIntensity: finalIntensity,
        finalChannel: finalIntensity > 0 ? this.channelOverride : 'off'
      });
    }

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

  async setIntensity(value) {
    // If fade is executing and value matches what fade just set, it's a programmatic update - skip
    if (this._fadeExecuting && value === this._lastFadeIntensity) {
      this.baseStrength = value;
      return;
    }

    this.baseStrength = value;
    this._userSetIntensity = true; // Mark as manually set by user
    this.ui.intensityValue.textContent = value;

    // Cancel any active fade when user manually sets intensity
    if (this._fadeState !== 'off' || this._fadeExecuting) {
      this.log(`Manual intensity ${value} - cancelling fade`, 'warning');
      this._cancelFade();
    }

    // Notify timeline of intensity change (visual only)
    const sessionActive = this.clock.isRunning || this.clock.isPaused;
    if (sessionActive && this.timeline) {
      this.timeline.setIntensity(value);
    }

    // Send command directly to device (timeline is visual-only now)
    if (sessionActive && this.ble?.canSendCommands) {
      try {
        const cmd = PulsettoProtocol.Commands.intensity(value);
        await this.ble.sendCommand(cmd);
      } catch (err) {
        this.log(`Failed to set intensity: ${err.message}`, 'error');
      }
    }
  }

  async startSession() {
    if (!this.ble.isConnected) {
      this.log('Not connected to device', 'error');
      return;
    }

    this.log(`=== START SESSION ===`, 'info');
    this.log(`selectedMode: ${this.selectedMode}`, 'info');
    this.log(`channelOverride: ${this.channelOverride}`, 'info');
    this.log(`modeSelect.value: ${this.ui.modeSelect?.value}`, 'info');
    this.log(`Starting session: ${this.selectedMode}, ${this.timerMinutes}min, intensity ${this.baseStrength}`, 'info');
    this.log(`  Channel override: ${this.channelOverride}`, 'info');

    // Initialize mode engine
    this.modeEngine = ModeEngineFactory.create(this.selectedMode);
    const duration = this.timerMinutes * 60;

    // Initialize timeline
    if (this.timeline) {
      this.ui.timelinePanel.classList.remove('hidden');
      // Set mode and get first script step for UI initialization
      this.timeline.setMode(this.selectedMode, duration, this.baseStrength);
      // Read first script entry and set UI/state to match
      const firstStep = this.timeline.script?.getInstructionAt(0);
      if (firstStep) {
        this.log(`Initial script step: ${firstStep.label}, channel=${firstStep.channel}, intensity=${firstStep.intensity}`, 'info');
        // Update UI to match initial script state (don't send commands - mode engine handles that)
        this.ui.intensityValue.textContent = firstStep.intensity ?? this.baseStrength;
        this.ui.intensitySlider.value = firstStep.intensity ?? this.baseStrength;
        // Update channel override to match first step (map 'off' to 'bilateral')
        const initialChannel = firstStep.channel === 'off' ? 'bilateral' : (firstStep.channel || 'bilateral');
        this.channelOverride = initialChannel;
        this.log(`Channel override set to: ${initialChannel}`, 'info');
        // Update channel buttons to match
        [this.ui.channelLeft, this.ui.channelRight, this.ui.channelBoth].forEach(btn => {
          if (btn) btn.classList.remove('active');
        });
        let initialBtn = null;
        switch(initialChannel) {
          case 'left': initialBtn = this.ui.channelLeft; break;
          case 'right': initialBtn = this.ui.channelRight; break;
          case 'bilateral':
          default: initialBtn = this.ui.channelBoth;
        }
        if (initialBtn) initialBtn.classList.add('active');
      }
      // Defer render to ensure container has dimensions
      requestAnimationFrame(() => {
        this.timeline.updateProgress(0, true);
        this.timeline.startTracking();
      });
    }

    // Get initial commands from mode engine
    let initialCommands = this.modeEngine.start(this.baseStrength, duration);
    this.log(`Mode engine generated: ${JSON.stringify(initialCommands)}`, 'info');
    this.log(`Current channelOverride: ${this.channelOverride}`, 'info');

    // Apply channel override if not bilateral (default)
    if (this.channelOverride !== 'bilateral') {
      initialCommands = applyChannelOverride(initialCommands, this.channelOverride);
      this.log(`After override applied: ${JSON.stringify(initialCommands)}`, 'info');
    }

    this.log(`Final commands to send: ${JSON.stringify(initialCommands)}`, 'info');

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
    // Pause timeline tracking
    if (this.timeline) {
      this.timeline.pauseTracking();
    }
    this.clock.pause();

    // Recalculate intensity upper bound based on current elapsed time
    // (some modes may want to limit max intensity as session progresses)
    this._recalculateIntensityBound();
  }

  resumeSession() {
    // Resume timeline tracking
    if (this.timeline) {
      this.timeline.resumeTracking();
    }
    this.clock.resume();
  }

  stopSession() {
    // Stop timeline tracking
    if (this.timeline) {
      this.timeline.stopTracking();
    }
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

  // Audio preference methods with localStorage persistence
  _loadAudioPreference() {
    try {
      const stored = localStorage.getItem('pulsetto_audio_enabled');
      if (stored === null) {
        return true; // Default to enabled if not set
      }
      return stored === 'true';
    } catch (e) {
      // localStorage may be unavailable (private mode, etc.)
      return true;
    }
  }

  _saveAudioPreference(enabled) {
    try {
      localStorage.setItem('pulsetto_audio_enabled', String(enabled));
    } catch (e) {
      // localStorage may be unavailable (private mode, quota exceeded, etc.)
      console.warn('[Audio] Failed to save preference:', e);
    }
  }

  // Audio feedback methods using Web Audio API
  _playTone(frequency, duration, type = 'sine', gainValue = 0.1) {
    if (!this.audioEnabled) return;
    const ctx = this.bgKeepalive?.audioContext;
    if (!ctx || ctx.state === 'suspended') return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.value = frequency;
      gain.gain.value = gainValue;

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration / 1000);

      // Fade out to avoid click at end
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
    } catch (e) {
      console.warn('[Audio] Tone playback failed:', e);
    }
  }

  playPhaseSound() {
    // Two-tone ascending chime for phase changes (440Hz -> 660Hz)
    // Louder (0.2 gain), longer (200ms per tone), with harmonic overtone
    this._playTone(440, 200, 'sine', 0.2);
    setTimeout(() => this._playTone(660, 250, 'sine', 0.25), 180);
    console.log('[Audio] Phase change sound');
  }

  playPhaseWarningSound() {
    // Warning tone before phase change - distinct from phase change sound
    // Single higher-pitch beep (880Hz) to alert user change is coming
    this._playTone(880, 150, 'sine', 0.15);
    console.log('[Audio] Phase warning sound');
  }

  playCompletionSound() {
    // Two-tone ascending chime (440Hz then 880Hz)
    this._playTone(440, 150, 'sine');
    setTimeout(() => this._playTone(880, 300, 'sine'), 160);
    console.log('[Audio] Completion chime');
  }

  // Mode engine tick processing - updates UI state only
  // Command sending is now handled by TimelineStateManager's scheduled ticks
  _processModeTick(elapsed) {
    // Skip if currently seeking - state manager handles seek
    if (this._isSeeking) return;

    const result = this.modeEngine.tick(
      elapsed,
      this.clock.totalDuration,
      this.baseStrength
    );

    // Update UI state only (commands handled by TimelineStateManager)
    this.isStimulationActive = result.isStimulationActive;
    this.effectiveStrength = result.effectiveStrength;
    this.activeChannel = result.activeChannel;
    this.breathingPhase = result.breathingPhase;

    // Update phase countdown if available
    if (result.timeUntilNextPhase !== null && result.timeUntilNextPhase !== undefined) {
      const seconds = Math.ceil(result.timeUntilNextPhase);
      this.ui.phaseCountdown.textContent = `next: ${seconds}s`;
      this.ui.phaseCountdown.classList.remove('hidden');
    } else {
      this.ui.phaseCountdown.classList.add('hidden');
    }

    // Update breathing UI
    this._updateBreathingAnimation(result);
  }

  /**
   * Handle timeline phase change - update UI controls to reflect preset
   * Timeline is visual only; no commands are sent here.
   * User must manually adjust or confirm settings.
   */
  /**
   * Handle timeline script step change
   * Format: { channel, intensity, label, type, start, end, isSeek? }
   * Only triggers commands on manual seek (isSeek=true), not natural progression.
   */
  _onTimelineScriptStep(step) {
    const isActive = this.clock.isRunning || this.clock.isPaused;
    if (!isActive) return;

    // Handle phase warning (3 seconds before change)
    if (step.type === 'phase-warning') {
      this.log(`  [Warning] Phase change in ${step.timeUntilChange}s`, 'info');
      this.playPhaseWarningSound();
      return;
    }

    // Update UI display for all steps
    if (step.intensity !== undefined) {
      this.ui.intensityValue.textContent = step.intensity;
      this.ui.intensitySlider.value = step.intensity;
      this.baseStrength = step.intensity;
    }

    if (step.channel) {
      [this.ui.channelLeft, this.ui.channelRight, this.ui.channelBoth].forEach(btn => {
        if (btn) btn.classList.remove('active');
      });
      let activeBtn = null;
      switch (step.channel) {
        case 'left': activeBtn = this.ui.channelLeft; break;
        case 'right': activeBtn = this.ui.channelRight; break;
        case 'bilateral':
        case 'off':
        default: activeBtn = this.ui.channelBoth;
      }
      if (activeBtn) activeBtn.classList.add('active');
    }

    // Send commands on: manual seek, natural phase transition, or fade intensity change
    // Order: intensity first, then channel (matches manual button press order)
    // Note: intensity 0 is sent during rest phases (stop command), channel is not sent when 'off'
    const shouldSendIntensity = step.intensity !== undefined;
    const shouldSendChannel = step.channel && step.channel !== 'off';

    if (step.isSeek) {
      // Manual seek - user dragged/scrubbed to new position
      this.log(`  [SEEK] Step: label="${step.label}", intensity=${step.intensity}, channel=${step.channel}`, 'info');
      if (shouldSendIntensity) this.setIntensity(step.intensity);
      if (shouldSendChannel) this.setChannelOverride(step.channel);
    } else if (!step.isFadeUpdate) {
      // Natural phase transition (not fade intensity update)
      this.log(`  [Phase] Natural transition to: ${step.label}, intensity=${step.intensity}, channel=${step.channel}`, 'info');
      this.playPhaseSound();
      if (shouldSendIntensity) this.setIntensity(step.intensity);
      if (shouldSendChannel) this.setChannelOverride(step.channel);
    } else if (step.isFadeUpdate && step.intensity !== undefined) {
      // During fade-down, only intensity changes
      this.log(`  [Fade] Intensity change: ${step.intensity}`, 'info');
      this.setIntensity(step.intensity);
    }

    // Log the script step
    const seekPrefix = step.isSeek ? '[Seek] ' : '';
    const fadePrefix = step.isFadeUpdate ? '[Fade] ' : '';
    const chLabel = step.channel === 'left' ? 'Left' :
                   step.channel === 'right' ? 'Right' :
                   'Both';
    this.log(`${seekPrefix}${fadePrefix}Script: ${step.label} (${chLabel}, ${step.intensity})`, 'info');
  }

  _resumeSessionOnDevice() {
    // Notify timeline of current position so it updates UI to current script step
    if (this.timeline) {
      this.timeline.seek(this.clock.elapsedSeconds);
    }
  }

  // Keepalive methods - timeline is visual-only now, manual control sends commands
  _startKeepalive() {
    // No-op: manual controls and fade scripts handle command sending
  }

  _stopKeepalive() {
    // No-op: manual controls handle command lifecycle
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
    // Update channel override buttons to reflect current state
    [this.ui.channelLeft, this.ui.channelRight, this.ui.channelBoth].forEach(btn => {
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
    // Intensity slider always enabled - allows pre-setting before connect
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
    this.ui.breathingHint?.classList.toggle('hidden', !isBreathing);

    // Update intensity slider max bound based on mode
    this._recalculateIntensityBound();
  }

  _recalculateIntensityBound() {
    const modeConfig = PulsettoProtocol.Modes[this.selectedMode];
    const maxIntensity = modeConfig?.maxIntensity || 9;

    // Update slider max attribute
    this.ui.intensitySlider.max = maxIntensity;

    // If current intensity exceeds new max, clamp it
    if (this.baseStrength > maxIntensity) {
      this.setIntensity(maxIntensity);
    }
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
    this.ui.phaseCountdown.classList.add('hidden');

    // Stop timeline tracking (but keep timeline visible for review)
    if (this.timeline) {
      this.timeline.stopTracking();
    }

    // Note: Timeline panel stays visible so user can review session

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
