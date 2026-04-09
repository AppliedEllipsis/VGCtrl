/**
 * VSL - Vagus Scripting Language
 * 
 * A domain-specific language for describing vagus nerve stimulation patterns.
 * Think of it like a recipe that tells the device what to do and when.
 * 
 * Protocol Version: 1 (tracked via ver(1) directive)
 * 
 * === HOW SCRIPTS WORK (5th Grade Version) ===
 * 
 * Imagine you're writing instructions for a device that stimulates your vagus nerve
 * at the side of your neck. The device needs to know:
 * 1. How strong to stimulate (intensity 1-9)
 * 2. Which side of the neck (left, right, or both)
 * 3. How long to wait between changes
 * 
 * Scripts are just a list of these instructions!
 * 
 * === EXAMPLE SCRIPTS ===
 * 
 * [Stress Relief]
 * mode(100%, both)
 * wait(session)
 *
 * [Focus Left]
 * repeat(cycle)
 *   mode(100%, left)
 *   wait(30s)
 *   mode(0%, off)
 *   wait(30s)
 * 
 * [Sleep]
 * mode(100%, both)
 * wait(20%)
 * mode(100%, left)
 * wait(20%)
 * fade(67%, 20%)
 * mode(100%, both)
 * wait(20%)
 * mode(100%, right)
 * wait(20%)
 * fade(33%, 20%)
 * 
 * === COMMANDS ===
 * 
 * [Mode Name]          - Starts a new mode script (must be first thing on line)
 * mode(int, ch)        - Turn on with intensity (1-9 or %), channel (left/right/both/off/none)
 * wait(time)           - Do nothing for X seconds, % of session, or 'session' for all remaining time
 * fade(to, over)       - Gradually change intensity over time
 * repeat(type)         - Start repeating a section
 * end                  - End the repeat section
 * suggested_intensity  - What intensity the user should start at (they can override)
 * 
 * === SPECIAL VALUES ===
 * 
 * Intensity: 1-9, or 11%-100% (percentage of user's chosen intensity)
 * Time: 1s, 5s, 30s, 1m, 5m (seconds or minutes)
 *      or 10%, 20% (percentage of total session time)
 *      or 'session' (all remaining time)
 * Channel: left, right, both, off, none (none maps to both for UX when stopped)
 * Repeat: cycle (repeat forever), stretch (fit to session time)
 * 
 * === COMMENTS ===
 * 
 * # This is a comment - the computer ignores it
 * # Use comments to explain what your script does!
 * 
 * === ESCAPING ===
 * 
 * If you need a semicolon in a comment: \;
 * (Normally semicolons separate commands on the same line)
 * 
 * === STRETCH MODE ===
 * 
 * When you use 'repeat(stretch)', the script calculates how long one loop takes,
 * then figures out how many loops fit in your session time. All the waits and fades
 * inside get stretched or squished proportionally.
 * 
 * Example: If your loop has "wait(10s)" and you have a 5-minute session,
 * and the whole loop needs to run 5 times, each wait becomes 60 seconds
 * (because 5min = 300s ÷ 5 loops = 60s per loop, and 10s was 1/6 of the original loop).
 */

class ScriptValidator {
  constructor() {
    this.commonTypos = {
      'mod': 'mode',
      'wait': 'wait',
      'wai': 'wait',
      'fad': 'fade',
      'repat': 'repeat',
      'repea': 'repeat',
      'suges': 'suggested_intensity',
      'suggest': 'suggested_intensity',
      'intensity': 'suggested_intensity',
      'left': 'left',
      'right': 'right',
      'both': 'both',
      'off': 'off',
      'none': 'none',
      'cycle': 'cycle',
      'strech': 'stretch',
      'session': 'session',
      'version': 'ver',
      'v': 'ver'
    };
  }

  validate(scriptText) {
    const errors = [];
    const warnings = [];
    const lines = this._splitLines(scriptText);
    let inRepeat = false;
    let hasEnd = false;
    let currentMode = null;
    let lineNum = 0;

    for (const line of lines) {
      lineNum++;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Check for mode header
      if (trimmed.startsWith('[') && trimmed.includes(']')) {
        currentMode = trimmed.match(/\[(.*?)\]/)?.[1];
        if (!currentMode.trim()) {
          errors.push({ line: lineNum, message: 'Mode name cannot be empty', code: 'EMPTY_MODE_NAME' });
        }
        continue;
      }

      // Skip if no mode defined yet
      if (!currentMode && !trimmed.startsWith('[')) {
        warnings.push({ line: lineNum, message: `Command "${trimmed.substring(0, 20)}..." outside of [Mode] section will be ignored`, code: 'ORPHAN_COMMAND' });
        continue;
      }

      // Parse commands (handle semicolons)
      const commands = this._splitCommands(trimmed);
      
      for (const cmd of commands) {
        const cmdName = cmd.match(/^([a-z_]+)/i)?.[1]?.toLowerCase();
        
        if (!cmdName) {
          errors.push({ line: lineNum, message: `Cannot understand command: "${cmd.substring(0, 30)}..."`, code: 'UNKNOWN_COMMAND' });
          continue;
        }

        // Check for typos
        const suggestion = this._suggestFix(cmdName);
        if (suggestion && suggestion !== cmdName) {
          warnings.push({ 
            line: lineNum, 
            message: `Did you mean "${suggestion}" instead of "${cmdName}"?`, 
            code: 'POSSIBLE_TYPO',
            suggestion 
          });
        }

        // Validate specific commands
        const validation = this._validateCommand(cmdName, cmd, lineNum);
        errors.push(...validation.errors);
        warnings.push(...validation.warnings);

        // Track repeat/end pairing
        if (cmdName === 'repeat') inRepeat = true;
        if (cmdName === 'end') {
          if (!inRepeat) {
            errors.push({ line: lineNum, message: 'Found "end" without matching "repeat"', code: 'UNMATCHED_END' });
          }
          inRepeat = false;
          hasEnd = true;
        }
      }
    }

    if (inRepeat && !hasEnd) {
      errors.push({ line: lineNum, message: 'Missing "end" to close "repeat" block', code: 'MISSING_END' });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      modeCount: this._countModes(lines)
    };
  }

  _splitLines(text) {
    return text.split(/\r?\n/);
  }

  _splitCommands(line) {
    // Split by semicolons, but not escaped ones
    const commands = [];
    let current = '';
    let escaped = false;
    
    for (const char of line) {
      if (escaped) {
        current += char;
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === ';') {
        if (current.trim()) commands.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current.trim()) commands.push(current.trim());
    return commands;
  }

  _suggestFix(word) {
    // Direct match in typo map
    if (this.commonTypos[word]) return this.commonTypos[word];
    
    // Levenshtein distance for close matches
    const knownWords = Object.keys(this.commonTypos);
    let bestMatch = null;
    let bestScore = Infinity;
    
    for (const known of knownWords) {
      const dist = this._levenshtein(word, known);
      if (dist < bestScore && dist <= 2) { // Within 2 edits
        bestScore = dist;
        bestMatch = this.commonTypos[known];
      }
    }
    
    return bestMatch;
  }

  _levenshtein(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = a[j - 1] === b[i - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    
    return matrix[b.length][a.length];
  }

  _validateCommand(name, fullCmd, lineNum) {
    const errors = [];
    const warnings = [];

    switch (name) {
      case 'mode':
        const modeMatch = fullCmd.match(/mode\s*\(\s*([^,)]+)\s*(?:,\s*([^)]+))?\s*\)/i);
        if (!modeMatch) {
          errors.push({ line: lineNum, message: 'mode() needs intensity and optional channel. Example: mode(5, both) or mode(100%)', code: 'BAD_MODE_SYNTAX' });
        } else {
          const intensity = modeMatch[1]?.trim();
          const channel = modeMatch[2]?.trim();
          
          if (!this._isValidIntensity(intensity)) {
            errors.push({ line: lineNum, message: `Invalid intensity: "${intensity}". Use 1-9 or 11%-100%`, code: 'INVALID_INTENSITY' });
          }
          const validChannels = ['left', 'right', 'both', 'off', 'none'];
          if (channel && !validChannels.includes(channel.toLowerCase())) {
            warnings.push({ line: lineNum, message: `Unknown channel: "${channel}". Valid: left, right, both, off, none. Defaulting to both.`, code: 'UNKNOWN_CHANNEL' });
          }
        }
        break;

      case 'wait':
        const waitMatch = fullCmd.match(/wait\s*\(\s*([^)]+)\s*\)/i);
        if (!waitMatch) {
          errors.push({ line: lineNum, message: 'wait() needs a time. Example: wait(30s) or wait(10%) or wait(session)', code: 'BAD_WAIT_SYNTAX' });
        } else if (!this._isValidTime(waitMatch[1]?.trim())) {
          errors.push({ line: lineNum, message: `Invalid time: "${waitMatch[1]}". Use: 1s, 30s, 1m, 5m, 10%, 20%, or "session"`, code: 'INVALID_TIME' });
        }
        break;

      case 'fade':
        const fadeMatch = fullCmd.match(/fade\s*\(\s*([^,)]+)\s*,\s*([^)]+)\s*\)/i);
        if (!fadeMatch) {
          errors.push({ line: lineNum, message: 'fade() needs target intensity and duration. Example: fade(50%, 20s) or fade(5, 10%)', code: 'BAD_FADE_SYNTAX' });
        } else {
          if (!this._isValidIntensity(fadeMatch[1]?.trim())) {
            errors.push({ line: lineNum, message: `Invalid fade target: "${fadeMatch[1]}". Use 1-9 or 0%-100%`, code: 'INVALID_FADE_TARGET' });
          }
          if (!this._isValidTime(fadeMatch[2]?.trim())) {
            errors.push({ line: lineNum, message: `Invalid fade duration: "${fadeMatch[2]}". Use: 5s, 10s, 1m, or 10%`, code: 'INVALID_FADE_TIME' });
          }
        }
        break;

      case 'repeat':
        const repeatMatch = fullCmd.match(/repeat\s*\(\s*(cycle|stretch)\s*\)/i);
        if (!repeatMatch) {
          errors.push({ line: lineNum, message: 'repeat() needs "cycle" (forever) or "stretch" (fit to session). Example: repeat(cycle)', code: 'BAD_REPEAT_SYNTAX' });
        }
        break;

      case 'suggested_intensity':
        const suggMatch = fullCmd.match(/suggested_intensity\s*\(\s*(\d+)\s*\)/i);
        if (!suggMatch || suggMatch[1] < 1 || suggMatch[1] > 9) {
          errors.push({ line: lineNum, message: 'suggested_intensity() needs 1-9. Example: suggested_intensity(5)', code: 'BAD_SUGGESTION' });
        }
        break;

      case 'ver':
        const verMatch = fullCmd.match(/ver\s*\(\s*(\d+)\s*\)/i);
        if (!verMatch) {
          errors.push({ line: lineNum, message: 'ver() needs a version number. Example: ver(1)', code: 'BAD_VERSION_SYNTAX' });
        } else {
          const version = parseInt(verMatch[1]);
          if (version !== 1) {
            warnings.push({ line: lineNum, message: `Version ${version} not recognized. Current protocol is ver(1).`, code: 'UNKNOWN_VERSION' });
          }
        }
        break;

      case 'end':
        // end takes no arguments
        if (fullCmd.match(/end\s*\([^)]*\)/)) {
          warnings.push({ line: lineNum, message: 'end should not have parentheses', code: 'END_WITH_PARENS' });
        }
        break;

      case 'ver':
        // Already handled above
        break;

      default:
        warnings.push({ line: lineNum, message: `Unknown command: "${name}". Did you mean one of: mode, wait, fade, repeat, end, suggested_intensity, ver?`, code: 'UNKNOWN_COMMAND' });
    }

    return { errors, warnings };
  }

  _isValidIntensity(val) {
    if (!val) return false;
    const lower = val.toLowerCase();
    if (lower.endsWith('%')) {
      const num = parseInt(lower);
      return num >= 0 && num <= 100;
    }
    const num = parseInt(lower);
    return num >= 0 && num <= 9;
  }

  _isValidTime(val) {
    if (!val) return false;
    const lower = val.toLowerCase();
    if (lower === 'session') return true;
    if (lower.endsWith('%')) {
      const num = parseInt(lower);
      return num > 0 && num <= 100;
    }
    if (lower.endsWith('s') || lower.endsWith('m')) {
      const num = parseInt(lower);
      return num > 0;
    }
    return false;
  }

  _countModes(lines) {
    return lines.filter(l => l.trim().startsWith('[') && l.includes(']')).length;
  }
}

class ScriptEngine {
  constructor() {
    this.validator = new ScriptValidator();
    this.scripts = new Map();
  }

  /**
   * Parse a multiline script string into executable instructions
   */
  parse(scriptText) {
    const validation = this.validator.validate(scriptText);
    if (!validation.valid) {
      throw new ScriptParseError('Script validation failed', validation.errors, validation.warnings);
    }

    const modes = [];
    const lines = this._splitLines(scriptText);
    let currentMode = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Mode header
      if (trimmed.startsWith('[')) {
        const match = trimmed.match(/\[([^\]]+)\]/);
        if (match) {
          if (currentMode) modes.push(currentMode);
          currentMode = {
            name: match[1].trim(),
            suggestedIntensity: null,
            instructions: []
          };
        }
        continue;
      }

      if (!currentMode) continue;

      // Parse commands
      const commands = this._splitCommands(trimmed);
      for (const cmd of commands) {
        const parsed = this._parseCommand(cmd);
        if (parsed) currentMode.instructions.push(parsed);
      }
    }

    if (currentMode) modes.push(currentMode);
    return modes;
  }

  _splitLines(text) {
    return text.split(/\r?\n/);
  }

  _splitCommands(line) {
    const commands = [];
    let current = '';
    let escaped = false;
    
    for (const char of line) {
      if (escaped) {
        current += char;
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === ';') {
        if (current.trim()) commands.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current.trim()) commands.push(current.trim());
    return commands;
  }

  _parseCommand(cmd) {
    const match = cmd.match(/^([a-z_]+)\s*\(\s*([^)]*)\s*\)/i);
    if (!match) {
      if (cmd.trim().toLowerCase() === 'end') {
        return { type: 'end' };
      }
      return null;
    }

    const name = match[1].toLowerCase();
    const args = match[2].split(',').map(a => a.trim()).filter(a => a);

    switch (name) {
      case 'mode':
        // mode(intensity, channel) - channel defaults to 'both', 'none' also maps to 'both'
        const channelArg = args[1]?.toLowerCase();
        const effectiveChannel = channelArg === 'none' ? 'both' : (channelArg || 'both');
        return {
          type: 'mode',
          intensity: this._parseIntensity(args[0]),
          channel: this._parseChannel(effectiveChannel)
        };

      case 'wait':
        return {
          type: 'wait',
          time: this._parseTime(args[0])
        };

      case 'fade':
        return {
          type: 'fade',
          toIntensity: this._parseIntensity(args[0]),
          duration: this._parseTime(args[1])
        };

      case 'repeat':
        return {
          type: 'repeat',
          mode: args[0]?.toLowerCase() || 'cycle'
        };

      case 'suggested_intensity':
        return {
          type: 'suggested_intensity',
          value: parseInt(args[0]) || 5
        };

      case 'ver':
        return {
          type: 'ver',
          version: parseInt(args[0]) || 1
        };

      default:
        return null;
    }
  }

  _parseIntensity(val) {
    if (!val) return { type: 'absolute', value: 100 };
    const lower = val.toLowerCase();
    if (lower.endsWith('%')) {
      return { type: 'relative', percent: parseInt(lower) };
    }
    return { type: 'absolute', value: parseInt(lower) };
  }

  _parseChannel(val) {
    const lower = val.toLowerCase();
    // 'none' maps to 'both' (D\n) for UX consistency when stopped
    const map = { left: 'A\n', right: 'C\n', both: 'D\n', off: 'off', none: 'D\n' };
    return map[lower] || 'D\n';
  }

  _parseTime(val) {
    if (!val) return { type: 'absolute', seconds: 0 };
    const lower = val.toLowerCase();
    
    if (lower === 'session') {
      return { type: 'session' };
    }
    if (lower.endsWith('%')) {
      return { type: 'percent', percent: parseInt(lower) };
    }
    if (lower.endsWith('m')) {
      return { type: 'absolute', seconds: parseInt(lower) * 60 };
    }
    if (lower.endsWith('s')) {
      return { type: 'absolute', seconds: parseInt(lower) };
    }
    return { type: 'absolute', seconds: parseInt(lower) || 0 };
  }

  /**
   * Execute a script for a given elapsed time
   * Returns the state at that moment (intensity, channel, commands to send)
   */
  execute(mode, elapsedSeconds, totalDuration, baseIntensity) {
    const state = {
      intensity: baseIntensity,
      channel: 'D\n',
      isActive: false,
      statusText: mode.name,
      commands: [],
      timeUntilNextPhase: null,
      phaseDescription: ''
    };

    // Pre-calculate loop durations for stretch mode
    const loopInfo = this._analyzeLoops(mode.instructions, totalDuration);
    
    // Find current position in script
    const position = this._findPosition(
      mode.instructions, 
      elapsedSeconds, 
      totalDuration, 
      baseIntensity,
      loopInfo
    );

    // Build state
    state.intensity = position.intensity;
    state.channel = position.channel;
    state.isActive = position.intensity > 0 && position.channel !== 'off';
    state.timeUntilNextPhase = position.timeUntilNextPhase;
    state.phaseDescription = position.phaseDescription;

    // Generate commands if needed
    // Note: mode(0%, off) and mode(0, off) both infer STOP - UX shows "Both" as channel when stopped
    if (position.sendCommands) {
      if (state.intensity > 0 && state.channel !== 'off') {
        // Active stimulation: send intensity then channel (order matters)
        state.commands.push(PulsettoProtocol.Commands.intensity(Math.round(state.intensity)));
        state.commands.push(state.channel);
      } else {
        // Stopped/off: single stop command, channel shown as "both" in UI
        state.commands.push(PulsettoProtocol.Commands.stop);
      }
    }

    // Build status text
    const channelName = this._channelToName(state.channel);
    state.statusText = `${mode.name} · ${channelName}`;
    if (position.isFading) {
      state.statusText += ` · Fading to ${Math.round(position.targetIntensity)}%`;
    }

    return state;
  }

  _analyzeLoops(instructions, totalDuration) {
    // Find repeat sections and calculate their natural duration
    const loops = [];
    let currentLoop = null;
    let i = 0;

    while (i < instructions.length) {
      const inst = instructions[i];
      
      if (inst.type === 'repeat') {
        currentLoop = {
          start: i,
          mode: inst.mode,
          instructions: [],
          naturalDuration: 0
        };
      } else if (inst.type === 'end' && currentLoop) {
        currentLoop.end = i;
        
        // Calculate natural duration of this loop
        for (const li of currentLoop.instructions) {
          if (li.type === 'wait' && li.time.type === 'absolute') {
            currentLoop.naturalDuration += li.time.seconds;
          } else if (li.type === 'fade' && li.duration.type === 'absolute') {
            currentLoop.naturalDuration += li.duration.seconds;
          }
        }
        
        // For stretch mode, calculate iterations and stretch factor
        if (currentLoop.mode === 'stretch' && currentLoop.naturalDuration > 0) {
          currentLoop.iterations = Math.floor(totalDuration / currentLoop.naturalDuration) || 1;
          currentLoop.stretchFactor = totalDuration / (currentLoop.iterations * currentLoop.naturalDuration);
        }
        
        loops.push(currentLoop);
        currentLoop = null;
      } else if (currentLoop) {
        currentLoop.instructions.push(inst);
      }
      
      i++;
    }

    return loops;
  }

  _findPosition(instructions, elapsed, totalDuration, baseIntensity, loopInfo) {
    let currentTime = 0;
    let intensity = baseIntensity;
    let channel = 'D\n';
    let i = 0;
    let inLoop = null;
    let loopIterations = 0;
    let position = {
      intensity,
      channel,
      timeUntilNextPhase: totalDuration - elapsed,
      sendCommands: false,
      phaseDescription: '',
      isFading: false,
      targetIntensity: intensity
    };

    while (i < instructions.length && currentTime < elapsed) {
      const inst = instructions[i];

      switch (inst.type) {
        case 'suggested_intensity':
          // This is metadata, doesn't affect execution
          break;

        case 'repeat':
          inLoop = loopInfo.find(l => l.start === i);
          loopIterations = 0;
          break;

        case 'end':
          if (inLoop) {
            // Check if we should continue looping
            if (inLoop.mode === 'cycle') {
              // For cycle, reset to loop start
              i = inLoop.start;
              loopIterations++;
              continue;
            } else if (inLoop.mode === 'stretch' && loopIterations < inLoop.iterations - 1) {
              // For stretch, continue until we've done enough iterations
              i = inLoop.start;
              loopIterations++;
              continue;
            }
            inLoop = null;
          }
          break;

        case 'mode':
          intensity = this._calculateIntensity(inst.intensity, baseIntensity);
          channel = inst.channel;
          position.sendCommands = true;
          position.phaseDescription = `Mode: ${Math.round(intensity)}% ${this._channelToName(channel)}`;
          break;

        case 'wait':
          const waitTime = this._resolveTime(inst.time, totalDuration, inLoop);
          if (currentTime + waitTime > elapsed) {
            // We're inside this wait
            position.timeUntilNextPhase = (currentTime + waitTime) - elapsed;
            return position;
          }
          currentTime += waitTime;
          break;

        case 'fade':
          const fadeDuration = this._resolveTime(inst.duration, totalDuration, inLoop);
          const targetIntensity = this._calculateIntensity(inst.toIntensity, baseIntensity);
          
          if (currentTime + fadeDuration > elapsed) {
            // We're inside this fade - interpolate
            const fadeProgress = (elapsed - currentTime) / fadeDuration;
            intensity = intensity + (targetIntensity - intensity) * fadeProgress;
            position.isFading = true;
            position.targetIntensity = targetIntensity;
            position.timeUntilNextPhase = (currentTime + fadeDuration) - elapsed;
            return position;
          }
          
          intensity = targetIntensity;
          currentTime += fadeDuration;
          position.sendCommands = true;
          break;
      }

      i++;
    }

    position.intensity = intensity;
    position.channel = channel;
    return position;
  }

  _resolveTime(timeSpec, totalDuration, loopInfo) {
    if (timeSpec.type === 'session') {
      return totalDuration;
    }
    if (timeSpec.type === 'percent') {
      return totalDuration * (timeSpec.percent / 100);
    }
    if (loopInfo && loopInfo.mode === 'stretch' && timeSpec.type === 'absolute') {
      return timeSpec.seconds * loopInfo.stretchFactor;
    }
    return timeSpec.seconds || 0;
  }

  _calculateIntensity(spec, baseIntensity) {
    if (spec.type === 'relative') {
      const calculated = baseIntensity * (spec.percent / 100);
      return Math.max(1, Math.min(9, calculated));
    }
    return Math.max(0, Math.min(9, spec.value));
  }

  _channelToName(channel) {
    const map = { 'A\n': 'Left', 'C\n': 'Right', 'D\n': 'Both', 'off': 'Off' };
    return map[channel] || 'Unknown';
  }
}

class ScriptParseError extends Error {
  constructor(message, errors, warnings) {
    super(message);
    this.errors = errors;
    this.warnings = warnings;
  }
}

// Storage manager for user scripts
class ScriptStorage {
  constructor() {
    this.STORAGE_KEY = 'pulsetto_custom_scripts';
    this.USER_INTENSITY_KEY = 'pulsetto_user_default_intensity';
  }

  getDefaultIntensity() {
    const stored = localStorage.getItem(this.USER_INTENSITY_KEY);
    const value = parseInt(stored);
    return (value >= 1 && value <= 9) ? value : 8;
  }

  setDefaultIntensity(intensity) {
    if (intensity >= 1 && intensity <= 9) {
      localStorage.setItem(this.USER_INTENSITY_KEY, intensity.toString());
    }
  }

  getScripts() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (e) {
      console.error('Failed to load scripts:', e);
      return null;
    }
  }

  saveScripts(scriptText) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(scriptText));
      return true;
    } catch (e) {
      console.error('Failed to save scripts:', e);
      return false;
    }
  }

  exportToFile() {
    const scripts = this.getScripts();
    if (!scripts) return null;
    
    const blob = new Blob([scripts], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pulsetto-scripts.txt';
    a.click();
    URL.revokeObjectURL(url);
    return true;
  }

  async importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  }

  resetToDefaults(defaultScripts) {
    this.saveScripts(defaultScripts);
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.ScriptEngine = ScriptEngine;
  window.ScriptValidator = ScriptValidator;
  window.ScriptStorage = ScriptStorage;
  window.ScriptParseError = ScriptParseError;
}
