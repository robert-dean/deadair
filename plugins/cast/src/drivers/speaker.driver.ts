import type { OutputMetadata, OutputPhase, OutputPlayRequest, PluginHost } from '@deadair/plugin-sdk';

/** One speaker as the operator configured it: a row of the `devices` list. */
export interface SpeakerTarget {
    /** `<protocol>:<address>`, lowercased: what the host stores and hands back. */
    id: string;
    name: string;
    /** As the operator typed it: a bare host, a `host:port`, or a URL, whichever the protocol takes. */
    address: string;
}

/** What a driver can say about a device: from the protocol alone, or by asking it. */
export interface SpeakerTraits {
    /** The content types it plays, MP3 first. See `OutputDevice.accepts`. */
    accepts: string[];
    followsMetadata: boolean;
    /** The make or model, where the device says. */
    model?: string;
}

/** How a device is doing, before the plugin adds which device it was. */
export interface SpeakerStatus {
    phase: OutputPhase;
    url?: string;
    detail?: string;
}

/**
 * One protocol the cast plugin speaks.
 *
 * The plugin is one `output` plugin with a driver per protocol, so the operator configures one
 * list of speakers and the console shows one list back. A driver is chosen by a row's `protocol`
 * cell, holds whatever connections it keeps open, and is handed the host on every call rather than
 * keeping one, for the SDK's rule about reading `this.host` after an await.
 *
 * Every method answers for one {@link SpeakerTarget}, which the plugin has already matched to an
 * id the host asked about, so a driver never sees an id it was not configured with.
 */
export interface SpeakerDriver {
    /** The word stored in a row's `protocol` cell. */
    readonly protocol: string;
    /** What the operator picks from, in the protocol column. */
    readonly label: string;
    /**
     * What the device can do. A driver may ask the device, and must answer anyway when it does not
     * reply: a configured speaker is listed whether or not it is switched on, so this falls back to
     * what the protocol alone promises rather than throwing.
     */
    describe(host: PluginHost, target: SpeakerTarget): Promise<SpeakerTraits>;
    play(host: PluginHost, target: SpeakerTarget, request: OutputPlayRequest): Promise<void>;
    updateMetadata(host: PluginHost, target: SpeakerTarget, metadata: OutputMetadata): Promise<void>;
    stop(host: PluginHost, target: SpeakerTarget): Promise<void>;
    /** Answers `unreachable` rather than throwing when the device does not answer. */
    status(host: PluginHost, target: SpeakerTarget): Promise<SpeakerStatus>;
    /** Lets go of every connection it holds. Called when the plugin unloads. */
    dispose(): void;
}
