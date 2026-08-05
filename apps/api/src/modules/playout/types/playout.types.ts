import { z } from 'zod';

/**
 * Which rundown item Liquidsoap has just started playing
 * generated from [PlayoutAiredQuery](file://./../../../../data/contracts/playout/playout.types.ck#L7)
 */
export const PlayoutAiredQuery = z.strictObject({
    item: z.string().min(1).max(100).describe("The id the app put on the pushed uri's `annotate:` metadata"),
});
export type PlayoutAiredQuery = z.infer<typeof PlayoutAiredQuery>;

/**
 * The shared secret gating the internal playout bridge, in both directions
 * generated from [PlayoutBridgeHeaders](file://./../../../../data/contracts/playout/playout.types.ck#L11)
 */
export const PlayoutBridgeHeaders = z.strictObject({
    'x-playout-secret': z.string().min(1).max(200).describe('The shared secret gating the internal playout bridge, in both directions'),
});
export type PlayoutBridgeHeaders = z.infer<typeof PlayoutBridgeHeaders>;
