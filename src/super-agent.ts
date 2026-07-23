/**
 * Super-agent orchestrator: chat with the user, call tools to list projects
 * and run worker one-shots. This is the "foreman", not a project picker.
 */
import { discoverProjects, resolveProjectTarget } from "./discovery.js";
import { runOneShot } from "./oneshot.js";
import type { ProjectEntry } from "./types.js";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
    role: ChatRole | "tool";
    content: string | ContentBlock[];
    tool_use_id?: string;
    name?: string;
}

export type ContentBlock =
    | { type: "text"; text: string }
    | {
          type: "tool_use";
          id: string;
          name: string;
          input: Record<string, unknown>;
      }
    | {
          type: "tool_result";
          tool_use_id: string;
          content: string;
          is_error?: boolean;
      };

export interface SuperAgentEvent {
    type:
        | "assistant_text"
        | "tool_start"
        | "tool_end"
        | "turn_start"
        | "turn_end"
        | "error";
    text?: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: string;
    error?: string;
}

export interface SuperAgentConfig {
    projectsRoot: string;
    apiKey: string;
    baseUrl: string;
    model: string;
    /** Max tool rounds per user turn */
    maxRounds?: number;
    fetchImpl?: typeof fetch;
    runWorker?: typeof runOneShot;
    discover?: typeof discoverProjects;
}

export const SUPER_SYSTEM_PROMPT = `You are AgentMux Super Agent — a single foreman that controls coding workers across many local projects.

The user talks ONLY to you. You decide which project(s) need work and you dispatch workers via tools.

Tools:
- list_projects: see projects under the user's Projects folder
- run_in_project: run a one-shot coding agent in a project (workers do the coding; you orchestrate)

Rules:
1. Prefer list_projects when the project name is ambiguous.
2. When the user names a project, use run_in_project with a clear, self-contained worker prompt.
3. You may run multiple projects in one turn if the user asks for multiple things.
4. After tools finish, summarize results for the user in Chinese if they write Chinese, else match their language.
5. Do not claim you edited code yourself — workers do. Report what workers returned.
6. If a worker fails (auth, missing project), explain clearly and suggest next steps.
7. Keep worker prompts concrete: goal, constraints, "do not unrelated refactors".`;

const TOOLS = [
    {
        name: "list_projects",
        description:
            "List local project basenames under the configured Projects root.",
        input_schema: {
            type: "object",
            properties: {
                filter: {
                    type: "string",
                    description: "Optional substring filter on project name",
                },
            },
        },
    },
    {
        name: "run_in_project",
        description:
            "Dispatch a one-shot coding worker into a project directory. The worker can read/edit code there.",
        input_schema: {
            type: "object",
            properties: {
                project: {
                    type: "string",
                    description: "Project basename or unambiguous partial name",
                },
                message: {
                    type: "string",
                    description:
                        "Full task for the worker (be specific; this is all the worker sees)",
                },
            },
            required: ["project", "message"],
        },
    },
] as const;

export function resolveSuperAgentAuth(
    env: NodeJS.ProcessEnv = process.env,
): { apiKey: string; baseUrl: string; model: string } {
    const apiKey =
        env.AGENTMUX_SUPER_API_KEY ||
        env.KIMI_API_KEY ||
        env.ANTHROPIC_AUTH_TOKEN ||
        env.ANTHROPIC_API_KEY ||
        "";
    const baseUrl = (
        env.AGENTMUX_SUPER_BASE_URL ||
        env.ANTHROPIC_BASE_URL ||
        "https://api.kimi.com/coding"
    ).replace(/\/$/, "");
    const model =
        env.AGENTMUX_SUPER_MODEL ||
        env.AGENTMUX_MODEL ||
        "kimi-for-coding";
    return { apiKey, baseUrl, model };
}

export function createDefaultSuperConfig(
    projectsRoot: string,
    env: NodeJS.ProcessEnv = process.env,
): SuperAgentConfig {
    const auth = resolveSuperAgentAuth(env);
    return {
        projectsRoot,
        apiKey: auth.apiKey,
        baseUrl: auth.baseUrl,
        model: auth.model,
        maxRounds: 8,
    };
}

/**
 * Run one user turn: model may call tools in a loop until it returns text-only.
 */
export async function runSuperTurn(options: {
    config: SuperAgentConfig;
    history: ChatMessage[];
    userText: string;
    onEvent?: (ev: SuperAgentEvent) => void;
}): Promise<{ assistantText: string; history: ChatMessage[] }> {
    const { config, onEvent } = options;
    if (!config.apiKey) {
        const err =
            "No API key for Super Agent. Set KIMI_API_KEY or ANTHROPIC_AUTH_TOKEN.";
        onEvent?.({ type: "error", error: err });
        throw new Error(err);
    }

    const history: ChatMessage[] = [
        ...options.history,
        { role: "user", content: options.userText },
    ];

    onEvent?.({ type: "turn_start" });

    let assistantText = "";
    const maxRounds = config.maxRounds ?? 8;
    const fetchImpl = config.fetchImpl ?? fetch;

    for (let round = 0; round < maxRounds; round++) {
        const response = await callMessagesApi({
            config,
            history,
            fetchImpl,
        });

        if (response.error) {
            onEvent?.({ type: "error", error: response.error });
            throw new Error(response.error);
        }

        const blocks = response.content;
        history.push({ role: "assistant", content: blocks });

        const toolUses = blocks.filter(
            (b): b is Extract<ContentBlock, { type: "tool_use" }> =>
                b.type === "tool_use",
        );
        const texts = blocks
            .filter(
                (b): b is Extract<ContentBlock, { type: "text" }> =>
                    b.type === "text",
            )
            .map((b) => b.text);

        for (const t of texts) {
            if (t) {
                assistantText += t;
                onEvent?.({ type: "assistant_text", text: t });
            }
        }

        if (toolUses.length === 0) {
            onEvent?.({ type: "turn_end" });
            return { assistantText, history };
        }

        // Execute tools and append tool_result user message (Anthropic format)
        const toolResults: ContentBlock[] = [];
        for (const tool of toolUses) {
            onEvent?.({
                type: "tool_start",
                toolName: tool.name,
                toolInput: tool.input,
            });
            const result = await executeTool(tool.name, tool.input, config);
            onEvent?.({
                type: "tool_end",
                toolName: tool.name,
                toolResult: result.text,
            });
            toolResults.push({
                type: "tool_result",
                tool_use_id: tool.id,
                content: result.text,
                is_error: result.isError,
            });
        }
        history.push({ role: "user", content: toolResults });
    }

    const err = `Super Agent exceeded max tool rounds (${maxRounds})`;
    onEvent?.({ type: "error", error: err });
    throw new Error(err);
}

async function executeTool(
    name: string,
    input: Record<string, unknown>,
    config: SuperAgentConfig,
): Promise<{ text: string; isError: boolean }> {
    const discover = config.discover ?? discoverProjects;
    const runWorker = config.runWorker ?? runOneShot;

    try {
        if (name === "list_projects") {
            const projects = await discover({
                projectsRoot: config.projectsRoot,
            });
            const filter =
                typeof input.filter === "string"
                    ? input.filter.toLowerCase()
                    : "";
            const filtered = filter
                ? projects.filter((p) => p.id.toLowerCase().includes(filter))
                : projects;
            const lines = filtered.map((p) => `- ${p.id}  (${p.cwd})`);
            return {
                text:
                    lines.length > 0
                        ? `Projects (${filtered.length}):\n${lines.join("\n")}`
                        : "No projects matched.",
                isError: false,
            };
        }

        if (name === "run_in_project") {
            const project =
                typeof input.project === "string" ? input.project : "";
            const message =
                typeof input.message === "string" ? input.message : "";
            if (!project || !message) {
                return {
                    text: "run_in_project requires project and message",
                    isError: true,
                };
            }
            const projects = await discover({
                projectsRoot: config.projectsRoot,
            });
            let target: ProjectEntry;
            try {
                target = resolveProjectTarget(project, projects);
            } catch (e) {
                return {
                    text: e instanceof Error ? e.message : String(e),
                    isError: true,
                };
            }
            const result = await runWorker({
                projectQuery: target.id,
                message,
                projects,
            });
            if (!result.ok) {
                return {
                    text: `Worker failed in ${target.id}: ${result.error ?? "unknown"}`,
                    isError: true,
                };
            }
            return {
                text: `Worker finished in ${target.id}:\n${result.assistantText ?? "(no text)"}`,
                isError: false,
            };
        }

        return { text: `Unknown tool: ${name}`, isError: true };
    } catch (e) {
        return {
            text: e instanceof Error ? e.message : String(e),
            isError: true,
        };
    }
}

async function callMessagesApi(options: {
    config: SuperAgentConfig;
    history: ChatMessage[];
    fetchImpl: typeof fetch;
}): Promise<{ content: ContentBlock[]; error?: string }> {
    const { config, history, fetchImpl } = options;
    const url = `${config.baseUrl}/v1/messages`;

    const body = {
        model: config.model,
        max_tokens: 8192,
        system: SUPER_SYSTEM_PROMPT,
        tools: TOOLS,
        messages: toApiMessages(history),
    };

    const res = await fetchImpl(url, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-api-key": config.apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
    });

    const raw = await res.text();
    if (!res.ok) {
        return {
            content: [],
            error: `Super Agent API ${res.status}: ${raw.slice(0, 400)}`,
        };
    }

    let data: {
        content?: Array<Record<string, unknown>>;
        error?: { message?: string };
    };
    try {
        data = JSON.parse(raw) as typeof data;
    } catch {
        return { content: [], error: `Invalid JSON from API: ${raw.slice(0, 200)}` };
    }

    if (data.error?.message) {
        return { content: [], error: data.error.message };
    }

    const content: ContentBlock[] = [];
    for (const block of data.content ?? []) {
        if (block.type === "text" && typeof block.text === "string") {
            content.push({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
            content.push({
                type: "tool_use",
                id: String(block.id ?? `tool_${Date.now()}`),
                name: String(block.name ?? ""),
                input:
                    block.input && typeof block.input === "object"
                        ? (block.input as Record<string, unknown>)
                        : {},
            });
        }
        // skip thinking blocks for history compactness (optional keep as text)
        else if (block.type === "thinking" && typeof block.thinking === "string") {
            // do not stream thinking as assistant_text to keep UI clean
        }
    }
    return { content };
}

function toApiMessages(
    history: ChatMessage[],
): Array<{ role: string; content: unknown }> {
    return history.map((m) => {
        if (m.role === "tool") {
            // shouldn't happen with our structure
            return { role: "user", content: m.content };
        }
        return { role: m.role, content: m.content };
    });
}

/**
 * Pure helper: decide if a user utterance looks like direct project dispatch
 * (for tests / optional shortcuts). Super agent normally handles all NL.
 */
export function looksLikeDirectDispatch(text: string): {
    project?: string;
    message?: string;
} {
    const m = text.trim().match(/^([A-Za-z0-9._-]+)\s+(.+)$/s);
    if (!m) return {};
    return { project: m[1], message: m[2] };
}
