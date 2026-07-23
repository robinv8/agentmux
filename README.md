# AgentMux

**One Super Agent. Many project workers.**

Talk to **one** foreman agent. It lists your repos, decides which project(s) to touch, and dispatches short-lived [Pi](https://github.com/earendil-works/pi) workers. You stop juggling terminals.

```bash
am super 看下我有哪些项目
am super mindmux-app 登录提交后没跳转，帮我查
```

[![CI](https://github.com/robinv8/agentmux/actions/workflows/ci.yml/badge.svg)](https://github.com/robinv8/agentmux/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Install (one command)

```bash
curl -fsSL https://raw.githubusercontent.com/robinv8/agentmux/main/scripts/install.sh | bash
```

This will:

1. Install [Bun](https://bun.sh) if missing  
2. `bun install -g github:robinv8/agentmux`  
3. Pull **`@earendil-works/pi-coding-agent` as a dependency** — you do **not** install Pi separately  

After install:

```bash
am list
am mindmux-app Fix the login form validation
```

(`am` is the short alias of `agentmux`.)

### Other install options

```bash
# Already have Bun
bun install -g github:robinv8/agentmux

# From a local clone (dev)
git clone https://github.com/robinv8/agentmux.git
cd agentmux
bun install
bun link          # puts am / agentmux on PATH via Bun
```

Override install source for the curl script:

```bash
AGENTMUX_REF=github:robinv8/agentmux#main curl -fsSL … | bash
```

Optional: force a different Pi binary with `PI_BIN=/path/to/pi` (default uses the one bundled with AgentMux).

## Usage

```bash
am list                                 # projects under ~/Projects
am mindmux-app Fix the login form       # one-shot agent in that project
am run AIDesignPrompt Run the unit tests
am chat                                 # interactive loop
```

Advanced (long-lived workers — optional):

```bash
am serve my-app
am dispatch my-app "follow-up"
```

## Configuration

| Variable | Default |
|----------|---------|
| `AGENTMUX_PROJECTS_ROOT` | `~/Projects` |
| `AGENTMUX_REGISTRY` | `~/.pi/agent/workers.json` |
| `AGENTMUX_SOCKETS` | `~/.pi/agent/worker-sockets` |
| `PI_BIN` | bundled `@earendil-works/pi-coding-agent` |

## Architecture

```
am <project> <message>
        │
        ├─ discover project under Projects root
        ├─ spawn bundled pi --mode rpc --no-session  (cwd = project)
        ├─ JSONL prompt on stdin
        ├─ stream text_delta → your terminal
        └─ wait agent_settled → exit
```

## As a Pi extension

```bash
pi -e $(bun pm ls -g --all 2>/dev/null; echo)/extensions/commander.ts
# or from a clone:
pi -e ./extensions/commander.ts
```

Tools: `list_projects`, `worker_status`, `run_in_project`.

## Library

```ts
import { discoverProjects, runOneShot, resolvePiBinary } from "agentmux";

const projects = await discoverProjects({ projectsRoot: `${process.env.HOME}/Projects` });
const result = await runOneShot({
  projectQuery: "my-app",
  message: "summarize README",
  projects,
  piBinary: resolvePiBinary(),
});
```

## macOS app (native)

SwiftUI client for the same list → select → one-shot → stream flow:

```bash
cd macos
swift run AgentMuxApp
```

See [macos/README.md](macos/README.md).

## Tests

```bash
bun test
cd macos && swift test
```

## Non-goals

- Keystroke injection into Grok / Codex / Kimi TUIs  
- Cloud / multi-user orchestration  

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © robinv8

## Acknowledgments

Workers speak [Pi](https://github.com/earendil-works/pi) RPC. Pi is bundled as a dependency; credit to the Pi maintainers.
