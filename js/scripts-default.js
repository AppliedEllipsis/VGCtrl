/**
 * Default Pulsetto Mode Scripts
 * 
 * These are the built-in stimulation patterns converted to the script format.
 * Users can override these by creating their own scripts with the same mode names.
 * 
 * === CONVERTED FROM ORIGINAL MODE ENGINES ===
 * 
 * Original engines were hardcoded JavaScript classes. These scripts express the same
 * patterns in human-readable (and editable!) format.
 */

const DEFAULT_SCRIPTS = `
# ============================================
# Pulsetto Default Mode Scripts
# ============================================
# 
# How to read these scripts:
# - [Name] starts a new mode
# - mode(int, ch) turns on stimulation
# - wait(time) does nothing for that long
# - fade(to, over) gradually changes intensity
# - repeat(cycle) starts a repeating section
# - end marks the end of a repeat
#
# Intensity can be absolute (1-9) or relative (50%, 100%)
# Times can be seconds (30s), minutes (1m), or % of session (20%)

# ============================================
[Stress Relief]
# Continuous bilateral stimulation
suggested_intensity(7)
mode(100%, both)
wait(session)

# ============================================
[Sleep]
# 5-phase rotation with end-of-session fade
# Original: D→A→D→C→D with fade in last 20%
suggested_intensity(5)
mode(100%, both)
wait(20%)
mode(100%, left)
wait(20%)
mode(100%, both)
wait(20%)
mode(100%, right)
wait(20%)
mode(100%, both)
# Last 20% fades intensity
fade(67%, 10%)
wait(10%)

# ============================================
[Focus Left]
# 30s ON / 30s OFF duty cycle, left side only
suggested_intensity(7)
repeat(cycle)
  mode(100%, left)
  wait(30s)
  mode(0%, off)
  wait(30s)
end

# ============================================
[Focus Right]
# 30s ON / 30s OFF duty cycle, right side only
suggested_intensity(7)
repeat(cycle)
  mode(100%, right)
  wait(30s)
  mode(0%, off)
  wait(30s)
end

# ============================================
[Focus Both]
# 30s ON / 30s OFF duty cycle, bilateral
suggested_intensity(7)
repeat(cycle)
  mode(100%, both)
  wait(30s)
  mode(0%, off)
  wait(30s)
end

# ============================================
[Focus Alt]
# 135s cycle: Both → Pause → Left → Pause → Right → Pause
suggested_intensity(7)
repeat(cycle)
  # Both phase (0-30s)
  mode(100%, both)
  wait(30s)
  # Pause after both (30-45s)
  mode(0%, off)
  wait(15s)
  # Left phase (45-75s)
  mode(100%, left)
  wait(30s)
  # Pause after left (75-90s)
  mode(0%, off)
  wait(15s)
  # Right phase (90-120s)
  mode(100%, right)
  wait(30s)
  # Pause after right (120-135s)
  mode(0%, off)
  wait(15s)
end

# ============================================
[Pain Relief]
# Sine wave intensity oscillation ±1 over 20s
# (Sine wave smoothed to 4 steps for simplicity)
suggested_intensity(6)
repeat(cycle)
  mode(100%, both)
  wait(5s)
  mode(122%, both)   # +1 step (roughly 122% of base, bounded to 9)
  wait(5s)
  mode(100%, both)
  wait(5s)
  mode(78%, both)   # -1 step (roughly 78% of base, bounded to 1)
  wait(5s)
end

# ============================================
[Calm]
# Respiratory-gated: 5s inhale, 5s hold, 7s exhale
# Stimulation on late inhale (after 3s lead)
suggested_intensity(5)
repeat(cycle)
  # Inhale phase - stimulation starts after 3s lead
  mode(0%, off)
  wait(3s)
  mode(100%, both)
  wait(2s)
  # Hold phase - stimulation continues
  mode(100%, both)
  wait(5s)
  # Exhale phase - no stimulation
  mode(0%, off)
  wait(7s)
end

# ============================================
[Meditation]
# Respiratory-gated: 5s inhale, 4s hold, 5s exhale
# Stimulation on late inhale (after 3s lead)
suggested_intensity(5)
repeat(cycle)
  # Inhale phase - stimulation starts after 3s lead
  mode(0%, off)
  wait(3s)
  mode(100%, both)
  wait(2s)
  # Hold phase - stimulation continues
  mode(100%, both)
  wait(4s)
  # Exhale phase - no stimulation
  mode(0%, off)
  wait(5s)
end

# ============================================
[Headache]
# Burst cycling: 2min ON / 30s OFF
suggested_intensity(8)
repeat(cycle)
  mode(100%, both)
  wait(120s)
  mode(0%, off)
  wait(30s)
end

# ============================================
[Nausea]
# Continuous bilateral stimulation
suggested_intensity(6)
mode(100%, both)
wait(session)
`;

// Make available globally
if (typeof window !== 'undefined') {
  window.DEFAULT_SCRIPTS = DEFAULT_SCRIPTS;
}
