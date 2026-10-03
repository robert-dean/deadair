import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { toPluginError } from '@deadair/plugin-sdk';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { pluginHttpError } from '#modules/plugins/plugin.error.http.js';
import { mountsFor, stationMounts } from './outputs.mounts.js';
import { OutputsRepository, type OutputCastRow } from './outputs.repository.js';
import { OutputSpeakers, OutputUnplayableError, isUnknownDevice } from './outputs.speakers.js';
import type { OutputCast, OutputCastList, OutputCastRequest, OutputDevice, OutputDeviceList, OutputProblem } from './types/outputs.types.js';

/**
 * The operator's half of playing the station on speakers: what there is to play on, what is
 * playing, and starting and stopping it.
 *
 * Starting a cast plays first and records second, so a speaker that refused leaves nothing behind
 * for the supervisor to keep retrying. Stopping records first and stops second, so the supervisor
 * cannot put back a speaker somebody has just asked to stop.
 */
@Injectable()
export class OutputsService {
    constructor(
        private readonly authz: AuthorizationContext,
        private readonly repository: OutputsRepository,
        private readonly speakers: OutputSpeakers,
        private readonly config: AppConfig,
    ) {}

    /**
     * Every speaker every `output` plugin offers. A plugin that cannot list its speakers is reported
     * in `problems` rather than failing the list: one unreachable plugin should not hide the rest.
     */
    async listDevices(): Promise<OutputDeviceList> {
        const mounts = stationMounts(this.config);
        const casting = new Set((await this.repository.list()).map(row => castKey(row.pluginId, row.deviceId)));
        const devices: OutputDevice[] = [];
        const problems: OutputProblem[] = [];

        await Promise.all(
            this.speakers.plugins().map(async plugin => {
                try {
                    for (const device of await this.speakers.devices(plugin)) {
                        devices.push({
                            pluginId: plugin.record.id,
                            deviceId: device.id,
                            name: device.name,
                            ...(device.model === undefined ? {} : { model: device.model }),
                            address: device.address,
                            ...(device.protocol === undefined ? {} : { protocol: device.protocol }),
                            mounts: mountsFor(device.accepts, mounts),
                            casting: casting.has(castKey(plugin.record.id, device.id)),
                        });
                    }
                } catch (error) {
                    problems.push({ pluginId: plugin.record.id, message: toPluginError(error).message });
                }
            }),
        );

        devices.sort((left, right) => left.name.localeCompare(right.name) || left.deviceId.localeCompare(right.deviceId));
        problems.sort((left, right) => left.pluginId.localeCompare(right.pluginId));
        return { devices, problems };
    }

    /** Every cast, each asked how it is doing now. A speaker that does not answer is `unreachable`, never an error. */
    async listCasts(): Promise<OutputCastList> {
        const rows = await this.repository.list();
        return { casts: await Promise.all(rows.map(row => this.withStatus(row))) };
    }

    /** Plays the station on a speaker and remembers it, replacing whatever the speaker was playing. */
    async startCast(request: OutputCastRequest): Promise<OutputCast> {
        const plugin = this.speakers.plugin(request.pluginId);
        if (plugin === undefined) throw httpError(404).withDetails({ message: `no running output plugin "${request.pluginId}"` });

        let device;
        try {
            device = (await this.speakers.devices(plugin)).find(candidate => candidate.id === request.deviceId);
        } catch (error) {
            throw pluginHttpError(plugin.record.id, error);
        }
        if (device === undefined) throw httpError(404).withDetails({ message: `"${request.pluginId}" has no speaker "${request.deviceId}"` });

        const playable = mountsFor(device.accepts, stationMounts(this.config));
        const mount = request.mountPath === undefined ? playable[0] : playable.find(candidate => candidate.path === request.mountPath);
        if (mount === undefined) {
            throw httpError(400).withDetails({
                message:
                    request.mountPath === undefined
                        ? `${device.name} cannot play any of the station's mounts`
                        : `${device.name} cannot play ${request.mountPath}, or the station does not publish it`,
            });
        }

        try {
            await this.speakers.play(plugin, device.id, mount.path);
        } catch (error) {
            if (error instanceof OutputUnplayableError) throw httpError(400).withDetails({ message: error.message });
            throw pluginHttpError(plugin.record.id, error);
        }

        const actor = this.authz.actor;
        const row = await this.repository.save({
            pluginId: plugin.record.id,
            deviceId: device.id,
            deviceName: device.name,
            mountPath: mount.path,
            ...(actor.kind === 'user' ? { startedBy: actor.actorId } : {}),
        });
        return { ...toCast(row), phase: 'opening' };
    }

    /**
     * Stops the station on a speaker. Answers for a speaker that was not playing too, since the
     * caller's intent (this speaker should not be playing the station) holds either way.
     */
    async stopCast(pluginId: string, deviceId: string): Promise<void> {
        await this.repository.remove(pluginId, deviceId);

        const plugin = this.speakers.plugin(pluginId);
        if (plugin === undefined) return;
        try {
            await this.speakers.stop(plugin, deviceId);
        } catch (error) {
            // A speaker the plugin no longer has is not playing anything of ours.
            if (isUnknownDevice(error)) return;
            throw pluginHttpError(pluginId, error);
        }
    }

    private async withStatus(row: OutputCastRow): Promise<OutputCast> {
        const plugin = this.speakers.plugin(row.pluginId);
        if (plugin === undefined) return { ...toCast(row), phase: 'unreachable', detail: `the plugin ${row.pluginId} is not running` };
        try {
            const status = await this.speakers.status(plugin, row.deviceId);
            return { ...toCast(row), phase: status.phase, ...(status.detail === undefined ? {} : { detail: status.detail }) };
        } catch (error) {
            return { ...toCast(row), phase: 'unreachable', detail: toPluginError(error).message };
        }
    }
}

const castKey = (pluginId: string, deviceId: string): string => `${pluginId}\u0000${deviceId}`;

function toCast(row: OutputCastRow): Omit<OutputCast, 'phase'> {
    return { pluginId: row.pluginId, deviceId: row.deviceId, deviceName: row.deviceName, mountPath: row.mountPath, startedAt: row.startedAt };
}
