import { z } from 'zod';

/**
 * What a liveness probe gets back from the API
 * generated from [Health](../../../../data/contracts/health/health.types.ck#L7)
 */
export const Health = z.strictObject({
    status: z
        .literal('ok')
        .describe(
            'Constant. This route answers 200 or nothing at all: a process that can serve it is up, and a process that cannot never reaches the handler',
        ),
    uptimeMs: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('How long this process has been running, so a probe can tell a live server from one that has just restarted under it'),
    revision: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe(
            "The commit this station was built from, as the image's `org.opencontainers.image.revision` label says it. Absent when nothing set one, which is what a development tree and a hand-built image both honestly are",
        ),
    version: z
        .string()
        .min(1)
        .max(50)
        .optional()
        .describe(
            "The release this station is, as the image's `org.opencontainers.image.version` label says it. Absent on every build that is not a tagged release, which is most of them: `latest` follows main, so a station tracking it honestly has a commit and no version",
        ),
});
export type Health = z.infer<typeof Health>;
