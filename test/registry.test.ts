import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    emptyRegistry,
    getWorker,
    loadRegistry,
    parseRegistryJson,
    removeWorker,
    saveRegistry,
    upsertWorker,
} from "../src/registry.ts";

describe("parseRegistryJson", () => {
    test("parses valid v1 registry", () => {
        const reg = parseRegistryJson(
            JSON.stringify({
                version: 1,
                workers: {
                    alpha: {
                        projectId: "alpha",
                        cwd: "/tmp/alpha",
                        rpcSocketPath: "/tmp/alpha.sock",
                        pid: 42,
                        mode: "rpc",
                        updatedAt: "2026-01-01T00:00:00.000Z",
                    },
                },
            }),
        );
        expect(reg.version).toBe(1);
        expect(reg.workers.alpha?.pid).toBe(42);
        expect(reg.workers.alpha?.rpcSocketPath).toBe("/tmp/alpha.sock");
    });

    test("rejects wrong version", () => {
        expect(() =>
            parseRegistryJson(JSON.stringify({ version: 99, workers: {} })),
        ).toThrow(/Unsupported registry version/);
    });

    test("rejects invalid JSON", () => {
        expect(() => parseRegistryJson("not-json")).toThrow(/not valid JSON/);
    });
});

describe("registry mutators", () => {
    test("upsert and get and remove", () => {
        let reg = emptyRegistry();
        reg = upsertWorker(reg, {
            projectId: "alpha",
            cwd: "/p/alpha",
            mode: "rpc",
            updatedAt: "t1",
            rpcSocketPath: "/s/alpha.sock",
        });
        expect(getWorker(reg, "alpha")?.cwd).toBe("/p/alpha");
        reg = removeWorker(reg, "alpha");
        expect(getWorker(reg, "alpha")).toBeUndefined();
    });
});

describe("loadRegistry / saveRegistry", () => {
    test("round-trips to disk; missing file yields empty", async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "pi-cmd-reg-"));
        try {
            const file = path.join(dir, "workers.json");
            const missing = await loadRegistry(file);
            expect(missing.workers).toEqual({});

            const next = upsertWorker(emptyRegistry(), {
                projectId: "beta",
                cwd: "/p/beta",
                mode: "manual",
                updatedAt: "t2",
            });
            await saveRegistry(file, next);
            const raw = await readFile(file, "utf8");
            expect(raw).toContain("beta");
            const loaded = await loadRegistry(file);
            expect(loaded.workers.beta?.cwd).toBe("/p/beta");
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
