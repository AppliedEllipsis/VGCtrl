---
estimated_steps: 9
estimated_files: 1
skills_used: []
---

# T01: Implement reliable stop command with multiple attempts

Modify `_sendStopCommand()` in `js/app.js` to send multiple stop commands with delays to ensure the device actually stops. The current implementation sends a single stop command which may not always reach the device due to BLE reliability issues.

Implementation approach:
1. Locate the existing `_sendStopCommand()` method in `js/app.js`
2. Modify it to send 3 stop commands with 1000ms delays between them
3. Use the existing `this.ble.sendStop()` for the first attempt (it has retry logic and clears queue)
4. For subsequent attempts, use `this.ble.sendCommand(stopCmd)` directly
5. Add logging for each stop attempt: "Stop 1/3", "Stop 2/3", "Stop 3/3"
6. Keep the existing `this.isStimulationActive = false` behavior after the sequence

Pattern to follow: The fade command implementation in `_triggerFade()` already uses sequential commands with delays - use the same pattern here.

## Inputs

- `js/app.js`
- `js/bluetooth.js`

## Expected Output

- `js/app.js`

## Verification

grep -q "Stop 1/3" js/app.js && grep -q "await.*delayMs" js/app.js && grep -q "stopAttempts = 3" js/app.js
