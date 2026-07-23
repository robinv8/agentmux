import { describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    formatLocalAgentsTable,
    scanLocalAgents,
} from "../src/local-agents.ts";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("scanLocalAgents", () => {
    test("finds agentmux entry and marks pi bundled when present", async () => {
        const agents = await scanLocalAgents({
            packageRoot: pkgRoot,
            pathEnv: `${path.join(pkgRoot, "bin")}:/usr/bin`,
            processLines: [
                "12345 grok some args",
                "12346 codex resume",
                "12347 other",
            ],
            skipVersion: true,
            home: "/nonexistent-home-for-test",
        });

        const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
        expect(byId.agentmux).toBeDefined();
        expect(byId.pi?.available).toBe(true);
        expect(byId.pi?.dispatchable).toBe(true);
        expect(byId.grok?.runningCount).toBeGreaterThanOrEqual(1);
        expect(byId.codex?.runningCount).toBeGreaterThanOrEqual(1);
        expect(byId.claude?.dispatchable).toBe(false);
    });

    test("formatLocalAgentsTable includes headers", () => {
        const table = formatLocalAgentsTable([
            {
                id: "pi",
                name: "Pi",
                kind: "bundled-worker",
                available: true,
                runningCount: 0,
                dispatchable: true,
                path: "/x/pi",
            },
        ]);
        expect(table).toContain("ID");
        expect(table).toContain("pi");
        expect(table).toContain("WORKER");
    });
});
