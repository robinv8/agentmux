import path from "node:path";
import os from "node:os";
import {
    discoverProjects,
    resolveProjectTarget,
    type DiscoverOptions,
} from "./discovery.js";
import {
    defaultRegistryPath,
    getWorker,
    loadRegistry,
    saveRegistry,
    upsertWorker,
} from "./registry.js";
import {
    buildInventory,
    formatInventoryTable,
    probeWorker,
    classifyStatus,
    defaultProcessProbe,
    type ProcessProbe,
} from "./status.js";
import { dispatchToProject } from "./dispatch.js";
import {
    SocketPiRpcClient,
    startWorkerBridge,
    type WorkerBridge,
} from "./rpc-client.js";
import type {
    DispatchResult,
    PiRpcClient,
    ProjectInventoryItem,
    WorkerRecord,
    WorkerStatus,
} from "./types.js";
import { resolvePiBinary } from "./pi-path.js";

export interface CommanderConfig {
    projectsRoot: string;
    registryPath: string;
    socketsDir: string;
    rpcClient?: PiRpcClient;
    processProbe?: ProcessProbe;
    piBinary?: string;
    /** Extra CLI args for `pi` (provider/model/etc.) */
    piArgs?: string[];
    requireProjectMarker?: boolean;
}

export function defaultCommanderConfig(
    overrides: Partial<CommanderConfig> = {},
): CommanderConfig {
    const home = process.env.HOME ?? os.homedir();
    return {
        projectsRoot:
            overrides.projectsRoot ??
            process.env.AGENTMUX_PROJECTS_ROOT ??
            path.join(home, "Projects"),
        registryPath:
            overrides.registryPath ??
            process.env.AGENTMUX_REGISTRY ??
            defaultRegistryPath(home),
        socketsDir:
            overrides.socketsDir ??
            process.env.AGENTMUX_SOCKETS ??
            path.join(home, ".pi", "agent", "worker-sockets"),
        rpcClient: overrides.rpcClient ?? new SocketPiRpcClient(),
        processProbe: overrides.processProbe ?? defaultProcessProbe,
        piBinary: overrides.piBinary ?? resolvePiBinary(),
        piArgs: overrides.piArgs,
        requireProjectMarker: overrides.requireProjectMarker ?? false,
    };
}

export async function listProjects(
    config: CommanderConfig,
): Promise<{ items: ProjectInventoryItem[]; table: string }> {
    const projects = await discoverProjects({
        projectsRoot: config.projectsRoot,
        requireProjectMarker: config.requireProjectMarker,
    });
    const registry = await loadRegistry(config.registryPath);
    const items = await buildInventory(projects, registry, {
        processProbe: config.processProbe,
        rpcClient: config.rpcClient,
        probe: true,
    });
    return { items, table: formatInventoryTable(items) };
}

export async function statusForProject(
    config: CommanderConfig,
    projectQuery: string,
): Promise<{
    projectId: string;
    status: WorkerStatus;
    detail?: string;
    worker?: WorkerRecord;
}> {
    const projects = await discoverProjects({
        projectsRoot: config.projectsRoot,
        requireProjectMarker: config.requireProjectMarker,
    });
    const project = resolveProjectTarget(projectQuery, projects);
    const registry = await loadRegistry(config.registryPath);
    const worker = getWorker(registry, project.id);
    if (!worker) {
        return {
            projectId: project.id,
            status: "offline",
            detail: "no worker registered",
        };
    }
    const probe = await probeWorker(worker, {
        processProbe: config.processProbe,
        rpcClient: config.rpcClient,
    });
    return {
        projectId: project.id,
        status: classifyStatus(worker, probe),
        detail: probe.error,
        worker,
    };
}

export async function dispatch(
    config: CommanderConfig,
    projectQuery: string,
    message: string,
): Promise<DispatchResult> {
    const projects = await discoverProjects({
        projectsRoot: config.projectsRoot,
        requireProjectMarker: config.requireProjectMarker,
    });
    const registry = await loadRegistry(config.registryPath);
    if (!config.rpcClient) {
        return {
            ok: false,
            projectId: projectQuery,
            message,
            error: "No RPC client configured",
        };
    }
    return dispatchToProject({
        projectQuery,
        message,
        projects,
        registry,
        rpcClient: config.rpcClient,
    });
}

/**
 * Start a local Pi RPC worker for a project and register it.
 */
export async function registerWorker(
    config: CommanderConfig,
    projectQuery: string,
): Promise<{ record: WorkerRecord; bridge: WorkerBridge }> {
    const projects = await discoverProjects({
        projectsRoot: config.projectsRoot,
        requireProjectMarker: config.requireProjectMarker,
    });
    const project = resolveProjectTarget(projectQuery, projects);
    const socketPath = path.join(
        config.socketsDir,
        `${project.id}.sock`,
    );

    const bridge = await startWorkerBridge({
        cwd: project.cwd,
        socketPath,
        piBinary: config.piBinary,
    });

    const record: WorkerRecord = {
        projectId: project.id,
        cwd: project.cwd,
        rpcSocketPath: bridge.socketPath,
        pid: bridge.pid,
        mode: "rpc",
        updatedAt: new Date().toISOString(),
    };

    const registry = await loadRegistry(config.registryPath);
    await saveRegistry(config.registryPath, upsertWorker(registry, record));

    return { record, bridge };
}

/**
 * Register an already-running worker by socket + optional pid (no spawn).
 */
export async function registerExternalWorker(
    config: CommanderConfig,
    projectQuery: string,
    opts: { rpcSocketPath: string; pid?: number },
): Promise<WorkerRecord> {
    const projects = await discoverProjects({
        projectsRoot: config.projectsRoot,
        requireProjectMarker: config.requireProjectMarker,
    });
    const project = resolveProjectTarget(projectQuery, projects);
    const record: WorkerRecord = {
        projectId: project.id,
        cwd: project.cwd,
        rpcSocketPath: opts.rpcSocketPath,
        pid: opts.pid,
        mode: "rpc",
        updatedAt: new Date().toISOString(),
    };
    const registry = await loadRegistry(config.registryPath);
    await saveRegistry(config.registryPath, upsertWorker(registry, record));
    return record;
}

export type { DiscoverOptions };
