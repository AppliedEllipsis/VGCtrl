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
      PulsettoProtocol.Commands.activateBilateral,
      PulsettoProtocol.Commands.intensity(baseStrength)
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

// Sleep - 5-phase rotation (D→A→D→C→D)
class SleepEngine extends ModeEngine {
  constructor() {
    super();
    this.phases = ['D', 'A', 'D', 'C', 'D'];
  }

  start(baseStrength, totalDuration) {
    super.start(baseStrength, totalDuration);
    const phaseIndex = 0;
    const strength = Math.max(1, Math.floor(baseStrength * 0.8)); // 80% intensity
    return this._phaseCommands(phaseIndex, strength);
  }

  tick(elapsed, totalDuration, baseStrength) {
    const strength = Math.max(1, Math.floor(baseStrength * 0.8));
    const phaseDuration = totalDuration / this.phases.length;
    const phaseIndex = Math.min(Math.floor(elapsed / phaseDuration), this.phases.length - 1);
    
    return new ModeTickResult({
      commands: this._phaseCommands(phaseIndex, strength),
      isStimulationActive: true,
      effectiveStrength: strength,
      activeChannel: ActiveChannel.BILATERAL,
      statusText: `Sleep · Phase ${phaseIndex + 1}/${this.phases.length}`
    });
  }

  _phaseCommands(phaseIndex, strength) {
    const phase = this.phases[phaseIndex];
    let command;
    switch(phase) {
      case 'A': command = PulsettoProtocol.Commands.activateLeft; break;
      case 'C': command = PulsettoProtocol.Commands.activateRight; break;
      default: command = PulsettoProtocol.Commands.activateBilateral;
    }
    return [command, PulsettoProtocol.Commands.intensity(strength)];
  }

  reconnectCommands(elapsed, totalDuration, baseStrength) {
    const strength = Math.max(1, Math.floor(baseStrength * 0.8));
    const phaseDuration = totalDuration / this.phases.length;
    const phaseIndex = Math.min(Math.floor(elapsed / phaseDuration), this.phases.length - 1);
    return this._phaseCommands(phaseIndex, strength);
  }
}

// Focus - 30s on/off duty cycling, left channel only
class FocusEngine extends ModeEngine {
  start(baseStrength, totalDuration) {
    super.start(baseStrength, totalDuration);
    return [
      PulsettoProtocol.Commands.activateLeft,
      PulsettoProtocol.Commands.intensity(baseStrength)
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
        PulsettoProtocol.Commands.activateLeft,
        PulsettoProtocol.Commands.intensity(baseStrength)
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
      PulsettoProtocol.Commands.activateBilateral,
      PulsettoProtocol.Commands.intensity(baseStrength)
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
      PulsettoProtocol.Commands.activateBilateral,
      PulsettoProtocol.Commands.intensity(baseStrength)
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
        PulsettoProtocol.Commands.activateBilateral,
        PulsettoProtocol.Commands.intensity(baseStrength)
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
      PulsettoProtocol.Commands.activateBilateral,
      PulsettoProtocol.Commands.intensity(baseStrength)
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
        PulsettoProtocol.Commands.activateBilateral,
        PulsettoProtocol.Commands.intensity(baseStrength)
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
        PulsettoProtocol.Commands.activateBilateral,
        PulsettoProtocol.Commands.intensity(baseStrength)
      ];
    }
    return [PulsettoProtocol.Commands.stop];
  }
}

// Mode Engine Factory
const ModeEngineFactory = {
  create(mode) {
    switch (mode) {
      case 'stress': return new StressReliefEngine();
      case 'sleep': return new SleepEngine();
      case 'focus': return new FocusEngine();
      case 'pain': return new PainReliefEngine();
      case 'calm': return new CalmEngine();
      case 'headache': return new HeadacheEngine();
      case 'nausea': return new NauseaEngine();
      case 'meditation': return new MeditationEngine();
      default: return new StressReliefEngine();
    }
  }
};

// Make available globally
if (typeof window !== 'undefined') {
  window.ModeEngine = ModeEngine;
  window.StressReliefEngine = StressReliefEngine;
  window.SleepEngine = SleepEngine;
  window.FocusEngine = FocusEngine;
  window.PainReliefEngine = PainReliefEngine;
  window.CalmEngine = CalmEngine;
  window.HeadacheEngine = HeadacheEngine;
  window.NauseaEngine = NauseaEngine;
  window.MeditationEngine = MeditationEngine;
  window.ModeEngineFactory = ModeEngineFactory;
  window.ActiveChannel = ActiveChannel;
  window.BreathingPhase = BreathingPhase;
  window.ModeTickResult = ModeTickResult;
}
