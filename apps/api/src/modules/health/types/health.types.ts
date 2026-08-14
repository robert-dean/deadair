import { z } from 'zod';

/**
 * What a liveness probe gets back from the API
 * generated from [Health](file://./../../../../data/contracts/health/health.types.ck#L7)
 */
export const Health = z.strictObject({
    status: z
        .literal('ok')
        .describe(
            'Constant. This route answers 200 or nothing at all: a process that can serve it is up, and a process that cannot never reaches the handler',
        ),
    uptimeMs: z.coerce
        .number()
        .int()
        .min(0)
        .describe('How long this process has been running, so a probe can tell a live server from one that has just restarted under it'),
});
export type Health = z.infer<typeof Health>;
