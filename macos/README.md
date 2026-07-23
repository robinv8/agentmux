# AgentMux for macOS (native)

SwiftUI client for the same **list → select project → one-shot task → stream** flow as the CLI (`am`).

## Requirements

- macOS 13+
- Xcode / Swift 5.9+
- AgentMux CLI installed (`am` on PATH or `~/Projects/agentmux/bin/agentmux.js` + Bun)

## Open & run

```bash
cd /path/to/agentmux/macos
swift build
swift run AgentMuxApp
```

Or open this folder in Xcode via **File → Open** → select `Package.swift`, then run the `AgentMuxApp` scheme.

## UI

1. **Projects** sidebar — direct children of the Projects root (default `~/Projects`, overridable in the field / `AGENTMUX_PROJECTS_ROOT`)
2. Select a project
3. Enter a task
4. **Run one-shot** (`⌘↩`) — spawns `am <project> <message>` and streams stdout/stderr into the transcript

## Tests

```bash
cd macos
swift test
```

Pure logic lives in `AgentMuxKit` (discovery, invocation, runner protocol). The app target only binds UI to those helpers.

## Env

| Variable | Purpose |
|----------|---------|
| `AGENTMUX_PROJECTS_ROOT` | Projects folder |
| `AGENTMUX_BIN` | Explicit path to `am` / `agentmux.js` |
| `KIMI_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | Passed through to the CLI process environment |
