import type { AppConfig } from '@maroonedsoftware/appconfig';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { numberOr } from '#modules/shared/setting.numbers.js';

/** The station settings that govern listener requests. Declared in `settings.registry.ts`, in the rotation group. */
export const REQUESTS_KEYS = {
    enabled: 'requests.enabled',
    approval: 'requests.approval',
    cooldownMinutes: 'requests.cooldownMinutes',
    maxOpen: 'requests.maxOpen',
    dedications: 'requests.dedications',
} as const;

/** Whether a request goes straight in, or waits for an operator to say yes. */
export type RequestApproval = 'auto' | 'operator';

export const REQUESTS_DEFAULTS = {
    enabled: true,
    approval: 'auto' as RequestApproval,
    cooldownMinutes: 30,
    maxOpen: 3,
    dedications: true,
} as const;

/** The bounds both the resolver and the settings form hold a stored row to. */
export const MAX_REQUEST_COOLDOWN_MINUTES = 24 * 60;
export const MAX_OPEN_REQUESTS = 20;

export interface RequestSettings {
    enabled: boolean;
    approval: RequestApproval;
    cooldownMs: number;
    maxOpen: number;
    /** Whether a dedication is said on air before the record. Off, the record still plays and the dedication is kept for the operator to read. */
    dedications: boolean;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(Math.trunc(value), min), max);

/** The request settings as they stand, read per call so a change applies to the next request. */
export function requestSettings(config: AppConfig): RequestSettings {
    const approval = config.get(REQUESTS_KEYS.approval, REQUESTS_DEFAULTS.approval);
    return {
        enabled: settingIsOn(config, REQUESTS_KEYS.enabled, REQUESTS_DEFAULTS.enabled),
        approval: approval === 'operator' ? 'operator' : 'auto',
        cooldownMs:
            clamp(numberOr(config, REQUESTS_KEYS.cooldownMinutes, REQUESTS_DEFAULTS.cooldownMinutes), 0, MAX_REQUEST_COOLDOWN_MINUTES) * 60_000,
        maxOpen: clamp(numberOr(config, REQUESTS_KEYS.maxOpen, REQUESTS_DEFAULTS.maxOpen), 1, MAX_OPEN_REQUESTS),
        dedications: settingIsOn(config, REQUESTS_KEYS.dedications, REQUESTS_DEFAULTS.dedications),
    };
}
