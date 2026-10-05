import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { isPluginError, type OutputDevice as PluginOutputDevice, type OutputMetadata, type OutputStatus } from '@deadair/plugin-sdk';
import { NowPlayingService } from '#modules/nowplaying/nowplaying.service.js';
import { asOutputPlugin, type OutputPlugin } from '#modules/plugins/plugin.capabilities.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { byPluginId, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { resolvePublicUrl, stationArtwork } from '#modules/stream/stream.settings.js';
import { MOUNT_CONTENT_TYPES, mountUrl, stationMounts } from './outputs.mounts.js';

/** How long listing one plugin's speakers may take: a config read, or one discovery pass. */
export const LIST_TIMEOUT_MS = 10_000;

/**
 * How long a play may take. Long, because it is several round trips to a device and one of them can
 * be an app launching on a television, which is seconds on its own.
 */
export const PLAY_TIMEOUT_MS = 30_000;

/** How long asking a speaker how it is, or telling it to stop, may take. */
export const STATUS_TIMEOUT_MS = 10_000;

/**
 * The station cannot be played anywhere, for a reason the operator fixes in the station's settings
 * rather than the plugin's: no public address, or a mount that is switched off.
 */
export class OutputUnplayableError extends Error {}

/**
 * Every call the outputs module makes into an `output` plugin, in one place.
 *
 * A singleton, because the supervisor uses it off the request path; the route service uses the same
 * one. It owns the timeouts, which mount is which content type, the URL a speaker is handed, and
 * what a speaker shows when it starts, so the service and the supervisor cannot start a cast two
 * different ways.
 */
@Injectable()
export class OutputSpeakers {
    constructor(
        private readonly registry: PluginRegistry,
        private readonly invoker: PluginInvoker,
        private readonly config: AppConfig,
        private readonly nowPlaying: NowPlayingService,
    ) {}

    /** Every `output` plugin installed and running, in id order. */
    plugins(): OutputPlugin[] {
        return pluginsWith(this.registry.list(), asOutputPlugin).sort(byPluginId);
    }

    /** One by id, when it is installed and running. */
    plugin(pluginId: string): OutputPlugin | undefined {
        const record = this.registry.get(pluginId);
        return record === undefined ? undefined : asOutputPlugin(record);
    }

    async devices(plugin: OutputPlugin): Promise<PluginOutputDevice[]> {
        return this.invoker.invoke(plugin.record.id, 'output.listDevices', async () => plugin.instance.listDevices(), { timeoutMs: LIST_TIMEOUT_MS });
    }

    /**
     * Starts the station on a speaker, at one of the station's mounts.
     *
     * @throws {OutputUnplayableError} when the mount is not one the station publishes now, or the
     *   station has no address a speaker could reach.
     * @throws {PluginError} whatever the plugin threw.
     */
    async play(plugin: OutputPlugin, deviceId: string, mountPath: string): Promise<void> {
        const mount = stationMounts(this.config).find(candidate => candidate.path === mountPath);
        if (mount === undefined) throw new OutputUnplayableError(`the station does not publish ${mountPath} now`);

        const url = mountUrl(this.config, mount.path);
        if (url === undefined) {
            throw new OutputUnplayableError(
                'the station has no address a speaker could reach; set stream.speakerUrl (or stream.publicUrl) to one that is not localhost',
            );
        }

        const request = { deviceId, url, contentType: MOUNT_CONTENT_TYPES[mount.format], metadata: this.metadata() };
        await this.invoker.invoke(plugin.record.id, 'output.play', async () => plugin.instance.play(request), { timeoutMs: PLAY_TIMEOUT_MS });
    }

    async stop(plugin: OutputPlugin, deviceId: string): Promise<void> {
        await this.invoker.invoke(plugin.record.id, 'output.stop', async () => plugin.instance.stop(deviceId), { timeoutMs: STATUS_TIMEOUT_MS });
    }

    async status(plugin: OutputPlugin, deviceId: string): Promise<OutputStatus> {
        return this.invoker.invoke(plugin.record.id, 'output.status', async () => plugin.instance.status(deviceId), { timeoutMs: STATUS_TIMEOUT_MS });
    }

    /** The URL a speaker would be handed for a mount, for telling the station's stream from anything else it plays. */
    urlFor(mountPath: string): string | undefined {
        return mountUrl(this.config, mountPath);
    }

    /**
     * What a speaker shows when it starts: the station and the programme, not the record.
     *
     * Not the record, because a speaker that cannot be told what changed would show the first
     * record's title for as long as it played. The station's name is true for all of it.
     */
    metadata(): OutputMetadata {
        const now = this.nowPlaying.getNowPlaying();
        const artworkUrl = stationArtwork(resolvePublicUrl(this.config));
        return {
            title: now.station,
            ...(now.show === undefined ? {} : { subtitle: now.show.name }),
            ...(artworkUrl === '' ? {} : { artworkUrl }),
        };
    }
}

/** Whether a plugin's refusal names a speaker it no longer has, which ends a cast rather than pausing it. */
export function isUnknownDevice(error: unknown): boolean {
    return isPluginError(error) && error.code === 'config';
}
