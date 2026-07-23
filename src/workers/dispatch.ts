import path from "node:path";
import { discoverProjects, resolveProjectTarget } from "../discovery.js";
import {
    createJob,
    markJobDone,
    markJobFailed,
    markJobRunning,
} from "../jobs.js";
import type { WorkerBackendId, WorkerRunResult } from "./types.js";
import { getBackend, listDispatchableBackends } from "./backends.js";

export interface DispatchWorkerOptions {
    /** Backend id: pi | claude | codex | grok | kimi. Default: auto */
    backend?: string;
    projectQuery: string;
    message: string;
    projectsRoot: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    onStdout?: (s: string) => void;
    onStderr?: (s: string) => void;
}

export interface DispatchWorkerResult extends WorkerRunResult {
    jobId: string;
}

/**
 * Pick default backend: prefer available non-pi if AGENTMUX_DEFAULT_BACKEND set,
 * else pi if available, else first available.
 */
export async function resolveDefaultBackend(
    preferred?: string,
    env?: NodeJS.ProcessEnv,
): Promise<WorkerBackendId> {
    if (preferred) {
        const b = getBackend(preferred);
        if (b && (await b.isAvailable(env))) return b.id;
        throw new Error(
            `Backend "${preferred}" is not available. Run: am workers`,
        );
    }
    const fromEnv = env?.AGENTMUX_DEFAULT_BACKEND || process.env.AGENTMUX_DEFAULT_BACKEND;
    if (fromEnv) {
        const b = getBackend(fromEnv);
        if (b && (await b.isAvailable(env))) return b.id;
    }
    const list = await listDispatchableBackends(env);
    const pi = list.find((x) => x.id === "pi" && x.available);
    if (pi) return "pi";
    const any = list.find((x) => x.available);
    if (any) return any.id;
    throw new Error("No worker backends available on PATH");
}

/**
 * Boss → little brother: resolve project, pick backend, run CLI, record job.
 */
export async function dispatchWorker(
    options: DispatchWorkerOptions,
): Promise<DispatchWorkerResult> {
    const projects = await discoverProjects({
        projectsRoot: options.projectsRoot,
    });
    const project = resolveProjectTarget(options.projectQuery, projects);
    const backendId = await resolveDefaultBackend(options.backend, options.env);
    const backend = getBackend(backendId);
    if (!backend) {
        throw new Error(`Unknown backend: ${backendId}`);
    }

    const job = await createJob({
        kind: "run_in_project",
        toolName: `run_in_project:${backendId}`,
        project: project.id,
        message: options.message,
        status: "running",
    });
    await markJobRunning(job.id);

    try {
        const result = await backend.run({
            backend: backendId,
            cwd: project.cwd,
            projectId: project.id,
            message: options.message,
            timeoutMs: options.timeoutMs,
            env: options.env,
            onStdout: options.onStdout,
            onStderr: options.onStderr,
        });

        if (!result.ok) {
            const err = result.error ?? "worker failed";
            await markJobFailed(job.id, `[${backendId}] ${err}`);
            return { ...result, jobId: job.id };
        }

        const summary =
            result.text?.trim() ||
            `(${backendId} finished with empty text in ${project.id})`;
        await markJobDone(job.id, `[${backendId}] ${summary}`);
        return { ...result, jobId: job.id, text: summary };
    } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        await markJobFailed(job.id, `[${backendId}] ${err}`);
        return {
            ok: false,
            backend: backendId,
            projectId: project.id,
            message: options.message,
            error: err,
            durationMs: 0,
            jobId: job.id,
        };
    }
}

export function normalizeBackendId(
    raw: unknown,
): WorkerBackendId | undefined {
    if (typeof raw !== "string") return undefined;
    const s = raw.trim().toLowerCase();
    if (
        s === "pi" ||
        s === "claude" ||
        s === "codex" ||
        s === "grok" ||
        s === "kimi"
    ) {
        return s;
    }
    // aliases
    if (s === "claude-code" || s === "anthropic") return "claude";
    if (s === "openai" || s === "chatgpt") return "codex";
    if (s === "kimi-code" || s === "moonshot") return "kimi";
    if (s === "xai" || s === "grok-build") return "grok";
    return undefined;
}

// unused path helper silence
void path;
