import { describe, expect, test } from "bun:test";
import {
    dispatchToProject,
    resolveDispatchTarget,
} from "../src/dispatch.ts";
import { FakePiRpcClient } from "../src/rpc-client.ts";

const projects = [
    { id: "alpha", name: "alpha", cwd: "/p/alpha" },
    { id: "beta", name: "beta", cwd: "/p/beta" },
];

const registry = {
    version: 1 as const,
    workers: {
        alpha: {
            projectId: "alpha",
            cwd: "/p/alpha",
            mode: "rpc" as const,
            updatedAt: "t",
            rpcSocketPath: "/tmp/alpha.sock",
            pid: 10,
        },
    },
};

describe("resolveDispatchTarget", () => {
    test("resolves registered worker", () => {
        const { project, worker } = resolveDispatchTarget(
            "alpha",
            projects,
            registry,
        );
        expect(project.id).toBe("alpha");
        expect(worker.rpcSocketPath).toBe("/tmp/alpha.sock");
    });

    test("throws when no worker", () => {
        expect(() =>
            resolveDispatchTarget("beta", projects, registry),
        ).toThrow(/No worker registered/);
    });
});

describe("dispatchToProject", () => {
    test("sends prompt through rpc client on success path", async () => {
        const fake = new FakePiRpcClient();
        const result = await dispatchToProject({
            projectQuery: "alpha",
            message: "hello worker",
            projects,
            registry,
            rpcClient: fake,
            now: () => new Date("2026-07-23T12:00:00.000Z"),
        });
        expect(result.ok).toBe(true);
        expect(result.projectId).toBe("alpha");
        expect(result.acceptedAt).toBe("2026-07-23T12:00:00.000Z");
        expect(fake.prompts).toEqual([
            { socketPath: "/tmp/alpha.sock", message: "hello worker" },
        ]);
    });

    test("fails when project unknown", async () => {
        const fake = new FakePiRpcClient();
        const result = await dispatchToProject({
            projectQuery: "nope",
            message: "x",
            projects,
            registry,
            rpcClient: fake,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/Unknown project/);
        expect(fake.prompts).toHaveLength(0);
    });

    test("fails when no worker registered", async () => {
        const fake = new FakePiRpcClient();
        const result = await dispatchToProject({
            projectQuery: "beta",
            message: "x",
            projects,
            registry,
            rpcClient: fake,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/No worker registered/);
    });

    test("propagates rpc rejection", async () => {
        const fake = new FakePiRpcClient();
        fake.failPrompt = true;
        const result = await dispatchToProject({
            projectQuery: "alpha",
            message: "x",
            projects,
            registry,
            rpcClient: fake,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/fake prompt rejected/);
    });

    test("rejects empty message", async () => {
        const fake = new FakePiRpcClient();
        const result = await dispatchToProject({
            projectQuery: "alpha",
            message: "   ",
            projects,
            registry,
            rpcClient: fake,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/empty/);
    });
});
