/**
 * Command Queue Manager with Debouncing and Coalescing
 * 
 * - Debounces rapid command changes (e.g., slider dragging)
 * - Coalesces channel+intensity combos (only sends latest)
 * - Handles command sequences (channel → intensity → step)
 * - Prioritizes urgent commands (stop)
 */
class CommandQueueManager {
  constructor(bluetooth) {
    this.bt = bluetooth;
    
    // Pending command state (coalescing)
    this.pendingChannel = null;
    this.pendingIntensity = null;
    this.pendingStep = null;
    
    // Debounce timer
    this.debounceTimer = null;
    this.debounceDelay = 300; // ms to wait for changes to settle
    
    // Processing lock
    this.isProcessing = false;
    
    // Last sent state (to avoid duplicates)
    this.lastChannel = null;
    this.lastIntensity = null;
  }

  // Queue a channel command (coalesces with pending intensity)
  queueChannel(channelCmd) {
    this.pendingChannel = channelCmd;
    this._scheduleProcess();
  }

  // Queue an intensity command (coalesces with pending channel)
  queueIntensity(intensityCmd) {
    this.pendingIntensity = intensityCmd;
    this._scheduleProcess();
  }

  // Queue a step command (sent after channel+intensity)
  queueStep(stepCmd) {
    this.pendingStep = stepCmd;
    this._scheduleProcess();
  }

  // Send stop immediately (clears all pending, bypasses debounce)
  async sendStop() {
    // Clear everything
    this._clearPending();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    
    // Send stop with retry logic
    let retryCount = 0;
    const maxRetries = 3;
    const stopCmd = PulsettoProtocol.Commands.stop;
    
    while (retryCount < maxRetries) {
      try {
        this.bt.emit('commandSending', { command: stopCmd, timestamp: Date.now() });
        await this.bt._sendCommandDirect(stopCmd);
        this.lastChannel = null;
        this.lastIntensity = null;
        this.bt.emit('commandSent', { command: stopCmd, timestamp: Date.now() });
        
        // Wait 2 seconds after stop, just like other commands
        await new Promise(r => setTimeout(r, 2000));
        return true;
        
      } catch (err) {
        if (err.message && err.message.includes('already in progress') && retryCount < maxRetries - 1) {
          retryCount++;
          this.bt.emit('commandError', { 
            command: stopCmd, 
            error: `GATT busy, retry ${retryCount}/${maxRetries}`, 
            timestamp: Date.now() 
          });
          await new Promise(r => setTimeout(r, 100 * retryCount));
        } else {
          this.bt.emit('commandError', { command: stopCmd, error: err.message, timestamp: Date.now() });
          return false;
        }
      }
    }
    return false;
  }

  // Clear all pending commands and reset state
  _clearPending() {
    this.pendingChannel = null;
    this.pendingIntensity = null;
    this.pendingStep = null;
    this.isProcessing = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // Schedule processing after debounce delay
  _scheduleProcess() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    this.debounceTimer = setTimeout(() => {
      this._processPending();
    }, this.debounceDelay);
  }

  // Process the pending command combo
  async _processPending() {
    if (this.isProcessing) {
      // Will be picked up after current processing
      return;
    }
    
    this.isProcessing = true;
    this.debounceTimer = null;
    
    const channel = this.pendingChannel;
    const intensity = this.pendingIntensity;
    const step = this.pendingStep;
    
    // Clear pending so new changes can queue while we process
    this._clearPending();
    
    // Build command sequence
    const commands = [];
    
    // Channel first (if changed)
    if (channel && channel !== this.lastChannel) {
      commands.push(channel);
    }
    
    // Intensity second (always send if we have it, or if channel changed)
    if (intensity) {
      commands.push(intensity);
    } else if (channel && channel !== this.lastChannel && this.lastIntensity) {
      // If channel changed but no new intensity, re-send last intensity
      commands.push(this.lastIntensity);
    }
    
    // Step commands last (ramp steps, etc.)
    if (step) {
      commands.push(step);
    }
    
    // Execute commands with 2 second delays
    for (const cmd of commands) {
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          this.bt.emit('commandSending', { command: cmd, timestamp: Date.now() });
          await this.bt._sendCommandDirect(cmd);
          
          // Track what we sent
          if (this._isChannelCmd(cmd)) {
            this.lastChannel = cmd;
          } else if (this._isIntensityCmd(cmd)) {
            this.lastIntensity = cmd;
          }
          
          this.bt.emit('commandSent', { command: cmd, timestamp: Date.now() });
          
          // Delay before next command (unless stop or it's the last one)
          if (cmd !== PulsettoProtocol.Commands.stop && cmd !== commands[commands.length - 1]) {
            await new Promise(r => setTimeout(r, 2000));
          }
          break; // Success, move to next command
          
        } catch (err) {
          if (err.message && err.message.includes('already in progress') && retryCount < maxRetries - 1) {
            // GATT conflict - wait and retry this command
            retryCount++;
            this.bt.emit('commandError', { 
              command: cmd, 
              error: `GATT busy, retry ${retryCount}/${maxRetries}`, 
              timestamp: Date.now() 
            });
            await new Promise(r => setTimeout(r, 100 * retryCount)); // Exponential backoff
          } else {
            // Non-retryable error or max retries exceeded
            this.bt.emit('commandError', { command: cmd, error: err.message, timestamp: Date.now() });
            console.warn('Command failed:', err.message);
            break;
          }
        }
      }
    }
    
    this.isProcessing = false;
    
    // If new commands came in while processing, schedule another run
    if (this.pendingChannel || this.pendingIntensity || this.pendingStep) {
      this._scheduleProcess();
    }
  }

  _isChannelCmd(cmd) {
    return cmd === PulsettoProtocol.Commands.activateLeft ||
           cmd === PulsettoProtocol.Commands.activateRight ||
           cmd === PulsettoProtocol.Commands.activateBilateral ||
           cmd === PulsettoProtocol.Commands.stop;
  }

  _isIntensityCmd(cmd) {
    return /^[1-9]\n$/.test(cmd);
  }

  // Full reset on disconnect - clears all state including last sent
  reset() {
    this._clearPending();
    this.lastChannel = null;
    this.lastIntensity = null;
  }

  // Wait for any pending commands to complete processing (returns true if something was processed)
  async waitForComplete(timeoutMs = 30000) {
    const start = Date.now();
    
    // Wait for debounce timer to fire and processing to complete
    while ((this.debounceTimer || this.isProcessing) && (Date.now() - start < timeoutMs)) {
      await new Promise(r => setTimeout(r, 50));
    }
    
    return !this.debounceTimer && !this.isProcessing;
  }

  // Force immediate send (for session start/resume) - 2s delays between commands
  async sendImmediate(commands) {
    // Wait for any current processing
    while (this.isProcessing) {
      await new Promise(r => setTimeout(r, 100));
    }
    
    this.isProcessing = true;
    
    for (const cmd of commands) {
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          this.bt.emit('commandSending', { command: cmd, timestamp: Date.now() });
          await this.bt._sendCommandDirect(cmd);
          if (this._isChannelCmd(cmd)) this.lastChannel = cmd;
          if (this._isIntensityCmd(cmd)) this.lastIntensity = cmd;
          this.bt.emit('commandSent', { command: cmd, timestamp: Date.now() });
          
          if (cmd !== commands[commands.length - 1]) {
            await new Promise(r => setTimeout(r, 2000));
          }
          break; // Success, move to next command
          
        } catch (err) {
          if (err.message && err.message.includes('already in progress') && retryCount < maxRetries - 1) {
            // GATT conflict - wait and retry this command
            retryCount++;
            this.bt.emit('commandError', { 
              command: cmd, 
              error: `GATT busy, retry ${retryCount}/${maxRetries}`, 
              timestamp: Date.now() 
            });
            await new Promise(r => setTimeout(r, 100 * retryCount)); // Exponential backoff
          } else {
            // Non-retryable error or max retries exceeded
            this.bt.emit('commandError', { command: cmd, error: err.message, timestamp: Date.now() });
            console.warn('Command failed:', err.message);
            break;
          }
        }
      }
    }
    
    this.isProcessing = false;
  }
}

/**
 * Pulsetto Bluetooth Manager
 * 
 * Manages Web Bluetooth connection using ASCII protocol.
 * Enhanced for background stability with reconnection support.
 */

class PulsettoBluetooth {
  constructor() {
    this.device = null;
    this.server = null;
    this.service = null;
    this.rxCharacteristic = null;
    this.txCharacteristic = null;
    this.connectionState = 'disconnected';
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = PulsettoProtocol.Timing.maxReconnectAttempts;
    this.reconnectTimer = null;
    this.pendingPromises = new Map();
    this.transactionId = 0;
    this.wasConnectedBeforeHidden = false;
    this._isManualDisconnect = false;
    
    // Command queue manager with debouncing and coalescing
    this.commandQueue = [];
    this.isProcessingQueue = false;
    this.commandManager = new CommandQueueManager(this);
    
    // Text encoder for ASCII commands
    this.encoder = new TextEncoder();
    
    // Last known state for reconnection
    this.lastDeviceId = null;
    this.lastDeviceName = null;
    
    // Bind event handlers
    this._onDisconnect = this._onDisconnect.bind(this);
    this._onNotification = this._onNotification.bind(this);
    this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
    this._keepConnectionAlive = this._keepConnectionAlive.bind(this);
    
    // Listen for page visibility changes
    document.addEventListener('visibilitychange', this._handleVisibilityChange);
    
    // Start keepalive interval (pings connection every 4 seconds to prevent timeout)
    setInterval(this._keepConnectionAlive, 4000);
  }

  // Event handling
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => {
        try { cb(data); } catch (e) { console.error('Event handler error:', e); }
      });
    }
  }

  // State getters
  get isConnected() {
    return this.connectionState === 'ready' && this.device?.gatt?.connected;
  }

  get canSendCommands() {
    return this.isConnected && this.rxCharacteristic != null;
  }

  // Scan and connect
  async scanAndConnect() {
    if (this.connectionState === 'scanning') {
      throw new Error('Already scanning');
    }

    try {
      this._setState('scanning');
      this.emit('scanning', { timestamp: Date.now() });
      this._isManualDisconnect = false;

      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: PulsettoProtocol.UUID.deviceNamePrefix }],
        optionalServices: [PulsettoProtocol.UUID.nordicUartService]
      });

      this.device.addEventListener('gattserverdisconnected', this._onDisconnect);

      this.emit('deviceFound', { 
        name: this.device.name, 
        id: this.device.id,
        timestamp: Date.now()
      });

      await this._connectGatt();
      return true;

    } catch (error) {
      this._setState('error');
      this.emit('error', { error, timestamp: Date.now() });
      throw error;
    }
  }

  // Connect to GATT server
  async _connectGatt() {
    try {
      this._setState('connecting');
      this.emit('connecting', { timestamp: Date.now() });

      this.server = await this.device.gatt.connect();
      
      this._setState('discovering');
      this.emit('discovering', { timestamp: Date.now() });

      // Get Nordic UART service
      this.service = await this.server.getPrimaryService(PulsettoProtocol.UUID.nordicUartService);

      // Get characteristics
      this.rxCharacteristic = await this.service.getCharacteristic(PulsettoProtocol.UUID.rxCharacteristic);
      this.txCharacteristic = await this.service.getCharacteristic(PulsettoProtocol.UUID.txCharacteristic);

      // Start notifications
      await this.txCharacteristic.startNotifications();
      this.txCharacteristic.addEventListener('characteristicvaluechanged', this._onNotification);

      this._setState('ready');
      this.reconnectAttempts = 0;
      
      // Store device info for potential reconnection
      this.lastDeviceId = this.device.id;
      this.lastDeviceName = this.device.name;
      
      this.emit('connected', { 
        name: this.device.name,
        id: this.device.id,
        timestamp: Date.now()
      });

    } catch (error) {
      this._setState('error');
      this.emit('error', { error, timestamp: Date.now() });
      throw error;
    }
  }

  // Disconnect
  async disconnect() {
    this._isManualDisconnect = true;
    this._cancelReconnect();
    
    if (this.txCharacteristic) {
      try {
        await this.txCharacteristic.stopNotifications();
        this.txCharacteristic.removeEventListener('characteristicvaluechanged', this._onNotification);
      } catch (e) {
        // Ignore errors during cleanup
      }
    }

    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this._onDisconnect);
    }

    if (this.server?.connected) {
      this.server.disconnect();
    }

    this._resetState();
    this._setState('disconnected');
    this.emit('disconnected', { 
      manual: true,
      timestamp: Date.now() 
    });
  }

  // Reset internal state
  _resetState() {
    this.server = null;
    this.service = null;
    this.rxCharacteristic = null;
    this.txCharacteristic = null;
    this.pendingPromises.clear();
    
    // Full reset of command manager
    if (this.commandManager) {
      this.commandManager.reset();
    }
  }

  // Set connection state
  _setState(newState) {
    const oldState = this.connectionState;
    this.connectionState = newState;
    this.emit('stateChange', { oldState, newState, timestamp: Date.now() });
  }

  // Keep connection alive by querying status periodically
  async _keepConnectionAlive() {
    if (!this.isConnected) return;
    
    try {
      // Send a gentle ping (query battery)
      // This prevents the connection from timing out due to inactivity
      const data = this.encoder.encode(PulsettoProtocol.Commands.queryBattery);
      await this.rxCharacteristic.writeValue(data);
    } catch (e) {
      // If ping fails, connection is likely dead
      console.warn('[BLE] Keepalive ping failed:', e);
    }
  }

  // Low-level: Send a command directly (used internally by CommandQueueManager)
  async _sendCommandDirect(commandString, withResponse = false, timeout = 5000) {
    const data = this.encoder.encode(commandString);
    
    await this.rxCharacteristic.writeValue(data);
    
    this.emit('commandSent', { 
      command: commandString,
      bytes: Array.from(data),
      timestamp: Date.now() 
    });

    if (withResponse) {
      return this._waitForResponse(timeout);
    }

    return { success: true };
  }

  // Public API: Send command via manager (debounced, coalesced)
  async sendCommand(commandString, options = {}) {
    return this.commandManager.sendImmediate([commandString]);
  }

  // Public API: Send multiple commands via manager
  async sendCommands(commandStrings, options = {}) {
    return this.commandManager.sendImmediate(commandStrings);
  }

  // Send command immediately (bypasses debounce, used for stop)
  async sendCommandImmediate(commandString, options = {}) {
    try {
      return await this._sendCommandDirect(commandString, options.withResponse, options.timeout);
    } catch (error) {
      // Retry once after delay on GATT conflict
      if (error.message && error.message.includes('already in progress')) {
        await new Promise(r => setTimeout(r, 100));
        return await this._sendCommandDirect(commandString, options.withResponse, options.timeout);
      }
      throw error;
    }
  }

  // Send stop (clears queue, bypasses debounce)
  async sendStop() {
    return this.commandManager.sendStop();
  }

  // Queue channel command (debounced, coalesces with intensity)
  queueChannel(channelCmd) {
    this.commandManager.queueChannel(channelCmd);
  }

  // Queue intensity command (debounced, coalesces with channel)
  queueIntensity(intensityCmd) {
    this.commandManager.queueIntensity(intensityCmd);
  }

  // Clear command manager state
  clearCommandQueue() {
    this.commandManager._clearPending();
  }

  // Wait for all pending commands to complete
  async waitForCommandsComplete(timeoutMs = 30000) {
    return this.commandManager.waitForComplete(timeoutMs);
  }

  // Wait for response
  _waitForResponse(timeout) {
    return new Promise((resolve, reject) => {
      const id = ++this.transactionId;
      const timer = setTimeout(() => {
        this.pendingPromises.delete(id);
        reject(new Error('Command response timeout'));
      }, timeout);

      this.pendingPromises.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          this.pendingPromises.delete(id);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          this.pendingPromises.delete(id);
          reject(err);
        }
      });
    });
  }

  // Handle incoming notifications
  _onNotification(event) {
    const value = event.target.value;
    const bytes = new Uint8Array(value.buffer);
    const text = new TextDecoder().decode(bytes);
    const parsed = PulsettoProtocol.ResponseParser.parse(text);
    
    this.emit('notification', { 
      text,
      bytes: Array.from(bytes),
      parsed,
      timestamp: Date.now()
    });

    // Resolve pending promises
    for (const [id, promise] of this.pendingPromises) {
      promise.resolve(parsed);
    }
    this.pendingPromises.clear();
  }

  // Handle disconnection
  _onDisconnect(event) {
    this._resetState();
    
    const wasManual = this._isManualDisconnect;
    this._isManualDisconnect = false;
    
    if (this.connectionState !== 'disconnecting') {
      this._setState('disconnected');
      this.emit('disconnected', { 
        unexpected: !wasManual,
        timestamp: Date.now() 
      });

      // Only auto-reconnect if it wasn't a manual disconnect and tab is visible
      if (!wasManual && !document.hidden) {
        this._scheduleReconnect();
      }
    }
  }

  // Schedule reconnection with exponential backoff
  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('reconnectFailed', { 
        attempts: this.reconnectAttempts,
        timestamp: Date.now() 
      });
      return;
    }

    const delay = Math.min(
      PulsettoProtocol.Timing.reconnectDelaySeconds * Math.pow(2, this.reconnectAttempts),
      PulsettoProtocol.Timing.maxReconnectDelaySeconds
    ) * 1000;

    this.reconnectAttempts++;
    
    this.emit('reconnectScheduled', { 
      attempt: this.reconnectAttempts,
      delay,
      timestamp: Date.now() 
    });

    this.reconnectTimer = setTimeout(async () => {
      try {
        this.emit('reconnecting', { 
          attempt: this.reconnectAttempts,
          timestamp: Date.now() 
        });
        await this._connectGatt();
      } catch (error) {
        this._scheduleReconnect();
      }
    }, delay);
  }

  _cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // Handle page visibility changes
  _handleVisibilityChange() {
    const hidden = document.hidden;
    
    this.emit('visibilityChange', { 
      hidden, 
      visible: !hidden,
      timestamp: Date.now() 
    });

    // When tab becomes hidden, note that we were connected
    // Keepalive system handles background silently - no warning needed
    if (hidden && this.isConnected) {
      this.wasConnectedBeforeHidden = true;
    }
    
    // When tab becomes visible again, attempt reconnection if we were connected before
    if (!hidden && this.wasConnectedBeforeHidden) {
      this.wasConnectedBeforeHidden = false;
      
      if (!this.isConnected && this.lastDeviceId) {
        this.emit('reconnectAfterVisibility', {
          message: 'Tab visible again - attempting to reconnect...',
          timestamp: Date.now()
        });
        
        // Note: Web Bluetooth requires user gesture for reconnection
        // We can only auto-reconnect if the device object is still valid
        if (this.device && this.device.gatt) {
          this._scheduleReconnect();
        }
      }
    }
  }

  // Query battery voltage
  async queryBattery() {
    await this.sendCommand(PulsettoProtocol.Commands.queryBattery);
  }

  // Query charging status
  async queryCharging() {
    await this.sendCommand(PulsettoProtocol.Commands.queryCharging);
  }

  // Query both status
  async queryStatus() {
    await this.queryBattery();
    await new Promise(r => setTimeout(r, PulsettoProtocol.Timing.commandDelayMs));
    await this.queryCharging();
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.PulsettoBluetooth = PulsettoBluetooth;
}
