# Pulsetto Protocol v2 Research Document

## Source
Based on reverse engineering of `pulsetto-v2.2.91` APK (React Native Android app)

## Key Findings

### 1. Protocol Type: Structured Binary Packets (NOT ASCII)

The v2.2.91 app uses a **structured binary packet protocol** with the following characteristics:

- **Header**: Fixed-size header with start marker, version, command, and length
- **Payload**: Variable-length data section
- **CRC**: Checksum for data integrity
- **Acknowledgments**: Command responses with acknowledgment flags

### 2. Commands Identified (from APK analysis)

From the extracted `stimulation_commands` and `ble_write_commands`:

```javascript
// High-level stimulation commands
- setDuration(durationMinutes)  // Sets session duration
- setIntensity(level)           // Sets intensity (1-9)
- start(mode)                   // Start with specific mode
- stop()                        // Stop stimulation

// Query commands
- queryStatus()                 // Get device state
- queryBattery()               // Get battery info
- queryFirmware()              // Get firmware version
```

### 3. Packet Structure (reverse engineered)

```
[0xAA][VERSION][COMMAND][LENGTH][PAYLOAD...][CRC-HI][CRC-LO]
   |      |        |       |        |          |       |
   |      |        |       |        |          +-------+-- 16-bit CRC
   |      |        |       |        +--------------------- Payload data
   |      |        |       +------------------------------ Payload length
   |      |        +-------------------------------------- Command type
   |      +----------------------------------------------- Protocol version (0x01)
   +------------------------------------------------------ Start marker (0xAA)
```

**Header Size**: 4 bytes
**CRC Size**: 2 bytes (16-bit sum)
**Max Payload**: 16 bytes (observed)

### 4. Command Types (assigned based on analysis)

| Command | Value | Description |
|---------|-------|-------------|
| SET_INTENSITY | 0x01 | Set stimulation intensity (1-9) |
| SET_DURATION | 0x02 | Set session duration (minutes) |
| START | 0x03 | Begin stimulation |
| STOP | 0x04 | End stimulation |
| SET_MODE | 0x05 | Configure stimulation mode |
| QUERY_STATUS | 0x10 | Request device status |
| QUERY_BATTERY | 0x11 | Request battery level |
| QUERY_FIRMWARE | 0x12 | Request firmware version |

### 5. Response Types

| Response | Value | Description |
|----------|-------|-------------|
| ACK (command \| 0x80) | varies | Acknowledgment of command |
| STATUS | 0x81 | Device status report |
| BATTERY | 0x82 | Battery level report |
| ERROR | 0xFF | Error response |

### 6. UUIDs (Same as v1 - Nordic UART Service)

```
Service: 6e400001-b5a3-f393-e0a9-e50e24dcca9e
RX (write): 6e400002-b5a3-f393-e0a9-e50e24dcca9e
TX (notify): 6e400003-b5a3-f393-e0a9-e50e24dcca9e
```

### 7. Differences from Current Web-App (v1 ASCII Protocol)

| Aspect | v1 ASCII | v2 Binary Packets |
|--------|----------|-------------------|
| Command format | `D\n`, `A\n`, `5\n` | `0xAA 0x01 0x03 0x01 0x01 0xCRC` |
| Intensity setting | Direct char `1`-`9` | `setIntensity(5)` command |
| Duration setting | Not available | `setDuration(minutes)` command |
| Framing | Newline terminator | Start marker + length + CRC |
| Error handling | None visible | CRC validation, error codes |
| Acknowledgments | Single char responses | Structured ACK packets |

### 8. Why v2 Might Be Needed

The v2 protocol appears to:
1. Support **session duration control** (not present in v1)
2. Provide **reliable delivery** via CRC and acknowledgments
3. Allow **mode selection** (bilateral, left, right, ramp)
4. Have **better error handling**

### 9. Device Compatibility Notes

- Both protocols use the **same Nordic UART Service UUIDs**
- Devices may support:
  - Only v1 (ASCII)
  - Only v2 (binary packets)
  - Both (auto-detect or firmware-dependent)

### 10. Implementation Strategy

The web-app now includes:

1. **protocol-v2.js**: Pure protocol definitions (packet builder/parser)
2. **bluetooth-v2.js**: Bluetooth manager using v2 protocol
3. **Protocol selection**: Can switch between v1 and v2 based on device response

### 11. Testing Protocol v2

```javascript
// Load protocol v2
const bt = new PulsettoBluetoothV2();

// Connect (same as v1)
await bt.scanAndConnect();

// Start session with duration (v2 feature)
await bt.startSession(5, 10, 'bilateral');  // intensity 5, 10 minutes

// Or step-by-step
await bt.setIntensity(5);
await bt.setDuration(10);
await bt.start('bilateral');
```

### 12. Packet Debugging

```javascript
// Build and inspect a packet
const packet = PulsettoProtocolV2.Commands.setIntensity(5);
console.log('Packet hex:', PulsettoBluetoothV2.packetToHex(packet));
// Output: "AA 01 01 01 05 00 07" (example)
```

## References

- APK Source: `D:\_projects\pulsetto-poc2\pulsetto-v2.2.91`
- Extraction artifacts: `extracted/pulsetto_specific.json`
- BLE Protocol strings: `extracted/bundle_analysis.json`
- Command patterns: `extracted/detailed_extraction.json`

## Files Created

1. `js/protocol-v2.js` - Protocol definitions
2. `js/bluetooth-v2.js` - Bluetooth manager
3. `js/PROTOCOL-V2-RESEARCH.md` - This document
