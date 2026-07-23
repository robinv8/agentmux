/**
 * Pi extension: expose list / status / dispatch as tools on a commander session.
 *
 * Install: point settings packages/extensions at this file, or:
 *   pi -e ./agentmux/extensions/commander.ts
 *
 * Tools call the same pure modules as the CLI so behavior stays consistent.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const extDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(extDir, "..");

async function loadCommander() {
    const mod = await import(
        pathToFileURL(path.join(packageRoot, "src", "commander.ts")).href
    );
    return mod as typeof import("../src/commander.ts");
}

export default function (pi: ExtensionAPI) {
    pi.registerTool({
        name: "list_projects",
        label: "List Projects",
        description:
            "List projects under the configured Projects root and show worker registration + coarse status (running/idle/offline/unknown).",
        parameters: Type.Object({}),
        async execute() {
            const { defaultCommanderConfig, listProjects } = await loadCommander();
            const { table, items } = await listProjects(defaultCommanderConfig());
            return {
                content: [
                    {
                        type: "text",
                        text: `${table}\n\nTotal: ${items.length}; with workers: ${items.filter((i) => i.worker).length}`,
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
            "Report coarse status for one project worker: running | idle | offline | unknown.",
        parameters: Type.Object({
            project: Type.String({
                description: "Project basename or id under Projects root",
            }),
        }),
        async execute(_id, params) {
            const { defaultCommanderConfig, statusForProject } =
                await loadCommander();
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
        name: "dispatch_to_project",
        label: "Dispatch To Project",
        description:
            "Send a user prompt to a registered project worker via Pi RPC (not by typing into its TUI).",
        parameters: Type.Object({
            project: Type.String({
                description: "Project basename or id",
            }),
            message: Type.String({
                description: "Prompt text for the worker agent",
            }),
        }),
        async execute(_id, params) {
            const { defaultCommanderConfig, dispatch } = await loadCommander();
            const result = await dispatch(
                defaultCommanderConfig(),
                params.project,
                params.message,
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
}
