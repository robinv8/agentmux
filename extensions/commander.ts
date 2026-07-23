/**
 * Pi extension for AgentMux: list / status / run (one-shot) tools.
 *
 *   pi -e ./extensions/commander.ts
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const extDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(extDir, "..");

async function loadMod(name: string) {
    return import(pathToFileURL(path.join(packageRoot, "src", name)).href);
}

export default function (pi: ExtensionAPI) {
    pi.registerTool({
        name: "list_projects",
        label: "List Projects",
        description:
            "List projects under AGENTMUX_PROJECTS_ROOT (default ~/Projects) with coarse worker status.",
        parameters: Type.Object({}),
        async execute() {
            const { defaultCommanderConfig, listProjects } =
                (await loadMod(
                    "commander.ts",
                )) as typeof import("../src/commander.ts");
            const { table, items } = await listProjects(
                defaultCommanderConfig(),
            );
            return {
                content: [
                    {
                        type: "text",
                        text: `${table}\n\nTotal: ${items.length}`,
                    },
                ],
                details: { count: items.length },
            };
        },
    });

    pi.registerTool({
        name: "worker_status",
        label: "Worker Status",
        description:
            "Report coarse status for one project: running | idle | offline | unknown.",
        parameters: Type.Object({
            project: Type.String({
                description: "Project basename under Projects root",
            }),
        }),
        async execute(_id, params) {
            const { defaultCommanderConfig, statusForProject } =
                (await loadMod(
                    "commander.ts",
                )) as typeof import("../src/commander.ts");
            const result = await statusForProject(
                defaultCommanderConfig(),
                params.project,
            );
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
                details: result,
            };
        },
    });

    pi.registerTool({
        name: "run_in_project",
        label: "Run In Project",
        description:
            "One-shot: spawn Pi RPC in the project cwd, send the prompt, wait until settled, return the assistant reply. Preferred over long-lived workers.",
        parameters: Type.Object({
            project: Type.String({
                description: "Project basename under Projects root",
            }),
            message: Type.String({
                description: "What the agent should do in that project",
            }),
        }),
        async execute(_id, params) {
            const { defaultCommanderConfig } =
                (await loadMod(
                    "commander.ts",
                )) as typeof import("../src/commander.ts");
            const { discoverProjects } =
                (await loadMod(
                    "discovery.ts",
                )) as typeof import("../src/discovery.ts");
            const { runOneShot } =
                (await loadMod(
                    "oneshot.ts",
                )) as typeof import("../src/oneshot.ts");
            const config = defaultCommanderConfig();
            const projects = await discoverProjects({
                projectsRoot: config.projectsRoot,
            });
            const result = await runOneShot({
                projectQuery: params.project,
                message: params.message,
                projects,
                piBinary: config.piBinary,
            });
            return {
                content: [
                    {
                        type: "text",
                        text: result.ok
                            ? (result.assistantText ?? "(no text)")
                            : `Error: ${result.error}`,
                    },
                ],
                details: result,
            };
        },
    });
}
