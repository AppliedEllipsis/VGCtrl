/**
 * Pulsetto BLE Protocol Definitions (ASCII Protocol)
 * 
 * Canonical protocol implementation for Web Bluetooth API.
 * All commands are ASCII strings terminated with newline.
 * 
 * Based on: pulse-libre/lib/ble/protocol_canonical.dart
 * Sources:
 * - open-pulse/OpenPulse/Models/BLEConstants.swift
 * - pulse-libre-desktop/main.py
 */

const PulsettoProtocol = {
  // Nordic UART Service UUIDs
  UUID: {
    nordicUartService: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    rxCharacteristic: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
    txCharacteristic: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
    deviceNamePrefix: 'Pulsetto'
  },

  // Timing constants
  Timing: {
    keepaliveIntervalSeconds: 10,
    statusPollIntervalSeconds: 30,
    reconnectDelaySeconds: 1,
    scanTimeoutSeconds: 10,
    scanRetryDelaySeconds: 3,
    maxReconnectDelaySeconds: 30,
    maxReconnectAttempts: 5,
    commandDelayMs: 100
  },

  // Battery constants
  Battery: {
    voltageMax: 3.95,
    voltageMin: 2.5,

    calculatePercentage(voltage) {
      if (voltage >= this.voltageMax) return 100;
      if (voltage <= this.voltageMin) return 0;
      return Math.round(((voltage - this.voltageMin) / (this.voltageMax - this.voltageMin)) * 100);
    },

    getLevelCategory(percentage) {
      if (percentage >= 80) return 'high';
      if (percentage >= 40) return 'medium';
      if (percentage >= 20) return 'low';
      return 'critical';
    }
  },

  // ASCII Command strings (with newline terminator)
  Commands: {
    // Bilateral activation - both channels active
    activateBilateral: 'D\n',

    // Left channel only
    activateLeft: 'A\n',

    // Right channel only  
    activateRight: 'C\n',

    // Ramp-up activation
    activateRamp: 'B\n',

    // Stop commands
    stop: '-\n',
    stopLegacy: '0\n',

    // Query commands
    queryBattery: 'Q\n',
    queryCharging: 'u\n',
    queryDeviceId: 'i\n',
    queryFirmware: 'v\n',

    // Intensity level (0-9) as ASCII. 0 is stop.
    intensity(level) {
      if (level < 0 || level > 9) {
        throw new Error(`Intensity must be 0-9, got ${level}`);
      }
      if (level === 0) {
        return this.stop;
      }
      return `${level}\n`;
    },

    // Keepalive - same as intensity
    keepalive(level) {
      return this.intensity(level);
    }
  },

  // Response type enumeration
  ResponseType: {
    strengthAck: 'strengthAck',
    startAck: 'startAck',
    stopAck: 'stopAck',
    batteryVoltage: 'batteryVoltage',
    chargingStatus: 'chargingStatus',
    deviceId: 'deviceId',
    firmwareVersion: 'firmwareVersion',
    unknown: 'unknown'
  },

  // Response parser
  ResponseParser: {
    parseType(text) {
      const trimmed = text.trim();

      if (!trimmed) return PulsettoProtocol.ResponseType.unknown;

      // Battery voltage: "Batt:3.72" or raw "3.72"
      let voltageText = trimmed;
      if (trimmed.startsWith('Batt:')) {
        voltageText = trimmed.substring(5);
      }
      if (voltageText.includes('.')) {
        const voltage = parseFloat(voltageText);
        if (!isNaN(voltage) && voltage >= 0.0 && voltage <= 5.0) {
          return PulsettoProtocol.ResponseType.batteryVoltage;
        }
      }

      // Charging status: "0", "1", "Charging", "Not Charging"
      if (trimmed === '0' || trimmed === '1' || trimmed === 'Charging' || trimmed === 'Not Charging') {
        return PulsettoProtocol.ResponseType.chargingStatus;
      }

      // Single character responses
      if (trimmed.length === 1) {
        const char = trimmed;

        // Strength ack: '1'-'9'
        if (char >= '1' && char <= '9') {
          return PulsettoProtocol.ResponseType.strengthAck;
        }

        // Start ack: 'D'
        if (char === 'D') {
          return PulsettoProtocol.ResponseType.startAck;
        }

        // Stop ack: '-' (or '0' for legacy)
        if (char === '-' || char === '0') {
          return PulsettoProtocol.ResponseType.stopAck;
        }
      }

      return PulsettoProtocol.ResponseType.unknown;
    },

    parse(text) {
      const trimmed = text.trim();
      const type = this.parseType(trimmed);

      switch (type) {
        case PulsettoProtocol.ResponseType.strengthAck:
          return { type, value: parseInt(trimmed, 10) };

        case PulsettoProtocol.ResponseType.batteryVoltage:
          let voltageText = trimmed;
          if (trimmed.startsWith('Batt:')) {
            voltageText = trimmed.substring(5);
          }
          return { type, value: parseFloat(voltageText) };

        case PulsettoProtocol.ResponseType.chargingStatus:
          if (trimmed === '1' || trimmed === 'Charging') return { type, value: true };
          if (trimmed === '0' || trimmed === 'Not Charging') return { type, value: false };
          return { type, value: null };

        case PulsettoProtocol.ResponseType.startAck:
        case PulsettoProtocol.ResponseType.stopAck:
          return { type, value: trimmed };

        default:
          return { type, value: trimmed };
      }
    }
  },

  // Mode definitions - UI labels only, not protocol features
  // The device only understands: intensity (1-9) + channel (A/C/D/-)
  // These are user-friendly presets for common use cases
  Modes: {
    stress: { name: 'Stress Relief', duration: 10, strength: 8, breathing: false },
    sleep: { name: 'Sleep', duration: 20, strength: 8, breathing: false },
    focus: { name: 'Focus (left)', duration: 15, strength: 8, breathing: false },
    focus_r: { name: 'Focus (right)', duration: 15, strength: 8, breathing: false },
    focus_both: { name: 'Focus (both)', duration: 15, strength: 8, breathing: false },
    focus_alt: { name: 'Focus (alt)', duration: 15, strength: 8, breathing: false },
    pain: { name: 'Pain Relief', duration: 15, strength: 8, breathing: false },
    calm: { name: 'Calm', duration: 10, strength: 8, breathing: true },
    headache: { name: 'Headache', duration: 12, strength: 8, breathing: false },
    nausea: { name: 'Nausea', duration: 10, strength: 8, breathing: false },
    meditation: { name: 'Meditation', duration: 15, strength: 8, breathing: true }
  }
};

// Make available globally
if (typeof window !== 'undefined') {
  window.PulsettoProtocol = PulsettoProtocol;
}
