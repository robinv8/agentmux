import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkerRecord, WorkerRegistry } from "./types.js";

export const REGISTRY_VERSION = 1 as const;

export function emptyRegistry(): WorkerRegistry {
    return { version: REGISTRY_VERSION, workers: {} };
}

/**
 * Default registry path: ~/.pi/agent/workers.json
 * Injectable for tests via `registryPath`.
 */
export function defaultRegistryPath(homeDir?: string): string {
    const home = homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? "";
    if (!home) {
        throw new Error("Cannot resolve home directory for worker registry");
    }
    return path.join(home, ".pi", "agent", "workers.json");
}

export async function loadRegistry(
    registryPath: string,
): Promise<WorkerRegistry> {
    try {
        const raw = await readFile(registryPath, "utf8");
        return parseRegistryJson(raw);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
            return emptyRegistry();
        }
        throw err;
    }
}

export function parseRegistryJson(raw: string): WorkerRegistry {
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        throw new Error("Worker registry is not valid JSON");
    }

    if (!data || typeof data !== "object") {
        throw new Error("Worker registry root must be an object");
    }

    const obj = data as Record<string, unknown>;
    const version = obj.version;
    if (version !== 1) {
        throw new Error(
            `Unsupported registry version: ${String(version)} (expected 1)`,
        );
    }

    const workersIn = obj.workers;
    if (!workersIn || typeof workersIn !== "object" || Array.isArray(workersIn)) {
        throw new Error("Worker registry.workers must be an object");
    }

    const workers: Record<string, WorkerRecord> = {};
    for (const [key, value] of Object.entries(
        workersIn as Record<string, unknown>,
    )) {
        const rec = parseWorkerRecord(key, value);
        workers[rec.projectId] = rec;
    }

    return { version: 1, workers };
}

function parseWorkerRecord(key: string, value: unknown): WorkerRecord {
    if (!value || typeof value !== "object") {
        throw new Error(`Invalid worker record for "${key}"`);
    }
    const v = value as Record<string, unknown>;
    const projectId =
        typeof v.projectId === "string" && v.projectId.length > 0
            ? v.projectId
            : key;
    if (typeof v.cwd !== "string" || !v.cwd) {
        throw new Error(`Worker "${key}" missing cwd`);
    }
    const mode = v.mode === "manual" ? "manual" : "rpc";
    const updatedAt =
        typeof v.updatedAt === "string" ? v.updatedAt : new Date(0).toISOString();

    return {
        projectId,
        cwd: v.cwd,
        rpcSocketPath:
            typeof v.rpcSocketPath === "string" ? v.rpcSocketPath : undefined,
        pid: typeof v.pid === "number" && Number.isFinite(v.pid) ? v.pid : undefined,
        mode,
        updatedAt,
    };
}

export async function saveRegistry(
    registryPath: string,
    registry: WorkerRegistry,
): Promise<void> {
    const dir = path.dirname(registryPath);
    await mkdir(dir, { recursive: true });
    const body = `${JSON.stringify(registry, null, 2)}\n`;
    await writeFile(registryPath, body, "utf8");
}

export function upsertWorker(
    registry: WorkerRegistry,
    record: WorkerRecord,
): WorkerRegistry {
    return {
        ...registry,
        workers: {
            ...registry.workers,
            [record.projectId]: record,
        },
    };
}

export function removeWorker(
    registry: WorkerRegistry,
    projectId: string,
): WorkerRegistry {
    const workers = { ...registry.workers };
    delete workers[projectId];
    return { ...registry, workers };
}

export function getWorker(
    registry: WorkerRegistry,
    projectId: string,
): WorkerRecord | undefined {
    return registry.workers[projectId];
}
