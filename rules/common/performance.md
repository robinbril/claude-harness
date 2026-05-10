# Performance Optimization

## Model Selection Strategy

See [agents.md](./agents.md) for the default model rule. General guidance:

- **Haiku 4.5**: Lightweight/worker agents, frequent invocation (3x cost savings)
- **Sonnet 4.6**: Main development, orchestration, complex coding (default)
- **Opus 4.6**: Complex architectural decisions, deep reasoning, research

## Context Window Management

Avoid last 20% of context window for:
- Large-scale refactoring
- Feature implementation spanning multiple files
- Debugging complex interactions

Lower context sensitivity tasks:
- Single-file edits
- Independent utility creation
- Documentation updates
- Simple bug fixes

## Complex Tasks

For tasks requiring deep reasoning, use Plan Mode and split role sub-agents (see [agents.md](./agents.md)).
