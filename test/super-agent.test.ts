import { describe, expect, test } from "bun:test";
import {
    looksLikeDirectDispatch,
    runSuperTurn,
    type SuperAgentConfig,
} from "../src/super-agent.ts";

describe("looksLikeDirectDispatch", () => {
    test("parses project + message", () => {
        expect(looksLikeDirectDispatch("mindmux-app fix login")).toEqual({
            project: "mindmux-app",
            message: "fix login",
        });
    });

    test("empty for freeform", () => {
        expect(looksLikeDirectDispatch("帮我看看登录有什么问题")).toEqual({});
    });
});

describe("runSuperTurn", () => {
    test("calls list_projects tool then answers", async () => {
        const projectsRoot = "/virtual/Projects";
        let fetchCalls = 0;
        const fetchImpl: typeof fetch = async (_url, init) => {
            fetchCalls += 1;
            const body = JSON.parse(String(init?.body ?? "{}")) as {
                messages: unknown[];
            };
            // Round 1: request tool
            if (fetchCalls === 1) {
                return new Response(
                    JSON.stringify({
                        content: [
                            {
                                type: "tool_use",
                                id: "tu1",
                                name: "list_projects",
                                input: {},
                            },
                        ],
                    }),
                    { status: 200 },
                );
            }
            // Round 2: final answer — history should include tool_result
            const msgs = body.messages;
            const last = msgs[msgs.length - 1] as {
                role: string;
                content: Array<{ type: string; content?: string }>;
            };
            expect(last.role).toBe("user");
            expect(
                last.content.some(
                    (c) =>
                        c.type === "tool_result" &&
                        String(c.content).includes("alpha"),
                ),
            ).toBe(true);
            return new Response(
                JSON.stringify({
                    content: [
                        {
                            type: "text",
                            text: "你有 alpha 和 beta 两个项目。",
                        },
                    ],
                }),
                { status: 200 },
            );
        };

        const config: SuperAgentConfig = {
            projectsRoot,
            apiKey: "test-key",
            baseUrl: "https://example.test",
            model: "test-model",
            fetchImpl,
            discover: async () => [
                {
                    id: "alpha",
                    name: "alpha",
                    cwd: `${projectsRoot}/alpha`,
                },
                {
                    id: "beta",
                    name: "beta",
                    cwd: `${projectsRoot}/beta`,
                },
            ],
            runWorker: async () => {
                throw new Error("should not run worker");
            },
        };

        const events: string[] = [];
        const result = await runSuperTurn({
            config,
            history: [],
            userText: "我有哪些项目？",
            onEvent: (ev) => {
                events.push(ev.type);
            },
        });

        expect(result.assistantText).toContain("alpha");
        expect(events).toContain("tool_start");
        expect(events).toContain("tool_end");
        expect(events).toContain("assistant_text");
        expect(events).toContain("turn_end");
        expect(fetchCalls).toBe(2);
    });

    test("run_in_project tool dispatches worker", async () => {
        let workerCalled = false;
        let fetchCalls = 0;
        const fetchImpl: typeof fetch = async () => {
            fetchCalls += 1;
            if (fetchCalls === 1) {
                return new Response(
                    JSON.stringify({
                        content: [
                            {
                                type: "tool_use",
                                id: "tu2",
                                name: "run_in_project",
                                input: {
                                    project: "alpha",
                                    message: "ping",
                                },
                            },
                        ],
                    }),
                    { status: 200 },
                );
            }
            return new Response(
                JSON.stringify({
                    content: [{ type: "text", text: "工人已完成 ping。" }],
                }),
                { status: 200 },
            );
        };

        const config: SuperAgentConfig = {
            projectsRoot: "/p",
            apiKey: "k",
            baseUrl: "https://example.test",
            model: "m",
            fetchImpl,
            discover: async () => [
                { id: "alpha", name: "alpha", cwd: "/p/alpha" },
            ],
            runWorker: async (opts) => {
                workerCalled = true;
                expect(opts.projectQuery).toBe("alpha");
                expect(opts.message).toBe("ping");
                return {
                    ok: true,
                    projectId: "alpha",
                    message: "ping",
                    assistantText: "PONG",
                    eventCount: 1,
                };
            },
        };

        const result = await runSuperTurn({
            config,
            history: [],
            userText: "让 alpha 回 pong",
        });
        expect(workerCalled).toBe(true);
        expect(result.assistantText).toContain("完成");
    });
});
