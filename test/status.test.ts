import { describe, expect, test } from "bun:test";
import {
    buildInventory,
    classifyStatus,
    probeWorker,
} from "../src/status.ts";
import { FakePiRpcClient } from "../src/rpc-client.ts";
import type { WorkerRecord } from "../src/types.ts";

describe("classifyStatus", () => {
    test("no worker → offline", () => {
        expect(classifyStatus(undefined, undefined)).toBe("offline");
    });

    test("worker without probe → unknown", () => {
        const w: WorkerRecord = {
            projectId: "a",
            cwd: "/a",
            mode: "rpc",
            updatedAt: "t",
        };
        expect(classifyStatus(w, undefined)).toBe("unknown");
    });

    test("dead probe → offline", () => {
        const w: WorkerRecord = {
            projectId: "a",
            cwd: "/a",
            mode: "rpc",
            updatedAt: "t",
            pid: 1,
        };
        expect(classifyStatus(w, { alive: false })).toBe("offline");
    });

    test("streaming → running", () => {
        const w: WorkerRecord = {
            projectId: "a",
            cwd: "/a",
            mode: "rpc",
            updatedAt: "t",
            pid: 1,
        };
        expect(
            classifyStatus(w, { alive: true, isStreaming: true }),
        ).toBe("running");
    });

    test("alive not streaming → idle", () => {
        const w: WorkerRecord = {
            projectId: "a",
            cwd: "/a",
            mode: "rpc",
            updatedAt: "t",
            pid: 1,
        };
        expect(
            classifyStatus(w, { alive: true, isStreaming: false }),
        ).toBe("idle");
    });
});

describe("probeWorker", () => {
    test("dead pid → not alive", async () => {
        const probe = await probeWorker(
            {
                projectId: "a",
                cwd: "/a",
                mode: "rpc",
                updatedAt: "t",
                pid: 999_999_999,
            },
            {
                processProbe: { isAlive: () => false },
            },
        );
        expect(probe.alive).toBe(false);
    });

    test("rpc get_state drives streaming flag", async () => {
        const fake = new FakePiRpcClient();
        fake.states.set("/s.sock", {
            isStreaming: true,
            sessionId: "s1",
        });
        const probe = await probeWorker(
            {
                projectId: "a",
                cwd: "/a",
                mode: "rpc",
                updatedAt: "t",
                pid: 1,
                rpcSocketPath: "/s.sock",
            },
            {
                processProbe: { isAlive: () => true },
                rpcClient: fake,
            },
        );
        expect(probe.alive).toBe(true);
        expect(probe.isStreaming).toBe(true);
    });
});

describe("buildInventory", () => {
    test("joins projects with registry status", async () => {
        const fake = new FakePiRpcClient();
        fake.states.set("/alpha.sock", { isStreaming: false });
        const items = await buildInventory(
            [
                { id: "alpha", name: "alpha", cwd: "/p/alpha" },
                { id: "beta", name: "beta", cwd: "/p/beta" },
            ],
            {
                version: 1,
                workers: {
                    alpha: {
                        projectId: "alpha",
                        cwd: "/p/alpha",
                        mode: "rpc",
                        updatedAt: "t",
                        pid: 1,
                        rpcSocketPath: "/alpha.sock",
                    },
                },
            },
            {
                processProbe: { isAlive: (pid) => pid === 1 },
                rpcClient: fake,
            },
        );
        const alpha = items.find((i) => i.project.id === "alpha");
        const beta = items.find((i) => i.project.id === "beta");
        expect(alpha?.status).toBe("idle");
        expect(beta?.status).toBe("offline");
        expect(beta?.worker).toBeUndefined();
    });
});
