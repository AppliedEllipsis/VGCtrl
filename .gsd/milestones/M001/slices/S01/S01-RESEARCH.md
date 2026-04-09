# S01 — Fade Control Implementation

**Date:** 2026-04-09

## Summary

Slice S01 implements manual fade controls for the Pulsetto web app, allowing users to ramp intensity up, down, or pulse during an active session. The implementation is complete in `js/app.js` and provides three fade modes via a dropdown control: Fade In (ramps to max), Fade Out (ramps to stop), and Pulse (ramps up then down).

**New Requirements Added:** Audio feedback system with user-toggleable preferences:
- Completion sound when session ends
- Phase change sounds during timeline progression  
- Stop command verification at session end
- Toggle control remembered in localStorage

The fade system respects device protocol constraints (0-9 intensity levels), validates bounds to prevent invalid operations, and integrates with the session clock. The audio system will leverage the existing Web Audio API infrastructure in `background-keepalive.js`.

## Recommendation

**Status: New Tasks Required**

The fade control feature (T01) is complete, but new requirements for audio feedback have been added. These require:

1. **T02: Audio Feedback System** — Implement Web Audio API sound generation for phase changes and session completion
2. **T03: Settings Toggle UI** — Add user preference controls for enabling/disabling audio with localStorage persistence

Implementation approach:
- Use existing `AudioContext` from `background-keepalive.js` (already kept alive for background processing)
- Generate short tones using oscillators (no external audio files needed)
- Phase change: Short beep (e.g., 200Hz, 100ms)
- Completion: Two-tone chime (ascending, 300ms)
- Store preference in `localStorage` under `pulsetto_audio_enabled`
- Hook into `_onTimelineScriptStep()` for phase change sounds (when `!step.isSeek && !step.isFadeUpdate`)
- Hook into `completed` event handler for session end sound

## Implementation Landscape

### Key Files

- `js/app.js` — Main integration point:
  - `_onTimelineScriptStep(step)` — Add phase change sound trigger (line ~1008)
  - `clock.on('completed', ...)` — Add completion sound (line ~397)
  - `_bindClockEvents()` — Bind audio triggers
  - Add `this.audioEnabled` state and localStorage methods
  
- `js/background-keepalive.js` — Audio infrastructure:
  - Already has `AudioContext` at `this.audioContext` (line 116)
  - Reuse this context for sound generation (avoid creating duplicate contexts)
  - Add sound generation methods or use standalone audio context
  
- `index.html` — Settings UI:
  - Add toggle/checkbox for "Audio feedback" in header or settings area
  - Recommended location: In the header status bar or a small settings section
  
- `js/protocol.js` — Command constants:
  - Already has `Commands.stop` — verify `_sendStopCommand()` works at session end

### Build Order

1. **T02: Audio Feedback System**
   - Create audio utility functions (playPhaseSound, playCompletionSound)
   - Use Web Audio API OscillatorNode for tones
   - Phase change: Short beep (e.g., 200Hz, 100ms)
   - Completion: Two-tone chime (ascending, 300ms)
   - Test without UI first (console commands)

2. **T03: Settings Toggle UI**
   - Add HTML toggle/checkbox to index.html
   - Add CSS styling for toggle
   - Add event listeners in app.js
   - Implement localStorage load/save
   - Wire toggle to enable/disable audio playback

### Verification Approach

To verify audio functionality:

1. **Enable audio toggle** — Check localStorage persistence across refresh
2. **Phase change test** — Start session, verify sound plays when timeline advances phases
3. **Completion test** — Let session run to end (or seek to end), verify completion sound plays
4. **Disable test** — Turn off toggle, verify no sounds play
5. **Stop command verification** — Check logs for stop command at session completion

### Architecture Notes

**Audio Implementation Strategy:**
```javascript
// Add to app.js constructor
this.audioEnabled = this._loadAudioPreference();

// Audio generation (no external files)
_playTone(frequency, duration, type = 'sine') {
  if (!this.audioEnabled) return;
  const ctx = this.bgKeepalive.audioContext;
  if (!ctx) return;
  
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  osc.frequency.value = frequency;
  osc.type = type;
  gain.gain.setValueAtTime(0.1, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
  
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

playPhaseSound() { this._playTone(200, 0.1); }
playCompletionSound() { 
  this._playTone(440, 0.15); // A4
  setTimeout(() => this._playTone(880, 0.3), 150); // A5
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
- Phase sound in `_onTimelineScriptStep()` when natural transition:
  ```javascript
  if (!step.isSeek && !step.isFadeUpdate) {
    this._playPhaseSound();
  }
  ```
- Completion sound in `clock.on('completed', ...)` before or after `_sendStopCommand()`

**Stop Command Verification:**
The stop command is already sent at session completion via `_sendStopCommand()` (line 403 in `_bindClockEvents`). This should be verified working but likely needs no changes.

### Constraints

- Audio must use Web Audio API (no external MP3/WAV files to keep app self-contained)
- Must respect browser autoplay policies (audio context may need user interaction first)
- Toggle state persists in localStorage only (no backend)
- Phase sounds should not play during manual seek operations
- Sounds should be subtle (low volume ~0.1) to not be jarring

### Common Pitfalls

- **Autoplay policy:** Browsers block audio until user interaction. The app already requires user clicks to start, so this should be fine.
- **Audio context suspended:** May need to resume context if suspended before playing. Check `this.bgKeepalive.audioContext.state`.
- **Duplicate sounds:** Ensure phase sound only plays on natural transitions, not on seek or fade updates. Check `!step.isSeek && !step.isFadeUpdate`.
- **Volume levels:** Keep gain low (0.05-0.1) for subtle feedback, not annoying alerts.

### Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Audio context management | `background-keepalive.js` already has AudioContext | Reuse to avoid duplicate contexts and permission issues |
| Tone generation | Web Audio API OscillatorNode | No external audio files needed, works offline |
| localStorage wrapper | Try-catch pattern in codebase | Handle private mode / quota errors gracefully |

### Open Risks

- Audio may not work on first load until user interacts (browser autoplay policy) — acceptable given the app requires clicks anyway
- Some browsers (Safari) may have different AudioContext behavior — test if targeting iOS

## Sources

- Fade implementation: `js/app.js` lines 546-770
- Task completion: `.gsd/milestones/M001/slices/S01/tasks/T01-SUMMARY.md`
- Audio context: `js/background-keepalive.js` lines 110-150
- Session completion: `js/app.js` lines 397-408
- Phase change detection: `js/app.js` lines 1008-1050
