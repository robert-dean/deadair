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
    type PluginHost,
} from '@deadair/plugin-sdk';

import { DEVICES_FIELD, DISCOVER_FIELD } from './cast.manifest.js';
import type { SpeakerDriver, SpeakerTarget } from './drivers/speaker.driver.js';

/** One speaker, configured or found, with the driver that speaks its protocol. */
interface Speaker {
    target: SpeakerTarget;
    driver: SpeakerDriver;
    /** Found on the network rather than typed in: its name may be bettered by what it says about itself. */
    found?: true;
}

/** How long one discovery pass listens, per kind of speaker. All kinds listen at once. */
export const DISCOVERY_TIMEOUT_MS = 2_000;

/**
 * The `output` plugin: one list of speakers, one driver per protocol.
 *
 * It owns the list and the routing, and nothing about any protocol: every call is matched to the
 * speaker its id names and handed to that speaker's driver. A row naming a protocol this build has
 * no driver for is dropped with a warning rather than listed, because a speaker shown in the console
 * that can never play is worse than one that is plainly missing.
 *
 * Speakers come from two places. The operator's rows are listed whether or not they answer, since
 * the operator asked for them by name. Found speakers come from each driver's discovery query,
 * asked when the list is asked for (never on a timer), and are kept for the life of the instance so
 * a speaker that stops answering for a moment is still a speaker. Where both name one device, the
 * typed row wins.
 */
export class CastPlugin extends Plugin implements OutputPluginInstance {
    private configured = new Map<string, Speaker>();
    private readonly found = new Map<string, Speaker>();
    private discover = true;

    constructor(private readonly drivers: readonly SpeakerDriver[]) {
        super();
    }

    protected async onLoad(): Promise<void> {
        const host = this.host;
        const config = await host.config.get();
        this.configured = readSpeakers(config[DEVICES_FIELD], this.drivers, protocol =>
            host.logger.warn('cast: a speaker names a kind this plugin cannot drive', { protocol }),
        );
        this.discover = isOn(config[DISCOVER_FIELD], true);

        this.register(() => {
            for (const driver of this.drivers) driver.dispose();
            this.found.clear();
        });

        host.logger.info('cast ready', { speakers: this.configured.size, discover: this.discover });
    }

    async listDevices(): Promise<OutputDevice[]> {
        const host = this.host;
        await this.lookAround(host);
        // Together, since a driver may ask each device, and a speaker that is switched off should cost
        // the list one timeout rather than one per speaker behind it.
        return Promise.all(
            this.all().map(async ({ target, driver, found }) => {
                const { model, name, ...traits } = await driver.describe(host, target);
                return {
                    id: target.id,
                    name: found === true && name !== undefined ? name : target.name,
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
        const { target, driver } = await this.speaker(host, request.deviceId);
        await driver.play(host, target, request);
    }

    async updateMetadata(request: OutputMetadataRequest): Promise<void> {
        const host = this.host;
        const { target, driver } = await this.speaker(host, request.deviceId);
        await driver.updateMetadata(host, target, request.metadata);
    }

    async stop(deviceId: string): Promise<void> {
        const host = this.host;
        const { target, driver } = await this.speaker(host, deviceId);
        await driver.stop(host, target);
    }

    async status(deviceId: string): Promise<OutputStatus> {
        const host = this.host;
        let speaker: Speaker;
        try {
            speaker = await this.speaker(host, deviceId);
        } catch (error) {
            // A found speaker that has not answered since a restart is a speaker switched off, not one
            // the operator removed: the host waits for it rather than forgetting the cast.
            if (
                this.discover &&
                this.drivers.some(driver => driver.discovery !== undefined && deviceId.toLowerCase().startsWith(`${driver.protocol}:`))
            ) {
                return { deviceId, phase: 'unreachable', detail: 'not found on the network' };
            }
            throw error;
        }
        return { deviceId, ...(await speaker.driver.status(host, speaker.target)) };
    }

    /** Asks every speaker how it is, and passes when they all answer. */
    async testConnection(): Promise<PluginConnectionResult> {
        const host = this.host;
        await this.lookAround(host);
        const speakers = this.all();
        if (speakers.length === 0) {
            return { ok: false, message: this.discover ? 'No speakers added, and none found on the network.' : 'No speakers added yet.' };
        }

        const answers = await Promise.all(speakers.map(async ({ target, driver }) => ({ target, status: await driver.status(host, target) })));
        const silent = answers.filter(answer => answer.status.phase === 'unreachable');
        if (silent.length === 0) return { ok: true, message: `All ${answers.length} answered.` };
        return { ok: false, message: `Not answering: ${silent.map(answer => answer.target.name).join(', ')}.` };
    }

    /** Configured speakers, then found ones that are not the same device as one typed in. */
    private all(): Speaker[] {
        const typed = [...this.configured.values()];
        const typedHosts = new Set(typed.map(speaker => `${speaker.driver.protocol}:${hostOf(speaker.target.address)}`));
        const found = [...this.found.values()].filter(speaker => !typedHosts.has(`${speaker.driver.protocol}:${hostOf(speaker.target.address)}`));
        return [...typed, ...found];
    }

    /** Runs every driver's discovery query, when looking is on. A failure costs that kind its finds and nothing else. */
    private async lookAround(host: PluginHost): Promise<void> {
        if (!this.discover) return;
        await Promise.all(
            this.drivers.map(async driver => {
                if (driver.discovery === undefined || driver.found === undefined) return;
                let services;
                try {
                    services = await host.discover(driver.discovery, { timeoutMs: DISCOVERY_TIMEOUT_MS });
                } catch (error) {
                    host.logger.warn('cast: looking for speakers failed', { protocol: driver.protocol, error: (error as Error).message });
                    return;
                }
                for (const service of services) {
                    const speaker = driver.found(service);
                    if (speaker === undefined) continue;
                    const id = `${driver.protocol}:${speaker.key}`.toLowerCase();
                    this.found.set(id, { target: { id, name: speaker.name, address: speaker.address }, driver, found: true });
                }
            }),
        );
    }

    /** The speaker an id names, looking around once more when it is not one already known. */
    private async speaker(host: PluginHost, deviceId: string): Promise<Speaker> {
        const id = deviceId.toLowerCase();
        const known = this.configured.get(id) ?? this.found.get(id);
        if (known !== undefined) return known;

        await this.lookAround(host);
        const found = this.found.get(id);
        if (found !== undefined) return found;
        throw new PluginError(`no speaker "${deviceId}" in this plugin's settings or on the network`).withCode('config');
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

/** The host part of an address in any of the forms a row or a find takes, lowercased. */
export function hostOf(address: string): string {
    const trimmed = address.trim();
    try {
        return new URL(trimmed.includes('://') ? trimmed : `x://${trimmed}`).hostname.toLowerCase();
    } catch {
        return trimmed.toLowerCase();
    }
}

/** A boolean setting as a plugin's config holds it: a real boolean, or its text. */
function isOn(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string' || value.trim() === '') return fallback;
    return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}
