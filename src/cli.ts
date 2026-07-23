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
        // Primary UX: agentmux <project> <message...>
        if (!RESERVED.has(cmd) && rest.length > 0) {
            return await runToProject(config, cmd, rest.join(" "));
        }

        switch (cmd) {
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
            case "chat":
            case "repl": {
                return await runRepl(config);
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

async function runRepl(
    config: ReturnType<typeof defaultCommanderConfig>,
): Promise<number> {
    console.error("AgentMux chat — type `project message` or /list /help /quit");
    const rl = readline.createInterface({ input, output, terminal: true });

    try {
        while (true) {
            const line = (await rl.question("AgentMux> ")).trim();
            if (!line) continue;
            if (line === "/quit" || line === "/exit" || line === "quit") break;
            if (line === "/help" || line === "help") {
                console.log(
                    "  <project> <message>   one-shot run in that project\n" +
                        "  /list                 list projects\n" +
                        "  /status <project>     worker status\n" +
                        "  /quit                 exit",
                );
                continue;
            }
            if (line === "/list" || line === "list") {
                const { table } = await listProjects(config);
                console.log(table);
                continue;
            }
            if (line.startsWith("/status ")) {
                const q = line.slice("/status ".length).trim();
                const s = await statusForProject(config, q);
                console.log(JSON.stringify(s, null, 2));
                continue;
            }

            // project message — first token is project
            const sp = line.indexOf(" ");
            if (sp === -1) {
                console.error("Need: <project> <message>");
                continue;
            }
            const projectQuery = line.slice(0, sp);
            const message = line.slice(sp + 1).trim();
            await runToProject(config, projectQuery, message);
        }
    } finally {
        rl.close();
    }
    return 0;
}

function printHelp(): void {
    // Prefer short form in help so muscle memory sticks.
    console.log(`AgentMux — one commander, many local projects (Pi RPC)
Command: am  (alias of agentmux)

Primary (no worker terminal needed):
  am <project> <message...>     Run a one-shot agent in that project
  am run <project> <message...> Same as above
  am chat                       Interactive loop

Inspect:
  am list                       Projects under ~/Projects + status
  am status <project>

Advanced (long-lived workers):
  am serve <project>            Keep a Pi RPC worker up
  am dispatch <project> <msg>   Prompt a registered long-lived worker
  am register <project> --socket PATH [--pid N]

Examples:
  am list
  am mindmux-app Fix the login form validation
  am run AIDesignPrompt Run bun test schema/goal and fix failures
  am chat

Env:
  AGENTMUX_PROJECTS_ROOT   default: ~/Projects
  AGENTMUX_REGISTRY        default: ~/.pi/agent/workers.json
  AGENTMUX_SOCKETS         default: ~/.pi/agent/worker-sockets
  PI_BIN                   pi binary (default: pi)
`);
}

if (import.meta.main) {
    const code = await runCli(process.argv.slice(2));
    process.exit(code);
}
