# VSL - Vagus Scripting Language Guide

> **Protocol Version**: 1 (specify with `ver(1)` at start of script)

## The 5-Minute Explanation

Think of a script like a recipe for your device. It tells the device:
1. **When** to turn on/off
2. **How strong** to stimulate (1-9)
3. **Which side(s)** (left, right, or both)
4. **How long** to wait between changes

The device reads your script from top to bottom, doing what you tell it, then repeats or stops when you say.

## Simple Example: Basic Focus

```
[Focus Left]
mode(100%, left)
wait(30s)
mode(0%, off)
wait(30s)
```

What happens:
1. Turn on at user's chosen intensity, left side only
2. Wait 30 seconds
3. Turn off
4. Wait 30 seconds
5. Stop (we didn't say to repeat!)

## Repeating Pattern: Proper Focus

```
[Focus Left]
repeat(cycle)
  mode(100%, left)
  wait(30s)
  mode(0%, off)
  wait(30s)
end
```

Now it loops forever (well, until your session ends).

## Commands Reference

### `[Mode Name]` - Start a Mode
Must be on its own line, in brackets. Everything after this belongs to this mode.

### `mode(intensity, channel)` - Turn On/Off
- **intensity**: 0-9 (absolute) or 0%-100% (relative to user's choice)
- **channel**: `left`, `right`, `both`, or `off`

Examples:
- `mode(5, both)` - Half power on both sides
- `mode(100%, left)` - User's chosen intensity, left only
- `mode(0%, off)` - Off

### `wait(time)` - Do Nothing
- **time**: `30s` (seconds), `1m` (minutes), `10%` (percent of session), or `session` (all remaining time)

Examples:
- `wait(30s)` - Wait half a minute
- `wait(20%)` - Wait 20% of total session time
- `wait(session)` - Wait until the session ends

### `fade(to, over)` - Gradual Change
Smoothly changes intensity over time.

- **to**: Target intensity (1-9 or %)
- **over**: How long to take (30s, 10%, etc.)

Example:
- `fade(50%, 20s)` - Fade to half intensity over 20 seconds

### `repeat(type)` and `end` - Looping
Makes a section repeat.

- **type**: `cycle` (repeat forever) or `stretch` (fit to session time)

Example with cycle:
```
repeat(cycle)
  mode(100%, both)
  wait(30s)
  mode(0%, off)
  wait(30s)
end
```

Example with stretch (fits 3 loops into session):
```
[Stress Relief]
repeat(stretch)
  mode(100%, both)
  wait(20s)
  mode(80%, both)
  wait(20s)
  mode(60%, both)
  wait(20s)
end
# If session is 3 minutes, each "20s" becomes ~33s to fit exactly
```

### `suggested_intensity(1-9)` - Suggest Starting Level
Tells the app what intensity slider position to show when this mode is selected. User can still change it.

## Intensity: Absolute vs Relative

**Absolute** (simple numbers): Direct device power level
- `mode(5, both)` = 5 out of 9, period
- `fade(7, 10s)` = fade to exactly 7

**Relative** (percentages): Based on user's chosen intensity
- `mode(100%, both)` = user's full chosen intensity
- `mode(50%, both)` = half of user's chosen intensity
- Useful for scripts that adapt to user preference!

### Bounds Protection
If a calculation goes below 1 or above 9, it gets clamped:
- `50%` of user setting `1` → `1` (not 0.5!)
- `150%` of user setting `8` → `9` (not 12!)

## Time: Absolute vs Relative vs Session

**Absolute**: Exact duration
- `wait(30s)` = exactly 30 seconds
- `fade(5, 10s)` = fade takes exactly 10 seconds

**Relative**: Percentage of total session
- `wait(20%)` = 20% of your session duration
- If session is 10 minutes, this waits 2 minutes

**Session**: All remaining time
- `wait(session)` = from now until the end
- Useful for simple modes that just stay on

## Comments

Lines starting with `#` are ignored. Use them to explain your script!

```
[Focus Alt]
# This mode cycles through different sides
repeat(cycle)
  mode(100%, both)   # Start with both sides
  wait(30s)
  mode(0%, off)       # Rest period
  wait(15s)
end
```

## Multiple Commands Per Line

Use semicolons to put multiple commands on one line:

```
mode(100%, both); wait(30s); mode(0%, off)
```

Need a literal semicolon? Escape it:

```
# This comment has a semicolon \; in it
```

## Common Mistakes (And What Happens)

| Mistake | What Happens | Fix |
|---------|--------------|-----|
| `mode(5)` | Error - need channel | Add `, both` etc |
| `mode(5, both` | Error - missing `)` | Add closing paren |
| `wait()` | Error - need time | Add `30s` etc |
| `repeat(cycle)` with no `end` | Error - unclosed loop | Add `end` |
| `end` with no `repeat` | Warning (ignored) | Remove or add `repeat` |
| `Mode(5, both)` | Warning - did you mean `mode`? | Lowercase `mode` |
| `wat(30s)` | Warning - did you mean `wait`? | Spell correctly |

## Storage and Import/Export

Your scripts are saved in your browser's local storage (like a cookie, but bigger). They stay even if you close the browser.

### Export
Click "Export Scripts" to download a `.txt` file you can save anywhere.

### Import
Click "Import Scripts" and choose a `.txt` file. **Warning**: This replaces all your scripts! Make sure to export first if you have custom ones.

### Reset
If scripts get corrupted or you're stuck, click "Reset to Defaults" to restore the original modes.

### Manual Edit
You can always edit the raw script text directly. It's just text! If you make a mistake, the validator will tell you.

## How Stretch Mode Works (Math!)

When you use `repeat(stretch)`, the engine:

1. Calculates how long one loop takes naturally (sum of all waits/fades)
2. Figures out how many loops fit in your session
3. Stretches or squashes all timings proportionally

Example:
```
[Example]
repeat(stretch)
  mode(100%, both)
  wait(10s)
  mode(50%, both)
  wait(10s)
end
```

Natural loop = 20 seconds. For a 60-second session:
- Fits 3 loops (60 ÷ 20 = 3)
- Stretch factor = 1.0 (perfect fit)

For a 90-second session:
- Fits 4 loops (90 ÷ 20 = 4.5, round down to 4)
- Stretch factor = 1.125 (90 ÷ 80 = 1.125)
- Each `wait(10s)` becomes `wait(11.25s)`

This makes patterns perfectly fit your session length!

## Script File Format

Scripts are stored as plain text. The format is:

```
[Mode Name 1]
command(args)
command(args)

[Mode Name 2]
command(args)
...
```

You can have as many modes as you want. Just put each in its own `[Name]` section.

## Future: Visual Script Builder

See `SCRIPT_BUILDER_DESIGN.md` for plans on a drag-and-drop interface.
