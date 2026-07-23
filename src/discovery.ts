import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ProjectEntry } from "./types.js";

const SKIP_NAMES = new Set([
    "node_modules",
    ".git",
    ".DS_Store",
    "tmp",
    "temp",
    "data",
    "local",
    "test",
    "test_2",
]);

export interface DiscoverOptions {
    /** Absolute path to the Projects root (default: ~/Projects). */
    projectsRoot: string;
    /** Skip names that look like non-project clutter. */
    skipNames?: Set<string>;
    /** When true, only include dirs that look like project roots (have package.json, .git, etc.). */
    requireProjectMarker?: boolean;
}

const PROJECT_MARKERS = [
    "package.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "Gemfile",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    ".git",
    "AGENTS.md",
    "README.md",
];

/**
 * List direct child directories under `projectsRoot` as project candidates.
 * Pure discovery: no process table, no registry.
 */
export async function discoverProjects(
    options: DiscoverOptions,
): Promise<ProjectEntry[]> {
    const skip = options.skipNames ?? SKIP_NAMES;
    const root = path.resolve(options.projectsRoot);

    let entries: string[];
    try {
        entries = await readdir(root);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read projects root ${root}: ${message}`);
    }

    const projects: ProjectEntry[] = [];

    for (const name of entries) {
        if (name.startsWith(".")) continue;
        if (skip.has(name)) continue;

        const cwd = path.join(root, name);
        let st;
        try {
            st = await stat(cwd);
        } catch {
            continue;
        }
        if (!st.isDirectory()) continue;

        if (options.requireProjectMarker) {
            const isProject = await hasProjectMarker(cwd);
            if (!isProject) continue;
        }

        projects.push({
            id: name,
            name,
            cwd,
        });
    }

    projects.sort((a, b) => a.id.localeCompare(b.id));
    return projects;
}

async function hasProjectMarker(cwd: string): Promise<boolean> {
    for (const marker of PROJECT_MARKERS) {
        try {
            await stat(path.join(cwd, marker));
            return true;
        } catch {
            // try next
        }
    }
    return false;
}

/**
 * Resolve a user-provided project name/id against discovered projects.
 * Accepts exact basename or case-insensitive match; throws if ambiguous/missing.
 */
export function resolveProjectTarget(
    query: string,
    projects: ProjectEntry[],
): ProjectEntry {
    const q = query.trim();
    if (!q) {
        throw new Error("Project id is empty");
    }

    const exact = projects.find((p) => p.id === q);
    if (exact) return exact;

    const lower = q.toLowerCase();
    const ci = projects.filter((p) => p.id.toLowerCase() === lower);
    if (ci.length === 1) return ci[0]!;
    if (ci.length > 1) {
        throw new Error(`Ambiguous project id "${q}"`);
    }

    const partial = projects.filter(
        (p) =>
            p.id.toLowerCase().includes(lower) ||
            p.name.toLowerCase().includes(lower),
    );
    if (partial.length === 1) return partial[0]!;
    if (partial.length > 1) {
        throw new Error(
            `Ambiguous project "${q}"; matches: ${partial.map((p) => p.id).join(", ")}`,
        );
    }

    throw new Error(`Unknown project "${q}"`);
}
