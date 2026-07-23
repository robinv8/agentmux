import type {
    PiRpcClient,
    ProjectEntry,
    ProjectInventoryItem,
    WorkerProbeResult,
    WorkerRecord,
    WorkerRegistry,
    WorkerStatus,
} from "./types.js";

export interface ProcessProbe {
    /** Return true if process with pid is alive. */
    isAlive(pid: number): boolean;
}

/** Default process probe using `process.kill(pid, 0)`. */
export const defaultProcessProbe: ProcessProbe = {
    isAlive(pid: number): boolean {
        if (!Number.isFinite(pid) || pid <= 0) return false;
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    },
};

/**
 * Classify coarse status from registry record + optional probe data.
 * Pure function — no I/O.
 */
export function classifyStatus(
    worker: WorkerRecord | undefined,
    probe: WorkerProbeResult | undefined,
): WorkerStatus {
    if (!worker) {
        return "offline";
    }

    if (!probe) {
        // Registered but never probed
        return "unknown";
    }

    if (!probe.alive) {
        return "offline";
    }

    if (probe.isStreaming === true) {
        return "running";
    }

    if (probe.isStreaming === false) {
        return "idle";
    }

    // Alive by pid but no RPC detail
    return "idle";
}

/**
 * Probe a single worker: process liveness, then optional RPC get_state.
 */
export async function probeWorker(
    worker: WorkerRecord,
    options: {
        processProbe?: ProcessProbe;
        rpcClient?: PiRpcClient;
    } = {},
): Promise<WorkerProbeResult> {
    const processProbe = options.processProbe ?? defaultProcessProbe;

    if (worker.pid !== undefined) {
        const alive = processProbe.isAlive(worker.pid);
        if (!alive) {
            return { alive: false, error: `pid ${worker.pid} not running` };
        }
    }

    if (worker.rpcSocketPath && options.rpcClient) {
        try {
            const state = await options.rpcClient.getState(worker.rpcSocketPath);
            return {
                alive: true,
                isStreaming: state.isStreaming,
                sessionId: state.sessionId,
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // If we have a live pid but RPC failed, still "alive" without streaming info
            if (worker.pid !== undefined && processProbe.isAlive(worker.pid)) {
                return {
                    alive: true,
                    error: `rpc failed: ${message}`,
                };
            }
            return { alive: false, error: message };
        }
    }

    if (worker.pid !== undefined) {
        return { alive: processProbe.isAlive(worker.pid) };
    }

    // Registered without pid or socket — cannot confirm
    return { alive: false, error: "no pid or rpc socket" };
}

/**
 * Build inventory rows: all projects + optional worker/status.
 */
export async function buildInventory(
    projects: ProjectEntry[],
    registry: WorkerRegistry,
    options: {
        processProbe?: ProcessProbe;
        rpcClient?: PiRpcClient;
        /** When false, skip probes and mark registered as unknown. Default true. */
        probe?: boolean;
    } = {},
): Promise<ProjectInventoryItem[]> {
    const shouldProbe = options.probe !== false;
    const items: ProjectInventoryItem[] = [];

    for (const project of projects) {
        const worker = registry.workers[project.id];
        let probe: WorkerProbeResult | undefined;
        if (worker && shouldProbe) {
            probe = await probeWorker(worker, {
                processProbe: options.processProbe,
                rpcClient: options.rpcClient,
            });
        }
        const status = classifyStatus(worker, probe);
        items.push({
            project,
            worker,
            status,
            detail: probe?.error,
        });
    }

    return items;
}

export function formatInventoryTable(items: ProjectInventoryItem[]): string {
    const lines: string[] = [];
    lines.push(
        pad("PROJECT", 28) +
            pad("STATUS", 12) +
            pad("WORKER", 10) +
            "CWD",
    );
    lines.push("-".repeat(80));
    for (const item of items) {
        const hasWorker = item.worker ? "yes" : "no";
        lines.push(
            pad(item.project.id, 28) +
                pad(item.status, 12) +
                pad(hasWorker, 10) +
                item.project.cwd,
        );
    }
    return lines.join("\n");
}

function pad(s: string, n: number): string {
    if (s.length >= n) return `${s.slice(0, n - 1)} `;
    return s + " ".repeat(n - s.length);
}
