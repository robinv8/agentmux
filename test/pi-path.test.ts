import { describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { findPackageDir, resolvePiBinary } from "../src/pi-path.ts";

describe("resolvePiBinary", () => {
    test("explicit wins", () => {
        expect(
            resolvePiBinary({
                explicit: "/custom/pi",
                envPiBin: "/env/pi",
            }),
        ).toBe("/custom/pi");
    });

    test("PI_BIN env wins over package resolve", () => {
        expect(
            resolvePiBinary({
                envPiBin: "/from/env/pi",
            }),
        ).toBe("/from/env/pi");
    });

    test("resolves bundled package bin when present", async () => {
        const dir = path.join(
            os.tmpdir(),
            `agentmux-pi-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        );
        const pkgDir = path.join(
            dir,
            "node_modules",
            "@earendil-works",
            "pi-coding-agent",
        );
        await mkdir(path.join(pkgDir, "dist"), { recursive: true });
        await writeFile(
            path.join(pkgDir, "package.json"),
            JSON.stringify({
                name: "@earendil-works/pi-coding-agent",
                bin: { pi: "dist/cli.js" },
            }),
        );
        const cliPath = path.join(pkgDir, "dist", "cli.js");
        await writeFile(cliPath, "#!/usr/bin/env node\nconsole.log('pi')\n");

        const probeFile = path.join(dir, "src", "probe.js");
        await mkdir(path.dirname(probeFile), { recursive: true });
        await writeFile(probeFile, "");

        try {
            const resolved = resolvePiBinary({
                envPiBin: "",
                fromUrl: pathToFileURL(probeFile).href,
            });
            expect(resolved).toBe(realpathSync(cliPath));
            expect(
                findPackageDir(probeFile, "@earendil-works/pi-coding-agent"),
            ).toBe(pkgDir);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("falls back to bare pi when package missing", () => {
        const ghost = path.join(
            os.tmpdir(),
            `agentmux-empty-${Date.now()}`,
            "nested",
            "x.js",
        );
        expect(
            resolvePiBinary({
                envPiBin: "",
                fromUrl: pathToFileURL(ghost).href,
            }),
        ).toBe("pi");
    });

    test("resolves real bundled dep from this package when installed", () => {
        const resolved = resolvePiBinary({ envPiBin: "" });
        // After npm/bun install in this repo, should hit local node_modules
        if (resolved !== "pi") {
            expect(resolved.includes("pi-coding-agent")).toBe(true);
            expect(resolved.endsWith("cli.js") || resolved.includes("/pi")).toBe(
                true,
            );
        }
    });
});
