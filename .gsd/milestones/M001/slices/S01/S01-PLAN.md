# S01: S01

**Goal:** Implement reliable stop commands and audio feedback system for the Pulsetto web app
**Demo:** 

## Must-Haves

- Verification approach:
- **Stop Command Reliability (T01):**
- 1. Start session, let run to completion or manually stop
- 2. Check browser console logs — should see "Stop 1/3", "Stop 2/3", "Stop 3/3" entries
- 3. Verify spacing between logs is ~1000ms (delays working)
- 4. Device should reliably stop (intensity goes to 0)
- **Audio Feedback (T02+T03):**
- 1. Verify localStorage persistence: toggle off, reload page, toggle should remain off
- 2. Enable audio, trigger phase change — should hear short 200Hz beep
- 3. Let session complete — should hear two-tone ascending chime
- 4. Disable audio toggle — no sounds should play
- **Integration Test:**
- ```javascript
- // In browser console with app running:
- app.audioEnabled = true;
- app.playPhaseSound();    // Should hear beep
- app.playCompletionSound(); // Should hear chime
- app.audioEnabled = false;
- app.playPhaseSound();    // Should hear nothing
- ```

## Proof Level

- This slice proves: This slice delivers operational improvements to an existing web app. No new test framework required - verification is through manual browser testing and console log inspection. The slice touches user-facing features (audio toggle, stop reliability) that are verified by runtime behavior observation.

## Integration Closure

This slice completes standalone UX improvements. No new runtime boundaries are introduced. The fade control feature (previously T01) plus these reliability and feedback enhancements make the session experience more robust. No additional integration work required before milestone is usable.

## Verification

- This slice is a simple UI/UX enhancement. No runtime observability surfaces are added. Audio and stop commands are user-facing features tested manually via browser console logs.

## Tasks

- [x] **T01: Implement reliable stop command with multiple attempts** `est:45m`
  Modify `_sendStopCommand()` in `js/app.js` to send multiple stop commands with delays to ensure the device actually stops. The current implementation sends a single stop command which may not always reach the device due to BLE reliability issues.

Implementation approach:
1. Locate the existing `_sendStopCommand()` method in `js/app.js`
2. Modify it to send 3 stop commands with 1000ms delays between them
3. Use the existing `this.ble.sendStop()` for the first attempt (it has retry logic and clears queue)
4. For subsequent attempts, use `this.ble.sendCommand(stopCmd)` directly
5. Add logging for each stop attempt: "Stop 1/3", "Stop 2/3", "Stop 3/3"
6. Keep the existing `this.isStimulationActive = false` behavior after the sequence

Pattern to follow: The fade command implementation in `_triggerFade()` already uses sequential commands with delays - use the same pattern here.
  - Files: `js/app.js`
  - Verify: grep -q "Stop 1/3" js/app.js && grep -q "await.*delayMs" js/app.js && grep -q "stopAttempts = 3" js/app.js

- [x] **T02: Implement audio feedback system using Web Audio API** `est:45m`
  Add audio feedback for phase changes and session completion using the existing Web Audio API infrastructure from `background-keepalive.js`.

Implementation steps:
1. Add audio utility methods to the App class in `js/app.js`:
   - `_playTone(frequency, duration, type)` - generates tones using OscillatorNode
   - `playPhaseSound()` - short 200Hz beep (100ms) for phase changes
   - `playCompletionSound()` - two-tone ascending chime (440Hz then 880Hz)

2. Integrate sounds into existing event handlers:
   - In `_onTimelineScriptStep(step)`: call `playPhaseSound()` when `!step.isSeek && !step.isFadeUpdate`
   - In the `clock.on('completed', ...)` handler: call `playCompletionSound()` after stop commands

3. Audio implementation details:
   - Use `this.bgKeepalive.audioContext` (already exists in background-keepalive.js)
   - Check `ctx.state !== 'suspended'` before playing (respect browser autoplay policies)
   - Keep volume low (gain ~0.1) for subtle feedback
   - Use sine wave type for pleasant tones

4. Add `this.audioEnabled` property to App class, defaulting to true for now (T04 will add toggle)
  - Files: `js/app.js`
  - Verify: grep -q "_playTone" js/app.js && grep -q "playPhaseSound" js/app.js && grep -q "playCompletionSound" js/app.js

- [ ] **T03: Add audio toggle UI with localStorage persistence** `est:45m`
  Add a settings toggle to enable/disable audio feedback, storing preference in localStorage.

Implementation steps:
1. In `js/app.js`:
   - Add `_loadAudioPreference()` method that reads from `localStorage.getItem('pulsetto_audio_enabled')`
   - Add `_saveAudioPreference(enabled)` method that writes to localStorage
   - Call `_loadAudioPreference()` in App constructor to set initial `this.audioEnabled`
   - Modify `_playTone()` to return early if `!this.audioEnabled`

2. In `index.html`:
   - Add a checkbox/toggle labeled "Audio feedback" in an appropriate location (near other controls or in a settings area)
   - Give it an id like `audio-toggle`

3. In `js/app.js`:
   - Add event listener for the toggle that calls `_saveAudioPreference()` and updates `this.audioEnabled`
   - Ensure the toggle's checked state matches the loaded preference on startup

4. CSS considerations:
   - If needed, add minimal styling for the toggle in the existing CSS or inline styles
   - Match existing UI styling patterns

localStorage keys:
- `pulsetto_audio_enabled` - stores 'true' or 'false'
  - Files: `js/app.js`, `index.html`
  - Verify: grep -q "pulsetto_audio_enabled" js/app.js && grep -q "localStorage" js/app.js && grep -q "audio.*toggle\|audio-feedback\|audioToggle" index.html

## Files Likely Touched

- js/app.js
- index.html
