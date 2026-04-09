/**
 * Timeline Script Engine
 *
 * Parses session duration into timestamp-based script instructions.
 * Each instruction defines: channel, intensity, duration, optional fade
 *
 * The timeline visualizes these and notifies the app when the active instruction changes.
 * No commands are sent automatically - purely informational/visual.
 */

class TimelineScript {
  constructor(mode, totalDuration, baseStrength) {
    this.mode = mode;
    this.totalDuration = totalDuration;
    this.baseStrength = baseStrength;
    this.instructions = this._generateInstructions();
  }

  /**
   * Generate script instructions based on mode
   */
  _generateInstructions() {
    switch (this.mode) {
      case 'sleep':
        return this._generateSleepScript();
      case 'focus':
        return this._generateFocusScript();
      case 'focus_r':
        return this._generateFocusRightScript();
      case 'focus_both':
        return this._generateFocusBothScript();
      case 'focus_alt':
        return this._generateFocusAltScript();
      case 'calm':
        return this._generateCalmScript();
      case 'meditation':
        return this._generateMeditationScript();
      case 'headache':
        return this._generateHeadacheScript();
      case 'pain':
        return this._generatePainScript();
      case 'stress':
      case 'nausea':
        return this._generateContinuousScript(this.mode);
      default:
        return this._generateContinuousScript('stress');
    }
  }

  /**
   * Sleep mode: 5 phases (bilateral, left, bilateral, right, bilateral)
   * Last phase has fade to intensity 1
   */
  _generateSleepScript() {
    const phaseDuration = this.totalDuration / 5;
    const instructions = [];

    const phases = [
      { channel: 'bilateral', label: 'Both' },
      { channel: 'left', label: 'Left' },
      { channel: 'bilateral', label: 'Both' },
      { channel: 'right', label: 'Right' },
      { channel: 'bilateral', label: 'Both (fade)', fade: true }
    ];

    phases.forEach((phase, i) => {
      const start = i * phaseDuration;
      const end = Math.min((i + 1) * phaseDuration, this.totalDuration);

      instructions.push({
        start,
        end,
        channel: phase.channel,
        intensity: phase.fade ? undefined : this.baseStrength,
        startIntensity: phase.fade ? this.baseStrength : undefined,
        endIntensity: phase.fade ? 1 : undefined,
        label: phase.label,
        type: phase.fade ? 'fade' : 'active'
      });
    });

    return instructions;
  }

  /**
   * Focus mode: 30s ON left / 30s OFF cycles
   */
  _generateFocusScript() {
    const cycleDuration = 60; // 30s on, 30s off
    const numCycles = Math.ceil(this.totalDuration / cycleDuration);
    const instructions = [];

    for (let i = 0; i < numCycles; i++) {
      const cycleStart = i * cycleDuration;
      const onEnd = Math.min(cycleStart + 30, this.totalDuration);
      const cycleEnd = Math.min(cycleStart + cycleDuration, this.totalDuration);

      if (onEnd > cycleStart) {
        instructions.push({
          start: cycleStart,
          end: onEnd,
          channel: 'left',
          intensity: this.baseStrength,
          label: 'ON',
          type: 'active'
        });
      }

      if (cycleEnd > onEnd) {
        instructions.push({
          start: onEnd,
          end: cycleEnd,
          channel: 'off',
          intensity: 0,
          label: 'REST',
          type: 'rest'
        });
      }
    }

    return instructions;
  }

  /**
   * Focus R mode: 30s ON right / 30s OFF cycles
   */
  _generateFocusRightScript() {
    const cycleDuration = 60; // 30s on, 30s off
    const numCycles = Math.ceil(this.totalDuration / cycleDuration);
    const instructions = [];

    for (let i = 0; i < numCycles; i++) {
      const cycleStart = i * cycleDuration;
      const onEnd = Math.min(cycleStart + 30, this.totalDuration);
      const cycleEnd = Math.min(cycleStart + cycleDuration, this.totalDuration);

      if (onEnd > cycleStart) {
        instructions.push({
          start: cycleStart,
          end: onEnd,
          channel: 'right',
          intensity: this.baseStrength,
          label: 'ON',
          type: 'active'
        });
      }

      if (cycleEnd > onEnd) {
        instructions.push({
          start: onEnd,
          end: cycleEnd,
          channel: 'off',
          intensity: 0,
          label: 'REST',
          type: 'rest'
        });
      }
    }

    return instructions;
  }

  /**
   * Focus Both mode: 30s ON bilateral / 30s OFF cycles
   */
  _generateFocusBothScript() {
    const cycleDuration = 60; // 30s on, 30s off
    const numCycles = Math.ceil(this.totalDuration / cycleDuration);
    const instructions = [];

    for (let i = 0; i < numCycles; i++) {
      const cycleStart = i * cycleDuration;
      const onEnd = Math.min(cycleStart + 30, this.totalDuration);
      const cycleEnd = Math.min(cycleStart + cycleDuration, this.totalDuration);

      if (onEnd > cycleStart) {
        instructions.push({
          start: cycleStart,
          end: onEnd,
          channel: 'bilateral',
          intensity: this.baseStrength,
          label: 'ON',
          type: 'active'
        });
      }

      if (cycleEnd > onEnd) {
        instructions.push({
          start: onEnd,
          end: cycleEnd,
          channel: 'off',
          intensity: 0,
          label: 'REST',
          type: 'rest'
        });
      }
    }

    return instructions;
  }

  /**
   * Focus Alt mode: Left (30s) → Rest (15s) → Right (30s) → Rest (15s) → repeat
   */
  _generateFocusAltScript() {
    const cycleDuration = 135; // 30s both + 15s pause + 30s left + 15s pause + 30s right + 15s pause
    const numCycles = Math.ceil(this.totalDuration / cycleDuration);
    const instructions = [];

    for (let i = 0; i < numCycles; i++) {
      const cycleStart = i * cycleDuration;
      const bothEnd = Math.min(cycleStart + 30, this.totalDuration);
      const pause1End = Math.min(cycleStart + 45, this.totalDuration);
      const leftEnd = Math.min(cycleStart + 75, this.totalDuration);
      const pause2End = Math.min(cycleStart + 90, this.totalDuration);
      const rightEnd = Math.min(cycleStart + 120, this.totalDuration);
      const cycleEnd = Math.min(cycleStart + cycleDuration, this.totalDuration);

      // Both phase (0-30s)
      if (bothEnd > cycleStart) {
        instructions.push({
          start: cycleStart,
          end: bothEnd,
          channel: 'bilateral',
          intensity: this.baseStrength,
          label: 'Both',
          type: 'active'
        });
      }

      // Pause after both (30-45s)
      if (pause1End > bothEnd) {
        instructions.push({
          start: bothEnd,
          end: pause1End,
          channel: 'off',
          intensity: 0,
          label: 'Pause',
          type: 'rest'
        });
      }

      // Left phase (45-75s)
      if (leftEnd > pause1End) {
        instructions.push({
          start: pause1End,
          end: leftEnd,
          channel: 'left',
          intensity: this.baseStrength,
          label: 'Left',
          type: 'active'
        });
      }

      // Pause after left (75-90s)
      if (pause2End > leftEnd) {
        instructions.push({
          start: leftEnd,
          end: pause2End,
          channel: 'off',
          intensity: 0,
          label: 'Pause',
          type: 'rest'
        });
      }

      // Right phase (90-120s)
      if (rightEnd > pause2End) {
        instructions.push({
          start: pause2End,
          end: rightEnd,
          channel: 'right',
          intensity: this.baseStrength,
          label: 'Right',
          type: 'active'
        });
      }

      // Pause after right (120-135s)
      if (cycleEnd > rightEnd) {
        instructions.push({
          start: rightEnd,
          end: cycleEnd,
          channel: 'off',
          intensity: 0,
          label: 'Pause',
          type: 'rest'
        });
      }
    }

    return instructions;
  }

  /**
   * Calm mode: Respiratory-gated breathing cycles
   * 5s inhale, 5s hold, 7s exhale = 17s breath cycle
   * Stimulation during inhale+hold
   */
  _generateCalmScript() {
    const breathCycle = 17; // 5+5+7
    const numCycles = Math.ceil(this.totalDuration / breathCycle);
    const instructions = [];

    for (let i = 0; i < numCycles; i++) {
      const cycleStart = i * breathCycle;
      const inhaleEnd = Math.min(cycleStart + 5, this.totalDuration);
      const holdEnd = Math.min(cycleStart + 10, this.totalDuration);
      const cycleEnd = Math.min(cycleStart + breathCycle, this.totalDuration);

      // Inhale - ramp up
      if (inhaleEnd > cycleStart) {
        instructions.push({
          start: cycleStart,
          end: inhaleEnd,
          channel: 'bilateral',
          startIntensity: 1,
          endIntensity: this.baseStrength,
          label: 'Inhale',
          type: 'fade'
        });
      }

      // Hold - steady
      if (holdEnd > inhaleEnd) {
        instructions.push({
          start: inhaleEnd,
          end: holdEnd,
          channel: 'bilateral',
          intensity: this.baseStrength,
          label: 'Hold',
          type: 'active'
        });
      }

      // Exhale - off
      if (cycleEnd > holdEnd) {
        instructions.push({
          start: holdEnd,
          end: cycleEnd,
          channel: 'off',
          intensity: 0,
          label: 'Exhale',
          type: 'rest'
        });
      }
    }

    return instructions;
  }

  /**
   * Meditation mode: Faster respiratory-gated cycles
   * 5s inhale, 4s hold, 5s exhale = 14s breath cycle
   */
  _generateMeditationScript() {
    const breathCycle = 14; // 5+4+5
    const numCycles = Math.ceil(this.totalDuration / breathCycle);
    const instructions = [];

    for (let i = 0; i < numCycles; i++) {
      const cycleStart = i * breathCycle;
      const inhaleEnd = Math.min(cycleStart + 5, this.totalDuration);
      const holdEnd = Math.min(cycleStart + 9, this.totalDuration);
      const cycleEnd = Math.min(cycleStart + breathCycle, this.totalDuration);

      // Inhale - ramp up
      if (inhaleEnd > cycleStart) {
        instructions.push({
          start: cycleStart,
          end: inhaleEnd,
          channel: 'bilateral',
          startIntensity: 1,
          endIntensity: this.baseStrength,
          label: 'Inhale',
          type: 'fade'
        });
      }

      // Hold - steady
      if (holdEnd > inhaleEnd) {
        instructions.push({
          start: inhaleEnd,
          end: holdEnd,
          channel: 'bilateral',
          intensity: this.baseStrength,
          label: 'Hold',
          type: 'active'
        });
      }

      // Exhale - off
      if (cycleEnd > holdEnd) {
        instructions.push({
          start: holdEnd,
          end: cycleEnd,
          channel: 'off',
          intensity: 0,
          label: 'Exhale',
          type: 'rest'
        });
      }
    }

    return instructions;
  }

  /**
   * Headache mode: 2min ON / 30s OFF burst cycles
   */
  _generateHeadacheScript() {
    const cycleDuration = 150; // 120s on, 30s off
    const numCycles = Math.ceil(this.totalDuration / cycleDuration);
    const instructions = [];

    for (let i = 0; i < numCycles; i++) {
      const cycleStart = i * cycleDuration;
      const onEnd = Math.min(cycleStart + 120, this.totalDuration);
      const cycleEnd = Math.min(cycleStart + cycleDuration, this.totalDuration);

      if (onEnd > cycleStart) {
        instructions.push({
          start: cycleStart,
          end: onEnd,
          channel: 'bilateral',
          intensity: this.baseStrength,
          label: 'Burst ON',
          type: 'active'
        });
      }

      if (cycleEnd > onEnd) {
        instructions.push({
          start: onEnd,
          end: cycleEnd,
          channel: 'off',
          intensity: 0,
          label: 'REST',
          type: 'rest'
        });
      }
    }

    return instructions;
  }

  /**
   * Pain mode: Continuous bilateral with sine wave oscillation
   * Visualized as continuous with wave indicator
   */
  _generatePainScript() {
    const wavePeriod = 20; // 20-second sine wave
    const numWaves = Math.ceil(this.totalDuration / wavePeriod);
    const instructions = [];

    for (let i = 0; i < numWaves; i++) {
      const start = i * wavePeriod;
      const end = Math.min(start + wavePeriod, this.totalDuration);

      instructions.push({
        start,
        end,
        channel: 'bilateral',
        intensity: this.baseStrength,
        variation: 1, // ±1 variation
        label: 'Wave',
        type: 'wave'
      });
    }

    return instructions;
  }

  /**
   * Stress relief / Nausea: Continuous bilateral
   */
  _generateContinuousScript(mode) {
    return [{
      start: 0,
      end: this.totalDuration,
      channel: 'bilateral',
      intensity: this.baseStrength,
      label: mode === 'nausea' ? 'Nausea Relief' : 'Stress Relief',
      type: 'active'
    }];
  }

  /**
   * Get current instruction at given elapsed time
   */
  getInstructionAt(elapsed) {
    for (const instruction of this.instructions) {
      if (elapsed >= instruction.start && elapsed < instruction.end) {
        return instruction;
      }
    }
    // At or past end, return last instruction
    return this.instructions[this.instructions.length - 1] || null;
  }

  /**
   * Get interpolated intensity for fade/wave instructions
   * For regular instructions, returns fixed intensity
   */
  getIntensityAt(elapsed) {
    const instruction = this.getInstructionAt(elapsed);
    if (!instruction) return 0;

    if (instruction.type === 'fade') {
      const progress = (elapsed - instruction.start) / (instruction.end - instruction.start);
      const startInt = instruction.startIntensity ?? this.baseStrength;
      const endInt = instruction.endIntensity ?? 1;
      return Math.round(startInt - (startInt - endInt) * progress);
    }

    if (instruction.type === 'wave' && instruction.variation) {
      // Sine wave variation around base intensity
      const progress = (elapsed - instruction.start) / (instruction.end - instruction.start);
      const sine = Math.sin(progress * Math.PI * 2);
      const variation = instruction.variation * sine;
      return Math.max(1, Math.min(9, Math.round(this.baseStrength + variation)));
    }

    return instruction.intensity;
  }

  /**
   * Get all instructions
   */
  getInstructions() {
    return this.instructions;
  }

  /**
   * Find next instruction change after given elapsed time
   */
  getNextChange(elapsed) {
    for (const instruction of this.instructions) {
      if (instruction.start > elapsed) {
        return instruction.start;
      }
      if (instruction.end > elapsed) {
        return instruction.end;
      }
    }
    return null;
  }
}

if (typeof window !== 'undefined') {
  window.TimelineScript = TimelineScript;
}
