# Protocol v2 Quick Start Guide

## What is Protocol v2?

Protocol v2 is a **structured binary packet protocol** reverse-engineered from the `pulsetto-v2.2.91` APK. Unlike the ASCII protocol (v1) that uses simple text commands like `D\n` and `5\n`, v2 uses binary packets with headers, payloads, and CRC checksums.

## Quick Comparison

| Action | v1 (ASCII) | v2 (Binary) |
|--------|------------|-------------|
| Start bilateral | `D\n` | `AA 01 03 01 01 CRC` |
| Set intensity 5 | `5\n` | `AA 01 01 01 05 CRC` |
| Set 10 min duration | ❌ Not possible | `AA 01 02 01 0A CRC` |
| Stop | `-\n` | `AA 01 04 00 CRC` |

## Using Protocol v2

### Method 1: UI Selector (Recommended)

1. Open the web app in your browser
2. Look for the **"BLE Protocol"** dropdown in the connection panel
3. Select **"v2: Binary Packets (v2.2.91)"**
4. Click **"Scan for Device"** and connect
5. Use the app normally

The protocol indicator will show **"v2"** when connected.

### Method 2: Console Testing

```javascript
// Create v2 Bluetooth manager
const bt = new PulsettoBluetoothV2();

// Connect to device
await bt.scanAndConnect();

// Start a 10-minute session at intensity 5
await bt.startSession(5, 10, 'bilateral');

// Or control step-by-step
await bt.setIntensity(7);
await bt.setDuration(15);
await bt.start('left');

// Stop
await bt.stop();

// Monitor all packets
bt.on('packetReceived', ({ parsed }) => {
  console.log('Device sent:', parsed);
});
```

### Method 3: Packet Inspection

```javascript
// Build a raw packet
const packet = PulsettoProtocolV2.Commands.setIntensity(5);

// View as hex
console.log(PulsettoBluetoothV2.packetToHex(packet));
// "AA 01 01 01 05 00 08"

// Parse a received packet
const response = new Uint8Array([0xAA, 0x01, 0x81, 0x01, 0x05, 0x00, 0x89]);
const parsed = PulsettoProtocolV2.ResponseParser.parse(response);
console.log(parsed);
// { type: 'intensityAck', value: 5, raw: [...] }
```

## When to Use v2

**Use v2 when:**
- Your device doesn't respond to ASCII commands
- You need to set specific session durations
- ASCII protocol seems unreliable or loses commands
- You see CRC/checksum errors in device logs

**Stick with v1 when:**
- Your device works fine with ASCII
- You want the simplest possible communication
- You need backward compatibility with older firmware

## Key v2 Features

### 1. Session Duration Control
```javascript
// v2 can set duration on the device
await bt.setDuration(15);  // 15 minutes

// v1 cannot - only web-side timer
```

### 2. Reliable Delivery
```javascript
// v2 waits for acknowledgment
await bt.setIntensity(5);  // Returns after device ACK

// v1 sends and hopes for the best
await bt.sendCommand('5\n');  // Fire and forget
```

### 3. Error Detection
```javascript
// v2 has CRC validation - detects corrupt packets
// v1 has no validation - garbage in, garbage out
```

## Troubleshooting

### "Not connected - cannot send packet"
- Check that device is paired
- Try toggling Bluetooth off/on
- Check browser console for errors

### "GATT operation already in progress"
**Fixed**: The v2 Bluetooth manager now includes a GATT operation queue that automatically serializes all GATT writes. This error should not occur with the current implementation.

If you still see this error:
- Verify you're using the latest `bluetooth-v2.js` with `_gattQueue` support
- Check that `sendPacket()` is being used (not direct `writeValue` calls)

### "CRC mismatch" or packet errors
The CRC algorithm might differ from actual device. Try:
1. Check console for exact error
2. Verify packet hex output
3. Compare with device documentation

### Device doesn't respond to v2
- Device may only support v1
- Switch back to "v1: ASCII (Standard)"
- Try reconnecting

### Session duration not working
- Verify device firmware supports v2
- Check that duration was sent in packet logs
- Some devices may ignore duration command

## Packet Structure Reference

```
[0xAA][0x01][CMD][LEN][PAYLOAD...][CRC-HI][CRC-LO]

Example: Set intensity 5
AA 01 01 01 05 00 08
│  │  │  │  │  └──┘── CRC (simple sum)
│  │  │  │  └────────── Value: 5
│  │  │  └───────────── Length: 1 byte
│  │  └──────────────── Command: 0x01 (SET_INTENSITY)
│  └─────────────────── Version: 0x01
└────────────────────── Start: 0xAA
```

**Command Types:**
- `0x01` - SET_INTENSITY
- `0x02` - SET_DURATION
- `0x03` - START
- `0x04` - STOP
- `0x10` - QUERY_STATUS
- `0x11` - QUERY_BATTERY

## Files Reference

| File | Purpose |
|------|---------|
| `js/protocol-v2.js` | Packet builder/parser, command definitions |
| `js/bluetooth-v2.js` | BLE manager using v2 protocol |
| `js/PROTOCOL-V2-RESEARCH.md` | Full research from APK |
| `PROTOCOL-FORK-SUMMARY.md` | Complete implementation overview |

## Switching Back to v1

1. Click the **"BLE Protocol"** dropdown
2. Select **"v1: ASCII (Standard)"**
3. Disconnect and reconnect
4. Indicator will show **"v1"**

## Need Help?

1. Check browser console for packet logs
2. Review `js/PROTOCOL-V2-RESEARCH.md` for APK findings
3. Compare packet hex with expected device format
4. Test with v1 first to verify device works

---

**Source**: Reverse engineered from `pulsetto-v2.2.91`  
**Branch**: `protocol-v2-poc2`  
**Files**: See git status for all changes
