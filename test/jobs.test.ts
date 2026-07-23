import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
    createJob,
    listJobs,
    markJobDone,
    markJobFailed,
    markJobRunning,
    readJob,
} from "../src/jobs.ts";

describe("job ledger", () => {
    test("create → running → done is durable", async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "agentmux-jobs-"));
        try {
            const job = await createJob(
                {
                    kind: "run_in_project",
                    project: "alpha",
                    message: "ping",
                    status: "queued",
                },
                dir,
            );
            expect(job.status).toBe("queued");
            await markJobRunning(job.id, dir);
            const mid = await readJob(job.id, dir);
            expect(mid?.status).toBe("running");
            expect(mid?.startedAt).toBeTruthy();

            await markJobDone(job.id, "PONG from worker", dir);
            const done = await readJob(job.id, dir);
            expect(done?.status).toBe("done");
            expect(done?.summary).toContain("PONG");
            expect(done?.finishedAt).toBeTruthy();

            const listed = await listJobs({ dir, sinceMs: 60_000 });
            expect(listed.some((j) => j.id === job.id && j.status === "done")).toBe(
                true,
            );
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("failed job stores error", async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "agentmux-jobs-f-"));
        try {
            const job = await createJob(
                { kind: "run_in_project", project: "beta", status: "running" },
                dir,
            );
            await markJobFailed(job.id, "boom", dir);
            const failed = await readJob(job.id, dir);
            expect(failed?.status).toBe("failed");
            expect(failed?.error).toBe("boom");
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
