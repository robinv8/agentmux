# Security Policy

## Scope

**AgentMux** can discover local project directories, spawn short-lived
[Pi](https://github.com/earendil-works/pi) RPC workers, track optional long-lived
worker PIDs, and send prompts over stdin JSONL or Unix sockets. Treat it as a
**local development tool with full user privileges**, not a multi-tenant control
plane.

## Reporting a vulnerability

Please open a **private** security advisory on GitHub if the repository enables
it, or email the maintainer via the contact method listed on the GitHub profile
for [robinv8](https://github.com/robinv8).

Do not file public issues for unfixed security problems.

## Safe defaults

- Do not expose worker Unix sockets on shared multi-user hosts without
  filesystem permissions review.
- Do not commit `~/.pi/agent/workers.json`, socket paths under
  `AGENTMUX_SOCKETS`, or API keys for model providers.
- Worker processes inherit your user permissions; assume any registered worker
  can run arbitrary shell/tool actions allowed by Pi.
- The install script clones into `~/.agentmux` and runs `npm install
  --ignore-scripts` by default so dependency lifecycle scripts are not executed
  unless you change that path yourself.
