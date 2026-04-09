---
estimated_steps: 18
estimated_files: 2
skills_used: []
---

# T03: Add audio toggle UI with localStorage persistence

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

## Inputs

- `js/app.js`
- `index.html`

## Expected Output

- `js/app.js`
- `index.html`

## Verification

grep -q "pulsetto_audio_enabled" js/app.js && grep -q "localStorage" js/app.js && grep -q "audio.*toggle\|audio-feedback\|audioToggle" index.html
