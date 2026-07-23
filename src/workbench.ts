/**
 * Today's workbench: multi-project stations, each with a bound worker (brother).
 * Super Agent sets up stations; start_all runs them (parallel); status is queryable.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { dispatchWorker, normalizeBackendId } from "./workers/index.js";
import type { WorkerBackendId } from "./workers/types.js";
import { discoverProjects, resolveProjectTarget } from "./discovery.js";

export type StationStatus =
    | "empty" // project not set
    | "ready" // project + backend + task set, not started
    | "running"
    | "waiting_user" // needs human answer / approval
    | "done"
    | "failed";

export interface WorkStation {
    id: string;
    /** Project basename */
    project?: string;
    cwd?: string;
    /** Worker backend */
    backend?: WorkerBackendId;
    /** Task description for the worker */
    task?: string;
    status: StationStatus;
    jobId?: string;
    /** Question shown to user when waiting_user */
    pendingQuestion?: string;
    /** Last worker / system summary */
    summary?: string;
    error?: string;
    updatedAt: string;
}

export interface Workbench {
    id: string;
    title: string;
    stations: WorkStation[];
    createdAt: string;
    updatedAt: string;
}

export function defaultWorkbenchPath(home = os.homedir()): string {
    return (
        process.env.AGENTMUX_WORKBENCH_PATH ||
        path.join(home, ".agentmux", "workbench.json")
    );
}

function now(): string {
    return new Date().toISOString();
}

function newId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyWorkbench(title = "今日工作台"): Workbench {
    const t = now();
    return {
        id: newId("wb"),
        title,
        stations: [],
        createdAt: t,
        updatedAt: t,
    };
}

export async function loadWorkbench(
    file = defaultWorkbenchPath(),
): Promise<Workbench> {
    try {
        const raw = await readFile(file, "utf8");
        return JSON.parse(raw) as Workbench;
    } catch {
        return emptyWorkbench();
    }
}

export async function saveWorkbench(
    wb: Workbench,
    file = defaultWorkbenchPath(),
): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    wb.updatedAt = now();
    await writeFile(file, `${JSON.stringify(wb, null, 2)}\n`, "utf8");
}

export function formatWorkbench(wb: Workbench): string {
    if (wb.stations.length === 0) {
        return `${wb.title} (${wb.id})\n(no stations — add projects first)`;
    }
    const lines = [
        `${wb.title} · ${wb.stations.length} stations`,
        "-".repeat(56),
    ];
    for (const s of wb.stations) {
        lines.push(
            `[${s.status.padEnd(12)}] ${s.project ?? "?"} · backend=${s.backend ?? "?"} · ${s.task?.slice(0, 40) ?? "(no task)"}`,
        );
        if (s.pendingQuestion) {
            lines.push(`    ⏳ 等你: ${s.pendingQuestion}`);
        }
        if (s.summary) {
            lines.push(`    → ${s.summary.slice(0, 80)}`);
        }
        if (s.error) {
            lines.push(`    ✗ ${s.error.slice(0, 80)}`);
        }
    }
    return lines.join("\n");
}

/** Replace today's projects (creates/resets stations). */
export async function setProjects(
    projectNames: string[],
    options: { projectsRoot: string; title?: string },
): Promise<Workbench> {
    const projects = await discoverProjects({
        projectsRoot: options.projectsRoot,
    });
    const stations: WorkStation[] = [];
    for (const name of projectNames) {
        const trimmed = name.trim();
        if (!trimmed) continue;
        try {
            const p = resolveProjectTarget(trimmed, projects);
            stations.push({
                id: newId("st"),
                project: p.id,
                cwd: p.cwd,
                status: "empty",
                updatedAt: now(),
            });
        } catch (e) {
            stations.push({
                id: newId("st"),
                project: trimmed,
                status: "failed",
                error: e instanceof Error ? e.message : String(e),
                updatedAt: now(),
            });
        }
    }
    const wb: Workbench = {
        ...emptyWorkbench(options.title ?? "今日工作台"),
        stations,
    };
    // mark empty if no backend/task yet — keep empty until both set; use empty for project-only
    for (const s of wb.stations) {
        if (s.status !== "failed") s.status = "empty";
    }
    await saveWorkbench(wb);
    return wb;
}

export async function assignBackend(
    projectQuery: string,
    backendRaw: string,
): Promise<Workbench> {
    const wb = await loadWorkbench();
    const backend = normalizeBackendId(backendRaw);
    if (!backend) {
        throw new Error(
            `Unknown backend "${backendRaw}". Use: pi|claude|codex|grok|kimi`,
        );
    }
    const st = findStation(wb, projectQuery);
    st.backend = backend;
    st.updatedAt = now();
    recomputeStationStatus(st);
    await saveWorkbench(wb);
    return wb;
}

export async function setTask(
    projectQuery: string,
    task: string,
): Promise<Workbench> {
    const wb = await loadWorkbench();
    const st = findStation(wb, projectQuery);
    st.task = task.trim();
    st.updatedAt = now();
    if (st.status === "done" || st.status === "failed") {
        // allow re-run setup
        st.jobId = undefined;
        st.summary = undefined;
        st.error = undefined;
        st.pendingQuestion = undefined;
    }
    recomputeStationStatus(st);
    await saveWorkbench(wb);
    return wb;
}

export async function askUser(
    projectQuery: string,
    question: string,
): Promise<Workbench> {
    const wb = await loadWorkbench();
    const st = findStation(wb, projectQuery);
    st.status = "waiting_user";
    st.pendingQuestion = question.trim();
    st.updatedAt = now();
    await saveWorkbench(wb);
    return wb;
}

export async function answerUser(
    projectQuery: string,
    answer: string,
): Promise<Workbench> {
    const wb = await loadWorkbench();
    const st = findStation(wb, projectQuery);
    const q = st.pendingQuestion ?? "(question)";
    st.pendingQuestion = undefined;
    // Append answer into task context for restart
    const note = `\n\n[User answer to: ${q}]\n${answer.trim()}`;
    st.task = (st.task ?? "") + note;
    st.status =
        st.backend && st.task && st.project ? "ready" : st.status === "waiting_user" ? "ready" : st.status;
    recomputeStationStatus(st);
    await saveWorkbench(wb);
    return wb;
}

/**
 * Start all ready stations in parallel (or a subset by project names).
 */
export async function startWork(
    options: {
        projectsRoot: string;
        onlyProjects?: string[];
    },
): Promise<{ workbench: Workbench; results: Array<{ project: string; ok: boolean; summary: string }> }> {
    const wb = await loadWorkbench();
    let targets = wb.stations.filter((s) => s.status === "ready" || s.status === "failed");
    if (options.onlyProjects?.length) {
        const set = new Set(
            options.onlyProjects.map((p) => p.toLowerCase()),
        );
        targets = targets.filter(
            (s) => s.project && set.has(s.project.toLowerCase()),
        );
    }

    // also allow starting waiting_user? no — need answer first
    const runnable = targets.filter(
        (s) => s.project && s.backend && s.task && s.cwd,
    );

    for (const s of runnable) {
        s.status = "running";
        s.error = undefined;
        s.updatedAt = now();
    }
    await saveWorkbench(wb);

    const settled = await Promise.all(
        runnable.map(async (s) => {
            try {
                const result = await dispatchWorker({
                    backend: s.backend,
                    projectQuery: s.project!,
                    message: s.task!,
                    projectsRoot: options.projectsRoot,
                });
                return {
                    stationId: s.id,
                    project: s.project!,
                    ok: result.ok,
                    jobId: result.jobId,
                    summary: result.ok
                        ? (result.text ?? "done").slice(0, 2000)
                        : (result.error ?? "failed"),
                    error: result.ok ? undefined : result.error,
                };
            } catch (e) {
                return {
                    stationId: s.id,
                    project: s.project ?? "?",
                    ok: false,
                    jobId: undefined as string | undefined,
                    summary: e instanceof Error ? e.message : String(e),
                    error: e instanceof Error ? e.message : String(e),
                };
            }
        }),
    );

    // Single write after all workers finish (avoid race on workbench.json)
    const latest = await loadWorkbench();
    for (const r of settled) {
        const st = latest.stations.find((x) => x.id === r.stationId);
        if (!st) continue;
        st.jobId = r.jobId;
        st.updatedAt = now();
        if (r.ok) {
            st.status = "done";
            st.summary = r.summary;
            st.error = undefined;
        } else {
            st.status = "failed";
            st.error = r.error;
            st.summary = r.summary;
        }
    }
    await saveWorkbench(latest);

    return {
        workbench: latest,
        results: settled.map((r) => ({
            project: r.project,
            ok: r.ok,
            summary: r.summary.slice(0, 300),
        })),
    };
}

function findStation(wb: Workbench, projectQuery: string): WorkStation {
    const q = projectQuery.trim().toLowerCase();
    const st =
        wb.stations.find((s) => s.project?.toLowerCase() === q) ||
        wb.stations.find((s) => s.project?.toLowerCase().includes(q));
    if (!st) {
        throw new Error(
            `No station for project "${projectQuery}". Current: ${wb.stations.map((s) => s.project).join(", ") || "(none)"}`,
        );
    }
    return st;
}

function recomputeStationStatus(st: WorkStation): void {
    if (st.status === "running" || st.status === "waiting_user") return;
    if (st.status === "done" || st.status === "failed") {
        // stay until task reassigned
        if (st.task && st.backend && st.project && !st.jobId) {
            st.status = "ready";
        }
        return;
    }
    if (st.project && st.backend && st.task) {
        st.status = "ready";
    } else if (st.project) {
        st.status = "empty";
    }
}
