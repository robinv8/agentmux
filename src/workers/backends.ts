import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOneShot } from "../oneshot.js";
import { resolvePiBinary } from "../pi-path.js";
import { discoverProjects } from "../discovery.js";
import type {
    WorkerBackend,
    WorkerBackendId,
    WorkerRunRequest,
    WorkerRunResult,
} from "./types.js";
import { spawnCli, which } from "./spawn-cli.js";

function packageRoot(): string {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function baseResult(
    req: WorkerRunRequest,
    partial: Partial<WorkerRunResult> & { ok: boolean; durationMs: number },
): WorkerRunResult {
    return {
        backend: req.backend,
        projectId: req.projectId,
        message: req.message,
        ...partial,
    };
}

/** Pi — existing RPC one-shot path (default worker). */
export const piBackend: WorkerBackend = {
    id: "pi",
    name: "Pi (bundled)",
    async resolveBinary() {
        const p = resolvePiBinary({ envPiBin: "" });
        return p === "pi" ? await which("pi") : p;
    },
    async isAvailable() {
        const b = await this.resolveBinary();
        return Boolean(b);
    },
    async run(req) {
        const started = Date.now();
        try {
            // runOneShot discovers by project id relative to projects root parent
            const projectsRoot = path.dirname(req.cwd);
            const projects = await discoverProjects({ projectsRoot });
            // ensure cwd project is present
            if (!projects.some((p) => p.cwd === req.cwd || p.id === req.projectId)) {
                projects.push({
                    id: req.projectId,
                    name: req.projectId,
                    cwd: req.cwd,
                });
            }
            const result = await runOneShot({
                projectQuery: req.projectId,
                message: req.message,
                projects,
                timeoutMs: req.timeoutMs,
                env: req.env,
                onTextDelta: req.onStdout,
            });
            return baseResult(req, {
                ok: result.ok,
                text: result.assistantText,
                error: result.error,
                durationMs: Date.now() - started,
            });
        } catch (e) {
            return baseResult(req, {
                ok: false,
                error: e instanceof Error ? e.message : String(e),
                durationMs: Date.now() - started,
            });
        }
    },
};

/** Claude Code print mode */
export const claudeBackend: WorkerBackend = {
    id: "claude",
    name: "Claude Code",
    async resolveBinary(env) {
        return which("claude", env?.PATH ?? process.env.PATH);
    },
    async isAvailable(env) {
        return Boolean(await this.resolveBinary(env));
    },
    async run(req) {
        const bin = await this.resolveBinary(req.env);
        if (!bin) {
            return baseResult(req, {
                ok: false,
                error: "claude not found on PATH",
                durationMs: 0,
            });
        }
        // Non-interactive print; accept edits so unattended runs can proceed.
        const args = [
            "-p",
            req.message,
            "--permission-mode",
            process.env.AGENTMUX_CLAUDE_PERMISSION_MODE || "acceptEdits",
        ];
        const r = await spawnCli({
            command: bin,
            args,
            cwd: req.cwd,
            env: req.env,
            timeoutMs: req.timeoutMs,
            onStdout: req.onStdout,
            onStderr: req.onStderr,
        });
        const text = r.stdout.trim() || r.stderr.trim();
        if (r.timedOut) {
            return baseResult(req, {
                ok: false,
                error: `claude timed out after ${req.timeoutMs ?? 600000}ms`,
                exitCode: r.exitCode,
                text,
                durationMs: r.durationMs,
            });
        }
        return baseResult(req, {
            ok: r.exitCode === 0,
            text,
            error:
                r.exitCode === 0
                    ? undefined
                    : `claude exit ${r.exitCode}: ${r.stderr.slice(0, 400)}`,
            exitCode: r.exitCode,
            durationMs: r.durationMs,
        });
    },
};

/** Codex non-interactive exec */
export const codexBackend: WorkerBackend = {
    id: "codex",
    name: "OpenAI Codex",
    async resolveBinary(env) {
        return which("codex", env?.PATH ?? process.env.PATH);
    },
    async isAvailable(env) {
        return Boolean(await this.resolveBinary(env));
    },
    async run(req) {
        const bin = await this.resolveBinary(req.env);
        if (!bin) {
            return baseResult(req, {
                ok: false,
                error: "codex not found on PATH",
                durationMs: 0,
            });
        }
        const args = ["exec", "-C", req.cwd, req.message];
        const r = await spawnCli({
            command: bin,
            args,
            cwd: req.cwd,
            env: req.env,
            timeoutMs: req.timeoutMs,
            onStdout: req.onStdout,
            onStderr: req.onStderr,
        });
        const text = r.stdout.trim() || r.stderr.trim();
        if (r.timedOut) {
            return baseResult(req, {
                ok: false,
                error: `codex timed out`,
                exitCode: r.exitCode,
                text,
                durationMs: r.durationMs,
            });
        }
        return baseResult(req, {
            ok: r.exitCode === 0,
            text,
            error:
                r.exitCode === 0
                    ? undefined
                    : `codex exit ${r.exitCode}: ${r.stderr.slice(0, 400)}`,
            exitCode: r.exitCode,
            durationMs: r.durationMs,
        });
    },
};

/** Grok Build single-turn headless */
export const grokBackend: WorkerBackend = {
    id: "grok",
    name: "Grok Build",
    async resolveBinary(env) {
        return (
            (await which("grok", env?.PATH ?? process.env.PATH)) ||
            path.join(
                process.env.HOME ?? "",
                ".grok",
                "bin",
                "grok",
            )
        );
    },
    async isAvailable(env) {
        const b = await this.resolveBinary(env);
        if (!b) return false;
        try {
            const { access } = await import("node:fs/promises");
            await access(b);
            return true;
        } catch {
            return false;
        }
    },
    async run(req) {
        const bin = await this.resolveBinary(req.env);
        if (!bin) {
            return baseResult(req, {
                ok: false,
                error: "grok not found",
                durationMs: 0,
            });
        }
        const args = [
            "--cwd",
            req.cwd,
            "-p",
            req.message,
            "--always-approve",
            "--output-format",
            "plain",
        ];
        const r = await spawnCli({
            command: bin,
            args,
            cwd: req.cwd,
            env: req.env,
            timeoutMs: req.timeoutMs,
            onStdout: req.onStdout,
            onStderr: req.onStderr,
        });
        const text = r.stdout.trim() || r.stderr.trim();
        if (r.timedOut) {
            return baseResult(req, {
                ok: false,
                error: "grok timed out",
                exitCode: r.exitCode,
                text,
                durationMs: r.durationMs,
            });
        }
        return baseResult(req, {
            ok: r.exitCode === 0,
            text,
            error:
                r.exitCode === 0
                    ? undefined
                    : `grok exit ${r.exitCode}: ${r.stderr.slice(0, 400)}`,
            exitCode: r.exitCode,
            durationMs: r.durationMs,
        });
    },
};

/** Kimi Code non-interactive prompt */
export const kimiBackend: WorkerBackend = {
    id: "kimi",
    name: "Kimi Code",
    async resolveBinary(env) {
        return (
            (await which("kimi", env?.PATH ?? process.env.PATH)) ||
            path.join(process.env.HOME ?? "", ".kimi-code", "bin", "kimi")
        );
    },
    async isAvailable(env) {
        const b = await this.resolveBinary(env);
        if (!b) return false;
        try {
            const { access } = await import("node:fs/promises");
            await access(b);
            return true;
        } catch {
            return false;
        }
    },
    async run(req) {
        const bin = await this.resolveBinary(req.env);
        if (!bin) {
            return baseResult(req, {
                ok: false,
                error: "kimi not found",
                durationMs: 0,
            });
        }
        // --auto: fully autonomous non-interactive
        const args = ["-p", req.message, "--auto", "--output-format", "text"];
        const r = await spawnCli({
            command: bin,
            args,
            cwd: req.cwd,
            env: req.env,
            timeoutMs: req.timeoutMs,
            onStdout: req.onStdout,
            onStderr: req.onStderr,
        });
        const text = r.stdout.trim() || r.stderr.trim();
        if (r.timedOut) {
            return baseResult(req, {
                ok: false,
                error: "kimi timed out",
                exitCode: r.exitCode,
                text,
                durationMs: r.durationMs,
            });
        }
        return baseResult(req, {
            ok: r.exitCode === 0,
            text,
            error:
                r.exitCode === 0
                    ? undefined
                    : `kimi exit ${r.exitCode}: ${r.stderr.slice(0, 400)}`,
            exitCode: r.exitCode,
            durationMs: r.durationMs,
        });
    },
};

export const ALL_BACKENDS: WorkerBackend[] = [
    piBackend,
    claudeBackend,
    codexBackend,
    grokBackend,
    kimiBackend,
];

export function getBackend(id: string): WorkerBackend | undefined {
    return ALL_BACKENDS.find((b) => b.id === id);
}

export async function listDispatchableBackends(
    env?: NodeJS.ProcessEnv,
): Promise<
    Array<{ id: WorkerBackendId; name: string; path?: string; available: boolean }>
> {
    const out: Array<{
        id: WorkerBackendId;
        name: string;
        path?: string;
        available: boolean;
    }> = [];
    for (const b of ALL_BACKENDS) {
        const available = await b.isAvailable(env);
        const path = await b.resolveBinary(env);
        out.push({ id: b.id, name: b.name, path, available });
    }
    return out;
}

// silence unused helper if tree-shaken
void packageRoot;
