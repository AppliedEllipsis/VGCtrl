# Pulsetto Web Controller

A vanilla JavaScript single-page application (SPA) for controlling Pulsetto vagus nerve stimulation devices via Web Bluetooth API.

## Features

### Core Functionality
- **Device Connection**: Scan and connect to Pulsetto devices via Web Bluetooth
- **Session Management**: Start, pause, resume, and stop stimulation sessions
- **8 Stimulation Modes**: Stress Relief, Sleep, Focus, Pain Relief, Calm, Headache, Nausea, Meditation
- **Intensity Control**: Adjust stimulation intensity (levels 1-9)
- **Timer**: Configurable session duration (1-60 minutes)
- **Breathing Guide**: Visual breathing guidance for respiratory-gated modes (Calm, Meditation)

### Background/Foreground Handling
- **Page Visibility API**: Detects when app goes to background/foreground
- **Wake Lock API**: Prevents screen from sleeping during active sessions
- **Wall-Clock Reconciliation**: Accurate timing across background transitions
- **Service Worker**: Offline capability and background sync support
- **PWA Manifest**: Installable as a progressive web app
- **Keepalive Pings**: Sends periodic commands to prevent connection timeout

### ⚠️ Important: Chrome Background Limitation
**Chrome terminates Web Bluetooth connections when tabs go to the background.** This is a browser security feature that cannot be fully bypassed. However, this app implements **aggressive countermeasures** to maximize the chance of survival:

**Implemented Keepalive Techniques:**
1. **Wake Lock API** - Keeps screen on during sessions
2. **Silent Audio Context** - Keeps audio processing thread alive (prevents some suspension)
3. **Web Worker** - Runs timer in separate thread
4. **BroadcastChannel** - Cross-tab communication pings
5. **No-op CSS Animation** - Constant layout recalc prevents some throttling
6. **MessageChannel Microtasks** - Aggressive scheduling
7. **Canvas Render Loop** - requestAnimationFrame keeps rendering thread active
8. **Periodic Background Sync** - Scheduled wake-ups (Chrome only)
9. **Persistent Notification** - requireInteraction keeps service worker alive
10. **Aggressive Pinging** - 250ms interval when hidden

**Best Practices for Users:**
1. **Keep Chrome in the foreground** - Do not switch to other apps
2. **Use a dedicated Chrome window** - Not a background tab
3. **Disable screen timeout** in OS settings
4. **On Android**: 
   - Enable "Desktop site" mode
   - Use split-screen to keep Chrome partially visible
   - Disable Chrome's "Battery Saver" for this site
5. **On Desktop**: Use a separate Chrome window, not a tab

**If Disconnection Occurs:**
- Return to the tab immediately
- The app attempts auto-reconnection (requires user interaction)
- Session timing continues accurately via wall-clock reconciliation

### BLE Protocol
- **ASCII Protocol**: Uses string-based commands with newline terminator
- **Keepalive**: Sends intensity command every 10 seconds during active sessions
- **Status Polling**: Queries battery and charging status every 30 seconds
- **Auto-reconnect**: Exponential backoff reconnection on disconnection
- **Response Parsing**: Handles battery voltage, charging status, and acknowledgments

## File Structure

```
pulsetto-web/
├── index.html          # Main HTML structure
├── style.css           # Dark theme styling
├── manifest.json       # PWA manifest
├── sw.js               # Service worker for offline/PWA
├── icon.svg            # App icon
├── js/
│   ├── protocol.js     # BLE protocol definitions (ASCII)
│   ├── bluetooth.js    # Web Bluetooth API wrapper
│   ├── session-clock.js # Session timing with wall-clock tracking
│   ├── mode-engines.js # Stimulation pattern generators
│   └── app.js          # Main application logic
```

## Usage

### Requirements
- Chrome/Edge/Opera with Web Bluetooth support (Chrome 56+, Edge 79+)
- HTTPS connection (required for Web Bluetooth)
- Pulsetto device with Nordic UART Service BLE support

### Running Locally

1. Serve the files over HTTPS (Web Bluetooth requires secure context):

```bash
# Using Python 3
python -m http.server 8443 --bind 127.0.0.1

# Using Node.js (http-server)
npx http-server -p 8443 -S -C cert.pem -K key.pem
```

2. Open `https://localhost:8443` in Chrome/Edge

3. Click "Scan for Device" and select your Pulsetto device

### Protocol Reference

#### Commands (ASCII with newline)
| Command | ASCII | Purpose |
|---------|-------|---------|
| Start bilateral | `D\n` | Both channels active |
| Start left | `A\n` | Left channel only |
| Start right | `C\n` | Right channel only |
| Stop | `-\n` | Deactivate (or `0\n` legacy) |
| Intensity | `1\n` to `9\n` | Set stimulation level |
| Battery query | `Q\n` | Request battery voltage |
| Charging query | `u\n` | Request charging status |

#### Responses
| Response | Format | Example |
|----------|--------|---------|
| Battery | `Batt:X.XX` or `X.XX` | `Batt:3.72` |
| Charging | `0`, `1`, or text | `1` = charging |
| Strength ack | Single digit `1`-`9` | `5` |
| Start ack | Single char `D` | `D` |
| Stop ack | Single char `-` | `-` |

## Mode Descriptions

| Mode | Duration | Breathing | Pattern |
|------|----------|-----------|---------|
| Stress Relief | 10 min | No | Bilateral continuous |
| Sleep | 20 min | No | 5-phase rotation (D→A→D→C→D) |
| Focus | 15 min | No | 30s on/off duty cycle, left only |
| Pain Relief | 15 min | No | Sine wave ±1 oscillation |
| Calm | 10 min | Yes | 5s inhale, 5s hold, 7s exhale |
| Headache | 12 min | No | 2 min on / 30s off burst |
| Nausea | 10 min | No | Bilateral continuous |
| Meditation | 15 min | Yes | 5s inhale, 4s hold, 5s exhale |

## Browser Compatibility

| Feature | Chrome | Edge | Firefox | Safari |
|---------|--------|------|---------|--------|
| Web Bluetooth | ✅ 56+ | ✅ 79+ | ❌ | ❌ |
| Wake Lock API | ✅ 84+ | ✅ 84+ | ❌ | ❌ |
| Page Visibility | ✅ | ✅ | ✅ | ✅ |
| Service Worker | ✅ | ✅ | ✅ | ✅ |

## Development

### Key Design Patterns

1. **ASCII Protocol**: All BLE commands are ASCII strings with newline terminator
2. **Session Clock**: Wall-clock reconciliation handles background/foreground timing
3. **Mode Engines**: State machines generate tick-based stimulation patterns
4. **Event-Driven**: Components emit events for loose coupling

### Background Handling

**Web Bluetooth Limitation**: Chrome aggressively suspends background tabs, including Bluetooth connections. This app implements **11 different keepalive techniques** to resist suspension:

**Keepalive Systems:**
1. Wake Lock API (screen on)
2. Silent Audio Context (audio thread alive)
3. Web Worker (isolated timer thread)
4. BroadcastChannel (cross-tab pings)
5. CSS Animation (layout thrashing)
6. MessageChannel (microtask scheduling)
7. Canvas Loop (rendering thread alive)
8. Periodic Background Sync (scheduled wake)
9. Persistent Notification (service worker alive)
10. 250ms Aggressive Pinging (when hidden)
11. beforeunload Warning (prevents accidental nav)

**When tab goes to background:**
1. Warning banner appears immediately
2. All 11 keepalive systems activate
3. Device stops for safety (stop command sent)
4. Wall-clock tracking continues (accurate timing)
5. 250ms ping interval attempts to prevent full suspension

**When returning to foreground:**
1. Warning banner removed
2. Time recalculated from wall-clock
3. Connection checked and re-established if needed
4. Device reactivated with current session state
5. All keepalive systems continue

**Reality Check**: Despite all countermeasures, Chrome **will** eventually suspend background tabs. The techniques increase survival time but cannot guarantee indefinite background operation.

## Security Notes

- Web Bluetooth requires HTTPS (except localhost during development)
- User must explicitly grant permission for each device connection
- Device pairing is handled by the OS, not the web app
- No persistent storage of device identifiers

## License

MIT License - See project root for details.

## References

- [Web Bluetooth Specification](https://webbluetoothcg.github.io/web-bluetooth/)
- [Pulsetto Protocol Matrix](../docs/knowledgebase/ble_protocol_matrix.md)
- [Pulse Libre BLE Implementation](../pulse-libre/lib/ble/protocol_canonical.dart)
- [Open Pulse iOS Reference](../open-pulse/OpenPulse/)
