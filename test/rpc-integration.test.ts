/**
 * Integration: real Unix socket JSONL bridge + SocketPiRpcClient.
 * Spawns a minimal mock "pi" that speaks the subset of RPC we use
 * (get_state / prompt responses). Does not require the real pi binary.
 */
import { describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SocketPiRpcClient } from "../src/rpc-client.ts";
import {
    dispatchToProject,
} from "../src/dispatch.ts";
import { classifyStatus, probeWorker } from "../src/status.ts";
import {
    emptyRegistry,
    saveRegistry,
    upsertWorker,
} from "../src/registry.ts";
import { discoverProjects } from "../src/discovery.ts";

async function startMockPiRpcServer(socketPath: string, state: {
    isStreaming: boolean;
    receivedPrompts: string[];
}) {
    await mkdir(path.dirname(socketPath), { recursive: true });
    const server = createServer((conn) => {
        let buf = "";
        conn.on("data", (chunk) => {
            buf += chunk.toString("utf8");
            let nl: number;
            while ((nl = buf.indexOf("\n")) !== -1) {
                let line = buf.slice(0, nl);
                buf = buf.slice(nl + 1);
                if (line.endsWith("\r")) line = line.slice(0, -1);
                if (!line.trim()) continue;
                let cmd: Record<string, unknown>;
                try {
                    cmd = JSON.parse(line) as Record<string, unknown>;
                } catch {
                    continue;
                }
                const id = cmd.id;
                if (cmd.type === "get_state") {
                    conn.write(
                        `${JSON.stringify({
                            id,
                            type: "response",
                            command: "get_state",
                            success: true,
                            data: {
                                isStreaming: state.isStreaming,
                                sessionId: "mock-session",
                                messageCount: state.receivedPrompts.length,
                            },
                        })}\n`,
                    );
                } else if (cmd.type === "prompt") {
                    const message = String(cmd.message ?? "");
                    state.receivedPrompts.push(message);
                    conn.write(
                        `${JSON.stringify({
                            id,
                            type: "response",
                            command: "prompt",
                            success: true,
                        })}\n`,
                    );
                    // Optional event so clients can observe accept
                    conn.write(
                        `${JSON.stringify({
                            type: "agent_start",
                        })}\n`,
                    );
                } else {
                    conn.write(
                        `${JSON.stringify({
                            id,
                            type: "response",
                            command: String(cmd.type),
                            success: false,
                            error: "unknown command",
                        })}\n`,
                    );
                }
            }
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, () => resolve());
    });

    return {
        stop: async () => {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        },
    };
}

describe("SocketPiRpcClient + mock worker", () => {
    test("get_state and prompt over real socket", async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "pi-cmd-rpc-"));
        const socketPath = path.join(dir, "worker.sock");
        const state = { isStreaming: true, receivedPrompts: [] as string[] };
        const server = await startMockPiRpcServer(socketPath, state);
        try {
            const client = new SocketPiRpcClient();
            const gs = await client.getState(socketPath);
            expect(gs.isStreaming).toBe(true);
            expect(gs.sessionId).toBe("mock-session");

            const pr = await client.prompt(socketPath, "ping from test");
            expect(pr.success).toBe(true);
            expect(state.receivedPrompts).toEqual(["ping from test"]);
        } finally {
            await server.stop();
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("dispatch + status against mock worker registry", async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "pi-cmd-int-"));
        const projectsRoot = path.join(dir, "Projects");
        const alpha = path.join(projectsRoot, "alpha");
        await mkdir(alpha, { recursive: true });
        await writeFile(path.join(alpha, "package.json"), "{}");

        const socketPath = path.join(dir, "alpha.sock");
        const state = { isStreaming: false, receivedPrompts: [] as string[] };
        const server = await startMockPiRpcServer(socketPath, state);

        const registryPath = path.join(dir, "workers.json");
        let reg = emptyRegistry();
        reg = upsertWorker(reg, {
            projectId: "alpha",
            cwd: alpha,
            mode: "rpc",
            updatedAt: new Date().toISOString(),
            pid: process.pid,
            rpcSocketPath: socketPath,
        });
        await saveRegistry(registryPath, reg);

        try {
            const projects = await discoverProjects({ projectsRoot });
            expect(projects.map((p) => p.id)).toContain("alpha");

            const client = new SocketPiRpcClient();
            const dispatchResult = await dispatchToProject({
                projectQuery: "alpha",
                message: "integration-dispatch-hello",
                projects,
                registry: reg,
                rpcClient: client,
            });
            expect(dispatchResult.ok).toBe(true);
            expect(state.receivedPrompts).toContain("integration-dispatch-hello");

            const online = await probeWorker(reg.workers.alpha!, {
                processProbe: { isAlive: () => true },
                rpcClient: client,
            });
            expect(classifyStatus(reg.workers.alpha, online)).toBe("idle");

            const dead = await probeWorker(
                {
                    ...reg.workers.alpha!,
                    pid: 1,
                    rpcSocketPath: path.join(dir, "missing.sock"),
                },
                {
                    processProbe: { isAlive: () => false },
                    rpcClient: client,
                },
            );
            expect(classifyStatus(reg.workers.alpha, dead)).toBe("offline");
        } finally {
            await server.stop();
            await rm(dir, { recursive: true, force: true });
        }
    });
});
