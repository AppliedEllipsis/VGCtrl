# Visual Script Builder Design Document

## Overview

The Visual Script Builder will be a drag-and-drop interface that lets users create stimulation patterns without writing code. It will translate visual arrangements into the script language described in `SCRIPT_LANGUAGE.md`.

## Core Concept: "Timeline Blocks"

Imagine a horizontal timeline (like a video editor or music sequencer). Users drag blocks onto this timeline, each block represents a command.

### Block Types

| Block | Visual | Represents |
|-------|--------|------------|
| **Mode Block** | Rectangle with intensity slider | `mode(int, channel)` |
| **Wait Block** | Spacer/gap with time label | `wait(time)` |
| **Fade Block** | Gradient rectangle | `fade(to, over)` |
| **Loop Bracket** | Bracket surrounding other blocks | `repeat()` / `end` |

### Block Appearance

```
Mode Block (active):
┌─────────────────────────┐
│ 🔵⚡⚡⚡⚡⚡⚡⚡⚡⚡🔵         │  <- Intensity dots
│                         │
│   BOTH SIDES            │  <- Channel indicator
│   Intensity: 7          │  <- Value display
│                         │
│   [══════════════]      │  <- Visual slider
│                         │
│   ⏱ 30 seconds          │  <- Duration (if in loop)
└─────────────────────────┘

Wait Block:
┌─────────────────────────┐
│                         │
│    ⏸  PAUSE            │
│                         │
│      30 seconds         │
│                         │
└─────────────────────────┘

Fade Block:
┌─────────────────────────┐
│ ▓▓▓▓▓░░░░░░░░░░░░░░░░ │  <- Gradient
│ 100% → 50%              │
│ Over 20 seconds         │
└─────────────────────────┘

Loop Bracket:
┌──────────────────────────────────────────┐
│ ↻ REPEAT FOREVER                         │  <- repeat(cycle)
│ ╔══════════════════════════════════════╗ │
│ ║ [Mode] [Wait] [Mode] [Wait]          ║ │
│ ╚══════════════════════════════════════╝ │
└──────────────────────────────────────────┘
```

## Interface Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Pulsetto Script Builder                                   [?]  │
├─────────────────────────────────────────────────────────────────┤
│  BLOCK PALETTE    │                                             │
│                   │     TIMELINE CANVAS                         │
│  ┌───────────┐    │     ┌───────────────────────────────────┐   │
│  │ Mode      │    │     │ ↻  repeat(cycle)                  │   │
│  │ Wait      │    │     │ ┌─────────┐   ╭────╮   ┌────────┐ │   │
│  │ Fade      │    │     │ │ Mode    │ ◯ │Wait│   │ Mode   │ │   │
│  │ Loop      │    │     │ │ 🔵⚡⚡⚡⚡⚡ │   ╰────╯   │ ⚡⚡⚡⚡⚡🔵 │ │   │
│  │           │    │     │ │ 7 left  │            │ 7 right│ │   │
│  │ [IMPORT]  │    │     │ │ 30s     │   30s      │ 30s    │ │   │
│  │ [EXPORT]  │    │     │ └─────────┘            └────────┘ │   │
│  │ [TEST]    │    │     │           end                       │   │
│  └───────────┘    │     └───────────────────────────────────┘   │
│                   │                                             │
│  ┌───────────┐    │  TIME RULER                                  │
│  │ PRESETS:  │    │  0s    30s   60s   90s   120s  150s  180s   │
│  │ • Focus   │    │  |      |      |      |      |      |      | │
│  │ • Sleep   │    │                                             │
│  │ • Custom  │    │  ▓▓▓▓▓▓▓▓░░░░░░▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░ │
│  └───────────┘    │  ON      OFF     ON       ... (preview)     │
│                   │                                             │
└───────────────────┴─────────────────────────────────────────────┘
```

## Interaction Patterns

### Adding Blocks
1. Drag from palette onto timeline
2. Block "snaps" to nearest second
3. If dropped inside a loop, it's in the loop

### Editing Blocks

**Double-click** any block opens edit panel:

```
Mode Block Editor:
┌────────────────────┐
│  ⚡ MODE SETTINGS  │
│                    │
│  Channel:          │
│  ○ Left  ● Both  ○ Right  ○ Off  │
│                    │
│  Intensity:        │
│  [══════════●════] │
│  0%    50%    100% │
│                    │
│  [Save]  [Delete]  │
└────────────────────┘
```

**Wait Block Editor**:
- Slider: 1s to 5m
- Or checkbox: "Until session ends"
- Or: "% of session" input

**Fade Block Editor**:
- "From" (inherited from previous)
- "To" intensity slider
- Duration input (same options as wait)
- Preview gradient

### Creating Loops
1. Drag "Loop" block onto timeline
2. It creates an empty bracket with `end`
3. Drag other blocks inside the bracket area
4. Click bracket to edit:
   - `repeat(cycle)` = forever
   - `repeat(stretch)` = fit to session

### Rearranging
- Drag blocks to reorder
- Can drag blocks in/out of loops
- Loop bracket auto-expands/contracts

### Deleting
- Right-click → delete
- Or drag to trash icon

## Block-to-Script Translation

### Simple Example

Visual:
```
[Mode: 100%, left] → [Wait: 30s] → [Mode: 0%, off] → [Wait: 30s]
       └─ repeat(cycle) ─┘
```

Generates:
```
repeat(cycle)
  mode(100%, left)
  wait(30s)
  mode(0%, off)
  wait(30s)
end
```

### Complex Example

Visual:
```
[Mode: 100%, both, 20%] → [Mode: 100%, left, 20%] → [Mode: 100%, both, 20%]
                                                 → [Mode: 100%, right, 20%]
                                                 → [Mode: 100%, both, 20%]
       └─ fade to 67% ─┘
```

Generates:
```
mode(100%, both)
wait(20%)
mode(100%, left)
wait(20%)
mode(100%, both)
wait(20%)
mode(100%, right)
wait(20%)
mode(100%, both)
fade(67%, 20%)
wait(20%)
```

## Smart Suggestions

The builder will suggest improvements:

1. **"This wait ends at 45s but your session is 30s"** → Offer to switch to percentage
2. **"Two mode blocks with same intensity"** → Suggest merging
3. **"Empty loop"** → Warning before save

## Preview Panel

Real-time visualization of the generated script:

```
Preview (3-minute session):
Time    Intensity   Channel   What's Happening
────────────────────────────────────────────────
0:00    7           Both      Starting...
0:30    7           Left      Switching to left
1:00    7           Both      Back to both
1:30    7           Right     Now right side
2:00    5           Both      Fading down
2:30    3           Both      Continuing fade
3:00    0           Off       Session complete
```

## File Operations

### Import
- Drop `.txt` file onto builder
- Parses and converts to visual blocks
- Shows errors if script is invalid

### Export
- Generates `.txt` file from current visual arrangement
- Preserves comments (maybe with metadata tags)

### Share
- Generate shareable URL with encoded script
- Copy/paste the raw text

## Accessibility

- Keyboard navigation (Tab between blocks)
- Screen reader announcements ("Mode block, intensity 7, left channel")
- High contrast mode
- Alternative: direct text editor always available

## Mobile Considerations

- Vertical layout instead of horizontal
- Touch gestures (pinch to zoom timeline)
- Simplified block sizes
- "Add" buttons instead of drag (drag is hard on mobile)

## Technical Implementation Notes

### Data Structure

```javascript
{
  blocks: [
    { id: 'b1', type: 'mode', intensity: 100, channel: 'left', time: 30 },
    { id: 'b2', type: 'wait', duration: { value: 30, unit: 's' } },
    { id: 'b3', type: 'loop', mode: 'cycle', contains: ['b1', 'b2'] }
  ]
}
```

### Rendering

- HTML5 Canvas or SVG for timeline
- DOM elements for blocks (easier interaction)
- Virtual scrolling for long sessions

### Performance

- 60fps while dragging
- Debounce script generation
- Thumbnail preview generation

## Future Enhancements

1. **Templates**: "Make me a custom Sleep mode with 4 phases instead of 5"
2. **Sharing**: Community script repository
3. **AI Assist**: "Create a script for studying that alternates sides every 2 minutes"
4. **Recording**: Hit record, manually change intensity, it generates the script
5. **Comparison**: Side-by-side two scripts
6. **Analytics**: "Most used custom scripts", "Average intensity per mode"

## Migration Path

Phase 1: Text editor with validation (current)
Phase 2: Add "Open in Builder" button that parses text → visual
Phase 3: Full builder with drag-and-drop
Phase 4: Advanced features (templates, sharing)

The text editor always remains as a fallback and for power users.
