# Development Workflow

> Extends [git-workflow.md](./git-workflow.md) with the full feature development process. For agent details, see [agents.md](./agents.md). For test mechanics, see [testing.md](./testing.md).

## Feature Implementation Workflow

0. **Index the Project** _(first step for any non-trivial project)_
   - Run `/index` to generate `PROJECT_INDEX.json` with full architectural awareness
   - Do this when entering a new project directory or before large changes
   - The index maps functions, classes, call graphs, imports, and file structure

1. **Research & Reuse** _(mandatory before any new implementation)_
   - Run `gh search repos` and `gh search code` to find existing implementations
   - Search package registries (npm, PyPI, crates.io) before writing utility code
   - Look for open-source projects that solve 80%+ of the problem
   - Prefer adopting a proven approach over writing net-new code

2. **Plan First**
   - Use **planner** agent for implementation plan
   - Identify dependencies and risks, break down into phases

3. **TDD** - See [testing.md](./testing.md) for the RED/GREEN/IMPROVE cycle

4. **Code Review** - Use **code-reviewer** agent, address CRITICAL and HIGH issues

5. **Commit & Push** - See [git-workflow.md](./git-workflow.md) for format and PR process
