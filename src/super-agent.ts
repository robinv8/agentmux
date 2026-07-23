/**
 * Super-agent orchestrator: chat with the user, call tools to list projects
 * and run worker one-shots. This is the "foreman", not a project picker.
 */
import { discoverProjects } from "./discovery.js";
import {
    formatLocalAgentsTable,
    scanLocalAgents,
} from "./local-agents.js";
import { formatJobsTable, listJobs } from "./jobs.js";
import {
    dispatchWorker,
    listDispatchableBackends,
    normalizeBackendId,
} from "./workers/index.js";
import * as workbench from "./workbench.js";

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
    /** Stable id for matching start/end of the same tool call */
    toolCallId?: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: string;
    /** Whether tool finished successfully */
    toolOk?: boolean;
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
    discover?: typeof discoverProjects;
}

export const SUPER_SYSTEM_PROMPT = `You are AgentMux — the boss. User talks only to you.

## Morning workbench flow (PRIMARY)
1. User says they will work on projects A,B,C today → call workbench_set_projects
2. Assign little brothers (backends) per project → workbench_assign (pi|claude|codex|grok|kimi). Ask user if unclear; suggest available backends via list_local_agents.
3. Capture each project's task → workbench_set_task
4. When user says start / 开干 / 回车干活 → workbench_start (runs ready stations in PARALLEL)
5. Progress → workbench_status (and list_jobs). Waiting on user → stations with waiting_user + pendingQuestion
6. User answers a blocked station → workbench_answer then offer to workbench_start that project again

## Also available
- list_projects / list_local_agents / list_jobs
- run_in_project for one-off tasks outside the workbench

## Rules
- Keep the workbench as the source of "today's stations" in the UI.
- When you need a decision/approval, use workbench_ask so the station shows 等你.
- After start, report which stations are running/done/failed.
- Match user's language (Chinese if they write Chinese).
- Worker prompts must be self-contained.`;

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
        name: "list_local_agents",
        description:
            "List coding agents available on this machine: installed path, version, running count, and whether Super Agent can dispatch work to them.",
        input_schema: {
            type: "object",
            properties: {
                onlyAvailable: {
                    type: "boolean",
                    description: "If true, only list agents found on disk",
                },
            },
        },
    },
    {
        name: "list_jobs",
        description:
            "List Super Agent worker jobs from the on-disk job ledger (authoritative completion status: running/done/failed).",
        input_schema: {
            type: "object",
            properties: {
                status: {
                    type: "string",
                    description:
                        "Optional filter: queued | running | done | failed",
                },
                limit: {
                    type: "number",
                    description: "Max jobs to return (default 20)",
                },
            },
        },
    },
    {
        name: "run_in_project",
        description:
            "One-off dispatch (not workbench). Prefer workbench_* for multi-project morning flow.",
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
                backend: {
                    type: "string",
                    description:
                        "Worker backend: pi | claude | codex | grok | kimi. Omit for auto (prefers pi).",
                },
            },
            required: ["project", "message"],
        },
    },
    {
        name: "workbench_set_projects",
        description:
            "Create/reset today's workbench stations from a list of project names (e.g. A,B,C).",
        input_schema: {
            type: "object",
            properties: {
                projects: {
                    type: "array",
                    items: { type: "string" },
                    description: "Project basenames",
                },
                title: {
                    type: "string",
                    description: "Optional workbench title",
                },
            },
            required: ["projects"],
        },
    },
    {
        name: "workbench_assign",
        description: "Bind a little brother (backend) to a workbench station.",
        input_schema: {
            type: "object",
            properties: {
                project: { type: "string" },
                backend: {
                    type: "string",
                    description: "pi|claude|codex|grok|kimi",
                },
            },
            required: ["project", "backend"],
        },
    },
    {
        name: "workbench_set_task",
        description: "Set the task description for a station.",
        input_schema: {
            type: "object",
            properties: {
                project: { type: "string" },
                task: { type: "string" },
            },
            required: ["project", "task"],
        },
    },
    {
        name: "workbench_start",
        description:
            "Start all ready stations in parallel (or only listed projects). Call when user confirms 开干.",
        input_schema: {
            type: "object",
            properties: {
                projects: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional subset of projects to start",
                },
            },
        },
    },
    {
        name: "workbench_status",
        description: "Show today's workbench stations and statuses.",
        input_schema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "workbench_ask",
        description:
            "Mark a station as waiting_user with a question (approval / clarification).",
        input_schema: {
            type: "object",
            properties: {
                project: { type: "string" },
                question: { type: "string" },
            },
            required: ["project", "question"],
        },
    },
    {
        name: "workbench_answer",
        description:
            "Apply the user's answer to a waiting station (appends into task context).",
        input_schema: {
            type: "object",
            properties: {
                project: { type: "string" },
                answer: { type: "string" },
            },
            required: ["project", "answer"],
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
                toolCallId: tool.id,
                toolName: tool.name,
                toolInput: tool.input,
            });
            const result = await executeTool(tool.name, tool.input, config);
            onEvent?.({
                type: "tool_end",
                toolCallId: tool.id,
                toolName: tool.name,
                toolResult: result.text,
                toolOk: !result.isError,
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

        if (name === "list_local_agents") {
            let agents = await scanLocalAgents();
            if (input.onlyAvailable === true) {
                agents = agents.filter((a) => a.available);
            }
            return {
                text: formatLocalAgentsTable(agents),
                isError: false,
            };
        }

        if (name === "list_jobs") {
            const status =
                typeof input.status === "string" ? input.status : undefined;
            const limit =
                typeof input.limit === "number" && input.limit > 0
                    ? Math.min(input.limit, 50)
                    : 20;
            let jobs = await listJobs({
                status: status as
                    | "queued"
                    | "running"
                    | "done"
                    | "failed"
                    | undefined,
                sinceMs: 48 * 60 * 60 * 1000,
            });
            jobs = jobs.slice(0, limit);
            const compact = jobs.map((j) => ({
                id: j.id,
                status: j.status,
                kind: j.kind,
                project: j.project,
                summary: (j.summary || j.error || j.message || "").slice(0, 200),
                updatedAt: j.updatedAt,
                finishedAt: j.finishedAt,
            }));
            return {
                text:
                    `Jobs (${jobs.length}):\n` +
                    formatJobsTable(jobs) +
                    "\n\nJSON:\n" +
                    JSON.stringify(compact, null, 2),
                isError: false,
            };
        }

        if (name === "run_in_project") {
            const project =
                typeof input.project === "string" ? input.project : "";
            const message =
                typeof input.message === "string" ? input.message : "";
            const backend = normalizeBackendId(input.backend);
            if (!project || !message) {
                return {
                    text: "run_in_project requires project and message",
                    isError: true,
                };
            }

            const brothers = await listDispatchableBackends();
            const available = brothers
                .filter((b) => b.available)
                .map((b) => b.id);

            try {
                const result = await dispatchWorker({
                    backend,
                    projectQuery: project,
                    message,
                    projectsRoot: config.projectsRoot,
                });
                if (!result.ok) {
                    return {
                        text:
                            `Worker FAILED backend=${result.backend} project=${result.projectId} job=${result.jobId}: ${result.error ?? "unknown"}\n` +
                            `Available backends: ${available.join(", ") || "(none)"}`,
                        isError: true,
                    };
                }
                return {
                    text:
                        `Worker DONE backend=${result.backend} project=${result.projectId} job=${result.jobId}:\n` +
                        `${result.text ?? "(empty)"}`,
                    isError: false,
                };
            } catch (e) {
                return {
                    text:
                        (e instanceof Error ? e.message : String(e)) +
                        `\nAvailable backends: ${available.join(", ") || "(none)"}`,
                    isError: true,
                };
            }
        }

        if (name === "workbench_set_projects") {
            const projects = Array.isArray(input.projects)
                ? input.projects.map(String)
                : [];
            if (projects.length === 0) {
                return { text: "projects array required", isError: true };
            }
            const wb = await workbench.setProjects(projects, {
                projectsRoot: config.projectsRoot,
                title:
                    typeof input.title === "string"
                        ? input.title
                        : "今日工作台",
            });
            return {
                text: workbench.formatWorkbench(wb),
                isError: false,
            };
        }

        if (name === "workbench_assign") {
            const project = String(input.project ?? "");
            const backend = String(input.backend ?? "");
            const wb = await workbench.assignBackend(project, backend);
            return { text: workbench.formatWorkbench(wb), isError: false };
        }

        if (name === "workbench_set_task") {
            const project = String(input.project ?? "");
            const task = String(input.task ?? "");
            const wb = await workbench.setTask(project, task);
            return { text: workbench.formatWorkbench(wb), isError: false };
        }

        if (name === "workbench_start") {
            const only = Array.isArray(input.projects)
                ? input.projects.map(String)
                : undefined;
            const { workbench: wb, results } = await workbench.startWork({
                projectsRoot: config.projectsRoot,
                onlyProjects: only,
            });
            const summary = results
                .map(
                    (r) =>
                        `- ${r.project}: ${r.ok ? "OK" : "FAIL"} ${r.summary.slice(0, 120)}`,
                )
                .join("\n");
            return {
                text: `${workbench.formatWorkbench(wb)}\n\nResults:\n${summary || "(no stations started — need ready: project+backend+task)"}`,
                isError: false,
            };
        }

        if (name === "workbench_status") {
            const wb = await workbench.loadWorkbench();
            return { text: workbench.formatWorkbench(wb), isError: false };
        }

        if (name === "workbench_ask") {
            const wb = await workbench.askUser(
                String(input.project ?? ""),
                String(input.question ?? ""),
            );
            return {
                text:
                    workbench.formatWorkbench(wb) +
                    "\n\n(User must answer in chat; then call workbench_answer + workbench_start)",
                isError: false,
            };
        }

        if (name === "workbench_answer") {
            const wb = await workbench.answerUser(
                String(input.project ?? ""),
                String(input.answer ?? ""),
            );
            return { text: workbench.formatWorkbench(wb), isError: false };
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
