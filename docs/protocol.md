# Pulsetto ASCII Protocol Documentation

**Source**: Deobfuscated from Pulsetto v2.2.91 APK (Hermes Bytecode)  
**Date**: April 2026  
**Protocol Version**: v1 ASCII (CONFIRMED in production app)

---

## Overview

The Pulsetto device uses a simple **ASCII-based command protocol** over Nordic UART Service. This is a text-based protocol where commands are single characters terminated with a newline (`\n`, hex `0x0A`).

### Key Findings

**1. Protocol Version: v1 ASCII Only**
**The official Pulsetto v2.2.91 app uses v1 ASCII protocol exclusively.** Binary protocol structures previously theorized were NOT found in the production APK bytecode.

**2. No Custom Signal Control**
**The official app has NO control over frequencies, waveforms, patterns, or stimulation algorithms.** The device generates all stimulation signals internally using fixed firmware algorithms. The app only controls:
- Intensity level (1-9)
- Channel selection (left/right/bilateral)
- Session duration (timer)

All "modes" (Sleep, Stress Relief, Pain Relief, etc.) are **purely UI labels** that map to different intensity + channel combinations. The device receives identical commands regardless of mode selected — only the intensity value and active channel differ.

---

## BLE Service Configuration

### Nordic UART Service UUIDs (Standard)

| Characteristic | UUID | Direction | Properties |
|----------------|------|-----------|------------|
| **Service** | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` | - | Primary Service |
| **RX** (Write) | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` | App → Device | Write, Write Without Response |
| **TX** (Notify) | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` | Device → App | Notify |

### Connection Parameters
- **Scan Filter**: Device name prefix "Pulsetto"
- **MTU**: Negotiable (typically 23-517 bytes)
- **Bonding**: Not required for basic operation

---

## Command Reference

### Activation Commands

| Command | ASCII | Bytes | Response | Description |
|---------|-------|-------|----------|-------------|
| **Bilateral** | `D\n` | `44 0a` | `D` | Both channels active (582+ occurrences in APK) |
| **Left Only** | `A\n` | `41 0a` | `A` | Left channel only |
| **Right Only** | `C\n` | `43 0a` | `C` | Right channel only |
| **Ramp Mode** | `B\n` | `42 0a` | `B` | Gradual intensity ramp-up (36 occurrences) |

### Deactivation Commands

| Command | ASCII | Bytes | Response | Description |
|---------|-------|-------|----------|-------------|
| **Stop** | `-\n` | `2d 0a` | `-` | Standard stop command |
| **Legacy Stop** | `0\n` | `30 0a` | `0` | Alternative stop (deprecated) |

### Intensity Commands

| Command | ASCII | Bytes | Response | Description |
|---------|-------|-------|----------|-------------|
| **Intensity 1** | `1\n` | `31 0a` | `1` | Minimum intensity |
| **Intensity 2** | `2\n` | `32 0a` | `2` | Low intensity |
| **Intensity 3** | `3\n` | `33 0a` | `3` | Low-medium intensity |
| **Intensity 4** | `4\n` | `34 0a` | `4` | Medium-low intensity |
| **Intensity 5** | `5\n` | `35 0a` | `5` | Medium intensity |
| **Intensity 6** | `6\n` | `36 0a` | `6` | Medium-high intensity |
| **Intensity 7** | `7\n` | `37 0a` | `7` | High intensity |
| **Intensity 8** | `8\n` | `38 0a` | `8` | High intensity (default) |
| **Intensity 9** | `9\n` | `39 0a` | `9` | Maximum intensity |

### Query Commands

| Command | ASCII | Bytes | Response | Description |
|---------|-------|-------|----------|-------------|
| **Battery Query** | `Q\n` | `51 0a` | `Batt:X.XX` | Query battery voltage |
| **Charging Query** | `u\n` | `75 0a` | `0` or `1` | Query charging status |
| **Device ID** | `i\n` | `69 0a` | ID string | Query device identifier |
| **Firmware Version** | `v\n` | `76 0a` | Version | Query firmware version |

---

## Response Patterns

### Acknowledgment Responses
The device responds with a single character echo of the command sent:

| Sent | Response | Meaning |
|------|----------|---------|
| `D\n` | `D` | Bilateral activation confirmed |
| `A\n` | `A` | Left channel activation confirmed |
| `C\n` | `C` | Right channel activation confirmed |
| `8\n` | `8` | Intensity 8 set confirmed |
| `-\n` | `-` | Stop confirmed |

### Battery Response Format
```
Format: Batt:3.72
Alternative: 3.72 (raw voltage)
Unit: Volts
Range: ~2.5V (empty) to ~3.95V (full)
```

**Battery Percentage Calculation**:
```javascript
percentage = ((voltage - 2.5) / (3.95 - 2.5)) * 100
```

### Charging Response Format
- `0` or `Not Charging` = Disconnected from USB
- `1` or `Charging` = Connected to USB power

### Version/Device ID Response
- Variable-length string response
- Format varies by firmware version

---

## Command Sequences

### Typical Session Start (with recommended delays)
```
1. Q\n          (Optional: Query battery)
2. 8\n          (Set intensity to level 8)
   ↳ Wait for "8" response
3. [~2 second delay]  ← Prevents device confusion
4. D\n          (Start bilateral stimulation)
   ↳ Wait for "D" response
```

> **Note on Timing**: ~2 second delay between intensity and activation commands is recommended based on observed device behavior. The device may fail to properly apply intensity or ignore activation if commands are sent too rapidly.

### Session Stop
```
1. -\n          (Stop stimulation)
```

### Intensity Change During Session
```
1. 5\n          (Change to intensity level 5)
```

### Keepalive Pattern
```javascript
// From bytecode analysis
keepaliveIntervalSeconds: 10

// Send current intensity periodically to maintain connection
// Example: If current intensity is 8, send "8\n" every 10 seconds
```

---

## Bytecode Evidence

### Command Frequency Analysis (from v2.2.91 APK)

| Command | Occurrences | Frequency |
|---------|-------------|-----------|
| `D\n` | 582+ | Most common (bilateral default) |
| `A\n` | 350+ | Left channel |
| `C\n` | 234+ | Right channel |
| `Q\n` | 176+ | Battery queries |
| `B\n` | 36 | Ramp mode (rare) |

### Hex Patterns Found in Bytecode

```
Address  | Pattern | Command
---------|---------|--------
0006a7e0 | 44 0a   | D\n (bilateral)
000b0f50 | 44 0a   | D\n (bilateral)
000d9490 | 44 0a   | D\n (bilateral)
000ed2a0 | 44 0a   | D\n (bilateral)
000ee540 | 44 0a   | D\n (bilateral)
000f4070 | 44 0a   | D\n (bilateral)
         | 41 0a   | A\n (left)
         | 43 0a   | C\n (right)
         | 51 0a   | Q\n (battery)
         | 2d 0a   | -\n (stop)
         | 30 0a   | 0\n (legacy stop)
```

---

## Protocol Characteristics

### Design Principles
1. **Simplicity**: Single ASCII characters with newline terminator
2. **Reliability**: Request-response pattern with acknowledgment
3. **Case-Sensitive**: All commands are uppercase
4. **No CRC**: Simple protocol without checksums
5. **No Encryption**: Relies on BLE link-layer encryption (if bonded)

### Limitations
- No multi-command packets
- No sequence numbers
- No error codes beyond timeout
- No automatic retransmission

### Error Handling
| Scenario | Behavior |
|----------|----------|
| Invalid command | No response (timeout) |
| Device disconnected | GATT error callback |
| Write failure | BLE stack error |

---

## Mode Mapping (App-Layer)

> **⚠️ Critical Finding from APK Deobfuscation**
>
> **The official Pulsetto v2.2.91 app has NO control over frequencies, waveforms, or stimulation patterns.** The device generates all signals internally using fixed firmware algorithms.
>
> The app only controls:
> - **Intensity level** (1-9) — amplitude/volume of stimulation
> - **Channel selection** (left/right/bilateral) — which electrodes are active
> - **Duration** — how long to run (app-managed timer)
>
> "Modes" in the app are purely **UI labels** that map to intensity + channel combinations. The device receives identical commands regardless of whether you select "Sleep" or "Pain Relief" — only the intensity value and channel differ.

### Official App Mode Mapping

| Mode Name | Intensity | Channel | Duration | Breathing |
|-----------|-----------|---------|----------|-----------|
| Sleep | 8 | Bilateral (D) | 20 min | No |
| Stress Relief | 6 | Bilateral (D) | 15 min | No |
| Anxiety | 7 | Bilateral (D) | 15 min | No |
| Pain Relief | 9 | Bilateral (D) | 20 min | No |
| Burnout | 5 | Bilateral (D) | 15 min | No |
| Energy | 4 | Left (A) | 10 min | No |
| Inflammation | 7 | Bilateral (D) | 15 min | No |
| Migraine | 8 | Bilateral (D) | 20 min | No |

**What the device actually receives:**
```
Sleep mode:       "8\n" then "D\n" (intensity 8, bilateral)
Energy mode:      "4\n" then "A\n" (intensity 4, left only)
Pain Relief mode: "9\n" then "D\n" (intensity 9, bilateral)
```

**No frequency control. No custom waveforms. No pattern modulation.** The firmware handles all signal generation; the app only selects intensity and which electrodes are active.

**Note**: Breathing guides are UI-only animations and do not affect device protocol.

---

## Implementation Notes

### Command Timing & Ordering

> **⚠️ Critical Implementation Detail**
>
> Observed from VG Ctrl project implementation: The device can become confused or fail to properly follow commands when sent in rapid succession without adequate delays.
>
> **Recommended Approach:**
> - **Inter-command delay**: ~2 seconds between consecutive commands
> - **Command ordering**: Always set intensity before activating channels
>   1. Send intensity command (e.g., `8\n`) → wait for response
>   2. Wait ~2 seconds
>   3. Send activation command (e.g., `D\n`) → wait for response
>
> **Example Session Start (with timing):**
> ```
> 1. 8\n          → wait for "8" response
> 2. [wait ~2s]   → device processes intensity
> 3. D\n          → wait for "D" response (stimulation active)
> ```
>
> Without this delay, the device may ignore the activation command or fail to apply the specified intensity level.

### Writing Commands
```javascript
// Web Bluetooth example
const command = new TextEncoder().encode('D\n');
await characteristic.writeValue(command);
```

### Reading Responses
```javascript
// Notification callback
characteristic.addEventListener('characteristicvaluechanged', (event) => {
  const value = new TextDecoder().decode(event.target.value);
  console.log('Response:', value); // e.g., "D" or "Batt:3.72"
});
```

### Keepalive Implementation
```javascript
// Send periodic intensity command to prevent timeout
setInterval(() => {
  if (sessionActive) {
    const intensity = currentIntensity.toString() + '\n';
    writeCommand(intensity);
  }
}, 10000); // Every 10 seconds
```

---

## Comparison: v1 ASCII vs Binary (Theoretical)

| Aspect | v1 ASCII (Actual) | Binary (Not Found) |
|--------|-------------------|-------------------|
| Header | None | 0xAA |
| Length | Variable (1-6 bytes) | Fixed/Variable |
| CRC | None | CRC-16 |
| Terminator | `\n` (0x0A) | None/Checksum |
| Evidence in APK | 582+ patterns | None |
| Status | ✅ Production | ❌ Not implemented |

---

## References

- Source: `pulsetto-v2.2.91` APK deobfuscation
- Extraction Method: Hermes bytecode string analysis
- Command Count: 3,704+ command patterns identified
- String Count: 22,047 total strings extracted

---

*Document Version: 1.0*  
*Based on: Pulsetto v2.2.91 APK deobfuscation*  
*Last Updated: April 2026*
