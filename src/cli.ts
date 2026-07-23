import {
    defaultCommanderConfig,
    dispatch,
    listProjects,
    registerExternalWorker,
    registerWorker,
    statusForProject,
} from "./commander.js";

export async function runCli(argv: string[]): Promise<number> {
    const [cmd, ...rest] = argv;

    if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
        printHelp();
        return 0;
    }

    const config = defaultCommanderConfig();

    try {
        switch (cmd) {
            case "list": {
                const { table, items } = await listProjects(config);
                console.log(table);
                console.log("");
                console.log(`Total projects: ${items.length}`);
                console.log(
                    `With workers: ${items.filter((i) => i.worker).length}`,
                );
                return 0;
            }
            case "status": {
                const projectQuery = rest[0];
                if (!projectQuery) {
                    console.error("Usage: agentmux status <project>");
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
            case "dispatch": {
                const projectQuery = rest[0];
                const message = rest.slice(1).join(" ").trim();
                if (!projectQuery || !message) {
                    console.error(
                        "Usage: agentmux dispatch <project> <message...>",
                    );
                    return 2;
                }
                const result = await dispatch(config, projectQuery, message);
                console.log(JSON.stringify(result, null, 2));
                return result.ok ? 0 : 1;
            }
            case "register": {
                const projectQuery = rest[0];
                if (!projectQuery) {
                    console.error(
                        "Usage: agentmux register <project> --socket <path> [--pid N]",
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
                const record = await registerExternalWorker(
                    config,
                    projectQuery,
                    { rpcSocketPath: socket, pid },
                );
                console.log(JSON.stringify(record, null, 2));
                return 0;
            }
            case "worker": {
                const projectQuery = rest[0];
                if (!projectQuery) {
                    console.error("Usage: agentmux worker <project>");
                    return 2;
                }
                const { record, bridge } = await registerWorker(
                    config,
                    projectQuery,
                );
                console.log(
                    JSON.stringify(
                        {
                            registered: record,
                            note: "Worker running in background of this process. Press Ctrl+C to stop.",
                        },
                        null,
                        2,
                    ),
                );
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
                // Keep process alive
                await new Promise(() => {});
                return 0;
            }
            default:
                console.error(`Unknown command: ${cmd}`);
                printHelp();
                return 2;
        }
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        return 1;
    }
}

function printHelp(): void {
    console.log(`agentmux — multi-project Pi super-agent (MVP)

Commands:
  list                              List projects under Projects root + worker status
  status <project>                  Coarse status: running | idle | offline | unknown
  dispatch <project> <message...>   Send prompt to project worker via Pi RPC
  register <project> --socket PATH [--pid N]
                                    Register an already-running RPC worker
  worker <project>                  Spawn pi --mode rpc, bridge socket, register, stay up

Env:
  AGENTMUX_PROJECTS_ROOT   default: ~/Projects
  AGENTMUX_REGISTRY        default: ~/.pi/agent/workers.json
  AGENTMUX_SOCKETS         default: ~/.pi/agent/worker-sockets
  PI_BIN                       pi binary (default: pi)
`);
}

// Allow `bun src/cli.ts ...`
if (import.meta.main) {
    const code = await runCli(process.argv.slice(2));
    process.exit(code);
}
