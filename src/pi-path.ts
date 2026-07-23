import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";

export interface ResolvePiBinaryOptions {
    /** Explicit path or command name wins over everything. */
    explicit?: string;
    /** Override process.env.PI_BIN (for tests). */
    envPiBin?: string | undefined;
    /**
     * File URL or path used as the walk start for node_modules lookup.
     * Defaults to this module's location (so global installs find the bundled dep).
     */
    fromUrl?: string;
    /** Optional package root to check `node_modules/.bin/pi`. */
    packageRoot?: string;
}

/**
 * Resolve the Pi CLI to use for one-shot / serve workers.
 *
 * Priority:
 * 1. explicit option
 * 2. PI_BIN env
 * 3. `@earendil-works/pi-coding-agent` next to AgentMux (bundled dependency)
 * 4. `packageRoot/node_modules/.bin/pi`
 * 5. bare `pi` on PATH (last resort)
 */
export function resolvePiBinary(
    options: ResolvePiBinaryOptions = {},
): string {
    if (options.explicit) return options.explicit;

    const envBin =
        options.envPiBin !== undefined
            ? options.envPiBin
            : process.env.PI_BIN;
    if (envBin && envBin.length > 0) return envBin;

    const startFile = toPath(options.fromUrl ?? import.meta.url);
    const bundled = resolveFromNodeModules(startFile, PI_PACKAGE);
    if (bundled) return bundled;

    if (options.packageRoot) {
        const cand = path.join(
            options.packageRoot,
            "node_modules",
            ".bin",
            "pi",
        );
        if (existsSync(cand)) return realpathSafe(cand);
    }

    return "pi";
}

function toPath(urlOrPath: string): string {
    if (urlOrPath.startsWith("file:")) {
        return fileURLToPath(urlOrPath);
    }
    return urlOrPath;
}

/**
 * Walk parents of `startFile` looking for node_modules/<package>/package.json.
 * Avoids require.resolve() so packages that omit `./package.json` from exports still work.
 */
export function findPackageDir(
    startFile: string,
    packageName: string,
): string | undefined {
    let dir = path.dirname(path.resolve(startFile));
    const parts = packageName.split("/");
    for (;;) {
        const cand = path.join(dir, "node_modules", ...parts);
        if (existsSync(path.join(cand, "package.json"))) {
            return cand;
        }
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

function resolveFromNodeModules(
    startFile: string,
    packageName: string,
): string | undefined {
    const pkgDir = findPackageDir(startFile, packageName);
    if (!pkgDir) return undefined;

    let pkg: { bin?: string | Record<string, string> };
    try {
        pkg = JSON.parse(
            readFileSync(path.join(pkgDir, "package.json"), "utf8"),
        ) as { bin?: string | Record<string, string> };
    } catch {
        return undefined;
    }

    const rel = pickBin(pkg.bin);
    if (!rel) return undefined;
    const abs = path.resolve(pkgDir, rel);
    if (!existsSync(abs)) return undefined;
    return realpathSafe(abs);
}

function pickBin(
    bin: string | Record<string, string> | undefined,
): string | undefined {
    if (!bin) return undefined;
    if (typeof bin === "string") return bin;
    if (typeof bin.pi === "string") return bin.pi;
    const first = Object.values(bin)[0];
    return typeof first === "string" ? first : undefined;
}

function realpathSafe(p: string): string {
    try {
        return realpathSync(p);
    } catch {
        return p;
    }
}
