# AgentMux

**One command. Right project. Done.**

AgentMux is a local multi-project commander for [Pi](https://github.com/earendil-works/pi). Point it at a folder of repos (default `~/Projects`), name a project, give it a task — it spins up a short-lived Pi RPC worker, runs the prompt there, streams the reply, and exits.

No second terminal. No manual worker registration for the common path.

[![CI](https://github.com/robinv8/agentmux/actions/workflows/ci.yml/badge.svg)](https://github.com/robinv8/agentmux/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Why

Running coding agents across many repos usually means a grid of tabs and constant context switching. AgentMux collapses the happy path to:

```bash
am mindmux-app Fix the login form validation
```

(`am` is the short alias of `agentmux`.)

## Requirements

- [Bun](https://bun.sh) (recommended) or Node 20+
- [Pi coding agent](https://github.com/earendil-works/pi) on your `PATH` for live runs:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

## Install

```bash
git clone https://github.com/robinv8/agentmux.git
cd agentmux
```

Put both commands on your `PATH` (recommended):

```bash
mkdir -p ~/.local/bin
ln -sf "$(pwd)/bin/agentmux.js" ~/.local/bin/agentmux
ln -sf "$(pwd)/bin/agentmux.js" ~/.local/bin/am
chmod +x bin/agentmux.js
# ensure ~/.local/bin is on PATH, then:
am list
```

Or shell aliases:

```bash
# ~/.zshrc
alias agentmux='bun ~/Projects/agentmux/bin/agentmux.js'
alias am='bun ~/Projects/agentmux/bin/agentmux.js'
```

When published to npm, both bins ship together:

```bash
npm install -g agentmux   # provides `agentmux` and `am`
```

## Usage

### Primary: one-shot run

```bash
# List projects under ~/Projects
am list

# Run an agent in a project (spawn → prompt → stream → exit)
am mindmux-app Fix the login form validation

# Explicit form (same behavior)
am run AIDesignPrompt Run bun test schema/goal and fix failures
```

### Interactive chat

```bash
am chat
# AgentMux> list
# AgentMux> mindmux-app add a loading skeleton to the home page
# AgentMux> /quit
```

### Advanced: long-lived workers

Only if you want a persistent worker you can `dispatch` into repeatedly:

```bash
am serve my-app          # keep Pi RPC up + register socket
am dispatch my-app "…"   # send to that registered worker
```

Most people never need this — prefer `am <project> <message>`.

## Configuration

| Variable | Default |
|----------|---------|
| `AGENTMUX_PROJECTS_ROOT` | `~/Projects` |
| `AGENTMUX_REGISTRY` | `~/.pi/agent/workers.json` |
| `AGENTMUX_SOCKETS` | `~/.pi/agent/worker-sockets` |
| `PI_BIN` | `pi` |

## Architecture

```
agentmux <project> <message>
        │
        ├─ discover project under Projects root
        ├─ spawn: pi --mode rpc --no-session  (cwd = project)
        ├─ JSONL prompt on stdin
        ├─ stream text_delta → your terminal
        └─ wait agent_settled → exit
```

Long-lived mode (optional) bridges Pi RPC to a Unix socket and records it in the registry for `dispatch`.

## As a Pi extension

```bash
cd /path/to/agentmux
pi -e ./extensions/commander.ts
```

Tools: `list_projects`, `worker_status`, `run_in_project`.

## Library

```ts
import { discoverProjects, runOneShot } from "./src/index.ts";

const projects = await discoverProjects({ projectsRoot: "~/Projects" });
const result = await runOneShot({
  projectQuery: "my-app",
  message: "summarize README",
  projects,
});
```

## Tests

```bash
bun test
```

Unit tests cover discovery, registry, status, socket dispatch, and one-shot RPC with a mock Pi process (no live `pi` binary required).

## Non-goals

- Keystroke injection into Grok / Codex / Kimi TUIs
- Cloud / multi-user orchestration
- Full dual-way chat mux of every token into a single super-model (roadmap)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © robinv8

## Acknowledgments

Workers speak [Pi](https://github.com/earendil-works/pi) RPC. Pi is a separate project.
