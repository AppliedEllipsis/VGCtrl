# S01: Implement reliable stop commands and audio feedback system for the Pulsetto web app — UAT

**Milestone:** M001
**Written:** 2026-04-09T16:33:05.441Z

## User Acceptance Tests

### Stop Command Reliability
1. Start a session with the device connected
2. Click Stop or let session run to completion
3. Check browser console logs — should see "Stop 1/3", "Stop 2/3", "Stop 3/3" entries
4. Verify spacing between logs is approximately 1000ms
5. Device should reliably stop (intensity goes to 0)

### Audio Feedback
1. **Toggle Persistence:**
   - Disable audio toggle, reload page
   - Toggle should remain off (persisted in localStorage)
   - Enable audio toggle, reload page
   - Toggle should remain on

2. **Phase Change Sound:**
   - Enable audio toggle
   - Start a session with a mode that has phase changes (e.g., Breathing)
   - When phase changes, should hear short 200Hz beep

3. **Completion Sound:**
   - Enable audio toggle
   - Let session run to completion or start a short session
   - When complete, should hear two-tone ascending chime (440Hz then 880Hz)

4. **Disable Audio:**
   - Disable audio toggle
   - Trigger phase change or completion
   - No sounds should play

### Console Test
```javascript
// With app running, in browser console:
app.audioEnabled = true;
app.playPhaseSound();      // Should hear beep
app.playCompletionSound(); // Should hear chime
app.audioEnabled = false;
app.playPhaseSound();      // Should hear nothing
```

### Expected Results
- Stop commands are reliable with 3 attempts
- Audio feedback plays when enabled
- Audio preference persists across page reloads
- No audio plays when toggle is disabled
