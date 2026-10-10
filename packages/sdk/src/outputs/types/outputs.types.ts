import { DateTime } from 'luxon';
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * One of the station's mounts a speaker can play
 * generated from [OutputMount](../../../../../apps/api/data/contracts/outputs/outputs.types.ck)
 */
export interface OutputMount {
    format: 'mp3' | 'opus' | 'aac' | 'flac' | 'hls';
    /** Same-origin path, leading slash included, as `/nowplaying` gives it */
    path: string;
}

/**
 * A plugin that could not list its speakers
 * generated from [OutputProblem](../../../../../apps/api/data/contracts/outputs/outputs.types.ck)
 */
export interface OutputProblem {
    pluginId: string;
    message: string;
}

/**
 * A speaker the station is meant to be playing on, and how it is doing
 * generated from [OutputCast](../../../../../apps/api/data/contracts/outputs/outputs.types.ck)
 */
export interface OutputCast {
    pluginId: string;
    deviceId: string;
    /** What the speaker was called when the cast started */
    deviceName: string;
    /** Which mount it plays */
    mountPath: string;
    startedAt: DateTime;
    /** As the speaker reports it now. `opening` and `buffering` are a stream starting, not a failure; `stopped` with the station's stream still loaded is played again on its own; `unreachable` is a speaker that did not answer, which the station waits out */
    phase: 'idle' | 'opening' | 'buffering' | 'playing' | 'stopped' | 'unreachable';
    /** A sentence about the phase when it needs one, such as why a speaker is unreachable */
    detail?: string;
}

/** Rehydrates every wire-encoded scalar in a OutputCast into its runtime type. Mutates and returns `raw`. */
export function reviveOutputCast(raw: OutputCast): OutputCast {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['startedAt'] = __dt(__o0['startedAt'], 'OutputCast.startedAt');
    return raw;
}

/**
 * Play the station on a speaker
 * generated from [OutputCastRequest](../../../../../apps/api/data/contracts/outputs/outputs.types.ck)
 */
export interface OutputCastRequest {
    pluginId: string;
    deviceId: string;
    /** Which mount, from the speaker's `mounts`. Absent means its first, which is MP3 wherever the speaker takes it */
    mountPath?: string;
}

/**
 * A speaker the station can play on, as an `output` plugin listed it
 * generated from [OutputDevice](../../../../../apps/api/data/contracts/outputs/outputs.types.ck)
 */
export interface OutputDevice {
    /** The plugin that drives it, for example `deadair.cast` */
    pluginId: string;
    /** The plugin's own id for the speaker. Stable across restarts */
    deviceId: string;
    /** What the operator calls it */
    name: string;
    /** The make or model, where the speaker says */
    model?: string;
    /** How the plugin reaches it, for recognising rather than dialling */
    address: string;
    /** How it is driven, for a plugin that speaks several: `chromecast`, `upnp`, `bluos` */
    protocol?: string;
    /** The station's mounts this speaker can play, MP3 first. Empty when it plays none of the ones switched on */
    mounts: OutputMount[];
    /** Whether the station is meant to be playing on it now. `/outputs/casts` says how that is going */
    casting: boolean;
}

/**
 * Every speaker the station is meant to be playing on
 * generated from [OutputCastList](../../../../../apps/api/data/contracts/outputs/outputs.types.ck)
 */
export interface OutputCastList {
    casts: OutputCast[];
}

/** Rehydrates every wire-encoded scalar in a OutputCastList into its runtime type. Mutates and returns `raw`. */
export function reviveOutputCastList(raw: OutputCastList): OutputCastList {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['casts'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveOutputCast(__a1[__i2] as never);
        }
    }
    return raw;
}

/**
 * Every speaker every `output` plugin can play the station on
 * generated from [OutputDeviceList](../../../../../apps/api/data/contracts/outputs/outputs.types.ck)
 */
export interface OutputDeviceList {
    devices: OutputDevice[];
    /** Plugins that did not answer. Their speakers are missing from `devices` rather than the whole list failing */
    problems: OutputProblem[];
    /** True when the station has looked for speakers on its network and never found one, which on a container usually means its network cannot carry multicast (a bridge network). Speakers added by address still work */
    discoverySeesNothing: boolean;
}
