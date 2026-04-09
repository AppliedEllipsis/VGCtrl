# S01 — Fade Control Implementation

**Date:** 2026-04-09

## Summary

Slice S01 implements manual fade controls for the Pulsetto web app, allowing users to ramp intensity up, down, or pulse during an active session. The implementation is complete in `js/app.js` and provides three fade modes via a dropdown control: Fade In (ramps to max), Fade Out (ramps to stop), and Pulse (ramps up then down).

**New Requirements Added:**

1. **Reliable Stop Command** — Current single stop command at session end may not always reach the device. Need to send multiple stop commands with proper delays to ensure device actually stops.

2. **Audio Feedback System** — User-toggleable preferences:
   - Completion sound when session ends
   - Phase change sounds during timeline progression  
   - Toggle control remembered in localStorage

The fade system respects device protocol constraints (0-9 intensity levels), validates bounds to prevent invalid operations, and integrates with the session clock. The audio system will leverage the existing Web Audio API infrastructure in `background-keepalive.js`.

## Recommendation

**Status: New Tasks Required**

The fade control feature (T01) is complete, but new requirements have been added:

1. **T02: Reliable Stop Command** — Modify `_sendStopCommand()` to send multiple stop commands with delays (similar to fade command sequencing pattern)
2. **T03: Audio Feedback System** — Implement Web Audio API sound generation for phase changes and session completion
3. **T04: Settings Toggle UI** — Add user preference controls for enabling/disabling audio with localStorage persistence

Implementation approach:
- **Stop reliability:** Use the same pattern as fade commands — build array of stop commands, execute sequentially with 1-2 second delays
- **Audio:** Use existing `AudioContext` from `background-keepalive.js`, generate short tones using oscillators
- **Storage:** Store audio preference in `localStorage` under `pulsetto_audio_enabled`

## Implementation Landscape

### Key Files

- `js/app.js` — Main integration point:
  - `_sendStopCommand()` — **MODIFY** to send 3 stop commands with 1s delays between them
  - `_onTimelineScriptStep(step)` — Add phase change sound trigger (line ~1008)
  - `clock.on('completed', ...)` — Add completion sound (line ~397)
  - Add `this.audioEnabled` state and localStorage methods
  
- `js/background-keepalive.js` — Audio infrastructure:
  - Already has `AudioContext` at `this.audioContext` (line 116)
  - Reuse this context for sound generation
  
- `index.html` — Settings UI:
  - Add toggle/checkbox for "Audio feedback" in header or settings area
  
- `js/bluetooth.js` — Already has `sendStop()` with retry logic, but app.js should send multiple

### Build Order

1. **T02: Reliable Stop Command**
   - Modify `_sendStopCommand()` in app.js to send multiple stops with delays
   - Pattern: 3 stop commands with 1000ms delays
   - Log each stop attempt
   - Keep existing `this.ble.sendStop()` call for command manager integration

2. **T03: Audio Feedback System**
   - Create audio utility functions using Web Audio API
   - Phase change: Short beep (200Hz, 100ms)
   - Completion: Two-tone chime (ascending)
   - Test without UI first

3. **T04: Settings Toggle UI**
   - Add HTML toggle/checkbox to index.html
   - Add CSS styling for toggle
   - Implement localStorage load/save

### Verification Approach

**Stop Command Reliability:**
1. Start session, let run to completion
2. Check logs — should see 3 stop attempts with "Stop 1/3", "Stop 2/3", "Stop 3/3"
3. Verify device actually stops (intensity goes to 0)
4. Test with manual stop button — should also send multiple stops

**Audio:**
1. Enable audio toggle, verify localStorage persistence
2. Phase change test — sound plays on natural timeline progression
3. Completion test — sound plays at session end
4. Disable test — no sounds when toggle off

### Architecture Notes

**Reliable Stop Implementation:**
```javascript
async _sendStopCommand() {
  if (!this.ble.canSendCommands) return;
  
  // Send multiple stops with delays to ensure device receives it
  const stopCmd = PulsettoProtocol.Commands.stop;
  const stopAttempts = 3;
  const delayMs = 1000;
  
  for (let i = 0; i < stopAttempts; i++) {
    try {
      // Use command queue for first, direct for subsequent
      if (i === 0) {
        await this.ble.sendStop(); // clears queue, uses retry logic
      } else {
        await this.ble.sendCommand(stopCmd);
      }
      this.log(`Stop ${i + 1}/${stopAttempts} sent`, 'info');
    } catch (err) {
      this.log(`Stop ${i + 1}/${stopAttempts} failed: ${err.message}`, 'warning');
    }
    
    // Delay between stops (except after last)
    if (i < stopAttempts - 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  
  this.isStimulationActive = false;
  this.log('Stop sequence complete', 'info');
}
```

**Audio Implementation:**
```javascript
_playTone(frequency, duration, type = 'sine') {
  if (!this.audioEnabled) return;
  const ctx = this.bgKeepalive.audioContext;
  if (!ctx || ctx.state === 'suspended') return;
  
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  osc.frequency.value = frequency;
  osc.type = type;
  gain.gain.setValueAtTime(0.1, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

playPhaseSound() { this._playTone(200, 0.1); }
playCompletionSound() { 
  this._playTone(440, 0.15);
  setTimeout(() => this._playTone(880, 0.3), 150);
}
```

**localStorage Pattern:**
```javascript
_loadAudioPreference() {
  try {
    return localStorage.getItem('pulsetto_audio_enabled') !== 'false';
  } catch (e) { return true; }
}
_saveAudioPreference(enabled) {
  try { localStorage.setItem('pulsetto_audio_enabled', enabled ? 'true' : 'false'); } catch (e) {}
}
```

**Integration Points:**
- Phase sound in `_onTimelineScriptStep()`:
  ```javascript
  if (!step.isSeek && !step.isFadeUpdate) {
    this._playPhaseSound();
  }
  ```
- Completion sound in `clock.on('completed', ...)` after stop commands sent

### Constraints

- Stop commands must be spaced ~1 second apart to avoid overwhelming BLE stack
- Audio must use Web Audio API (no external files)
- Must respect browser autoplay policies
- Phase sounds should not play during manual seek or fade updates
- Sounds should be subtle (low volume ~0.1)

### Common Pitfalls

- **Stop command timing:** Don't wait for each stop to acknowledge before sending next — fire-and-forget with delays works better for BLE
- **Audio context suspended:** Check state before playing, skip if suspended
- **Duplicate phase sounds:** Only play on `!step.isSeek && !step.isFadeUpdate`
- **Volume levels:** Keep gain low (0.05-0.1) for subtle feedback

### Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Stop with retry | `this.ble.sendStop()` | Has built-in retry logic, clears queue |
| Sequential delays | Fade command pattern | Already proven in `_triggerFade()` |
| Audio context | `background-keepalive.js` | Reuse to avoid duplicate contexts |
| Tone generation | Web Audio API OscillatorNode | No external audio files needed |

### Open Risks

- BLE reliability may still be affected by connection quality — multiple stops improves odds but isn't guaranteed
- Audio may not work on first load until user interacts (acceptable given app requires clicks)

## Sources

- Fade implementation (sequential command pattern): `js/app.js` lines 620-750
- Stop command: `js/app.js` line 945, `js/bluetooth.js` lines 49-80
- Task completion: `.gsd/milestones/M001/slices/S01/tasks/T01-SUMMARY.md`
- Audio context: `js/background-keepalive.js` lines 110-150
- Session completion handler: `js/app.js` lines 397-408
- Phase change detection: `js/app.js` lines 1008-1050
