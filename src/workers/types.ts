export type WorkerBackendId =
    | "pi"
    | "claude"
    | "codex"
    | "grok"
    | "kimi";

export interface WorkerRunRequest {
    backend: WorkerBackendId;
    /** Absolute project directory */
    cwd: string;
    /** Project basename (for logging) */
    projectId: string;
    message: string;
    /** Soft timeout ms (default 10 min) */
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
}

export interface WorkerRunResult {
    ok: boolean;
    backend: WorkerBackendId;
    projectId: string;
    message: string;
    text?: string;
    error?: string;
    exitCode?: number | null;
    durationMs: number;
}

export interface WorkerBackend {
    id: WorkerBackendId;
    /** Human label */
    name: string;
    /** Whether binary is found and we know a non-interactive invocation */
    isAvailable(env?: NodeJS.ProcessEnv): Promise<boolean>;
    /** Absolute path to binary if known */
    resolveBinary(env?: NodeJS.ProcessEnv): Promise<string | undefined>;
    run(req: WorkerRunRequest): Promise<WorkerRunResult>;
}
