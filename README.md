# agentmux

**One commander. Many project workers.**

`agentmux` is a local multi-project super-agent for [Pi](https://github.com/earendil-works/pi): list every repo under your Projects folder, dispatch prompts to per-project Pi RPC workers, and report coarse status (`running` | `idle` | `offline` | `unknown`) — without juggling a grid of agent terminals.

It does **not** inject keystrokes into Grok / Codex / Kimi (or other) interactive TUIs. The MVP wire protocol is **Pi RPC** over a Unix domain socket bridge.

[![CI](https://github.com/robinv8/agentmux/actions/workflows/ci.yml/badge.svg)](https://github.com/robinv8/agentmux/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Why

If you run coding agents across many repos, progress is scattered: one tab per project, different CLIs, constant context switching. `agentmux` gives you a single CLI (or Pi extension) that:

1. **Discovers** project roots under a configurable directory (default `~/Projects`)
2. **Registers** workers (Pi `--mode rpc` processes) in a durable registry
3. **Dispatches** prompts programmatically
4. **Reports** whether each worker is running, idle, or offline

## Status

MVP — core discovery / registry / status / dispatch are implemented and unit-tested. Live multi-worker UX and richer streaming back into the commander are future work.

## Requirements

- [Bun](https://bun.sh) (or Node 20+ for library use)
- Optional for live workers: global Pi CLI

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

## Install

```bash
git clone https://github.com/robinv8/agentmux.git
cd agentmux
```

No install step is required for the Bun CLI entry; run it from the repo.

## Quick start

```bash
# List projects + worker registration/status
bun run bin/agentmux.js list

# Start a Pi RPC worker for a project (keeps this process alive)
bun run bin/agentmux.js worker my-app

# In another terminal: dispatch a prompt
bun run bin/agentmux.js dispatch my-app "Summarize the README in one sentence"

# Coarse status for one project
bun run bin/agentmux.js status my-app

# Register an already-bridged socket
bun run bin/agentmux.js register my-app \
  --socket ~/.pi/agent/worker-sockets/my-app.sock \
  --pid 12345
```

### As a Pi extension

```bash
cd /path/to/agentmux
pi -e ./extensions/commander.ts
```

Tools exposed to the model:

| Tool | Purpose |
|------|---------|
| `list_projects` | Inventory projects + worker status |
| `worker_status` | Status for one project |
| `dispatch_to_project` | Send a prompt via Pi RPC |

## Configuration

| Environment variable | Default |
|----------------------|---------|
| `AGENTMUX_PROJECTS_ROOT` | `~/Projects` |
| `AGENTMUX_REGISTRY` | `~/.pi/agent/workers.json` |
| `AGENTMUX_SOCKETS` | `~/.pi/agent/worker-sockets` |
| `PI_BIN` | `pi` |

## Architecture

```
commander CLI / Pi extension
    │
    ├─ discovery  → direct children of Projects root
    ├─ registry   → workers.json (project → socket / pid)
    ├─ status     → process probe + optional RPC get_state
    └─ dispatch   → JSONL over Unix socket → pi --mode rpc
```

Workers are **Pi RPC** processes, bridged to a Unix domain socket so the commander can dial without sharing a TTY.

### Registry shape

```json
{
  "version": 1,
  "workers": {
    "my-app": {
      "projectId": "my-app",
      "cwd": "/home/you/Projects/my-app",
      "rpcSocketPath": "/home/you/.pi/agent/worker-sockets/my-app.sock",
      "pid": 12345,
      "mode": "rpc",
      "updatedAt": "2026-07-23T00:00:00.000Z"
    }
  }
}
```

## Library surface

Pure modules under `src/` are importable for embedding:

- `discoverProjects` / `resolveProjectTarget`
- `loadRegistry` / `saveRegistry` / `upsertWorker`
- `classifyStatus` / `buildInventory`
- `dispatchToProject` / `SocketPiRpcClient`

```ts
import { discoverProjects, classifyStatus } from "./src/index.ts";
```

## Tests

```bash
bun test
```

Tests cover discovery, registry I/O, status classification, dispatch routing, and a mock Pi JSONL RPC server over real Unix sockets (no live `pi` binary required).

## Non-goals (MVP)

- Keystroke injection into third-party agent TUIs
- Full dual-way chat proxy of every worker token stream into the commander
- Remote / multi-user / cloud orchestration
- Replacing each project's preferred long-term coding agent

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © robinv8

## Acknowledgments

Built to orchestrate [Pi](https://github.com/earendil-works/pi) workers. Pi is a separate project with its own license and maintainers.
