import { createConnection, createServer } from "node:net";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { PiRpcClient } from "./types.js";

/**
 * Pi RPC over a JSONL Unix domain socket bridge.
 *
 * Official `pi --mode rpc` speaks JSONL on stdin/stdout. For multi-worker
 * dispatch we spawn `pi --mode rpc` per project and bridge each instance to a
 * Unix socket so the commander can dial by path.
 *
 * Socket path protocol (one connection = one request cycle is NOT required):
 * - Client writes newline-delimited JSON commands
 * - Server (bridge) forwards to pi stdin and relays stdout lines back
 */

export interface JsonlLine {
    type?: string;
    [key: string]: unknown;
}

export class SocketPiRpcClient implements PiRpcClient {
    async getState(socketPath: string): Promise<{
        isStreaming: boolean;
        sessionId?: string;
        messageCount?: number;
    }> {
        const response = await this.request(socketPath, { type: "get_state" });
        if (!response.success) {
            throw new Error(
                typeof response.error === "string"
                    ? response.error
                    : "get_state failed",
            );
        }
        const data = (response.data ?? {}) as Record<string, unknown>;
        return {
            isStreaming: Boolean(data.isStreaming),
            sessionId:
                typeof data.sessionId === "string" ? data.sessionId : undefined,
            messageCount:
                typeof data.messageCount === "number"
                    ? data.messageCount
                    : undefined,
        };
    }

    async prompt(
        socketPath: string,
        message: string,
        options?: { streamingBehavior?: "steer" | "followUp" },
    ): Promise<{ success: boolean; error?: string }> {
        const body: Record<string, unknown> = {
            type: "prompt",
            message,
        };
        if (options?.streamingBehavior) {
            body.streamingBehavior = options.streamingBehavior;
        }
        const response = await this.request(socketPath, body);
        if (!response.success) {
            return {
                success: false,
                error:
                    typeof response.error === "string"
                        ? response.error
                        : "prompt failed",
            };
        }
        return { success: true };
    }

    /**
     * Send one command and wait for the matching `type: "response"` line.
     * Ignores intermediate agent events.
     */
    async request(
        socketPath: string,
        command: Record<string, unknown>,
        timeoutMs = 30_000,
    ): Promise<JsonlLine & { success?: boolean; error?: string; data?: unknown }> {
        const id =
            typeof command.id === "string"
                ? command.id
                : `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const payload = { ...command, id };

        return new Promise((resolve, reject) => {
            const socket = createConnection(socketPath);
            let buffer = "";
            let settled = false;

            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`RPC timeout after ${timeoutMs}ms`));
            }, timeoutMs);

            const cleanup = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                socket.removeAllListeners();
                socket.destroy();
            };

            socket.on("connect", () => {
                socket.write(`${JSON.stringify(payload)}\n`);
            });

            socket.on("data", (chunk) => {
                buffer += chunk.toString("utf8");
                let nl: number;
                while ((nl = buffer.indexOf("\n")) !== -1) {
                    let line = buffer.slice(0, nl);
                    buffer = buffer.slice(nl + 1);
                    if (line.endsWith("\r")) line = line.slice(0, -1);
                    if (!line.trim()) continue;
                    let parsed: JsonlLine;
                    try {
                        parsed = JSON.parse(line) as JsonlLine;
                    } catch {
                        continue;
                    }
                    if (
                        parsed.type === "response" &&
                        (parsed as { id?: string }).id === id
                    ) {
                        cleanup();
                        resolve(
                            parsed as JsonlLine & {
                                success?: boolean;
                                error?: string;
                                data?: unknown;
                            },
                        );
                        return;
                    }
                }
            });

            socket.on("error", (err) => {
                cleanup();
                reject(err);
            });

            socket.on("close", () => {
                if (!settled) {
                    cleanup();
                    reject(new Error("RPC socket closed before response"));
                }
            });
        });
    }
}

export interface WorkerBridge {
    pid: number;
    socketPath: string;
    cwd: string;
    stop: () => Promise<void>;
}

export interface StartWorkerOptions {
    cwd: string;
    socketPath: string;
    piBinary?: string;
    /** Extra args after `pi` */
    piArgs?: string[];
    env?: NodeJS.ProcessEnv;
}

/**
 * Start `pi --mode rpc --no-session` in `cwd` and bridge stdin/stdout to a
 * Unix domain socket at `socketPath`.
 */
export async function startWorkerBridge(
    options: StartWorkerOptions,
): Promise<WorkerBridge> {
    const piBinary = options.piBinary ?? process.env.PI_BIN ?? "pi";
    const socketPath = path.resolve(options.socketPath);
    await mkdir(path.dirname(socketPath), { recursive: true });
    try {
        await unlink(socketPath);
    } catch {
        // ok if missing
    }

    const args = options.piArgs ?? [
        "--mode",
        "rpc",
        "--no-session",
    ];

    let child: ChildProcessWithoutNullStreams;
    try {
        child = spawn(piBinary, args, {
            cwd: options.cwd,
            env: { ...process.env, ...options.env },
            stdio: ["pipe", "pipe", "pipe"],
        }) as ChildProcessWithoutNullStreams;
    } catch (err) {
        throw new Error(
            `Failed to spawn pi worker: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    // Multiplex: each socket connection gets exclusive request/response until
    // the matching response id arrives; events are broadcast to active sockets.
    const clients = new Set<import("node:net").Socket>();
    let stdoutBuffer = "";

    const server = createServer((conn) => {
        clients.add(conn);
        let inBuf = "";
        conn.on("data", (chunk) => {
            inBuf += chunk.toString("utf8");
            let nl: number;
            while ((nl = inBuf.indexOf("\n")) !== -1) {
                let line = inBuf.slice(0, nl);
                inBuf = inBuf.slice(nl + 1);
                if (line.endsWith("\r")) line = line.slice(0, -1);
                if (!line.trim()) continue;
                if (child.stdin.writable) {
                    child.stdin.write(`${line}\n`);
                }
            }
        });
        conn.on("close", () => clients.delete(conn));
        conn.on("error", () => clients.delete(conn));
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, () => resolve());
    });

    child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf8");
        let nl: number;
        while ((nl = stdoutBuffer.indexOf("\n")) !== -1) {
            let line = stdoutBuffer.slice(0, nl);
            stdoutBuffer = stdoutBuffer.slice(nl + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            const out = `${line}\n`;
            for (const c of clients) {
                if (c.writable) c.write(out);
            }
        }
    });

    const stderrChunks: string[] = [];
    child.stderr.on("data", (c: Buffer) => {
        stderrChunks.push(c.toString("utf8"));
    });

    // Wait briefly for process to stay alive
    await new Promise((r) => setTimeout(r, 200));
    if (child.exitCode !== null) {
        server.close();
        throw new Error(
            `pi worker exited early (code ${child.exitCode}): ${stderrChunks.join("")}`,
        );
    }

    const pid = child.pid;
    if (pid === undefined) {
        server.close();
        child.kill();
        throw new Error("pi worker has no pid");
    }

    return {
        pid,
        socketPath,
        cwd: options.cwd,
        stop: async () => {
            for (const c of clients) c.destroy();
            clients.clear();
            await new Promise<void>((resolve) => {
                server.close(() => resolve());
            });
            if (child.exitCode === null) {
                child.kill("SIGTERM");
            }
            try {
                await unlink(socketPath);
            } catch {
                // ignore
            }
        },
    };
}

/**
 * Fake in-memory RPC client for unit tests.
 */
export class FakePiRpcClient implements PiRpcClient {
    states = new Map<
        string,
        { isStreaming: boolean; sessionId?: string; messageCount?: number }
    >();
    prompts: Array<{ socketPath: string; message: string }> = [];
    failPrompt = false;
    failState = false;

    async getState(socketPath: string) {
        if (this.failState) throw new Error("fake get_state failure");
        return (
            this.states.get(socketPath) ?? {
                isStreaming: false,
                sessionId: "fake",
                messageCount: 0,
            }
        );
    }

    async prompt(socketPath: string, message: string) {
        this.prompts.push({ socketPath, message });
        if (this.failPrompt) {
            return { success: false, error: "fake prompt rejected" };
        }
        return { success: true };
    }
}
