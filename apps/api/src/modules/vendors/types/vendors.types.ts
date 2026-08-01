import { z } from 'zod';

/**
 * generated from [SpotifyCallbackQuery](file://./../../../../data/contracts/vendors/vendors.types.ck#L7)
 */
export const SpotifyCallbackQuery = z.strictObject({
    code: z.string().max(2048).optional(),
    state: z.string().max(200).optional(),
    error: z.string().max(200).optional(),
});
export type SpotifyCallbackQuery = z.infer<typeof SpotifyCallbackQuery>;
