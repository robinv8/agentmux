/** Coarse worker status for MVP. */
export type WorkerStatus = "running" | "idle" | "offline" | "unknown";

/** One discovered project root under the Projects directory. */
export interface ProjectEntry {
    /** Stable id: directory basename */
    id: string;
    name: string;
    cwd: string;
}

/** Persisted mapping from project → worker connection. */
export interface WorkerRecord {
    projectId: string;
    cwd: string;
    /** Absolute path to a unix domain socket, or host:port for TCP (future). */
    rpcSocketPath?: string;
    /** PID of the worker process if known. */
    pid?: number;
    /** How the worker was registered. */
    mode: "rpc" | "manual";
    updatedAt: string;
}

export interface WorkerRegistry {
    version: 1;
    workers: Record<string, WorkerRecord>;
}

/** Snapshot used by list / status surfaces. */
export interface ProjectInventoryItem {
    project: ProjectEntry;
    worker?: WorkerRecord;
    status: WorkerStatus;
    detail?: string;
}

/** Probe result from process table or RPC get_state. */
export interface WorkerProbeResult {
    alive: boolean;
    /** When RPC responded, whether the agent is currently streaming a turn. */
    isStreaming?: boolean;
    sessionId?: string;
    error?: string;
}

/** Thin RPC boundary used by status + dispatch (injectable in tests). */
export interface PiRpcClient {
    getState(socketPath: string): Promise<{
        isStreaming: boolean;
        sessionId?: string;
        messageCount?: number;
    }>;
    prompt(
        socketPath: string,
        message: string,
        options?: { streamingBehavior?: "steer" | "followUp" },
    ): Promise<{ success: boolean; error?: string }>;
}

export interface DispatchResult {
    ok: boolean;
    projectId: string;
    message: string;
    error?: string;
    acceptedAt?: string;
}
