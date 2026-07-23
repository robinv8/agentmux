/**
 * JSONL protocol for Super Agent so the macOS app (or any UI) can drive turns.
 *
 * stdin lines:
 *   {"type":"user","text":"..."}
 *   {"type":"ping"}
 *   {"type":"shutdown"}
 *
 * stdout lines:
 *   {"type":"ready"}
 *   {"type":"assistant_text","text":"..."}
 *   {"type":"tool_start","toolName":"...","toolInput":{}}
 *   {"type":"tool_end","toolName":"...","toolResult":"..."}
 *   {"type":"turn_end","assistantText":"..."}
 *   {"type":"error","error":"..."}
 */
import { createDefaultSuperConfig, runSuperTurn, type ChatMessage } from "./super-agent.js";
import { defaultCommanderConfig } from "./commander.js";

export async function runSuperRpcStdio(
    options: {
        projectsRoot?: string;
        stdin?: NodeJS.ReadableStream;
        stdout?: NodeJS.WritableStream;
    } = {},
): Promise<void> {
    const stdin = options.stdin ?? process.stdin;
    const stdout = options.stdout ?? process.stdout;
    const write = (obj: unknown) => {
        stdout.write(`${JSON.stringify(obj)}\n`);
    };

    const cmd = defaultCommanderConfig();
    const projectsRoot = options.projectsRoot ?? cmd.projectsRoot;
    const config = createDefaultSuperConfig(projectsRoot);
    let history: ChatMessage[] = [];

    write({ type: "ready", projectsRoot, model: config.model });

    let buffer = "";
    for await (const chunk of stdin as AsyncIterable<Buffer | string>) {
        buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.trim()) continue;

            let msg: { type?: string; text?: string };
            try {
                msg = JSON.parse(line) as { type?: string; text?: string };
            } catch {
                write({ type: "error", error: `invalid json: ${line.slice(0, 80)}` });
                continue;
            }

            if (msg.type === "shutdown" || msg.type === "quit") {
                write({ type: "bye" });
                return;
            }
            if (msg.type === "ping") {
                write({ type: "pong" });
                continue;
            }
            if (msg.type === "reset") {
                history = [];
                write({ type: "reset_ok" });
                continue;
            }
            if (msg.type === "user") {
                const text = (msg.text ?? "").trim();
                if (!text) {
                    write({ type: "error", error: "empty user text" });
                    continue;
                }
                try {
                    const result = await runSuperTurn({
                        config,
                        history,
                        userText: text,
                        onEvent: (ev) => {
                            write(ev);
                        },
                    });
                    history = result.history;
                    write({
                        type: "turn_end",
                        assistantText: result.assistantText,
                    });
                } catch (e) {
                    write({
                        type: "error",
                        error: e instanceof Error ? e.message : String(e),
                    });
                }
                continue;
            }

            write({ type: "error", error: `unknown type: ${msg.type}` });
        }
    }
}
