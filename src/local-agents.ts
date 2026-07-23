/**
 * Discover coding agents installed / running on this machine.
 */
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";

export type AgentKind =
    | "orchestrator"
    | "cli"
    | "editor"
    | "bundled-worker";

export interface LocalAgentInfo {
    id: string;
    name: string;
    kind: AgentKind;
    /** Absolute path to binary if found */
    path?: string;
    version?: string;
    available: boolean;
    /** Matching process count (best-effort) */
    runningCount: number;
    /** Extra notes (e.g. session cwds) */
    notes?: string[];
    /** Whether Super Agent can dispatch work to this backend today */
    dispatchable: boolean;
}

export interface LocalAgentScanOptions {
    home?: string;
    env?: NodeJS.ProcessEnv;
    pathEnv?: string;
    /** AgentMux package root for bundled pi */
    packageRoot?: string;
    /** Inject process list lines for tests (comm or full cmdline) */
    processLines?: string[];
    /** Skip slow --version probes */
    skipVersion?: boolean;
}

const CATALOG: Array<{
    id: string;
    name: string;
    kind: AgentKind;
    /** basenames to look for on PATH */
    binaries: string[];
    /** substrings matched against process list */
    processMatch: string[];
    /** home-relative candidate paths */
    homeCandidates?: string[];
    dispatchable: boolean;
}> = [
    {
        id: "agentmux",
        name: "AgentMux Super Agent",
        kind: "orchestrator",
        binaries: ["am", "agentmux"],
        processMatch: ["AgentMux", "agentmux"],
        dispatchable: false,
    },
    {
        id: "pi",
        name: "Pi (worker)",
        kind: "bundled-worker",
        binaries: ["pi"],
        processMatch: ["pi-coding-agent", "/pi "],
        homeCandidates: [],
        dispatchable: true,
    },
    {
        id: "grok",
        name: "Grok Build",
        kind: "cli",
        binaries: ["grok", "agent"],
        processMatch: ["grok"],
        homeCandidates: [".grok/bin/grok", ".grok/bin/agent"],
        dispatchable: false,
    },
    {
        id: "codex",
        name: "OpenAI Codex",
        kind: "cli",
        binaries: ["codex"],
        processMatch: ["codex"],
        homeCandidates: [".codex/packages/standalone/current/bin/codex"],
        dispatchable: false,
    },
    {
        id: "kimi",
        name: "Kimi Code",
        kind: "cli",
        binaries: ["kimi"],
        processMatch: ["kimi"],
        homeCandidates: [".kimi-code/bin/kimi"],
        dispatchable: false,
    },
    {
        id: "claude",
        name: "Claude Code",
        kind: "cli",
        binaries: ["claude"],
        processMatch: ["claude"],
        dispatchable: false,
    },
    {
        id: "cursor",
        name: "Cursor",
        kind: "editor",
        binaries: ["cursor"],
        processMatch: ["Cursor", "cursor-agent"],
        dispatchable: false,
    },
    {
        id: "cursor-agent",
        name: "Cursor Agent",
        kind: "cli",
        binaries: ["cursor-agent"],
        processMatch: ["cursor-agent"],
        dispatchable: false,
    },
    {
        id: "openclaw",
        name: "OpenClaw",
        kind: "cli",
        binaries: ["openclaw"],
        processMatch: ["openclaw"],
        dispatchable: false,
    },
];

export async function scanLocalAgents(
    options: LocalAgentScanOptions = {},
): Promise<LocalAgentInfo[]> {
    const home = options.home ?? os.homedir();
    const env = options.env ?? process.env;
    const pathEnv = options.pathEnv ?? env.PATH ?? "";
    const pathDirs = pathEnv.split(path.delimiter).filter(Boolean);
    const processLines =
        options.processLines ?? (await listProcessLines()).split("\n");

    const results: LocalAgentInfo[] = [];

    for (const entry of CATALOG) {
        let foundPath: string | undefined;

        for (const bin of entry.binaries) {
            const p = await findOnPath(bin, pathDirs);
            if (p) {
                foundPath = p;
                break;
            }
        }

        if (!foundPath && entry.homeCandidates) {
            for (const rel of entry.homeCandidates) {
                const abs = path.join(home, rel);
                if (await isExecutable(abs)) {
                    foundPath = abs;
                    break;
                }
            }
        }

        // Bundled pi next to agentmux package
        if (entry.id === "pi" && !foundPath) {
            const pkgRoot =
                options.packageRoot ??
                path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
            const bundled = path.join(
                pkgRoot,
                "node_modules",
                ".bin",
                "pi",
            );
            if (await isExecutable(bundled)) {
                foundPath = bundled;
            }
            // also resolve real cli.js
            const cliJs = path.join(
                pkgRoot,
                "node_modules",
                "@earendil-works",
                "pi-coding-agent",
                "dist",
                "cli.js",
            );
            if (!foundPath && (await exists(cliJs))) {
                foundPath = cliJs;
            }
        }

        const runningCount = countProcessMatches(
            processLines,
            entry.processMatch,
            entry.id,
        );

        let version: string | undefined;
        if (foundPath && !options.skipVersion) {
            if (entry.id === "agentmux") {
                version = await readPackageVersion(
                    options.packageRoot ??
                        path.resolve(
                            path.dirname(fileURLToPath(import.meta.url)),
                            "..",
                        ),
                );
            } else {
                version = probeVersion(foundPath);
            }
        }

        const notes: string[] = [];
        if (entry.id === "grok") {
            const sessions = await readGrokSessions(home);
            if (sessions.length > 0) {
                notes.push(
                    ...sessions
                        .slice(0, 8)
                        .map((s) => `session: ${s.cwd} (pid ${s.pid})`),
                );
                if (sessions.length > 8) {
                    notes.push(`… +${sessions.length - 8} more grok sessions`);
                }
            }
        }
        if (entry.id === "pi" && foundPath?.includes("node_modules")) {
            notes.push("bundled with AgentMux (default worker)");
        }
        if (!entry.dispatchable && entry.id !== "agentmux") {
            notes.push("installed locally; not yet wired as Super Agent worker");
        }

        results.push({
            id: entry.id,
            name: entry.name,
            kind: entry.kind,
            path: foundPath,
            version,
            available: Boolean(foundPath),
            runningCount,
            notes: notes.length ? notes : undefined,
            dispatchable: entry.dispatchable && Boolean(foundPath),
        });
    }

    return results;
}

export function formatLocalAgentsTable(agents: LocalAgentInfo[]): string {
    const lines = [
        pad("ID", 14) +
            pad("NAME", 22) +
            pad("AVAIL", 8) +
            pad("RUN", 6) +
            pad("WORKER", 8) +
            "PATH / NOTES",
        "-".repeat(96),
    ];
    for (const a of agents) {
        const avail = a.available ? "yes" : "no";
        const run = String(a.runningCount);
        const worker = a.dispatchable ? "yes" : "no";
        const extra = [
            a.path ?? "",
            a.version ? `v=${a.version}` : "",
            ...(a.notes ?? []),
        ]
            .filter(Boolean)
            .join(" · ");
        lines.push(
            pad(a.id, 14) +
                pad(a.name, 22) +
                pad(avail, 8) +
                pad(run, 6) +
                pad(worker, 8) +
                extra,
        );
    }
    return lines.join("\n");
}

function pad(s: string, n: number): string {
    if (s.length >= n) return `${s.slice(0, n - 1)} `;
    return s + " ".repeat(n - s.length);
}

async function findOnPath(
    name: string,
    pathDirs: string[],
): Promise<string | undefined> {
    for (const dir of pathDirs) {
        const candidate = path.join(dir, name);
        if (await isExecutable(candidate)) return candidate;
    }
    return undefined;
}

async function isExecutable(p: string): Promise<boolean> {
    try {
        await access(p, constants.X_OK);
        return true;
    } catch {
        try {
            await access(p, constants.F_OK);
            // .js files may not be +x but still runnable via bun
            return p.endsWith(".js");
        } catch {
            return false;
        }
    }
}

async function exists(p: string): Promise<boolean> {
    try {
        await access(p, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

function probeVersion(bin: string): string | undefined {
    for (const args of [["--version"], ["-V"], ["version"]] as string[][]) {
        try {
            const r = spawnSync(bin, args, {
                encoding: "utf8",
                timeout: 2500,
                env: process.env,
            });
            const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n")[0];
            if (
                out &&
                !out.toLowerCase().includes("usage:") &&
                !out.toLowerCase().includes("missing message")
            ) {
                return out.slice(0, 80);
            }
        } catch {
            // try next
        }
    }
    return undefined;
}

async function readPackageVersion(pkgRoot: string): Promise<string | undefined> {
    try {
        const raw = await readFile(path.join(pkgRoot, "package.json"), "utf8");
        const pkg = JSON.parse(raw) as { version?: string };
        return pkg.version;
    } catch {
        return undefined;
    }
}

async function listProcessLines(): Promise<string> {
    try {
        const r = spawnSync("ps", ["-axo", "pid=,comm=,args="], {
            encoding: "utf8",
            timeout: 3000,
        });
        return r.stdout ?? "";
    } catch {
        return "";
    }
}

function countProcessMatches(
    lines: string[],
    patterns: string[],
    id: string,
): number {
    let n = 0;
    for (const line of lines) {
        const lower = line.toLowerCase();
        // avoid counting this scan / editor noise too aggressively for short names
        if (id === "pi" && lower.includes("pi-path")) continue;
        if (id === "agentmux" && lower.includes("local-agents")) continue;
        for (const p of patterns) {
            if (lower.includes(p.toLowerCase())) {
                n += 1;
                break;
            }
        }
    }
    return n;
}

async function readGrokSessions(
    home: string,
): Promise<Array<{ cwd: string; pid: number }>> {
    const file = path.join(home, ".grok", "active_sessions.json");
    try {
        const raw = await readFile(file, "utf8");
        const data = JSON.parse(raw) as Array<{
            cwd?: string;
            pid?: number;
        }>;
        return data
            .filter((x) => x.cwd && x.pid)
            .map((x) => ({ cwd: x.cwd!, pid: x.pid! }));
    } catch {
        return [];
    }
}
