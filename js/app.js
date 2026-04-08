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
    
    // State
    this.selectedMode = 'calm';
    this.baseStrength = 8;
    this.timerMinutes = 10;
    this.effectiveStrength = null;
    this.isStimulationActive = false;
    this.activeChannel = ActiveChannel.OFF;
    this.breathingPhase = null;
    this.channelOverride = 'auto'; // 'auto', 'left', 'right', 'bilateral'

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

    // Set initial mode from HTML default (Sleep)
    const defaultMode = this.ui.modeSelect.value;
    this.selectMode(defaultMode);

    this._updateUI();

    this.log('Pulsetto Web Controller initialized (ASCII protocol)', 'info');
    this.log('Click "Scan for Device" to connect', 'info');
    this.log('Using ASCII protocol (verified with official app v2.2.91)', 'info');
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

    // Channel override
    [this.ui.channelAuto, this.ui.channelLeft, this.ui.channelRight, this.ui.channelBoth].forEach(btn => {
      btn?.addEventListener('click', (e) => this.setChannelOverride(e.target.dataset.channel));
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
    });
    
    this.ble.on('disconnected', ({ unexpected }) => {
      this.ui.deviceInfo.classList.add('hidden');
      this.ui.btnScan.classList.remove('hidden');
      this.ui.btnDisconnect.classList.add('hidden');
      this.ui.batteryLevel.classList.add('hidden');
      this.ui.chargingIndicator.classList.add('hidden');
      
      this._stopKeepalive();
      this._stopStatusPoll();
      
      if (unexpected && this.clock.isRunning) {
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
    
    this.ble.on('commandSent', ({ command, bytes }) => {
      this.log(`→ ${command.replace('\n', '')}`, 'command', bytes);
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
      this.ui.timerValue.textContent = SessionClock.formatTime(remaining);
      this.ui.remainingTime.textContent = SessionClock.formatTime(remaining);
      this.ui.elapsedTime.textContent = SessionClock.formatTime(elapsed);
      this.ui.progressFill.style.width = `${progress * 100}%`;
      
      // Process tick for mode engine
      if (this.modeEngine && this.clock.isRunning) {
        this._processModeTick(elapsed);
      }
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

    this._updateBreathingUI();
    this.log(`Mode selected: ${description.name}`, 'info');
  }

  setChannelOverride(channel) {
    this.channelOverride = channel;

    // Update button states
    [this.ui.channelAuto, this.ui.channelLeft, this.ui.channelRight, this.ui.channelBoth].forEach(btn => {
      if (btn) btn.classList.toggle('active', btn.dataset.channel === channel);
    });

    this.log(`Channel override: ${channel}`, 'info');
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
    this.baseStrength = value;
    this.ui.intensityValue.textContent = value;
    
    // Send to device if running
    if (this.ble.canSendCommands && this.clock.isRunning && this.isStimulationActive) {
      this.ble.sendCommand(PulsettoProtocol.Commands.intensity(this.baseStrength));
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
    
    // Get initial commands
    let initialCommands = this.modeEngine.start(this.baseStrength, duration);

    // Apply channel override if set
    if (this.channelOverride !== 'auto') {
      initialCommands = applyChannelOverride(initialCommands, this.channelOverride);
    }

    this.log(`Commands to send: ${JSON.stringify(initialCommands)}`, 'info');

    // Send activation commands
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

  // Send stop command with fallback for compatibility
  async _sendStopCommand() {
    if (!this.ble.canSendCommands) return;
    
    try {
      // Try modern stop command first
      await this.ble.sendCommand(PulsettoProtocol.Commands.stop);
      this.log('Stop command sent', 'info');
    } catch (err) {
      this.log('Modern stop failed, trying legacy', 'warning');
      try {
        // Fall back to legacy stop command
        await this.ble.sendCommand(PulsettoProtocol.Commands.stopLegacy);
        this.log('Legacy stop command sent', 'info');
      } catch (err2) {
        this.log(`Both stop commands failed: ${err2.message}`, 'error');
      }
    }
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

    // Send commands
    if (commands.length > 0 && this.ble.canSendCommands) {
      this.ble.sendCommands(commands);
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
      this.ble.sendCommands(commands);
    }
  }

  // Keepalive
  _startKeepalive() {
    this._stopKeepalive();
    
    const interval = PulsettoProtocol.Timing.keepaliveIntervalSeconds * 1000;
    this.keepaliveTimer = setInterval(() => {
      if (this.ble.canSendCommands && this.clock.isRunning && this.isStimulationActive) {
        const strength = this.effectiveStrength || this.baseStrength;
        this.ble.sendCommand(PulsettoProtocol.Commands.keepalive(strength));
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
    // Update channel override buttons to reflect current state
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
  }

  _enableSessionControls(enabled) {
    this.ui.modeSelect.disabled = !enabled;
    this.ui.timerSlider.disabled = !enabled;
    this.ui.intensitySlider.disabled = !enabled;
    this.ui.btnTimerUp.disabled = !enabled;
    this.ui.btnTimerDown.disabled = !enabled;
    this.ui.btnStart.disabled = !enabled;
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
    
    this.modeEngine = null;
    this.isStimulationActive = false;
    this.effectiveStrength = null;
    this.activeChannel = ActiveChannel.OFF;
    this.breathingPhase = null;
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

    // Smart auto-scroll: only scroll if user is at bottom or auto-scroll is enabled
    if (this._shouldAutoScroll()) {
      this.ui.logContainer.scrollTop = this.ui.logContainer.scrollHeight;
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
