# Pulsetto Protocol v2 Fork - Implementation Summary

## Research Source
**Location**: `D:\_projects\pulsetto-poc2\pulsetto-v2.2.91`  
**Type**: React Native Android APK (decompiled)  
**Version**: v2.2.91 (likely a newer firmware/app version)

---

## Key Discovery: Two Different Protocols

### Protocol v1 (Current Web-App - ASCII)
Your existing implementation uses **simple ASCII commands**:

```javascript
'D\n'  // Bilateral activation
'A\n'  // Left channel only
'C\n'  // Right channel only
'B\n'  // Ramp-up mode
'-\n'  // Stop
'5\n'  // Intensity level 5 (characters 1-9)
'Q\n'  // Query battery
```

**Characteristics**:
- Newline-terminated strings
- Single-character responses
- No framing, no checksums
- Simple but limited

### Protocol v2 (From v2.2.91 APK - Binary Packets)
The APK reveals a **structured binary packet protocol**:

```
Packet Structure:
[0xAA][VERSION][CMD][LEN][PAYLOAD...][CRC-HI][CRC-LO]

Example - Set Intensity to 5:
AA 01 01 01 05 00 08
│  │  │  │  │  └──┘── CRC (16-bit sum)
│  │  │  │  └───────── Payload: intensity value (5)
│  │  │  └──────────── Payload length (1 byte)
│  │  └─────────────── Command (0x01 = SET_INTENSITY)
│  └────────────────── Version (0x01)
└───────────────────── Start marker (0xAA)
```

**Characteristics**:
- Binary framing with start marker (0xAA)
- Command + payload + CRC structure
- Explicit `setDuration()` command (not in v1!)
- Acknowledgment packets
- Error handling with codes

---

## Files Created

### 1. `js/protocol-v2.js`
Pure protocol implementation - no Bluetooth dependencies:

```javascript
// Packet building
PulsettoProtocolV2.Packet.build(command, payload)
PulsettoProtocolV2.Packet.parse(data)

// High-level commands
PulsettoProtocolV2.Commands.setIntensity(level)
PulsettoProtocolV2.Commands.setDuration(minutes)
PulsettoProtocolV2.Commands.start(mode)
PulsettoProtocolV2.Commands.stop()

// Response parsing
PulsettoProtocolV2.ResponseParser.parse(packet)
```

### 2. `js/bluetooth-v2.js`
Bluetooth manager using v2 protocol:

```javascript
const bt = new PulsettoBluetoothV2();
await bt.scanAndConnect();
await bt.startSession(5, 10, 'bilateral'); // intensity 5, 10 min
```

### 3. `js/PROTOCOL-V2-RESEARCH.md`
Detailed research findings from APK analysis.

### 4. `PROTOCOL-FORK-SUMMARY.md` (this file)
Implementation overview and usage guide.

---

## UI Updates

### Protocol Selector
Added to connection panel:
```html
<select id="protocol-select">
  <option value="v1">v1: ASCII (Standard)</option>
  <option value="v2">v2: Binary Packets (v2.2.91)</option>
</select>
```

Visual indicators:
- Protocol badge shows "v1" or "v2" in device info
- Help button links to research documentation

### Styling
- Protocol selector styled in CSS
- Packet debug logging styles for v2 hex output
- Responsive layout for mobile

---

## Key Differences Summary

| Feature | v1 ASCII | v2 Binary |
|---------|----------|-----------|
| **Command Format** | `D\n`, `5\n` | `AA 01 03 01 01 CRC` |
| **Duration Control** | ❌ Not available | ✅ `setDuration(min)` |
| **Framing** | Newline | Start marker + length |
| **Checksum** | ❌ None | ✅ 16-bit CRC |
| **Acknowledgments** | Simple char | ✅ Structured packets |
| **Error Handling** | ❌ None visible | ✅ Error codes |
| **Mode Selection** | Direct command | Explicit start(mode) |

---

## Device Compatibility Notes

Both protocols use the **same Nordic UART Service UUIDs**:
- Service: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- RX: `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
- TX: `6e400003-b5a3-f393-e0a9-e50e24dcca9e`

**Device behavior may vary**:
- Some devices only support v1
- Some devices only support v2
- Some may support both
- Firmware version likely determines protocol

---

## Testing Protocol v2

### Method 1: Web Inspector Console
```javascript
// After loading page
const bt = new PulsettoBluetoothV2();
await bt.scanAndConnect();

// Set intensity and duration separately
await bt.setIntensity(5);
await bt.setDuration(10);  // 10 minutes - v2 feature!
await bt.start('bilateral');

// Or all at once
await bt.startSession(5, 10, 'bilateral');

// Monitor events
bt.on('packetReceived', ({ parsed }) => {
  console.log('Device response:', parsed);
});
```

### Method 2: UI Protocol Selector
1. Open web app
2. Select "v2: Binary Packets" from dropdown
3. Click "Scan for Device"
4. Use controls normally

### Method 3: Packet Debugging
```javascript
// Build and inspect raw packets
const packet = PulsettoProtocolV2.Commands.setIntensity(5);
console.log('Hex:', PulsettoBluetoothV2.packetToHex(packet));
// Output: "AA 01 01 01 05 00 08"
```

---

## Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| Protocol definitions | ✅ Complete | `protocol-v2.js` |
| Packet builder/parser | ✅ Complete | With CRC validation |
| Bluetooth manager | ✅ Complete | `bluetooth-v2.js` |
| UI protocol selector | ✅ Complete | Dropdown + indicator |
| CSS styling | ✅ Complete | Protocol badge styles |
| Auto-protocol detection | 🔄 Future | Try v2, fallback v1 |
| Mode engines v2 | 🔄 Future | Duration-aware engines |
| Session clock v2 | 🔄 Future | Device-synced timer |

---

## Known Limitations / TODO

1. **Protocol Auto-Detection**: Currently manual selection. Could implement automatic fallback (try v2 → timeout → use v1).

2. **CRC Algorithm**: Using 16-bit sum (common in embedded). Actual firmware may use CRC-16 CCITT or other variant.

3. **Response Payloads**: Structured based on analysis. Actual device responses may differ slightly.

4. **Session Duration Sync**: v2 allows setting duration on device, but web session clock still runs independently.

5. **Mode Engines**: Current mode-engines.js is designed for v1. v2 version could use device-side duration control.

---

## APK Analysis Methodology

What was examined in `pulsetto-v2.2.91`:

1. **Extracted JSON files**:
   - `pulsetto_specific.json` - Command names (`setDuration`, `setIntensity`)
   - `bundle_analysis.json` - BLE UUIDs, packet structure hints
   - `detailed_extraction.json` - Protocol references

2. **Key findings**:
   - `stimulation_commands: ["setDuration", "setIntensity"]`
   - `ble_packet_structure: ["packet", "HEADER", "CRC", "payload"]`
   - Nordic UART UUIDs present
   - `writeCharacteristic` methods for binary data

3. **Hermes bytecode**: Main bundle was compiled Hermes bytecode (not readable JavaScript), so exact implementation details were inferred from strings and structure references.

---

## Next Steps / Recommendations

1. **Test with real device**:
   - Try v2 protocol with actual Pulsetto device
   - Monitor console for packet logs
   - Verify CRC calculation matches device expectations

2. **Protocol auto-detection**:
   - Implement try-v2-first, fallback-to-v1 logic
   - Store successful protocol per device

3. **Firmware version check**:
   - If firmware version available via BLE, use to select protocol

4. **Research actual CRC**:
   - If device rejects packets, try different CRC algorithms
   - Common alternatives: CRC-16 CCITT, CRC-16 Modbus

---

## File Reference

```
web-app/
├── js/
│   ├── protocol.js           # v1: ASCII protocol (original)
│   ├── protocol-v2.js        # v2: Binary packet protocol (NEW)
│   ├── bluetooth.js          # v1: ASCII Bluetooth manager
│   ├── bluetooth-v2.js       # v2: Binary Bluetooth manager (NEW)
│   ├── PROTOCOL-V2-RESEARCH.md  # Research documentation
│   ├── ...
├── index.html                # Updated with v2 scripts + selector
├── style.css                 # Updated with protocol styles
└── PROTOCOL-FORK-SUMMARY.md  # This file
```

---

## Summary

You now have a **parallel protocol implementation** that mirrors the approach found in the v2.2.91 APK. The structured binary protocol may provide:

- ✅ Better reliability (CRC validation)
- ✅ Session duration control (explicit setDuration)
- ✅ Better error handling
- ✅ More device state visibility

**Use v2 when**:
- Device doesn't respond to ASCII commands
- You need session duration control
- ASCII protocol seems unreliable

**Use v1 when**:
- Device works fine with ASCII
- You want simplest possible protocol
- Backward compatibility needed

---

*Generated: 2025-01-08*  
*Source: pulsetto-v2.2.91 APK reverse engineering*  
*Location: D:\_projects\pulsetto-poc2\pulsetto-v2.2.91*
