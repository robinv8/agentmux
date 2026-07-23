import { describe, expect, test } from "bun:test";
import {
    getBackend,
    listDispatchableBackends,
    normalizeBackendId,
} from "../src/workers/index.ts";
import { spawnCli } from "../src/workers/spawn-cli.ts";

describe("normalizeBackendId", () => {
    test("maps aliases", () => {
        expect(normalizeBackendId("Claude")).toBe("claude");
        expect(normalizeBackendId("claude-code")).toBe("claude");
        expect(normalizeBackendId("openai")).toBe("codex");
        expect(normalizeBackendId("xai")).toBe("grok");
        expect(normalizeBackendId("nope")).toBeUndefined();
    });
});

describe("backends registry", () => {
    test("all expected backends registered", () => {
        for (const id of ["pi", "claude", "codex", "grok", "kimi"] as const) {
            expect(getBackend(id)?.id).toBe(id);
        }
    });

    test("listDispatchableBackends returns entries", async () => {
        const list = await listDispatchableBackends();
        expect(list.length).toBeGreaterThanOrEqual(5);
        expect(list.some((x) => x.id === "pi")).toBe(true);
    });
});

describe("spawnCli", () => {
    test("runs a simple command and captures stdout", async () => {
        const r = await spawnCli({
            command: "echo",
            args: ["hello-brother"],
            cwd: process.cwd(),
            timeoutMs: 5000,
        });
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("hello-brother");
        expect(r.timedOut).toBe(false);
    });
});
