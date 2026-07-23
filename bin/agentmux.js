#!/usr/bin/env bun
/**
 * Launchable commander CLI for multi-project Pi workers.
 *
 * Usage:
 *   agentmux list
 *   agentmux status <project>
 *   agentmux dispatch <project> <message...>
 *   agentmux register <project> --socket <path> [--pid N]
 *   agentmux worker <project>   # start local pi --mode rpc bridge + register
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
