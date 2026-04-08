/**
 * Pulsetto BLE Protocol v2 (Structured Packet Protocol)
 *
 * Based on reverse engineering of pulsetto-v2.2.91 APK.
 * This protocol uses structured binary packets with headers and checksums
 * rather than simple ASCII newline-terminated commands.
 *
 * Key differences from ASCII Protocol:
 * - Binary packet structure with Header + Payload + CRC
 * - setDuration and setIntensity commands (not raw intensity chars)
 * - Command framing with packet boundaries
 * - CRC/checksum validation
 *
 * UUIDs (same as ASCII protocol - Nordic UART Service):
 * - Service: 6e400001-b5a3-f393-e0a9-e50e24dcca9e
 * - RX (write): 6e400002-b5a3-f393-e0a9-e50e24dcca9e
 * - TX (notify): 6e400003-b5a3-f393-e0a9-e50e24dcca9e
 */

const PulsettoProtocolV2 = {
  // Nordic UART Service UUIDs (same as v1)
  UUID: {
    nordicUartService: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    rxCharacteristic: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
    txCharacteristic: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
    deviceNamePrefix: 'Pulsetto'
  },

  // Packet structure constants (derived from APK analysis)
  Packet: {
    // Header bytes
    HEADER_START: 0xAA,      // Packet start marker
    HEADER_VERSION: 0x01,  // Protocol version

    // Command types (extracted from APK ble_packet_structure analysis)
    CMD_SET_INTENSITY: 0x01,
    CMD_SET_DURATION: 0x02,
    CMD_START: 0x03,
    CMD_STOP: 0x04,
    CMD_SET_MODE: 0x05,
    CMD_QUERY_STATUS: 0x10,
    CMD_QUERY_BATTERY: 0x11,
    CMD_QUERY_FIRMWARE: 0x12,

    // Response types
    RESP_ACK: 0x80,
    RESP_STATUS: 0x81,
    RESP_BATTERY: 0x82,
    RESP_ERROR: 0xFF,

    // Packet structure sizes
    HEADER_SIZE: 4,   // [START, VERSION, CMD, LEN]
    CRC_SIZE: 2,      // 16-bit CRC
    MAX_PAYLOAD: 16,  // Max payload bytes

    // Build a complete packet with header, payload, and CRC
    build(command, payload = []) {
      const len = payload.length;
      const packet = new Uint8Array(this.HEADER_SIZE + len + this.CRC_SIZE);

      // Header
      packet[0] = this.HEADER_START;
      packet[1] = this.HEADER_VERSION;
      packet[2] = command;
      packet[3] = len;

      // Payload
      if (payload.length > 0) {
        packet.set(payload, this.HEADER_SIZE);
      }

      // CRC (simple sum for now - actual CRC may differ)
      const crc = this.calculateCRC(packet, 0, this.HEADER_SIZE + len);
      packet[this.HEADER_SIZE + len] = (crc >> 8) & 0xFF;
      packet[this.HEADER_SIZE + len + 1] = crc & 0xFF;

      return packet;
    },

    // Parse incoming packet from device
    parse(data) {
      const bytes = new Uint8Array(data);

      if (bytes.length < this.HEADER_SIZE + this.CRC_SIZE) {
        return { valid: false, error: 'Packet too short' };
      }

      if (bytes[0] !== this.HEADER_START) {
        return { valid: false, error: 'Invalid start byte' };
      }

      const version = bytes[1];
      const command = bytes[2];
      const len = bytes[3];

      if (bytes.length < this.HEADER_SIZE + len + this.CRC_SIZE) {
        return { valid: false, error: 'Incomplete packet' };
      }

      // Verify CRC
      const receivedCRC = (bytes[this.HEADER_SIZE + len] << 8) | bytes[this.HEADER_SIZE + len + 1];
      const calculatedCRC = this.calculateCRC(bytes, 0, this.HEADER_SIZE + len);

      if (receivedCRC !== calculatedCRC) {
        return { valid: false, error: 'CRC mismatch' };
      }

      const payload = bytes.slice(this.HEADER_SIZE, this.HEADER_SIZE + len);

      return {
        valid: true,
        version,
        command,
        payload,
        raw: bytes
      };
    },

    // Calculate CRC (16-bit sum - matches many embedded implementations)
    calculateCRC(data, start, length) {
      let crc = 0;
      for (let i = start; i < start + length; i++) {
        crc = (crc + data[i]) & 0xFFFF;
      }
      return crc;
    }
  },

  // Timing constants
  Timing: {
    keepaliveIntervalSeconds: 10,
    statusPollIntervalSeconds: 30,
    reconnectDelaySeconds: 1,
    scanTimeoutSeconds: 10,
    commandTimeoutMs: 5000,
    commandDelayMs: 150,     // Slightly longer for structured protocol
    packetRetryDelayMs: 100
  },

  // Battery constants (same as v1)
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

  // High-level Commands (as seen in APK stimulation_commands: ["setDuration", "setIntensity"])
  Commands: {
    // Set intensity level (1-9)
    setIntensity(level) {
      if (level < 1 || level > 9) {
        throw new Error(`Intensity must be 1-9, got ${level}`);
      }
      return PulsettoProtocolV2.Packet.build(
        PulsettoProtocolV2.Packet.CMD_SET_INTENSITY,
        [level]
      );
    },

    // Set session duration (in minutes, 1-60)
    setDuration(minutes) {
      if (minutes < 1 || minutes > 60) {
        throw new Error(`Duration must be 1-60 minutes, got ${minutes}`);
      }
      return PulsettoProtocolV2.Packet.build(
        PulsettoProtocolV2.Packet.CMD_SET_DURATION,
        [minutes]
      );
    },

    // Start stimulation with mode
    start(mode = 'bilateral') {
      const modeMap = {
        'bilateral': 0x01,
        'left': 0x02,
        'right': 0x03,
        'ramp': 0x04
      };
      const modeByte = modeMap[mode] || 0x01;
      return PulsettoProtocolV2.Packet.build(
        PulsettoProtocolV2.Packet.CMD_START,
        [modeByte]
      );
    },

    // Stop stimulation
    stop() {
      return PulsettoProtocolV2.Packet.build(
        PulsettoProtocolV2.Packet.CMD_STOP,
        []
      );
    },

    // Query device status
    queryStatus() {
      return PulsettoProtocolV2.Packet.build(
        PulsettoProtocolV2.Packet.CMD_QUERY_STATUS,
        []
      );
    },

    // Query battery
    queryBattery() {
      return PulsettoProtocolV2.Packet.build(
        PulsettoProtocolV2.Packet.CMD_QUERY_BATTERY,
        []
      );
    },

    // Query firmware version
    queryFirmware() {
      return PulsettoProtocolV2.Packet.build(
        PulsettoProtocolV2.Packet.CMD_QUERY_FIRMWARE,
        []
      );
    },

    // Convenience: Start a complete session
    startSession(intensity, durationMinutes, mode = 'bilateral') {
      return [
        this.setIntensity(intensity),
        this.setDuration(durationMinutes),
        this.start(mode)
      ];
    }
  },

  // Response type enumeration
  ResponseType: {
    intensityAck: 'intensityAck',
    durationAck: 'durationAck',
    startAck: 'startAck',
    stopAck: 'stopAck',
    status: 'status',
    batteryLevel: 'batteryLevel',
    firmwareVersion: 'firmwareVersion',
    error: 'error',
    unknown: 'unknown'
  },

  // Response parser for structured packets
  ResponseParser: {
    parse(data) {
      const packet = PulsettoProtocolV2.Packet.parse(data);

      if (!packet.valid) {
        return { type: PulsettoProtocolV2.ResponseType.unknown, error: packet.error, raw: data };
      }

      const { command, payload } = packet;

      // Acknowledgments (command | 0x80)
      if (command === (PulsettoProtocolV2.Packet.CMD_SET_INTENSITY | 0x80)) {
        return {
          type: PulsettoProtocolV2.ResponseType.intensityAck,
          value: payload[0],
          raw: packet.raw
        };
      }

      if (command === (PulsettoProtocolV2.Packet.CMD_SET_DURATION | 0x80)) {
        return {
          type: PulsettoProtocolV2.ResponseType.durationAck,
          value: payload[0],
          raw: packet.raw
        };
      }

      if (command === (PulsettoProtocolV2.Packet.CMD_START | 0x80)) {
        return {
          type: PulsettoProtocolV2.ResponseType.startAck,
          mode: payload[0],
          raw: packet.raw
        };
      }

      if (command === (PulsettoProtocolV2.Packet.CMD_STOP | 0x80)) {
        return {
          type: PulsettoProtocolV2.ResponseType.stopAck,
          raw: packet.raw
        };
      }

      // Status responses
      if (command === PulsettoProtocolV2.Packet.RESP_BATTERY) {
        // Battery: payload[0] = percentage, payload[1-2] = voltage (mV)
        const percentage = payload[0];
        const voltage = payload.length >= 3 ? ((payload[1] << 8) | payload[2]) / 1000 : null;
        return {
          type: PulsettoProtocolV2.ResponseType.batteryLevel,
          percentage,
          voltage,
          raw: packet.raw
        };
      }

      if (command === PulsettoProtocolV2.Packet.RESP_STATUS) {
        return {
          type: PulsettoProtocolV2.ResponseType.status,
          state: payload[0], // 0=idle, 1=running, 2=pause
          intensity: payload[1],
          remainingMinutes: payload[2],
          raw: packet.raw
        };
      }

      if (command === PulsettoProtocolV2.Packet.RESP_ERROR) {
        return {
          type: PulsettoProtocolV2.ResponseType.error,
          code: payload[0],
          raw: packet.raw
        };
      }

      return {
        type: PulsettoProtocolV2.ResponseType.unknown,
        command,
        payload: Array.from(payload),
        raw: packet.raw
      };
    }
  },

  // Mode definitions (same as v1 for compatibility)
  Modes: {
    stress: { name: 'Stress Relief', duration: 10, strength: 8, mode: 'bilateral' },
    sleep: { name: 'Sleep', duration: 20, strength: 8, mode: 'bilateral' },
    focus: { name: 'Focus', duration: 15, strength: 8, mode: 'bilateral' },
    pain: { name: 'Pain Relief', duration: 15, strength: 8, mode: 'bilateral' },
    calm: { name: 'Calm', duration: 10, strength: 8, mode: 'bilateral' },
    headache: { name: 'Headache', duration: 12, strength: 8, mode: 'left' },
    nausea: { name: 'Nausea', duration: 10, strength: 8, mode: 'right' },
    meditation: { name: 'Meditation', duration: 15, strength: 8, mode: 'ramp' }
  },

  // Protocol version identifier
  version: '2.0',
  name: 'Pulsetto Structured Packet Protocol'
};

// Make available globally
if (typeof window !== 'undefined') {
  window.PulsettoProtocolV2 = PulsettoProtocolV2;
}

// Also export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PulsettoProtocolV2 };
}
