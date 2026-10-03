import {
    Plugin,
    PluginError,
    parseRows,
    type OutputDevice,
    type OutputMetadataRequest,
    type OutputPlayRequest,
    type OutputPluginInstance,
    type OutputStatus,
    type PluginConnectionResult,
} from '@deadair/plugin-sdk';

import { DEVICES_FIELD } from './cast.manifest.js';
import type { SpeakerDriver, SpeakerTarget } from './drivers/speaker.driver.js';

/** One configured speaker, with the driver that speaks its protocol. */
interface Speaker {
    target: SpeakerTarget;
    driver: SpeakerDriver;
}

/**
 * The `output` plugin: one list of speakers, one driver per protocol.
 *
 * It owns the list and the routing, and nothing about any protocol: every call is matched to the
 * configured row its id names and handed to that row's driver. A row naming a protocol this build
 * has no driver for is dropped with a warning rather than listed, because a speaker shown in the
 * console that can never play is worse than one that is plainly missing.
 */
export class CastPlugin extends Plugin implements OutputPluginInstance {
    private speakers = new Map<string, Speaker>();

    constructor(private readonly drivers: readonly SpeakerDriver[]) {
        super();
    }

    protected async onLoad(): Promise<void> {
        const host = this.host;
        const config = await host.config.get();
        this.speakers = readSpeakers(config[DEVICES_FIELD], this.drivers, protocol =>
            host.logger.warn('cast: a speaker names a kind this plugin cannot drive', { protocol }),
        );

        this.register(() => {
            for (const driver of this.drivers) driver.dispose();
        });

        host.logger.info('cast ready', { speakers: this.speakers.size });
    }

    async listDevices(): Promise<OutputDevice[]> {
        const host = this.host;
        // Together, since a driver may ask each device, and a speaker that is switched off should cost
        // the list one timeout rather than one per speaker behind it.
        return Promise.all(
            [...this.speakers.values()].map(async ({ target, driver }) => {
                const { model, ...traits } = await driver.describe(host, target);
                return {
                    id: target.id,
                    name: target.name,
                    ...(model === undefined ? {} : { model }),
                    address: target.address,
                    protocol: driver.protocol,
                    ...traits,
                };
            }),
        );
    }

    async play(request: OutputPlayRequest): Promise<void> {
        const host = this.host;
        const { target, driver } = this.speaker(request.deviceId);
        await driver.play(host, target, request);
    }

    async updateMetadata(request: OutputMetadataRequest): Promise<void> {
        const host = this.host;
        const { target, driver } = this.speaker(request.deviceId);
        await driver.updateMetadata(host, target, request.metadata);
    }

    async stop(deviceId: string): Promise<void> {
        const host = this.host;
        const { target, driver } = this.speaker(deviceId);
        await driver.stop(host, target);
    }

    async status(deviceId: string): Promise<OutputStatus> {
        const host = this.host;
        const { target, driver } = this.speaker(deviceId);
        return { deviceId, ...(await driver.status(host, target)) };
    }

    /** Asks every speaker how it is, and passes when they all answer. */
    async testConnection(): Promise<PluginConnectionResult> {
        const host = this.host;
        if (this.speakers.size === 0) return { ok: false, message: 'No speakers added yet.' };

        const answers = await Promise.all(
            [...this.speakers.values()].map(async ({ target, driver }) => ({ target, status: await driver.status(host, target) })),
        );
        const silent = answers.filter(answer => answer.status.phase === 'unreachable');
        if (silent.length === 0) return { ok: true, message: `All ${answers.length} answered.` };
        return { ok: false, message: `Not answering: ${silent.map(answer => answer.target.name).join(', ')}.` };
    }

    private speaker(deviceId: string): Speaker {
        const speaker = this.speakers.get(deviceId.toLowerCase());
        if (speaker === undefined) throw new PluginError(`no speaker "${deviceId}" in this plugin's settings`).withCode('config');
        return speaker;
    }
}

/**
 * The configured rows, keyed by id. A row is `<protocol>:<address>` lowercased, so two rows for one
 * device are one speaker (the later name wins) and an id survives a renamed row.
 */
export function readSpeakers(raw: unknown, drivers: readonly SpeakerDriver[], unknownProtocol: (protocol: string) => void): Map<string, Speaker> {
    const speakers = new Map<string, Speaker>();
    for (const row of parseRows(raw)) {
        const address = row.address;
        const protocol = row.protocol;
        if (address === undefined || protocol === undefined) continue;

        const driver = drivers.find(candidate => candidate.protocol === protocol);
        if (driver === undefined) {
            unknownProtocol(protocol);
            continue;
        }

        const id = `${protocol}:${address}`.toLowerCase();
        speakers.set(id, { target: { id, name: row.name ?? address, address }, driver });
    }
    return speakers;
}
