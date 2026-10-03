import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * One of the station's mounts a speaker can play
 * generated from [OutputMount](../../../../data/contracts/outputs/outputs.types.ck#L7)
 */
export const OutputMount = z.strictObject({
    format: z.enum(['mp3', 'opus', 'aac', 'flac', 'hls']),
    path: z.string().min(1).max(200).describe('Same-origin path, leading slash included, as `/nowplaying` gives it'),
});
export type OutputMount = z.infer<typeof OutputMount>;

/**
 * A plugin that could not list its speakers
 * generated from [OutputProblem](../../../../data/contracts/outputs/outputs.types.ck#L23)
 */
export const OutputProblem = z.strictObject({
    pluginId: z.string().max(200),
    message: z.string().max(1000),
});
export type OutputProblem = z.infer<typeof OutputProblem>;

/**
 * A speaker the station is meant to be playing on, and how it is doing
 * generated from [OutputCast](../../../../data/contracts/outputs/outputs.types.ck#L33)
 */
export const OutputCast = z.strictObject({
    pluginId: z.string().max(200),
    deviceId: z.string().max(400),
    deviceName: z.string().max(200).describe('What the speaker was called when the cast started'),
    mountPath: z.string().min(1).max(200).describe('Which mount it plays'),
    startedAt: _ZodDatetime,
    phase: z
        .enum(['idle', 'opening', 'buffering', 'playing', 'stopped', 'unreachable'])
        .describe(
            "As the speaker reports it now. `opening` and `buffering` are a stream starting, not a failure; `stopped` with the station's stream still loaded is played again on its own; `unreachable` is a speaker that did not answer, which the station waits out",
        ),
    detail: z.string().max(1000).optional().describe('A sentence about the phase when it needs one, such as why a speaker is unreachable'),
});
export type OutputCast = z.infer<typeof OutputCast>;

/**
 * Play the station on a speaker
 * generated from [OutputCastRequest](../../../../data/contracts/outputs/outputs.types.ck#L47)
 */
export const OutputCastRequest = z.strictObject({
    pluginId: z.string().min(1).max(200),
    deviceId: z.string().min(1).max(400),
    mountPath: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("Which mount, from the speaker's `mounts`. Absent means its first, which is MP3 wherever the speaker takes it"),
});
export type OutputCastRequest = z.infer<typeof OutputCastRequest>;

/**
 * A speaker the station can play on, as an `output` plugin listed it
 * generated from [OutputDevice](../../../../data/contracts/outputs/outputs.types.ck#L12)
 */
export const OutputDevice = z.strictObject({
    pluginId: z.string().max(200).describe('The plugin that drives it, for example `deadair.cast`'),
    deviceId: z.string().max(400).describe("The plugin's own id for the speaker. Stable across restarts"),
    name: z.string().max(200).describe('What the operator calls it'),
    model: z.string().max(200).optional().describe('The make or model, where the speaker says'),
    address: z.string().max(400).describe('How the plugin reaches it, for recognising rather than dialling'),
    protocol: z.string().max(50).optional().describe('How it is driven, for a plugin that speaks several: `chromecast`, `upnp`, `bluos`'),
    mounts: z.array(OutputMount).describe("The station's mounts this speaker can play, MP3 first. Empty when it plays none of the ones switched on"),
    casting: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the station is meant to be playing on it now. `/outputs/casts` says how that is going'),
});
export type OutputDevice = z.infer<typeof OutputDevice>;

/**
 * Every speaker the station is meant to be playing on
 * generated from [OutputCastList](../../../../data/contracts/outputs/outputs.types.ck#L43)
 */
export const OutputCastList = z.strictObject({
    casts: z.array(OutputCast),
});
export type OutputCastList = z.infer<typeof OutputCastList>;

/**
 * Every speaker every `output` plugin can play the station on
 * generated from [OutputDeviceList](../../../../data/contracts/outputs/outputs.types.ck#L28)
 */
export const OutputDeviceList = z.strictObject({
    devices: z.array(OutputDevice),
    problems: z
        .array(OutputProblem)
        .describe('Plugins that did not answer. Their speakers are missing from `devices` rather than the whole list failing'),
});
export type OutputDeviceList = z.infer<typeof OutputDeviceList>;
