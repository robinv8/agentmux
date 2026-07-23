# Contributing

Thanks for helping improve **AgentMux**.

## Development

```bash
git clone https://github.com/robinv8/agentmux.git
cd agentmux
bun install          # pulls bundled @earendil-works/pi-coding-agent
bun test
bun run bin/agentmux.js list
```

Requirements:

- [Bun](https://bun.sh) (CLI + tests)
- Pi is a **package dependency** — do not document a separate global Pi install

## Guidelines

1. Keep discovery, registry, status, one-shot, and dispatch **injectable** so unit tests mock spawn/RPC without a real `pi` binary.
2. Prefer the **one-shot** path (`runOneShot`) for default UX; long-lived workers are advanced.
3. Do not add keystroke injection into third-party TUIs; protocol is **Pi RPC**.
4. Avoid committing personal paths, sockets, registries, or API keys.
5. User-facing product name is **AgentMux**; CLI binary stays `agentmux`.

## Pull requests

- Describe what changed and why.
- Include `bun test` output if you touch logic under `src/`.
- Update `README.md` when CLI flags, env vars, or architecture change.
