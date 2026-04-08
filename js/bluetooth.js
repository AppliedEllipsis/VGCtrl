/**
 * Pulsetto Bluetooth Manager
 * 
 * Manages Web Bluetooth connection using ASCII protocol.
 * Commands are sent as ASCII strings with newline terminator.
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
    
    // Text encoder for ASCII commands
    this.encoder = new TextEncoder();
    
    // Bind event handlers
    this._onDisconnect = this._onDisconnect.bind(this);
    this._onNotification = this._onNotification.bind(this);
    this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
    
    // Listen for page visibility changes
    document.addEventListener('visibilitychange', this._handleVisibilityChange);
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
    this.emit('disconnected', { timestamp: Date.now() });
  }

  // Reset internal state
  _resetState() {
    this.server = null;
    this.service = null;
    this.rxCharacteristic = null;
    this.txCharacteristic = null;
    this.pendingPromises.clear();
  }

  // Set connection state
  _setState(newState) {
    const oldState = this.connectionState;
    this.connectionState = newState;
    this.emit('stateChange', { oldState, newState, timestamp: Date.now() });
  }

  // Send ASCII command to device
  async sendCommand(commandString, options = {}) {
    if (!this.canSendCommands) {
      throw new Error('Not connected - cannot send command');
    }

    const { withResponse = false, timeout = 5000 } = options;

    try {
      // Encode ASCII string to Uint8Array
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

    } catch (error) {
      this.emit('commandError', { 
        error, 
        command: commandString,
        timestamp: Date.now() 
      });
      throw error;
    }
  }

  // Send multiple commands with delay
  async sendCommands(commandStrings, options = {}) {
    const results = [];
    for (const cmd of commandStrings) {
      results.push(await this.sendCommand(cmd, options));
      // Small delay between commands
      await new Promise(r => setTimeout(r, PulsettoProtocol.Timing.commandDelayMs));
    }
    return results;
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
    
    if (this.connectionState !== 'disconnecting') {
      this._setState('disconnected');
      this.emit('disconnected', { 
        unexpected: true,
        timestamp: Date.now() 
      });

      // Attempt reconnect if configured
      this._scheduleReconnect();
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
