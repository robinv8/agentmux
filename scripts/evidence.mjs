/**
 * Capture list/status/dispatch evidence against a mock Pi JSONL RPC server.
 * Run: bun scripts/evidence.mjs
 */
import { createServer } from "node:net";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commander = await import(
    pathToFileURL(path.join(root, "src", "commander.ts")).href
);
const rpc = await import(
    pathToFileURL(path.join(root, "src", "rpc-client.ts")).href
);
const registryMod = await import(
    pathToFileURL(path.join(root, "src", "registry.ts")).href
);

const {
    defaultCommanderConfig,
    dispatch,
    listProjects,
    registerExternalWorker,
    statusForProject,
} = commander;
const { SocketPiRpcClient } = rpc;
const { loadRegistry, saveRegistry, upsertWorker } = registryMod;

const dir = await mkdtemp(path.join(os.tmpdir(), "pi-cmd-evidence-"));
const projectsRoot = path.join(dir, "Projects");
const alpha = path.join(projectsRoot, "alpha");
await mkdir(alpha, { recursive: true });
await mkdir(path.join(projectsRoot, "beta"), { recursive: true });
await writeFile(path.join(alpha, "package.json"), '{"name":"alpha"}');

const socketPath = path.join(dir, "alpha.sock");
const received = [];
const state = { isStreaming: false };

const server = createServer((conn) => {
    let buf = "";
    conn.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
            let line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.trim()) continue;
            const cmd = JSON.parse(line);
            if (cmd.type === "get_state") {
                conn.write(
                    `${JSON.stringify({
                        id: cmd.id,
                        type: "response",
                        command: "get_state",
                        success: true,
                        data: {
                            isStreaming: state.isStreaming,
                            sessionId: "ev-sess",
                            messageCount: received.length,
                        },
                    })}\n`,
                );
            } else if (cmd.type === "prompt") {
                received.push(String(cmd.message));
                conn.write(
                    `${JSON.stringify({
                        id: cmd.id,
                        type: "response",
                        command: "prompt",
                        success: true,
                    })}\n`,
                );
            }
        }
    });
});

await new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(socketPath, res);
});

const registryPath = path.join(dir, "workers.json");
const config = defaultCommanderConfig({
    projectsRoot,
    registryPath,
    socketsDir: path.join(dir, "sockets"),
    rpcClient: new SocketPiRpcClient(),
    processProbe: { isAlive: (pid) => pid === process.pid },
});

const record = await registerExternalWorker(config, "alpha", {
    rpcSocketPath: socketPath,
    pid: process.pid,
});
console.log("REGISTERED", JSON.stringify(record));

const online = await statusForProject(config, "alpha");
console.log("STATUS_ONLINE", JSON.stringify(online));

const dispatchResult = await dispatch(
    config,
    "alpha",
    "evidence-prompt-hello-worker",
);
console.log("DISPATCH", JSON.stringify(dispatchResult));
console.log("WORKER_RECEIVED", JSON.stringify(received));

const offline = await statusForProject(config, "beta");
console.log("STATUS_OFFLINE", JSON.stringify(offline));

let reg = await loadRegistry(registryPath);
reg = upsertWorker(reg, {
    projectId: "alpha",
    cwd: alpha,
    mode: "rpc",
    updatedAt: new Date().toISOString(),
    pid: 1,
    rpcSocketPath: path.join(dir, "gone.sock"),
});
await saveRegistry(registryPath, reg);

const configDead = defaultCommanderConfig({
    projectsRoot,
    registryPath,
    rpcClient: new SocketPiRpcClient(),
    processProbe: { isAlive: () => false },
});
const dead = await statusForProject(configDead, "alpha");
console.log("STATUS_DEAD", JSON.stringify(dead));

const { table } = await listProjects(configDead);
console.log("LIST_TABLE");
console.log(table);

if (!dispatchResult.ok) throw new Error("dispatch failed");
if (!received.includes("evidence-prompt-hello-worker")) {
    throw new Error("worker did not receive prompt");
}
if (online.status !== "idle" && online.status !== "running") {
    throw new Error(`online not idle/running: ${online.status}`);
}
if (offline.status !== "offline") {
    throw new Error("missing worker not offline");
}
if (dead.status !== "offline") {
    throw new Error("dead not offline");
}
console.log("EVIDENCE_OK");

await new Promise((r) => server.close(() => r()));
await rm(dir, { recursive: true, force: true });
