import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
    defaultCommanderConfig,
    dispatch,
    listProjects,
    registerExternalWorker,
    registerWorker,
    statusForProject,
} from "./commander.js";
import { discoverProjects } from "./discovery.js";
import { runOneShot } from "./oneshot.js";

/** Subcommands reserved so bare `agentmux <project> <msg>` still works. */
const RESERVED = new Set([
    "list",
    "ls",
    "status",
    "run",
    "do",
    "ask",
    "dispatch",
    "serve",
    "worker",
    "register",
    "chat",
    "repl",
    "super",
    "s",
    "agents",
    "agent",
    "help",
    "--help",
    "-h",
]);

export async function runCli(argv: string[]): Promise<number> {
    const [cmd, ...rest] = argv;

    if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
        printHelp();
        return 0;
    }

    const config = defaultCommanderConfig();

    try {
        // Direct worker path still supported: am <project> <message>
        if (!RESERVED.has(cmd) && rest.length > 0) {
            return await runToProject(config, cmd, rest.join(" "));
        }

        switch (cmd) {
            case "super":
            case "s":
            case "chat":
            case "repl": {
                // Primary product path: talk to the Super Agent
                if (rest[0] === "--rpc" || rest[0] === "rpc") {
                    const { runSuperRpcStdio } = await import("./super-rpc.js");
                    await runSuperRpcStdio({
                        projectsRoot: config.projectsRoot,
                    });
                    return 0;
                }
                if (rest[0] === "-m" || rest[0] === "--message") {
                    return await runSuperOnce(config, rest.slice(1).join(" "));
                }
                if (rest.length > 0) {
                    return await runSuperOnce(config, rest.join(" "));
                }
                return await runSuperRepl(config);
            }
            case "list":
            case "ls": {
                const { table, items } = await listProjects(config);
                console.log(table);
                console.log("");
                console.log(`Total projects: ${items.length}`);
                const online = items.filter(
                    (i) => i.status === "running" || i.status === "idle",
                ).length;
                console.log(`Workers online: ${online}`);
                return 0;
            }
            case "agents":
            case "agent": {
                const { scanLocalAgents, formatLocalAgentsTable } =
                    await import("./local-agents.js");
                const only =
                    rest.includes("--available") || rest.includes("-a");
                const asJson = rest.includes("--json") || rest.includes("-j");
                let agents = await scanLocalAgents();
                if (only) agents = agents.filter((x) => x.available);
                if (asJson) {
                    console.log(JSON.stringify(agents, null, 2));
                    return 0;
                }
                console.log(formatLocalAgentsTable(agents));
                console.log("");
                console.log(
                    `Available: ${agents.filter((x) => x.available).length} · Running procs (sum): ${agents.reduce((n, x) => n + x.runningCount, 0)} · Dispatchable workers: ${agents.filter((x) => x.dispatchable).length}`,
                );
                return 0;
            }
            case "status": {
                const projectQuery = rest[0];
                if (!projectQuery) {
                    console.error("Usage: am status <project>");
                    return 2;
                }
                const result = await statusForProject(config, projectQuery);
                console.log(
                    JSON.stringify(
                        {
                            projectId: result.projectId,
                            status: result.status,
                            detail: result.detail,
                            worker: result.worker
                                ? {
                                      pid: result.worker.pid,
                                      rpcSocketPath: result.worker.rpcSocketPath,
                                      cwd: result.worker.cwd,
                                      updatedAt: result.worker.updatedAt,
                                  }
                                : null,
                        },
                        null,
                        2,
                    ),
                );
                return 0;
            }
            case "run":
            case "do":
            case "ask": {
                const projectQuery = rest[0];
                const message = rest.slice(1).join(" ").trim();
                if (!projectQuery || !message) {
                    console.error(
                        "Usage: am run <project> <message...>\n   or: am <project> <message...>",
                    );
                    return 2;
                }
                return await runToProject(config, projectQuery, message);
            }
            case "dispatch": {
                // Advanced: send to a long-lived registered worker (socket)
                const projectQuery = rest[0];
                const message = rest.slice(1).join(" ").trim();
                if (!projectQuery || !message) {
                    console.error(
                        "Usage: am dispatch <project> <message...>",
                    );
                    return 2;
                }
                const result = await dispatch(config, projectQuery, message);
                console.log(JSON.stringify(result, null, 2));
                return result.ok ? 0 : 1;
            }
            case "serve":
            case "worker": {
                // Advanced: keep a long-lived worker process
                const projectQuery = rest[0];
                if (!projectQuery) {
                    console.error("Usage: am serve <project>");
                    return 2;
                }
                const { record, bridge } = await registerWorker(
                    config,
                    projectQuery,
                );
                console.error(
                    `AgentMux: serving ${record.projectId} (pid ${record.pid}) on ${record.rpcSocketPath}`,
                );
                console.error("Press Ctrl+C to stop.");
                const shutdown = async () => {
                    await bridge.stop();
                    process.exit(0);
                };
                process.on("SIGINT", () => {
                    void shutdown();
                });
                process.on("SIGTERM", () => {
                    void shutdown();
                });
                await new Promise(() => {});
                return 0;
            }
            case "register": {
                const projectQuery = rest[0];
                if (!projectQuery) {
                    console.error(
                        "Usage: am register <project> --socket <path> [--pid N]",
                    );
                    return 2;
                }
                const socketIdx = rest.indexOf("--socket");
                const pidIdx = rest.indexOf("--pid");
                const socket =
                    socketIdx >= 0 ? rest[socketIdx + 1] : undefined;
                const pid =
                    pidIdx >= 0 ? Number(rest[pidIdx + 1]) : undefined;
                if (!socket) {
                    console.error("--socket is required");
                    return 2;
                }
                const rec = await registerExternalWorker(config, projectQuery, {
                    rpcSocketPath: socket,
                    pid,
                });
                console.log(JSON.stringify(rec, null, 2));
                return 0;
            }
            default:
                // Single token that looks like a project but no message
                if (!RESERVED.has(cmd) && rest.length === 0) {
                    console.error(
                        `Missing message. Try:\n  am ${cmd} <what you want done>`,
                    );
                    return 2;
                }
                console.error(`Unknown command: ${cmd}`);
                printHelp();
                return 2;
        }
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        return 1;
    }
}

async function runToProject(
    config: ReturnType<typeof defaultCommanderConfig>,
    projectQuery: string,
    message: string,
): Promise<number> {
    const projects = await discoverProjects({
        projectsRoot: config.projectsRoot,
        requireProjectMarker: config.requireProjectMarker,
    });

    console.error(`AgentMux → ${projectQuery}`);
    console.error(`cwd root: ${config.projectsRoot}`);
    console.error("---");

    const result = await runOneShot({
        projectQuery,
        message,
        projects,
        piBinary: config.piBinary,
        piArgs: config.piArgs,
        onTextDelta: (delta) => {
            process.stdout.write(delta);
        },
    });

    if (result.assistantText && !result.assistantText.endsWith("\n")) {
        process.stdout.write("\n");
    }

    console.error("---");
    if (!result.ok) {
        console.error(`AgentMux: failed — ${result.error ?? "unknown error"}`);
        return 1;
    }
    console.error(
        `AgentMux: done (${result.projectId}, ${result.eventCount} events)`,
    );
    return 0;
}

async function runSuperOnce(
    config: ReturnType<typeof defaultCommanderConfig>,
    text: string,
): Promise<number> {
    const { createDefaultSuperConfig, runSuperTurn } = await import(
        "./super-agent.js"
    );
    const superConfig = createDefaultSuperConfig(config.projectsRoot);
    try {
        const result = await runSuperTurn({
            config: superConfig,
            history: [],
            userText: text,
            onEvent: (ev) => {
                if (ev.type === "assistant_text" && ev.text) {
                    process.stdout.write(ev.text);
                } else if (ev.type === "tool_start") {
                    console.error(
                        `\n[tool] ${ev.toolName} ${JSON.stringify(ev.toolInput ?? {})}`,
                    );
                } else if (ev.type === "tool_end") {
                    console.error(
                        `[tool done] ${ev.toolName}: ${(ev.toolResult ?? "").slice(0, 200)}`,
                    );
                } else if (ev.type === "error") {
                    console.error(`[error] ${ev.error}`);
                }
            },
        });
        if (result.assistantText && !result.assistantText.endsWith("\n")) {
            process.stdout.write("\n");
        }
        return 0;
    } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        return 1;
    }
}

async function runSuperRepl(
    config: ReturnType<typeof defaultCommanderConfig>,
): Promise<number> {
    const { createDefaultSuperConfig, runSuperTurn } = await import(
        "./super-agent.js"
    );
    const superConfig = createDefaultSuperConfig(config.projectsRoot);
    let history: import("./super-agent.js").ChatMessage[] = [];

    console.error("AgentMux Super Agent — talk naturally. /quit to exit.");
    console.error(`Projects root: ${config.projectsRoot}`);
    const rl = readline.createInterface({ input, output, terminal: true });

    try {
        while (true) {
            const line = (await rl.question("You> ")).trim();
            if (!line) continue;
            if (line === "/quit" || line === "/exit" || line === "quit") break;
            if (line === "/help") {
                console.log(
                    "  (default) natural language → Super Agent dispatches workers\n" +
                        "  /list     show projects\n" +
                        "  /reset    clear conversation\n" +
                        "  /quit",
                );
                continue;
            }
            if (line === "/list") {
                const { table } = await listProjects(config);
                console.log(table);
                continue;
            }
            if (line === "/reset") {
                history = [];
                console.error("(history cleared)");
                continue;
            }

            process.stdout.write("Super> ");
            try {
                const result = await runSuperTurn({
                    config: superConfig,
                    history,
                    userText: line,
                    onEvent: (ev) => {
                        if (ev.type === "assistant_text" && ev.text) {
                            process.stdout.write(ev.text);
                        } else if (ev.type === "tool_start") {
                            process.stderr.write(
                                `\n  ↳ ${ev.toolName}…\nSuper> `,
                            );
                        }
                    },
                });
                history = result.history;
                if (!result.assistantText.endsWith("\n")) {
                    process.stdout.write("\n");
                }
            } catch (e) {
                console.error(e instanceof Error ? e.message : String(e));
            }
        }
    } finally {
        rl.close();
    }
    return 0;
}

function printHelp(): void {
    console.log(`AgentMux — Super Agent that dispatches project workers
Command: am  (alias of agentmux)

Primary (talk to the Super Agent — it picks projects & workers):
  am super                      Interactive Super Agent chat
  am super <message...>         One Super Agent turn
  am super --rpc                JSONL protocol for the macOS app
  am chat                       Alias of am super

Direct worker (advanced / power users):
  am <project> <message...>     Skip Super Agent; one-shot worker only
  am run <project> <message...> Same

Inspect:
  am list                       Projects under ~/Projects
  am agents                     Local agents (path / running / dispatchable)
  am agents -a                  Only available on disk
  am status <project>

Examples:
  am super 看下我有哪些项目
  am super mindmux-app 登录页提交后没跳转，帮我查
  am super 同时看 md-converter 的 README 和 agentmux 的 package 名

Env:
  AGENTMUX_PROJECTS_ROOT   default: ~/Projects
  KIMI_API_KEY             Super Agent + workers (or ANTHROPIC_AUTH_TOKEN)
  ANTHROPIC_BASE_URL       default: https://api.kimi.com/coding
  AGENTMUX_SUPER_MODEL     default: kimi-for-coding
  AGENTMUX_PROVIDER/MODEL  worker Pi defaults

Install:
  curl -fsSL https://raw.githubusercontent.com/robinv8/agentmux/main/scripts/install.sh | bash
`);
}

if (import.meta.main) {
    const code = await runCli(process.argv.slice(2));
    process.exit(code);
}
