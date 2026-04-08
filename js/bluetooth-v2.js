/**
 * Pulsetto Bluetooth Manager - Protocol v2
 *
 * Manages Web Bluetooth connection using the structured packet protocol.
 * Based on reverse engineering of pulsetto-v2.2.91.
 *
 * Key differences from v1:
 * - Uses binary packet protocol with headers and CRC
 * - Explicit setDuration/setIntensity commands (not ASCII)
 * - Packet acknowledgment and retry logic
 * - Different response handling
 */

class PulsettoBluetoothV2 {
  constructor(options = {}) {
    this.device = null;
    this.server = null;
    this.service = null;
    this.rxCharacteristic = null;
    this.txCharacteristic = null;
    this.connectionState = 'disconnected';
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectTimer = null;

    // Protocol v2 specific
    this.pendingTransactions = new Map();
    this.transactionId = 0;
    this.packetBuffer = new Uint8Array(0);  // For reassembling packets
    this.lastSentPacket = null;
    this.retryCount = 0;
    this.maxRetries = 3;

    // GATT operation queue (Web Bluetooth requires serial GATT operations)
    this._gattQueue = Promise.resolve();
    this._gattQueueLock = false;

    // Configuration
    this.config = {
      protocolVersion: '2.0',
      requireAck: true,
      packetTimeoutMs: 5000,
      ...options
    };

    // Track state
    this.sessionState = {
      intensity: 0,
      duration: 0,
      running: false,
      mode: 'idle'
    };

    this.lastDeviceId = null;
    this.lastDeviceName = null;
    this.wasConnectedBeforeHidden = false;
    this._isManualDisconnect = false;

    // Bind event handlers
    this._onDisconnect = this._onDisconnect.bind(this);
    this._onNotification = this._onNotification.bind(this);
    this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
    this._keepConnectionAlive = this._keepConnectionAlive.bind(this);

    // Listen for page visibility changes
    document.addEventListener('visibilitychange', this._handleVisibilityChange);

    // Start keepalive interval
    this.keepaliveInterval = setInterval(this._keepConnectionAlive, 10000);
  }

  // ==================== Event Handling ====================

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
        try { cb(data); } catch (e) { console.error('[BT-V2] Event handler error:', e); }
      });
    }
  }

  // ==================== State Getters ====================

  get isConnected() {
    return this.connectionState === 'ready' && this.device?.gatt?.connected;
  }

  get canSendCommands() {
    return this.isConnected && this.rxCharacteristic != null;
  }

  // ==================== Connection Management ====================

  async scanAndConnect() {
    if (this.connectionState === 'scanning') {
      throw new Error('Already scanning');
    }

    try {
      this._setState('scanning');
      this.emit('scanning', { timestamp: Date.now() });
      this._isManualDisconnect = false;

      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'Pulsetto' }],
        optionalServices: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e']
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

  async _connectGatt() {
    try {
      this._setState('connecting');
      this.emit('connecting', { timestamp: Date.now() });

      this.server = await this.device.gatt.connect();

      this._setState('discovering');
      this.emit('discovering', { timestamp: Date.now() });

      // Get Nordic UART service
      this.service = await this.server.getPrimaryService('6e400001-b5a3-f393-e0a9-e50e24dcca9e');

      // Get characteristics
      this.rxCharacteristic = await this.service.getCharacteristic('6e400002-b5a3-f393-e0a9-e50e24dcca9e');
      this.txCharacteristic = await this.service.getCharacteristic('6e400003-b5a3-f393-e0a9-e50e24dcca9e');

      // Start notifications
      await this.txCharacteristic.startNotifications();
      this.txCharacteristic.addEventListener('characteristicvaluechanged', this._onNotification);

      this._setState('ready');
      this.reconnectAttempts = 0;
      this.retryCount = 0;

      this.lastDeviceId = this.device.id;
      this.lastDeviceName = this.device.name;

      this.emit('connected', {
        name: this.device.name,
        id: this.device.id,
        protocol: 'v2',
        timestamp: Date.now()
      });

      // Query initial status
      await this.queryStatus();

    } catch (error) {
      this._setState('error');
      this.emit('error', { error, timestamp: Date.now() });
      throw error;
    }
  }

  async disconnect() {
    this._isManualDisconnect = true;
    this._cancelReconnect();
    this._clearPendingTransactions();

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

  _resetState() {
    this.server = null;
    this.service = null;
    this.rxCharacteristic = null;
    this.txCharacteristic = null;
    this.packetBuffer = new Uint8Array(0);
    this.sessionState = { intensity: 0, duration: 0, running: false, mode: 'idle' };
  }

  _setState(newState) {
    const oldState = this.connectionState;
    this.connectionState = newState;
    this.emit('stateChange', { oldState, newState, timestamp: Date.now() });
  }

  // ==================== Protocol v2: Packet Handling ====================

  // Send a structured packet with optional acknowledgment wait
  // Uses GATT operation queue to prevent "GATT operation already in progress" errors
  async sendPacket(packet, options = {}) {
    if (!this.canSendCommands) {
      throw new Error('Not connected - cannot send packet');
    }

    // Queue the GATT operation
    return this._queueGattOperation(() => this._doSendPacket(packet, options));
  }

  // Queue GATT operations to ensure serial execution
  _queueGattOperation(operation) {
    const queuedOperation = this._gattQueue.then(operation).catch(err => {
      // If operation fails, we still need to resolve the queue
      throw err;
    });

    // Update queue to include this operation
    this._gattQueue = queuedOperation.catch(() => {
      // Swallow errors to keep queue moving, error is thrown to caller
    });

    return queuedOperation;
  }

  // Internal: Actually send the packet (called within queue)
  async _doSendPacket(packet, options) {
    const { waitForAck = false, timeout = 5000 } = options;

    // Store for potential retry
    this.lastSentPacket = packet;

    try {
      await this.rxCharacteristic.writeValue(packet);

      this.emit('packetSent', {
        packet: Array.from(packet),
        timestamp: Date.now()
      });

      if (waitForAck) {
        return this._waitForAck(packet[2], timeout); // packet[2] is command byte
      }

      return { success: true };

    } catch (error) {
      this.emit('packetError', {
        error,
        packet: Array.from(packet),
        timestamp: Date.now()
      });

      // Attempt retry if configured
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        this.emit('packetRetry', {
          attempt: this.retryCount,
          maxRetries: this.maxRetries,
          timestamp: Date.now()
        });
        await new Promise(r => setTimeout(r, 100));
        return this._doSendPacket(packet, options);
      }

      throw error;
    }
  }

  // Wait for acknowledgment of specific command
  _waitForAck(command, timeout) {
    return new Promise((resolve, reject) => {
      const id = ++this.transactionId;
      const timer = setTimeout(() => {
        this.pendingTransactions.delete(id);
        reject(new Error(`Ack timeout for command 0x${command.toString(16)}`));
      }, timeout);

      this.pendingTransactions.set(id, {
        command: command | 0x80,  // Expected ack command
        resolve: (value) => {
          clearTimeout(timer);
          this.pendingTransactions.delete(id);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          this.pendingTransactions.delete(id);
          reject(err);
        }
      });
    });
  }

  // Clear all pending transactions
  _clearPendingTransactions() {
    for (const [id, tx] of this.pendingTransactions) {
      tx.reject(new Error('Connection closed'));
    }
    this.pendingTransactions.clear();
  }

  // ==================== High-Level Commands ====================

  // Set stimulation intensity (1-9)
  async setIntensity(level) {
    if (!window.PulsettoProtocolV2) {
      throw new Error('ProtocolV2 not loaded');
    }

    const packet = window.PulsettoProtocolV2.Commands.setIntensity(level);
    const result = await this.sendPacket(packet, { waitForAck: true });

    this.sessionState.intensity = level;
    this.emit('intensitySet', { level, timestamp: Date.now() });

    return result;
  }

  // Set session duration (minutes)
  async setDuration(minutes) {
    if (!window.PulsettoProtocolV2) {
      throw new Error('ProtocolV2 not loaded');
    }

    const packet = window.PulsettoProtocolV2.Commands.setDuration(minutes);
    const result = await this.sendPacket(packet, { waitForAck: true });

    this.sessionState.duration = minutes;
    this.emit('durationSet', { minutes, timestamp: Date.now() });

    return result;
  }

  // Start stimulation
  async start(mode = 'bilateral') {
    if (!window.PulsettoProtocolV2) {
      throw new Error('ProtocolV2 not loaded');
    }

    const packet = window.PulsettoProtocolV2.Commands.start(mode);
    const result = await this.sendPacket(packet, { waitForAck: true });

    this.sessionState.running = true;
    this.sessionState.mode = mode;
    this.emit('sessionStarted', { mode, timestamp: Date.now() });

    return result;
  }

  // Stop stimulation
  async stop() {
    if (!window.PulsettoProtocolV2) {
      throw new Error('ProtocolV2 not loaded');
    }

    const packet = window.PulsettoProtocolV2.Commands.stop();
    const result = await this.sendPacket(packet, { waitForAck: true });

    this.sessionState.running = false;
    this.sessionState.mode = 'idle';
    this.emit('sessionStopped', { timestamp: Date.now() });

    return result;
  }

  // Full session start: intensity + duration + start
  async startSession(intensity, durationMinutes, mode = 'bilateral') {
    this.emit('sessionStarting', { intensity, duration: durationMinutes, mode, timestamp: Date.now() });

    // Reset retry count for fresh session
    this.retryCount = 0;

    // Send commands in sequence with proper delays
    await this.setIntensity(intensity);
    await new Promise(r => setTimeout(r, 150));

    await this.setDuration(durationMinutes);
    await new Promise(r => setTimeout(r, 150));

    await this.start(mode);

    return {
      success: true,
      intensity,
      duration: durationMinutes,
      mode,
      timestamp: Date.now()
    };
  }

  // ==================== v1 Compatibility Layer ====================

  // Send single ASCII command (translates to binary packet)
  async sendCommand(commandString, options = {}) {
    // Parse ASCII command and translate to v2 binary
    const packet = this._asciiToPacket(commandString);
    if (!packet) {
      throw new Error(`Unknown ASCII command: ${commandString}`);
    }
    return this.sendPacket(packet, { waitForAck: false });
  }

  // Send multiple ASCII commands with delays
  async sendCommands(commandStrings, options = {}) {
    const results = [];
    for (const cmd of commandStrings) {
      results.push(await this.sendCommand(cmd, options));
      await new Promise(r => setTimeout(r, 150)); // Delay between packets
    }
    return results;
  }

  // Translate v1 ASCII commands to v2 binary packets
  _asciiToPacket(commandString) {
    const cmd = commandString.trim();

    // Intensity commands: '1', '2', ..., '9'
    if (/^[1-9]$/.test(cmd)) {
      return window.PulsettoProtocolV2.Commands.setIntensity(parseInt(cmd));
    }

    // Channel/mode commands
    switch (cmd) {
      case 'D':  // Bilateral
        return window.PulsettoProtocolV2.Commands.start('bilateral');
      case 'A':  // Left
        return window.PulsettoProtocolV2.Commands.start('left');
      case 'C':  // Right
        return window.PulsettoProtocolV2.Commands.start('right');
      case 'B':  // Ramp
        return window.PulsettoProtocolV2.Commands.start('ramp');
      case '-':  // Stop
      case 'E':  // Alternative stop
        return window.PulsettoProtocolV2.Commands.stop();
      case 'Q':  // Query battery
        return window.PulsettoProtocolV2.Commands.queryBattery();
      case 'u':  // Charging query (v1 uses 'u')
      case 'U':
        return window.PulsettoProtocolV2.Commands.queryBattery(); // v2 uses battery for status
      default:
        return null;
    }
  }

  // v1 compatibility: queryCharging (v2 queries battery status which includes charging)
  async queryCharging() {
    // v2 doesn't have a separate charging query, battery packet includes status
    return this.queryBattery();
  }

  // v1 compatibility: queryStatus (same as v2)
  async queryStatus() {
    if (!window.PulsettoProtocolV2) {
      throw new Error('ProtocolV2 not loaded');
    }

    const packet = window.PulsettoProtocolV2.Commands.queryStatus();
    return this.sendPacket(packet, { waitForAck: false });
  }

  // ==================== Notification Handling ====================

  _onNotification(event) {
    const value = event.target.value;
    const bytes = new Uint8Array(value.buffer);

    // Debug: log raw notification data
    const hexDebug = bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    const asciiDebug = bytes.map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
    this.emit('debug', { message: `RX raw: ${hexDebug} | ASCII: ${asciiDebug}`, timestamp: Date.now() });

    // Append to packet buffer (for handling fragmented packets)
    const newBuffer = new Uint8Array(this.packetBuffer.length + bytes.length);
    newBuffer.set(this.packetBuffer);
    newBuffer.set(bytes, this.packetBuffer.length);
    this.packetBuffer = newBuffer;

    // Try to parse packets from buffer
    this._processPacketBuffer();
  }

  _processPacketBuffer() {
    if (!window.PulsettoProtocolV2) return;

    // Debug: log buffer state
    const bufferHex = this.packetBuffer.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    this.emit('debug', { message: `Buffer: ${bufferHex} (${this.packetBuffer.length} bytes)`, timestamp: Date.now() });

    // Need at least header size to check
    const HEADER_SIZE = 4;
    const CRC_SIZE = 2;

    while (this.packetBuffer.length >= HEADER_SIZE + CRC_SIZE) {
      // Check for start byte
      if (this.packetBuffer[0] !== 0xAA) {
        // Skip until we find start byte
        const nextStart = this.packetBuffer.indexOf(0xAA);
        if (nextStart === -1) {
          this.packetBuffer = new Uint8Array(0);
          return;
        }
        this.packetBuffer = this.packetBuffer.slice(nextStart);
        continue;
      }

      // Get payload length from header
      const payloadLen = this.packetBuffer[3];
      const totalLen = HEADER_SIZE + payloadLen + CRC_SIZE;

      if (this.packetBuffer.length < totalLen) {
        // Need more data
        this.emit('debug', { message: `Need more data: have ${this.packetBuffer.length}, need ${totalLen}`, timestamp: Date.now() });
        return;
      }

      // Extract complete packet
      const packet = this.packetBuffer.slice(0, totalLen);
      this.packetBuffer = this.packetBuffer.slice(totalLen);

      // Debug: log extracted packet
      const packetHex = packet.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      this.emit('debug', { message: `Packet extracted: ${packetHex}`, timestamp: Date.now() });

      // Parse using protocol
      const parsed = window.PulsettoProtocolV2.ResponseParser.parse(packet);

      if (!parsed.valid) {
        this.emit('debug', { message: `Parse error: ${parsed.error}`, timestamp: Date.now() });
      }

      this._handleParsedResponse(parsed);
    }
  }

  _handleParsedResponse(parsed) {
    this.emit('packetReceived', {
      parsed,
      raw: parsed.raw,
      timestamp: Date.now()
    });

    // Check for pending transaction acknowledgments
    if (parsed.type && parsed.type.endsWith('Ack')) {
      for (const [id, tx] of this.pendingTransactions) {
        if (tx.command === parsed.raw[2]) {  // Command byte match
          tx.resolve(parsed);
          this.retryCount = 0;  // Reset retry on successful ack
          return;
        }
      }
    }

    // Update session state from status responses
    if (parsed.type === 'status') {
      this.sessionState = {
        ...this.sessionState,
        running: parsed.state === 1,
        intensity: parsed.intensity,
        duration: parsed.remainingMinutes
      };
    }

    if (parsed.type === 'batteryLevel') {
      this.emit('batteryUpdate', {
        percentage: parsed.percentage,
        voltage: parsed.voltage,
        timestamp: Date.now()
      });
    }

    if (parsed.type === 'error') {
      this.emit('deviceError', {
        code: parsed.code,
        timestamp: Date.now()
      });
    }
  }

  // ==================== Keepalive & Reconnection ====================

  async _keepConnectionAlive() {
    if (!this.isConnected) return;

    try {
      // Send status query as keepalive - use queue to avoid conflicts
      const packet = window.PulsettoProtocolV2.Commands.queryStatus();
      await this._queueGattOperation(() => this.rxCharacteristic.writeValue(packet));
    } catch (e) {
      // Silent fail - keepalive is best effort
      console.warn('[BT-V2] Keepalive failed:', e.message);
    }
  }

  _onDisconnect(event) {
    this._resetState();
    this._clearPendingTransactions();

    const wasManual = this._isManualDisconnect;
    this._isManualDisconnect = false;

    if (this.connectionState !== 'disconnecting') {
      this._setState('disconnected');
      this.emit('disconnected', {
        unexpected: !wasManual,
        timestamp: Date.now()
      });

      if (!wasManual && !document.hidden) {
        this._scheduleReconnect();
      }
    }
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('reconnectFailed', {
        attempts: this.reconnectAttempts,
        timestamp: Date.now()
      });
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
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

  _handleVisibilityChange() {
    const hidden = document.hidden;

    this.emit('visibilityChange', {
      hidden,
      visible: !hidden,
      timestamp: Date.now()
    });

    if (hidden && this.isConnected) {
      this.wasConnectedBeforeHidden = true;
    }

    if (!hidden && this.wasConnectedBeforeHidden) {
      this.wasConnectedBeforeHidden = false;

      if (!this.isConnected && this.lastDeviceId) {
        if (this.device && this.device.gatt) {
          this._scheduleReconnect();
        }
      }
    }
  }

  // ==================== Utility Methods ====================

  // Get current session state
  getSessionState() {
    return { ...this.sessionState };
  }

  // Utility: Convert packet to hex string for debugging
  static packetToHex(packet) {
    return Array.from(packet)
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
  }

  // Utility: Parse hex string to packet
  static hexToPacket(hexString) {
    const hex = hexString.replace(/\s/g, '');
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return new Uint8Array(bytes);
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.PulsettoBluetoothV2 = PulsettoBluetoothV2;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PulsettoBluetoothV2 };
}
