import type {
    DispatchResult,
    PiRpcClient,
    ProjectEntry,
    WorkerRecord,
    WorkerRegistry,
} from "./types.js";
import { resolveProjectTarget } from "./discovery.js";
import { getWorker } from "./registry.js";

export interface DispatchOptions {
    projectQuery: string;
    message: string;
    projects: ProjectEntry[];
    registry: WorkerRegistry;
    rpcClient: PiRpcClient;
    now?: () => Date;
    streamingBehavior?: "steer" | "followUp";
}

/**
 * Resolve target project + worker, then send prompt via Pi RPC client.
 * Does not touch TUIs; requires a registered worker with rpcSocketPath.
 */
export async function dispatchToProject(
    options: DispatchOptions,
): Promise<DispatchResult> {
    const now = options.now ?? (() => new Date());
    const message = options.message.trim();
    if (!message) {
        return {
            ok: false,
            projectId: options.projectQuery,
            message: "",
            error: "Dispatch message is empty",
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
        };
    }

    const worker: WorkerRecord | undefined = getWorker(
        options.registry,
        project.id,
    );
    if (!worker) {
        return {
            ok: false,
            projectId: project.id,
            message,
            error: `No worker registered for project "${project.id}". Start a worker and register it first.`,
        };
    }

    if (!worker.rpcSocketPath) {
        return {
            ok: false,
            projectId: project.id,
            message,
            error: `Worker for "${project.id}" has no rpcSocketPath`,
        };
    }

    try {
        const response = await options.rpcClient.prompt(
            worker.rpcSocketPath,
            message,
            { streamingBehavior: options.streamingBehavior },
        );
        if (!response.success) {
            return {
                ok: false,
                projectId: project.id,
                message,
                error: response.error ?? "RPC prompt rejected",
            };
        }
        return {
            ok: true,
            projectId: project.id,
            message,
            acceptedAt: now().toISOString(),
        };
    } catch (err) {
        return {
            ok: false,
            projectId: project.id,
            message,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

/**
 * Resolve which worker record would receive a dispatch (no I/O).
 * Used by routing unit tests.
 */
export function resolveDispatchTarget(
    projectQuery: string,
    projects: ProjectEntry[],
    registry: WorkerRegistry,
): { project: ProjectEntry; worker: WorkerRecord } {
    const project = resolveProjectTarget(projectQuery, projects);
    const worker = getWorker(registry, project.id);
    if (!worker) {
        throw new Error(`No worker registered for project "${project.id}"`);
    }
    if (!worker.rpcSocketPath) {
        throw new Error(`Worker for "${project.id}" has no rpcSocketPath`);
    }
    return { project, worker };
}
