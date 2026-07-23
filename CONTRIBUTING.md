# Contributing

Thanks for helping improve **agentmux**.

## Development

```bash
git clone https://github.com/robinv8/agentmux.git
cd agentmux
bun test
bun run bin/agentmux.js list
```

Requirements:

- [Bun](https://bun.sh) (preferred for tests and the CLI entry)
- Optional: [Pi coding agent](https://github.com/earendil-works/pi) for live RPC workers

## Guidelines

1. Keep discovery, registry, status classification, and dispatch **pure / injectable** so unit tests do not need a real `pi` binary.
2. Prefer small PRs with tests for new pure logic.
3. Do not add keystroke injection into third-party TUIs (Grok / Codex / Kimi, etc.); the MVP protocol is **Pi RPC**.
4. Avoid committing personal paths, sockets, registries, or API keys.

## Pull requests

- Describe what changed and why.
- Include `bun test` output if you touch logic under `src/`.
- Update `README.md` when CLI flags, env vars, or architecture change.
