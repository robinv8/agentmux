import { spawn } from "node:child_process";

export interface SpawnCliOptions {
    command: string;
    args: string[];
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
}

export interface SpawnCliResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
}

/**
 * Run a CLI to completion, capturing stdout/stderr. Used by worker backends.
 */
export function spawnCli(options: SpawnCliOptions): Promise<SpawnCliResult> {
    const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    const started = Date.now();

    return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let settled = false;

        const child = spawn(options.command, options.args, {
            cwd: options.cwd,
            env: { ...process.env, ...options.env },
            stdio: ["ignore", "pipe", "pipe"],
        });

        const timer = setTimeout(() => {
            timedOut = true;
            try {
                child.kill("SIGTERM");
            } catch {
                // ignore
            }
            setTimeout(() => {
                try {
                    child.kill("SIGKILL");
                } catch {
                    // ignore
                }
            }, 2000);
        }, timeoutMs);

        child.stdout?.on("data", (c: Buffer) => {
            const s = c.toString("utf8");
            stdout += s;
            options.onStdout?.(s);
        });
        child.stderr?.on("data", (c: Buffer) => {
            const s = c.toString("utf8");
            stderr += s;
            options.onStderr?.(s);
        });

        const finish = (code: number | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
                exitCode: code,
                stdout,
                stderr,
                timedOut,
                durationMs: Date.now() - started,
            });
        };

        child.on("error", (err) => {
            stderr += err.message;
            finish(1);
        });
        child.on("close", (code) => finish(code));
    });
}

export async function which(
    name: string,
    pathEnv = process.env.PATH ?? "",
): Promise<string | undefined> {
    const { access } = await import("node:fs/promises");
    const { constants } = await import("node:fs");
    const path = await import("node:path");
    for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
        const candidate = path.join(dir, name);
        try {
            await access(candidate, constants.X_OK);
            return candidate;
        } catch {
            // next
        }
    }
    return undefined;
}
