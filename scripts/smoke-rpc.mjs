#!/usr/bin/env bun
/**
 * Smoke test: Pi RPC one prompt with kimi-coding (or CLI args).
 * Usage: bun scripts/smoke-rpc.mjs [provider] [model]
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { resolvePiBinary } = await import(
    pathToFileURL(path.join(root, "src/pi-path.ts")).href
);

const provider = process.argv[2] || "kimi-coding";
const model = process.argv[3] || "kimi-for-coding";
const pi = resolvePiBinary({ envPiBin: "" });

const env = {
    ...process.env,
    KIMI_API_KEY:
        process.env.KIMI_API_KEY ||
        process.env.ANTHROPIC_AUTH_TOKEN ||
        process.env.ANTHROPIC_API_KEY ||
        "",
};

console.error(`pi=${pi}`);
console.error(`provider=${provider} model=${model}`);
console.error(`KIMI_API_KEY set=${Boolean(env.KIMI_API_KEY)}`);

const child = spawn(
    pi,
    ["--mode", "rpc", "--no-session", "--provider", provider, "--model", model],
    {
        cwd: path.join(root),
        stdio: ["pipe", "pipe", "pipe"],
        env,
    },
);

let out = "";
child.stdout.on("data", (c) => {
    out += c.toString();
    process.stdout.write(c);
});
child.stderr.on("data", (c) => process.stderr.write(c));

setTimeout(() => {
    child.stdin.write(
        `${JSON.stringify({
            id: "smoke-1",
            type: "prompt",
            message:
                "Reply with exactly the single line: PONG-AGENTMUX. No tools. No file edits.",
        })}\n`,
    );
}, 400);

const timer = setTimeout(() => {
    console.error("TIMEOUT");
    child.kill();
    process.exit(1);
}, 120_000);

function maybeDone() {
    if (out.includes("agent_settled")) {
        clearTimeout(timer);
        const ok = out.includes("PONG-AGENTMUX");
        setTimeout(() => {
            child.kill();
            process.exit(ok ? 0 : 2);
        }, 300);
    }
    if (out.includes('"success":false') && out.includes("No API key")) {
        clearTimeout(timer);
        child.kill();
        process.exit(3);
    }
}
child.stdout.on("data", maybeDone);
