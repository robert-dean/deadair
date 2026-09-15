import { Duration } from 'luxon';

/**
 * What every station API key starts with: `da_` followed by 43 base62 characters and a six-character
 * checksum. The prefix is what lets the bearer chain decline a JWT without a query, and what a secret
 * scanner matches on if a key is ever pasted somewhere public.
 */
export const API_KEY_PREFIX = 'da';

/**
 * How often one key's use is recorded in `login_events`: at most once per window, however often it is
 * presented. A doorbell polling every few seconds costs one row every five minutes, which is what
 * keeps a table nothing prunes from growing with every request. ServerKit's own `lastUsedAt` throttle
 * is given the same window, so the two cannot disagree about what "recently" means.
 */
export const API_KEY_USE_WINDOW = Duration.fromObject({ minutes: 5 });
