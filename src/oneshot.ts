import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ProjectEntry } from "./types.js";
import { resolveProjectTarget } from "./discovery.js";

export interface OneShotResult {
    ok: boolean;
    projectId: string;
    message: string;
    assistantText?: string;
    error?: string;
    /** Number of JSONL events received from the worker */
    eventCount: number;
}

export interface OneShotSpawnResult {
    stdin: NodeJS.WritableStream;
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
    kill: (signal?: NodeJS.Signals) => void;
    pid?: number;
}

export type OneShotSpawner = (opts: {
    piBinary: string;
    cwd: string;
    args: string[];
}) => OneShotSpawnResult;

export interface RunOneShotOptions {
    projectQuery: string;
    message: string;
    projects: ProjectEntry[];
    piBinary?: string;
    /** Wait for agent_settled; default 10 minutes */
    timeoutMs?: number;
    /** Stream text deltas to this callback (e.g. process.stdout.write) */
    onTextDelta?: (delta: string) => void;
    onEvent?: (event: Record<string, unknown>) => void;
    spawner?: OneShotSpawner;
    now?: () => Date;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Default spawner: `pi --mode rpc --no-session` with piped stdio.
 */
export const defaultPiSpawner: OneShotSpawner = ({ piBinary, cwd, args }) => {
    const child = spawn(piBinary, args, {
        cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        kill: (signal) => {
            if (child.exitCode === null) child.kill(signal ?? "SIGTERM");
        },
        pid: child.pid,
    };
};

/**
 * Run one prompt against a project in a short-lived Pi RPC process.
 * No separate worker terminal, no registry, no Unix socket required.
 *
 * Flow: spawn pi → prompt → stream until agent_settled → return last assistant text → kill.
 */
export async function runOneShot(
    options: RunOneShotOptions,
): Promise<OneShotResult> {
    const message = options.message.trim();
    if (!message) {
        return {
            ok: false,
            projectId: options.projectQuery,
            message: "",
            error: "Message is empty",
            eventCount: 0,
        };
    }

    let project: ProjectEntry;
    try {
        project = resolveProjectTarget(options.projectQuery, options.projects);
    } catch (err) {
        return {
            ok: false,
            projectId: options.projectQuery,
            message,
            error: err instanceof Error ? err.message : String(err),
            eventCount: 0,
        };
    }

    const piBinary = options.piBinary ?? process.env.PI_BIN ?? "pi";
    const spawner = options.spawner ?? defaultPiSpawner;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let proc: OneShotSpawnResult;
    try {
        proc = spawner({
            piBinary,
            cwd: project.cwd,
            args: ["--mode", "rpc", "--no-session"],
        });
    } catch (err) {
        return {
            ok: false,
            projectId: project.id,
            message,
            error: `Failed to start Pi: ${err instanceof Error ? err.message : String(err)}. Install: npm i -g --ignore-scripts @earendil-works/pi-coding-agent`,
            eventCount: 0,
        };
    }

    const promptId = `oneshot-${Date.now()}`;
    let buffer = "";
    let eventCount = 0;
    let lastAssistantText = "";
    let promptAccepted = false;
    let settled = false;
    let stderr = "";

    const result = await new Promise<OneShotResult>((resolve) => {
        let done = false;
        const finish = (r: OneShotResult) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try {
                proc.kill("SIGTERM");
            } catch {
                // ignore
            }
            resolve(r);
        };

        const timer = setTimeout(() => {
            finish({
                ok: false,
                projectId: project.id,
                message,
                assistantText: lastAssistantText || undefined,
                error: `Timed out after ${timeoutMs}ms waiting for agent_settled`,
                eventCount,
            });
        }, timeoutMs);

        proc.stderr.on("data", (chunk: Buffer | string) => {
            stderr += String(chunk);
        });

        proc.stdout.on("data", (chunk: Buffer | string) => {
            buffer += String(chunk);
            let nl: number;
            while ((nl = buffer.indexOf("\n")) !== -1) {
                let line = buffer.slice(0, nl);
                buffer = buffer.slice(nl + 1);
                if (line.endsWith("\r")) line = line.slice(0, -1);
                if (!line.trim()) continue;

                let event: Record<string, unknown>;
                try {
                    event = JSON.parse(line) as Record<string, unknown>;
                } catch {
                    continue;
                }

                eventCount += 1;
                options.onEvent?.(event);

                // prompt acceptance response
                if (
                    event.type === "response" &&
                    event.command === "prompt" &&
                    event.id === promptId
                ) {
                    promptAccepted = Boolean(event.success);
                    if (!event.success) {
                        finish({
                            ok: false,
                            projectId: project.id,
                            message,
                            error:
                                typeof event.error === "string"
                                    ? event.error
                                    : "Pi rejected prompt",
                            eventCount,
                        });
                        return;
                    }
                }

                // stream text
                if (event.type === "message_update") {
                    const ame = event.assistantMessageEvent as
                        | Record<string, unknown>
                        | undefined;
                    if (ame?.type === "text_delta" && typeof ame.delta === "string") {
                        options.onTextDelta?.(ame.delta);
                    }
                }

                if (event.type === "message_end") {
                    const msg = event.message as
                        | { role?: string; content?: unknown }
                        | undefined;
                    if (msg?.role === "assistant") {
                        const text = extractAssistantText(msg.content);
                        if (text) lastAssistantText = text;
                    }
                }

                if (event.type === "agent_settled") {
                    settled = true;
                    finish({
                        ok: promptAccepted || lastAssistantText.length > 0,
                        projectId: project.id,
                        message,
                        assistantText: lastAssistantText || undefined,
                        error:
                            promptAccepted || lastAssistantText
                                ? undefined
                                : "Worker settled without accepting prompt",
                        eventCount,
                    });
                }
            }
        });

        // Some mocks close stdout without agent_settled — treat as done if we got text
        const onEnd = () => {
            if (done) return;
            if (settled) return;
            if (lastAssistantText || promptAccepted) {
                finish({
                    ok: true,
                    projectId: project.id,
                    message,
                    assistantText: lastAssistantText || undefined,
                    eventCount,
                });
                return;
            }
            finish({
                ok: false,
                projectId: project.id,
                message,
                error:
                    stderr.trim() ||
                    "Pi exited before completing (is `pi` installed and on PATH?)",
                eventCount,
            });
        };
        proc.stdout.on("end", onEnd);
        // Node Readable may emit close
        if ("on" in proc.stdout) {
            (proc.stdout as NodeJS.EventEmitter).on("close", onEnd);
        }

        // Send prompt
        try {
            const payload = JSON.stringify({
                id: promptId,
                type: "prompt",
                message,
            });
            proc.stdin.write(`${payload}\n`);
        } catch (err) {
            finish({
                ok: false,
                projectId: project.id,
                message,
                error: `Failed to write prompt: ${err instanceof Error ? err.message : String(err)}`,
                eventCount,
            });
        }
    });

    return result;
}

function extractAssistantText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    for (const block of content) {
        if (
            block &&
            typeof block === "object" &&
            (block as { type?: string }).type === "text" &&
            typeof (block as { text?: string }).text === "string"
        ) {
            parts.push((block as { text: string }).text);
        }
    }
    return parts.join("");
}

/**
 * Resolve project + run one-shot in one call (used by CLI).
 */
export async function runProjectOneShot(
    projectQuery: string,
    message: string,
    options: {
        projects: ProjectEntry[];
        piBinary?: string;
        timeoutMs?: number;
        onTextDelta?: (delta: string) => void;
        spawner?: OneShotSpawner;
    },
): Promise<OneShotResult> {
    return runOneShot({
        projectQuery,
        message,
        projects: options.projects,
        piBinary: options.piBinary,
        timeoutMs: options.timeoutMs,
        onTextDelta: options.onTextDelta,
        spawner: options.spawner,
    });
}
