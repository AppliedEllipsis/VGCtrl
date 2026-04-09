---
estimated_steps: 15
estimated_files: 1
skills_used: []
---

# T02: Implement audio feedback system using Web Audio API

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

## Inputs

- `js/app.js`
- `js/background-keepalive.js`

## Expected Output

- `js/app.js`

## Verification

grep -q "_playTone" js/app.js && grep -q "playPhaseSound" js/app.js && grep -q "playCompletionSound" js/app.js
