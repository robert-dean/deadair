/**
 * The `output` kind. An output plugin puts the station on a speaker somewhere
 * else: a Chromecast, a Sonos, a BluOS player, a DLNA renderer.
 *
 * ## The speaker fetches the stream, and nothing here carries audio
 *
 * Every speaker this describes is a PULL speaker: it is told a URL and fetches
 * the station's mount itself, the way any other listener does. So the contract
 * is commands and status, never bytes, and the station's rule that no audio is
 * decoded or mixed in Node holds without an exception for it.
 *
 * That is also the line this capability does not cross. A PUSH protocol, where
 * the sender encodes the audio and streams it to the device (AirPlay audio,
 * Bluetooth), cannot implement it: there is no URL to hand over, and building
 * one would put an encoder in the station's process. A speaker that only
 * speaks such a protocol is out of reach of this capability on purpose, not by
 * omission.
 *
 * ## A device is a listener
 *
 * A speaker playing the station is one more connection to the mount, and the
 * station counts it as an audience like any other. That is the point rather
 * than a side effect: a station with nobody listening may stand down, and a
 * kitchen speaker is somebody listening. It is also why `stop` has to mean it:
 * a device left playing holds the audience open.
 *
 * ## What the host decides, and what the plugin does
 *
 * The host chooses WHICH mount a device is given, from the content types the
 * device says it {@link OutputDevice.accepts}, and builds the URL from the
 * station's public address. A plugin never builds a station URL and never
 * picks a format: it is handed both and passes them on. The host also owns
 * whether a cast is still wanted: it remembers what it started, asks
 * {@link OutputProvider.status} how each one is doing, and plays it again when
 * a device drops it. So a plugin does not retry on its own, and should not:
 * two things deciding to reconnect is one thing reconnecting twice.
 *
 * ## Status is the device's word, read honestly
 *
 * A speaker takes seconds to start a live stream, and reports a stream it has
 * not started yet in whatever way it likes. {@link OutputPhase} is the shared
 * vocabulary for that, and the rule for using it is that warming up is
 * `opening` or `buffering`, never a failure, and a device that did not answer
 * at all is `unreachable` rather than an exception: the host lists it all the
 * same, so an operator sees the speaker they configured and why it is quiet.
 */

/**
 * Where a device is, as far as playing the station goes.
 *
 * - `idle`: answering, and playing nothing of ours.
 * - `opening`: told to play, and has not started fetching yet.
 * - `buffering`: fetching, and not yet making sound.
 * - `playing`: making the station's sound.
 * - `stopped`: was playing ours and has stopped, by request or on its own.
 * - `unreachable`: did not answer.
 */
export type OutputPhase = 'idle' | 'opening' | 'buffering' | 'playing' | 'stopped' | 'unreachable';

/** One speaker a plugin can play the station on. */
export interface OutputDevice {
    /**
     * Stable and unique within this plugin, across restarts: the host stores it
     * to resume a cast after a reboot, so an id that changes is a cast that is
     * forgotten. Compare them case-insensitively if your sources disagree on
     * case; the host does not.
     */
    id: string;
    /** What the operator calls it, as the device or the settings name it. */
    name: string;
    /** The make or model, where the device says. */
    model?: string;
    /**
     * How the plugin reaches it, for the operator to recognise rather than for
     * anybody to dial: an address, or a URL.
     */
    address: string;
    /**
     * The protocol it is driven over, as a short word (`chromecast`, `upnp`,
     * `bluos`), for a plugin that speaks several. Shown, never interpreted.
     */
    protocol?: string;
    /**
     * The content types it can play, as MIME types (`audio/mpeg`, `audio/aac`,
     * `audio/ogg`, `audio/flac`, `application/vnd.apple.mpegurl`). The host
     * offers a device only the mounts it lists, so be honest: a Sonos takes MP3
     * and AAC for a radio URL and nothing else, and listing more is a cast that
     * fails on the device rather than here. Never empty: MP3 is the floor.
     */
    accepts: string[];
    /**
     * Whether {@link OutputProvider.updateMetadata} changes what the device
     * shows. `false` for a device that reads the stream's own titles, or one that
     * can only be told at the start; the host then does not call it.
     */
    followsMetadata: boolean;
}

/** What a device shows while it plays the station. */
export interface OutputMetadata {
    /** The line it shows largest: the record, or the station's name. */
    title: string;
    /** The line under it: the artist, or the show. */
    subtitle?: string;
    /** An absolute `http(s)` URL the device fetches itself. */
    artworkUrl?: string;
}

/** Play the station on one device. */
export interface OutputPlayRequest {
    /** An {@link OutputDevice.id} this plugin listed. */
    deviceId: string;
    /** The mount, absolute, on the station's public address. Pass it on as it is. */
    url: string;
    /** The mount's content type, one the device said it {@link OutputDevice.accepts}. */
    contentType: string;
    /** What to show to begin with. */
    metadata: OutputMetadata;
}

/** Change what a device shows, without restarting what it plays. */
export interface OutputMetadataRequest {
    deviceId: string;
    metadata: OutputMetadata;
}

/** How one device is doing. */
export interface OutputStatus {
    deviceId: string;
    phase: OutputPhase;
    /** The URL it is playing, where it says; how the host tells ours from somebody else's. */
    url?: string;
    /** A sentence for the operator when the phase needs one, such as why it is unreachable. */
    detail?: string;
}

/**
 * The `output` capability's methods.
 *
 * Every method but {@link listDevices} names a device by the id
 * {@link listDevices} gave it, and should answer for an id it does not know by
 * throwing a `PluginError` with code `config`: the operator removed a speaker
 * the host still remembered, and that is theirs to see.
 */
export interface OutputProvider {
    /**
     * Every speaker this plugin can play on: the ones the operator configured,
     * and any it found. A configured device that does not answer is still
     * listed, because the operator asked for it by name.
     */
    listDevices(): Promise<OutputDevice[]>;

    /**
     * Start the station on a device, replacing whatever it was playing.
     *
     * Resolve once the device has ACCEPTED the command, not once it is making
     * sound: starting a live stream takes seconds, and the host reads progress
     * through {@link status}. Throw when the device refused or could not be
     * reached.
     */
    play(request: OutputPlayRequest): Promise<void>;

    /** Change what a device shows. Called only for a device that {@link OutputDevice.followsMetadata}. */
    updateMetadata(request: OutputMetadataRequest): Promise<void>;

    /**
     * Stop the station on a device. Resolve when it has stopped, or when it was
     * not playing ours to begin with: stopping is idempotent.
     */
    stop(deviceId: string): Promise<void>;

    /**
     * How a device is doing right now. Answer `unreachable` rather than
     * throwing when it does not answer; throw only for an id this plugin does
     * not know.
     */
    status(deviceId: string): Promise<OutputStatus>;
}
