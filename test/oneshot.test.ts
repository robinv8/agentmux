import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { runOneShot, type OneShotSpawner } from "../src/oneshot.ts";

function mockSpawner(
    script: (write: (obj: unknown) => void) => void,
): OneShotSpawner {
    return () => {
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        const stderr = new PassThrough();

        stdin.on("data", (chunk: Buffer) => {
            const line = chunk.toString("utf8").trim();
            if (!line) return;
            let cmd: { id?: string; type?: string; message?: string };
            try {
                cmd = JSON.parse(line) as {
                    id?: string;
                    type?: string;
                    message?: string;
                };
            } catch {
                return;
            }
            if (cmd.type === "prompt") {
                const write = (obj: unknown) => {
                    stdout.write(`${JSON.stringify(obj)}\n`);
                };
                write({
                    id: cmd.id,
                    type: "response",
                    command: "prompt",
                    success: true,
                });
                script(write);
            }
        });

        return {
            stdin,
            stdout,
            stderr,
            kill: () => {
                stdin.destroy();
                stdout.destroy();
                stderr.destroy();
            },
            pid: 4242,
        };
    };
}

const projects = [
    { id: "alpha", name: "alpha", cwd: "/tmp/alpha" },
    { id: "beta", name: "beta", cwd: "/tmp/beta" },
];

describe("runOneShot", () => {
    test("streams text and returns assistant message on agent_settled", async () => {
        const deltas: string[] = [];
        const result = await runOneShot({
            projectQuery: "alpha",
            message: "say hi",
            projects,
            timeoutMs: 5000,
            onTextDelta: (d) => deltas.push(d),
            spawner: mockSpawner((write) => {
                write({
                    type: "message_update",
                    assistantMessageEvent: {
                        type: "text_delta",
                        delta: "Hello ",
                    },
                });
                write({
                    type: "message_update",
                    assistantMessageEvent: {
                        type: "text_delta",
                        delta: "world",
                    },
                });
                write({
                    type: "message_end",
                    message: {
                        role: "assistant",
                        content: [{ type: "text", text: "Hello world" }],
                    },
                });
                write({ type: "agent_settled" });
            }),
        });

        expect(result.ok).toBe(true);
        expect(result.projectId).toBe("alpha");
        expect(result.assistantText).toBe("Hello world");
        expect(deltas.join("")).toBe("Hello world");
        expect(result.eventCount).toBeGreaterThan(0);
    });

    test("rejects unknown project without spawning useful work", async () => {
        let spawned = false;
        const result = await runOneShot({
            projectQuery: "nope",
            message: "x",
            projects,
            spawner: () => {
                spawned = true;
                throw new Error("should not spawn");
            },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/Unknown project/);
        expect(spawned).toBe(false);
    });

    test("rejects empty message", async () => {
        const result = await runOneShot({
            projectQuery: "alpha",
            message: "   ",
            projects,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/empty/i);
    });

    test("surfaces prompt rejection", async () => {
        const result = await runOneShot({
            projectQuery: "alpha",
            message: "nope",
            projects,
            timeoutMs: 3000,
            spawner: () => {
                const stdin = new PassThrough();
                const stdout = new PassThrough();
                const stderr = new PassThrough();
                stdin.on("data", (chunk: Buffer) => {
                    const cmd = JSON.parse(chunk.toString("utf8").trim()) as {
                        id: string;
                    };
                    stdout.write(
                        `${JSON.stringify({
                            id: cmd.id,
                            type: "response",
                            command: "prompt",
                            success: false,
                            error: "blocked",
                        })}\n`,
                    );
                });
                return {
                    stdin,
                    stdout,
                    stderr,
                    kill: () => {
                        stdin.destroy();
                        stdout.destroy();
                    },
                };
            },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/blocked/);
    });
});
