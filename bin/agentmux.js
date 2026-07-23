#!/usr/bin/env bun
/**
 * AgentMux CLI — multi-project Pi commander.
 *
 * Primary:
 *   agentmux <project> <message...>
 *   agentmux list
 *   agentmux chat
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// Prefer TypeScript sources under bun; fall back to .js if compiled.
const modPath = path.join(root, "src", "cli.ts");
const { runCli } = await import(pathToFileURL(modPath).href);
const code = await runCli(process.argv.slice(2));
process.exit(code);
