/**
 * On-disk job ledger so the UI can know worker completion without
 * depending on flaky stream parsing.
 *
 * Default dir: ~/.agentmux/jobs/<id>.json
 */
import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface AgentJob {
    id: string;
    kind: "run_in_project" | "list_projects" | "list_local_agents" | "other";
    status: JobStatus;
    project?: string;
    message?: string;
    toolName?: string;
    summary?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    finishedAt?: string;
}

export function defaultJobsDir(home = os.homedir()): string {
    return (
        process.env.AGENTMUX_JOBS_DIR ||
        path.join(home, ".agentmux", "jobs")
    );
}

export async function ensureJobsDir(dir = defaultJobsDir()): Promise<string> {
    await mkdir(dir, { recursive: true });
    return dir;
}

export function newJobId(): string {
    return randomUUID();
}

export async function createJob(
    partial: Omit<AgentJob, "id" | "createdAt" | "updatedAt" | "status"> & {
        status?: JobStatus;
        id?: string;
    },
    dir = defaultJobsDir(),
): Promise<AgentJob> {
    await ensureJobsDir(dir);
    const now = new Date().toISOString();
    const job: AgentJob = {
        id: partial.id ?? newJobId(),
        kind: partial.kind,
        status: partial.status ?? "queued",
        project: partial.project,
        message: partial.message,
        toolName: partial.toolName,
        summary: partial.summary,
        error: partial.error,
        createdAt: now,
        updatedAt: now,
        startedAt: partial.status === "running" ? now : undefined,
    };
    await writeJob(job, dir);
    return job;
}

export async function updateJob(
    id: string,
    patch: Partial<AgentJob>,
    dir = defaultJobsDir(),
): Promise<AgentJob> {
    const current = await readJob(id, dir);
    if (!current) {
        throw new Error(`Job not found: ${id}`);
    }
    const now = new Date().toISOString();
    const next: AgentJob = {
        ...current,
        ...patch,
        id: current.id,
        updatedAt: now,
    };
    if (patch.status === "running" && !next.startedAt) {
        next.startedAt = now;
    }
    if (
        (patch.status === "done" || patch.status === "failed") &&
        !next.finishedAt
    ) {
        next.finishedAt = now;
    }
    await writeJob(next, dir);
    return next;
}

export async function markJobRunning(
    id: string,
    dir = defaultJobsDir(),
): Promise<AgentJob> {
    return updateJob(id, { status: "running" }, dir);
}

export async function markJobDone(
    id: string,
    summary: string,
    dir = defaultJobsDir(),
): Promise<AgentJob> {
    return updateJob(
        id,
        { status: "done", summary: summary.slice(0, 4000), error: undefined },
        dir,
    );
}

export async function markJobFailed(
    id: string,
    error: string,
    dir = defaultJobsDir(),
): Promise<AgentJob> {
    return updateJob(
        id,
        { status: "failed", error: error.slice(0, 2000) },
        dir,
    );
}

export async function readJob(
    id: string,
    dir = defaultJobsDir(),
): Promise<AgentJob | null> {
    try {
        const raw = await readFile(path.join(dir, `${id}.json`), "utf8");
        return JSON.parse(raw) as AgentJob;
    } catch {
        return null;
    }
}

export async function listJobs(
    options: {
        dir?: string;
        /** Only jobs updated within this many ms (default 24h) */
        sinceMs?: number;
        status?: JobStatus | JobStatus[];
    } = {},
): Promise<AgentJob[]> {
    const dir = options.dir ?? defaultJobsDir();
    await ensureJobsDir(dir);
    const files = await readdir(dir);
    const since = Date.now() - (options.sinceMs ?? 24 * 60 * 60 * 1000);
    const statusFilter = options.status
        ? new Set(Array.isArray(options.status) ? options.status : [options.status])
        : null;

    const jobs: AgentJob[] = [];
    for (const f of files) {
        if (!f.endsWith(".json")) continue;
        try {
            const raw = await readFile(path.join(dir, f), "utf8");
            const job = JSON.parse(raw) as AgentJob;
            const t = Date.parse(job.updatedAt || job.createdAt);
            if (!Number.isNaN(t) && t < since) continue;
            if (statusFilter && !statusFilter.has(job.status)) continue;
            jobs.push(job);
        } catch {
            // skip corrupt
        }
    }
    jobs.sort((a, b) =>
        (b.updatedAt || "").localeCompare(a.updatedAt || ""),
    );
    return jobs;
}

export function formatJobsTable(jobs: AgentJob[]): string {
    if (jobs.length === 0) return "(no recent jobs)";
    const lines = [
        pad("STATUS", 10) +
            pad("KIND", 18) +
            pad("PROJECT", 18) +
            "SUMMARY",
        "-".repeat(80),
    ];
    for (const j of jobs) {
        const sum = (j.summary || j.error || j.message || "").replace(
            /\s+/g,
            " ",
        );
        lines.push(
            pad(j.status, 10) +
                pad(j.kind, 18) +
                pad(j.project ?? "-", 18) +
                sum.slice(0, 48),
        );
    }
    return lines.join("\n");
}

async function writeJob(job: AgentJob, dir: string): Promise<void> {
    const file = path.join(dir, `${job.id}.json`);
    await writeFile(file, `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

export async function purgeOldJobs(
    maxAgeMs = 7 * 24 * 60 * 60 * 1000,
    dir = defaultJobsDir(),
): Promise<number> {
    await ensureJobsDir(dir);
    const files = await readdir(dir);
    const cutoff = Date.now() - maxAgeMs;
    let n = 0;
    for (const f of files) {
        if (!f.endsWith(".json")) continue;
        try {
            const raw = await readFile(path.join(dir, f), "utf8");
            const job = JSON.parse(raw) as AgentJob;
            const t = Date.parse(job.updatedAt || job.createdAt);
            if (!Number.isNaN(t) && t < cutoff) {
                await unlink(path.join(dir, f));
                n += 1;
            }
        } catch {
            // ignore
        }
    }
    return n;
}

function pad(s: string, n: number): string {
    if (s.length >= n) return `${s.slice(0, n - 1)} `;
    return s + " ".repeat(n - s.length);
}
