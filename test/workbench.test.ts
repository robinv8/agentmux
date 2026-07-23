import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
    assignBackend,
    formatWorkbench,
    loadWorkbench,
    saveWorkbench,
    setProjects,
    setTask,
    emptyWorkbench,
    defaultWorkbenchPath,
} from "../src/workbench.ts";

describe("workbench", () => {
    test("set projects, assign backend, set task → ready", async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "wb-fx-"));
        const projectsRoot = path.join(dir, "Projects");
        await mkdir(path.join(projectsRoot, "alpha"), { recursive: true });
        await mkdir(path.join(projectsRoot, "beta"), { recursive: true });
        await writeFile(path.join(projectsRoot, "alpha", "package.json"), "{}");
        await writeFile(path.join(projectsRoot, "beta", "README.md"), "b");

        const wbPath = path.join(dir, "workbench.json");
        process.env.AGENTMUX_WORKBENCH_PATH = wbPath;

        try {
            const wb1 = await setProjects(["alpha", "beta"], {
                projectsRoot,
                title: "test day",
            });
            expect(wb1.stations).toHaveLength(2);
            expect(wb1.stations[0]?.project).toBe("alpha");

            await assignBackend("alpha", "grok");
            await setTask("alpha", "fix login");
            const wb2 = await loadWorkbench();
            const alpha = wb2.stations.find((s) => s.project === "alpha");
            expect(alpha?.backend).toBe("grok");
            expect(alpha?.task).toBe("fix login");
            expect(alpha?.status).toBe("ready");

            const text = formatWorkbench(wb2);
            expect(text).toContain("alpha");
            expect(text).toContain("ready");
        } finally {
            delete process.env.AGENTMUX_WORKBENCH_PATH;
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("save/load roundtrip", async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "wb-rt-"));
        const wbPath = path.join(dir, "wb.json");
        process.env.AGENTMUX_WORKBENCH_PATH = wbPath;
        try {
            const wb = emptyWorkbench("x");
            wb.stations.push({
                id: "st-1",
                project: "p",
                backend: "pi",
                task: "t",
                status: "ready",
                updatedAt: new Date().toISOString(),
            });
            await saveWorkbench(wb);
            const loaded = await loadWorkbench();
            expect(loaded.stations[0]?.project).toBe("p");
            expect(defaultWorkbenchPath()).toBe(wbPath);
        } finally {
            delete process.env.AGENTMUX_WORKBENCH_PATH;
            await rm(dir, { recursive: true, force: true });
        }
    });
});
