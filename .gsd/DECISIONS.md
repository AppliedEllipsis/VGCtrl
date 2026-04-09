# Decisions Register

<!-- Append-only. Never edit or remove existing rows.
     To reverse a decision, add a new row that supersedes it.
     Read this file at the start of any planning or research phase. -->

| # | When | Scope | Decision | Choice | Rationale | Revisable? | Made By |
|---|------|-------|----------|--------|-----------|------------|---------|
| D001 | Fixing seek behavior to trigger command queuing | bug-fix | Timeline seek should trigger commands via setIntensity/setChannelOverride | Modified _onTimelineScriptStep to call setIntensity/setChannelOverride only when step.isSeek is true. These methods update UI and send BLE commands. Natural playback just updates UI display without sending commands. | User wants seeking to actually apply the script settings to the device (queue commands), not just update UI. The isSeek flag distinguishes manual seek from natural playback. This ensures commands are only sent when user intentionally seeks, not every second during playback. | Yes | agent |
| D002 | Fixing timeline to properly distinguish natural progression vs seek | bug-fix | Timeline script steps explicitly set isSeek: false for natural progression, true only for manual seek | Modified _tick() to set isSeek: false explicitly, and seek() to set isSeek: true. Added logging to distinguish between natural progression (UI only) and seek (commands sent). | User needs clear distinction between natural playback (visual only) and manual seek (apply settings). The isSeek flag now explicitly indicates intent. Added debug logging to help diagnose any remaining issues with channel/intensity application. | Yes | agent |
