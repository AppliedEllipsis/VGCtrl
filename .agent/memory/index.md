# Agent Memory Index - Web App

Last updated: 2026-04-08

## Read Order

1. `../../AGENTS.md` (parent project agent guidelines)
2. `../docs/MEMORY.md` (if exists)
3. `../docs/plans/PROGRESS.md` (if exists)
4. `./.gsd/PREFERENCES.md` (GSD configuration)

## Purpose

This folder is the fast-start memory layer for agents working in `d:\_projects\pulsetto\web-app`.
This is the browser-based web controller for the Pulsetto BLE device.

## Active Focus

1. Build responsive web UI for Pulsetto device control
2. Implement real-time timeline visualization with intensity levels
3. Maintain BLE protocol safety and session reliability
4. Coordinate with Flutter app via shared protocol definitions

## Quick Status

- **Date**: 2026-04-08
- **Stack**: Vanilla JS, Web Bluetooth API, Canvas timeline
- **Current Work**: Timeline intensity visualization, responsive layout
- **Protocol**: ASCII (verified with official app v2.2.91)

## File Index

| File | Purpose |
|------|---------|
| `js/timeline.js` | Session timeline visualization with intensity curves |
| `js/timeline-state-manager.js` | Command scheduler with 5s ticks + 3s transition deferral |
| `js/mode-engines.js` | Stimulation pattern generators (sleep, focus, pain, etc.) |
| `js/bluetooth.js` | Web Bluetooth LE communication layer |
| `js/protocol.js` | ASCII protocol definitions and response parsers |
| `js/app.js` | Main application coordinator |
| `js/session-clock.js` | Session timing and progress tracking |
| `style.css` | Compact responsive layout styles |
| `index.html` | Main UI with grid-based responsive layout |

## Architecture Notes

### Command Scheduling (TimelineStateManager)
- Ticks every 5 seconds since last command
- Calculates expected state: mode engine + channel override
- If transition within 3 seconds, defers to batch with it
- Sends via ble.queueChannel / queueIntensity

### Channel Override System
- Timeline zones set expected channel via mode engine
- User override (left/right/both/auto) takes precedence
- 'auto' uses timeline's expected channel

### Responsive Layout
- Max-width: 900px (wider, uses space better)
- Controls in responsive rows using CSS Grid
- Collapsible logs section
- Timeline with intensity scale overlay (0-9 markers)
