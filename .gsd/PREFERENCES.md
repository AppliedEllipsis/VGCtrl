# GSD Preferences

## Model Configuration

### Reasoning Mode
enabled: true

### Thinking Mode
enabled: true

## Execution Mode

### Parallel Processing
parallel: true
maxParallelTasks: 4

### Task Isolation
mode: worktree  # Options: worktree, branch, none

## Auto-Mode Configuration

### Dispatch Strategy
strategy: parallel-safe  # Options: sequential, parallel-safe, greedy

### Quality Gates
enabled: true
gates:
  - Q3  # Contract verification
  - Q4  # Implementation quality
  - Q5  # Test coverage
  - Q6  # Observability
  - Q7  # Documentation
  - Q8  # Security

### Checkpoint Behavior
autoCheckpoint: true
checkpointInterval: 10  # minutes

## UI Configuration

### Verbosity
level: concise  # Options: minimal, concise, verbose

### Output Format
showToolCalls: true
showProgressIndicators: true

## Memory System

### Persistence
autoSaveDecisions: true
autoSaveRequirements: true

### Cache Strategy
parseCache: true
stateCache: true
