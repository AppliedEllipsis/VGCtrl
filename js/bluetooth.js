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
    this.clearCommandQueue();
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

  // Send ASCII command to device (queued to prevent GATT conflicts)
  async sendCommand(commandString, options = {}) {
    if (!this.canSendCommands) {
      throw new Error('Not connected - cannot send command');
    }

    const { withResponse = false, timeout = 5000 } = options;

    // Create a promise that will resolve when the command is processed
    return new Promise((resolve, reject) => {
      this.commandQueue.push({
        commandString,
        withResponse,
        timeout,
        resolve,
        reject
      });
      
      // Start processing if not already
      if (!this.isProcessingQueue) {
        this._processCommandQueue();
      }
    });
  }

  // Process command queue sequentially
  async _processCommandQueue() {
    if (this.isProcessingQueue || this.commandQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.commandQueue.length > 0 && this.canSendCommands) {
      const item = this.commandQueue.shift();
      
      try {
        const result = await this._executeCommand(item.commandString, item.withResponse, item.timeout);
        item.resolve(result);
      } catch (error) {
        // Don't break queue on GATT operation conflict - retry once after delay
        if (error.message && error.message.includes('already in progress')) {
          await new Promise(r => setTimeout(r, 100));
          try {
            const result = await this._executeCommand(item.commandString, item.withResponse, item.timeout);
            item.resolve(result);
          } catch (retryError) {
            item.reject(retryError);
          }
        } else {
          item.reject(error);
        }
      }

      // Small delay between commands to prevent GATT conflicts
      if (this.commandQueue.length > 0) {
        await new Promise(r => setTimeout(r, PulsettoProtocol.Timing.commandDelayMs));
      }
    }

    this.isProcessingQueue = false;
    
    // Check if more commands were added while processing
    if (this.commandQueue.length > 0) {
      this._processCommandQueue();
    }
  }

  // Execute a single command
  async _executeCommand(commandString, withResponse, timeout) {
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

  // Send multiple commands with delay (queued)
  async sendCommands(commandStrings, options = {}) {
    const results = [];
    for (const cmd of commandStrings) {
      results.push(await this.sendCommand(cmd, options));
    }
    return results;
  }

  // Clear command queue (useful on disconnect or stop)
  clearCommandQueue() {
    // Reject all pending commands
    while (this.commandQueue.length > 0) {
      const item = this.commandQueue.shift();
      item.reject(new Error('Command cancelled'));
    }
    this.isProcessingQueue = false;
  }

  // Send command immediately, bypassing queue (for urgent commands like stop)
  async sendCommandImmediate(commandString, options = {}) {
    if (!this.canSendCommands) {
      throw new Error('Not connected - cannot send command');
    }

    const { withResponse = false, timeout = 5000 } = options;

    try {
      const result = await this._executeCommand(commandString, withResponse, timeout);
      return result;
    } catch (error) {
      // Retry once after delay on GATT conflict
      if (error.message && error.message.includes('already in progress')) {
        await new Promise(r => setTimeout(r, 100));
        return await this._executeCommand(commandString, withResponse, timeout);
      }
      throw error;
    }
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
