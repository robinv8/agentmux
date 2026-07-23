import { describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    discoverProjects,
    resolveProjectTarget,
} from "../src/discovery.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(here, "..", "fixtures", "projects");

describe("discoverProjects", () => {
    test("lists direct child project directories", async () => {
        const projects = await discoverProjects({
            projectsRoot: fixturesRoot,
            requireProjectMarker: false,
        });
        const ids = projects.map((p) => p.id);
        expect(ids).toContain("alpha");
        expect(ids).toContain("beta");
        expect(projects.every((p) => p.cwd.startsWith(fixturesRoot))).toBe(true);
    });

    test("skips non-directories and hidden names", async () => {
        const projects = await discoverProjects({
            projectsRoot: fixturesRoot,
        });
        expect(projects.some((p) => p.id.startsWith("."))).toBe(false);
    });

    test("requireProjectMarker filters bare dirs without markers", async () => {
        const all = await discoverProjects({
            projectsRoot: fixturesRoot,
            requireProjectMarker: false,
        });
        const marked = await discoverProjects({
            projectsRoot: fixturesRoot,
            requireProjectMarker: true,
        });
        // alpha has package.json marker; beta may only if we add one
        expect(all.length).toBeGreaterThanOrEqual(marked.length);
        expect(marked.map((p) => p.id)).toContain("alpha");
    });
});

describe("resolveProjectTarget", () => {
    const projects = [
        { id: "AIDesignPrompt", name: "AIDesignPrompt", cwd: "/p/AIDesignPrompt" },
        { id: "mindmux-app", name: "mindmux-app", cwd: "/p/mindmux-app" },
        { id: "input", name: "input", cwd: "/p/input" },
    ];

    test("exact match", () => {
        expect(resolveProjectTarget("input", projects).id).toBe("input");
    });

    test("case-insensitive match", () => {
        expect(resolveProjectTarget("mindmux-APP", projects).id).toBe(
            "mindmux-app",
        );
    });

    test("partial unique match", () => {
        expect(resolveProjectTarget("Design", projects).id).toBe(
            "AIDesignPrompt",
        );
    });

    test("unknown throws", () => {
        expect(() => resolveProjectTarget("nope", projects)).toThrow(
            /Unknown project/,
        );
    });

    test("empty throws", () => {
        expect(() => resolveProjectTarget("  ", projects)).toThrow(/empty/);
    });
});
