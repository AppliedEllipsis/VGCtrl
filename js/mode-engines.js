/**
 * Pulsetto Mode Engines
 * 
 * Stimulation pattern generators for each mode.
 * All commands are returned as ASCII strings.
 * 
 * Based on: open-pulse/OpenPulse/Models/ModeEngine.swift
 *           pulse-libre/lib/domain/mode_engine.dart
 */

const ActiveChannel = {
  OFF: 'off',
  LEFT: 'left',
  RIGHT: 'right',
  BILATERAL: 'bilateral'
};

const BreathingPhase = {
  INHALE: 'inhale',
  HOLD: 'hold',
  EXHALE: 'exhale'
};

class ModeTickResult {
  constructor({
    commands = [],
    isStimulationActive = false,
    effectiveStrength = null,
    activeChannel = ActiveChannel.OFF,
    breathingPhase = null,
    breathingProgress = 0,
    statusText = ''
  }) {
    this.commands = commands;
    this.isStimulationActive = isStimulationActive;
    this.effectiveStrength = effectiveStrength;
    this.activeChannel = activeChannel;
    this.breathingPhase = breathingPhase;
    this.breathingProgress = breathingProgress;
    this.statusText = statusText;
  }
}

// Base Mode Engine
class ModeEngine {
  constructor() {
    this.isActive = false;
  }

  start(baseStrength, totalDuration) {
    this.isActive = true;
    return [];
  }

  tick(elapsed, totalDuration, baseStrength) {
    return new ModeTickResult({});
  }

  reconnectCommands(elapsed, totalDuration, baseStrength) {
    return [];
  }

  reset() {
    this.isActive = false;
  }
}

// Stress Relief - Bilateral continuous
class StressReliefEngine extends ModeEngine {
  start(baseStrength, totalDuration) {
    super.start(baseStrength, totalDuration);
    return [
      PulsettoProtocol.Commands.intensity(baseStrength),
      PulsettoProtocol.Commands.activateBilateral
    ];
  }

  tick(elapsed, totalDuration, baseStrength) {
    return new ModeTickResult({
      commands: [PulsettoProtocol.Commands.intensity(baseStrength)],
      isStimulationActive: true,
      effectiveStrength: baseStrength,
      activeChannel: ActiveChannel.BILATERAL,
      statusText: 'Bilateral · Continuous'
    });
  }

  reconnectCommands(elapsed, totalDuration, baseStrength) {
    return this.start(baseStrength, totalDuration);
  }
}

// Sleep - 5-phase rotation (D→A→D→C→D) with end-of-session fade
class SleepEngine extends ModeEngine {
  constructor() {
    super();
    this.phases = ['D', 'A', 'D', 'C', 'D'];
    this._lastPhaseIndex = -1;
    this._lastFadeStrength = -1;
  }

  start(baseStrength, totalDuration) {
    super.start(baseStrength, totalDuration);
    this._lastPhaseIndex = 0;
    this._lastFadeStrength = baseStrength;
    return this._phaseCommands(0, baseStrength);
  }

  tick(elapsed, totalDuration, baseStrength) {
    const phaseDuration = totalDuration / this.phases.length;
    const phaseIndex = Math.min(Math.floor(elapsed / phaseDuration), this.phases.length - 1);
    const fadeStrength = this._fadeStrength(elapsed, totalDuration, baseStrength);

    const commands = [];

    // Phase transition
    if (phaseIndex !== this._lastPhaseIndex) {
      commands.push(this._phaseCommand(phaseIndex));
      this._lastPhaseIndex = phaseIndex;
    }

    // Fade strength change
    if (fadeStrength !== this._lastFadeStrength) {
      commands.push(PulsettoProtocol.Commands.intensity(fadeStrength));
      this._lastFadeStrength = fadeStrength;
    }

    const fadeNote = fadeStrength < baseStrength ? ' · Fading' : '';

    return new ModeTickResult({
      commands,
      isStimulationActive: true,
      effectiveStrength: fadeStrength !== baseStrength ? fadeStrength : null,
      activeChannel: ActiveChannel.BILATERAL,
      statusText: `Sleep · Phase ${phaseIndex + 1}/${this.phases.length}${fadeNote}`
    });
  }

  _phaseCommand(phaseIndex) {
    const phase = this.phases[phaseIndex];
    switch(phase) {
      case 'A': return PulsettoProtocol.Commands.activateLeft;
      case 'C': return PulsettoProtocol.Commands.activateRight;
      default: return PulsettoProtocol.Commands.activateBilateral;
    }
  }

  _phaseCommands(phaseIndex, strength) {
    return [PulsettoProtocol.Commands.intensity(strength), this._phaseCommand(phaseIndex)];
  }

  // Fade: last 20% reduces strength by -1 then -2
  _fadeStrength(elapsed, totalDuration, baseStrength) {
    const fadeStart = Math.floor(totalDuration * 4 / 5);
    if (elapsed < fadeStart || totalDuration <= fadeStart) {
      return baseStrength;
    }

    const fadeLen = totalDuration - fadeStart;
    const fadeElapsed = elapsed - fadeStart;
    const fadeMid = Math.floor(fadeLen / 2);

    if (fadeElapsed < fadeMid) {
      return Math.max(1, baseStrength - 1);
    } else {
      return Math.max(1, baseStrength - 2);
    }
  }

  reconnectCommands(elapsed, totalDuration, baseStrength) {
    const phaseDuration = totalDuration / this.phases.length;
    const phaseIndex = Math.min(Math.floor(elapsed / phaseDuration), this.phases.length - 1);
    const fadeStrength = this._fadeStrength(elapsed, totalDuration, baseStrength);
    return this._phaseCommands(phaseIndex, fadeStrength);
  }

  reset() {
    super.reset();
    this._lastPhaseIndex = -1;
    this._lastFadeStrength = -1;
  }
}

// Focus - 30s on/off duty cycling, left channel only
class FocusEngine extends ModeEngine {
  start(baseStrength, totalDuration) {
    super.start(baseStrength, totalDuration);
    return [
      PulsettoProtocol.Commands.intensity(baseStrength),
      PulsettoProtocol.Commands.activateLeft
    ];
  }

  tick(elapsed, totalDuration, baseStrength) {
    const dutyCycle = 30; // 30 seconds on, 30 seconds off
    const isOnPhase = Math.floor(elapsed / dutyCycle) % 2 === 0;

    if (isOnPhase) {
      return new ModeTickResult({
        commands: [PulsettoProtocol.Commands.intensity(baseStrength)],
        isStimulationActive: true,
        effectiveStrength: baseStrength,
        activeChannel: ActiveChannel.LEFT,
        statusText: 'Focus · Active'
      });
    } else {
      return new ModeTickResult({
        commands: [PulsettoProtocol.Commands.stop],
        isStimulationActive: false,
        effectiveStrength: null,
        activeChannel: ActiveChannel.OFF,
        statusText: 'Focus · Rest'
      });
    }
  }

  reconnectCommands(elapsed, totalDuration, baseStrength) {
    const dutyCycle = 30;
    const isOnPhase = Math.floor(elapsed / dutyCycle) % 2 === 0;
    if (isOnPhase) {
      return [
        PulsettoProtocol.Commands.intensity(baseStrength),
        PulsettoProtocol.Commands.activateLeft
      ];
    }
    return [PulsettoProtocol.Commands.stop];
  }
}

// Focus Right - 30s on/off duty cycling, right channel only
class FocusRightEngine extends ModeEngine {
  start(baseStrength, totalDuration) {
    super.start(baseStrength, totalDuration);
    return [
      PulsettoProtocol.Commands.intensity(baseStrength),
      PulsettoProtocol.Commands.activateRight
    ];
  }

  tick(elapsed, totalDuration, baseStrength) {
    const dutyCycle = 30; // 30 seconds on, 30 seconds off
    const isOnPhase = Math.floor(elapsed / dutyCycle) % 2 === 0;

    if (isOnPhase) {
      return new ModeTickResult({
        commands: [PulsettoProtocol.Commands.intensity(baseStrength)],
        isStimulationActive: true,
        effectiveStrength: baseStrength,
        activeChannel: ActiveChannel.RIGHT,
        statusText: 'Focus R · Active'
      });
    } else {
      return new ModeTickResult({
        commands: [PulsettoProtocol.Commands.stop],
        isStimulationActive: false,
        effectiveStrength: null,
        activeChannel: ActiveChannel.OFF,
        statusText: 'Focus R · Rest'
      });
    }
  }

  reconnectCommands(elapsed, totalDuration, baseStrength) {
    const dutyCycle = 30;
    const isOnPhase = Math.floor(elapsed / dutyCycle) % 2 === 0;
    if (isOnPhase) {
      return [
        PulsettoProtocol.Commands.intensity(baseStrength),
        PulsettoProtocol.Commands.activateRight
      ];
    }
    return [PulsettoProtocol.Commands.stop];
  }
}

// Pain Relief - Sine wave intensity oscillation
class PainReliefEngine extends ModeEngine {
  start(baseStrength, totalDuration) {
    super.start(baseStrength, totalDuration);
    return [
      PulsettoProtocol.Commands.intensity(baseStrength),
      PulsettoProtocol.Commands.activateBilateral
    ];
  }

  tick(elapsed, totalDuration, baseStrength) {
    // Sine wave: ±1 oscillation around base strength
    const period = 20; // 20 second period
    const t = (elapsed % period) / period;
    const sine = Math.sin(t * 2 * Math.PI);
    const strength = Math.max(1, Math.min(9, Math.round(baseStrength + sine)));
    
    return new ModeTickResult({
      commands: [PulsettoProtocol.Commands.intensity(strength)],
      isStimulationActive: true,
      effectiveStrength: strength,
      activeChannel: ActiveChannel.BILATERAL,
      statusText: `Pain Relief · ${strength}/9`
    });
  }

  reconnectCommands(elapsed, totalDuration, baseStrength) {
    return this.start(baseStrength, totalDuration);
  }
}

// Headache - Burst cycling (2 min on, 30s off)
class HeadacheEngine extends ModeEngine {
  start(baseStrength, totalDuration) {
    super.start(baseStrength, totalDuration);
    return [
      PulsettoProtocol.Commands.intensity(baseStrength),
      PulsettoProtocol.Commands.activateBilateral
    ];
  }

  tick(elapsed, totalDuration, baseStrength) {
    const burstOn = 120; // 2 minutes
    const burstOff = 30; // 30 seconds
    const cycle = burstOn + burstOff;
    const inBurst = (elapsed % cycle) < burstOn;
    
    if (inBurst) {
      return new ModeTickResult({
        commands: [PulsettoProtocol.Commands.intensity(baseStrength)],
        isStimulationActive: true,
        effectiveStrength: baseStrength,
        activeChannel: ActiveChannel.BILATERAL,
        statusText: 'Headache · Burst'
      });
    } else {
      return new ModeTickResult({
        commands: [PulsettoProtocol.Commands.stop],
        isStimulationActive: false,
        effectiveStrength: null,
        activeChannel: ActiveChannel.OFF,
        statusText: 'Headache · Pause'
      });
    }
  }

  reconnectCommands(elapsed, totalDuration, baseStrength) {
    const burstOn = 120;
    const burstOff = 30;
    const cycle = burstOn + burstOff;
    const inBurst = (elapsed % cycle) < burstOn;
    
    if (inBurst) {
      return [
        PulsettoProtocol.Commands.intensity(baseStrength),
        PulsettoProtocol.Commands.activateBilateral
      ];
    }
    return [PulsettoProtocol.Commands.stop];
  }
}

// Nausea - Bilateral continuous
class NauseaEngine extends ModeEngine {
  start(baseStrength, totalDuration) {
    super.start(baseStrength, totalDuration);
    return [
      PulsettoProtocol.Commands.intensity(baseStrength),
      PulsettoProtocol.Commands.activateBilateral
    ];
  }

  tick(elapsed, totalDuration, baseStrength) {
    return new ModeTickResult({
      commands: [PulsettoProtocol.Commands.intensity(baseStrength)],
      isStimulationActive: true,
      effectiveStrength: baseStrength,
      activeChannel: ActiveChannel.BILATERAL,
      statusText: 'Nausea · Continuous'
    });
  }

  reconnectCommands(elapsed, totalDuration, baseStrength) {
    return this.start(baseStrength, totalDuration);
  }
}

// Respiratory-gated base engine (for Calm and Meditation)
class RespiratoryGatedEngine extends ModeEngine {
  constructor(inhaleTime, holdTime, exhaleTime, leadTime = 3) {
    super();
    this.inhaleTime = inhaleTime;
    this.holdTime = holdTime;
    this.exhaleTime = exhaleTime;
    this.leadTime = leadTime;
    this.cycleTime = inhaleTime + holdTime + exhaleTime;
    this.currentPhase = null;
  }

  _getPhase(elapsedInCycle) {
    if (elapsedInCycle < this.inhaleTime) {
      return { phase: BreathingPhase.INHALE, progress: elapsedInCycle / this.inhaleTime };
    } else if (elapsedInCycle < this.inhaleTime + this.holdTime) {
      return { phase: BreathingPhase.HOLD, progress: (elapsedInCycle - this.inhaleTime) / this.holdTime };
    } else {
      return { phase: BreathingPhase.EXHALE, progress: (elapsedInCycle - this.inhaleTime - this.holdTime) / this.exhaleTime };
    }
  }

  tick(elapsed, totalDuration, baseStrength) {
    const elapsedInCycle = elapsed % this.cycleTime;
    const phaseInfo = this._getPhase(elapsedInCycle);
    
    // Stimulation starts after lead time on inhale
    const isActive = phaseInfo.phase === BreathingPhase.INHALE && 
                     elapsedInCycle >= this.leadTime;
    
    const commands = [];
    if (isActive && this.currentPhase !== BreathingPhase.INHALE) {
      commands.push(PulsettoProtocol.Commands.activateBilateral);
      commands.push(PulsettoProtocol.Commands.intensity(baseStrength));
    } else if (!isActive && this.currentPhase === BreathingPhase.INHALE) {
      commands.push(PulsettoProtocol.Commands.stop);
    }
    
    this.currentPhase = phaseInfo.phase;
    
    return new ModeTickResult({
      commands,
      isStimulationActive: isActive,
      effectiveStrength: isActive ? baseStrength : null,
      activeChannel: isActive ? ActiveChannel.BILATERAL : ActiveChannel.OFF,
      breathingPhase: phaseInfo.phase,
      breathingProgress: phaseInfo.progress,
      statusText: this._getStatusText(phaseInfo.phase, isActive)
    });
  }

  _getStatusText(phase, isActive) {
    const phaseLabels = {
      [BreathingPhase.INHALE]: 'Inhale',
      [BreathingPhase.HOLD]: 'Hold',
      [BreathingPhase.EXHALE]: 'Exhale'
    };
    const status = isActive ? 'Active' : 'Pause';
    return `${phaseLabels[phase]} · ${status}`;
  }
}

// Calm - 5s inhale, 5s hold, 7s exhale (17s cycle)
class CalmEngine extends RespiratoryGatedEngine {
  constructor() {
    super(5, 5, 7, 3); // inhale, hold, exhale, lead
  }

  start(baseStrength, totalDuration) {
    super.start(baseStrength, totalDuration);
    return []; // No initial commands, waits for breathing
  }

  reconnectCommands(elapsed, totalDuration, baseStrength) {
    const elapsedInCycle = elapsed % this.cycleTime;
    const isActive = elapsedInCycle >= this.leadTime && elapsedInCycle < this.inhaleTime;
    
    if (isActive) {
      return [
        PulsettoProtocol.Commands.intensity(baseStrength),
        PulsettoProtocol.Commands.activateBilateral
      ];
    }
    return [PulsettoProtocol.Commands.stop];
  }
}

// Meditation - 5s inhale, 4s hold, 5s exhale (14s cycle)
class MeditationEngine extends RespiratoryGatedEngine {
  constructor() {
    super(5, 4, 5, 3); // inhale, hold, exhale, lead
  }

  start(baseStrength, totalDuration) {
    super.start(baseStrength, totalDuration);
    return []; // No initial commands, waits for breathing
  }

  reconnectCommands(elapsed, totalDuration, baseStrength) {
    const elapsedInCycle = elapsed % this.cycleTime;
    const isActive = elapsedInCycle >= this.leadTime && elapsedInCycle < this.inhaleTime;
    
    if (isActive) {
      return [
        PulsettoProtocol.Commands.intensity(baseStrength),
        PulsettoProtocol.Commands.activateBilateral
      ];
    }
    return [PulsettoProtocol.Commands.stop];
  }
}

// Mode descriptions for UI
const ModeDescriptions = {
  stress: {
    name: 'Stress Relief',
    summary: 'Continuous bilateral stimulation for general relaxation and stress reduction.',
    channel: 'Both ears',
    pattern: 'Continuous',
    timing: 'Full session duration'
  },
  sleep: {
    name: 'Sleep',
    summary: 'Rotating channels with gentle fade-out to ease you into sleep. Cycles through bilateral, left, bilateral, right, bilateral.',
    channel: 'Rotating (Both → Left → Both → Right → Both)',
    pattern: '5-phase rotation with fade',
    timing: 'Last 20%: -1 intensity, then -2'
  },
  focus: {
    name: 'Focus (left)',
    summary: 'Left-ear only stimulation with 30-second on/off cycles. Enhances concentration without overstimulation.',
    channel: 'Left ear only',
    pattern: '30s ON / 30s OFF duty cycle',
    timing: 'Repeats throughout session'
  },
  focus_r: {
    name: 'Focus (right)',
    summary: 'Right-ear only stimulation with 30-second on/off cycles. Alternate focus enhancement with right-side bias.',
    channel: 'Right ear only',
    pattern: '30s ON / 30s OFF duty cycle',
    timing: 'Repeats throughout session'
  },
  pain: {
    name: 'Pain Relief',
    summary: 'Bilateral stimulation with gentle intensity waves (±1) on a 20-second cycle. Based on clinical protocols.',
    channel: 'Both ears',
    pattern: 'Sine wave oscillation ±1',
    timing: '20-second wave period'
  },
  calm: {
    name: 'Calm',
    summary: 'Breathing-guided stimulation. Stimulation activates during late inhale and hold, pauses during exhale. Slow 3.5 breaths/min.',
    channel: 'Both ears',
    pattern: 'Respiratory-gated: inhale→ON, exhale→OFF',
    timing: '5s inhale, 5s hold, 7s exhale'
  },
  headache: {
    name: 'Headache',
    summary: 'High-intensity burst cycling: 2 minutes stimulation followed by 30-second rest. Based on gammaCore migraine protocol.',
    channel: 'Both ears',
    pattern: 'Burst: 2min ON / 30s OFF',
    timing: '2:30 cycle repeats'
  },
  nausea: {
    name: 'Nausea',
    summary: 'Continuous bilateral stimulation at moderate-high intensity. Based on gammaCore anti-nausea cervical protocol.',
    channel: 'Both ears',
    pattern: 'Continuous',
    timing: 'Recommended: 5 minute sessions'
  },
  meditation: {
    name: 'Meditation',
    summary: 'Breathing-guided stimulation with faster cycle. Activates during inhale hold, supporting meditative state.',
    channel: 'Both ears',
    pattern: 'Respiratory-gated: inhale→ON, exhale→OFF',
    timing: '5s inhale, 4s hold, 5s exhale'
  }
};

// Channel override helper - applies manual channel selection to commands
function applyChannelOverride(commands, overrideChannel) {
  if (!overrideChannel || overrideChannel === 'auto') return commands;

  // Map override to activation command
  let activationCmd;
  switch (overrideChannel) {
    case 'left': activationCmd = PulsettoProtocol.Commands.activateLeft; break;
    case 'right': activationCmd = PulsettoProtocol.Commands.activateRight; break;
    case 'bilateral': activationCmd = PulsettoProtocol.Commands.activateBilateral; break;
    default: return commands;
  }

  // Replace any activation commands (A, C, D) with the override
  return commands.map(cmd => {
    if (cmd === 'A\n' || cmd === 'C\n' || cmd === 'D\n') {
      return activationCmd;
    }
    return cmd;
  });
}

// Mode Engine Factory
const ModeEngineFactory = {
  create(mode) {
    switch (mode) {
      case 'stress': return new StressReliefEngine();
      case 'sleep': return new SleepEngine();
      case 'focus': return new FocusEngine();
      case 'focus_r': return new FocusRightEngine();
      case 'pain': return new PainReliefEngine();
      case 'calm': return new CalmEngine();
      case 'headache': return new HeadacheEngine();
      case 'nausea': return new NauseaEngine();
      case 'meditation': return new MeditationEngine();
      default: return new StressReliefEngine();
    }
  },

  getDescription(mode) {
    return ModeDescriptions[mode] || ModeDescriptions.stress;
  }
};

// Make available globally
if (typeof window !== 'undefined') {
  window.ModeEngine = ModeEngine;
  window.StressReliefEngine = StressReliefEngine;
  window.SleepEngine = SleepEngine;
  window.FocusEngine = FocusEngine;
  window.FocusRightEngine = FocusRightEngine;
  window.PainReliefEngine = PainReliefEngine;
  window.CalmEngine = CalmEngine;
  window.HeadacheEngine = HeadacheEngine;
  window.NauseaEngine = NauseaEngine;
  window.MeditationEngine = MeditationEngine;
  window.ModeEngineFactory = ModeEngineFactory;
  window.ModeDescriptions = ModeDescriptions;
  window.applyChannelOverride = applyChannelOverride;
  window.ActiveChannel = ActiveChannel;
  window.BreathingPhase = BreathingPhase;
  window.ModeTickResult = ModeTickResult;
}
