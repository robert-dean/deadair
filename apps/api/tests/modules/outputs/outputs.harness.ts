import { vi } from 'vitest';
import { DateTime } from 'luxon';
import type { Logger } from '@maroonedsoftware/logger';
import type { OutputDevice, OutputPlayRequest, OutputStatus, PluginManifest } from '@deadair/plugin-sdk';

import type { NowPlayingService } from '../../../src/modules/nowplaying/nowplaying.service.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { OutputsRepository, type NewOutputCast, type OutputCastRow } from '../../../src/modules/outputs/outputs.repository.js';
import { OutputSpeakers } from '../../../src/modules/outputs/outputs.speakers.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';
import { settingsConfig } from '../../utils/settings.config.js';
import { stubContainer } from '../../utils/stub.container.js';

export const PLUGIN_ID = 'deadair.cast';
export const PUBLIC_URL = 'https://radio.example.com';

export const kitchen: OutputDevice = {
    id: 'chromecast:10.0.0.5',
    name: 'Kitchen',
    address: '10.0.0.5',
    protocol: 'chromecast',
    accepts: ['audio/mpeg', 'audio/aac'],
    followsMetadata: false,
};

function manifest(): PluginManifest {
    return {
        id: PLUGIN_ID,
        name: 'Speakers',
        version: '1.0.0',
        capabilities: ['output'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
    };
}

/** An `output` plugin whose speakers, and what each one says, the test sets. */
export function speakerPlugin(devices: OutputDevice[] = [kitchen]) {
    const statuses = new Map<string, OutputStatus>();
    const instance = {
        init: vi.fn(),
        listDevices: vi.fn(async () => devices),
        play: vi.fn(async (_request: OutputPlayRequest) => {}),
        updateMetadata: vi.fn(async () => {}),
        stop: vi.fn(async (_deviceId: string) => {}),
        status: vi.fn(async (deviceId: string): Promise<OutputStatus> => statuses.get(deviceId) ?? { deviceId, phase: 'idle' }),
    };
    const record: PluginRecord = {
        id: PLUGIN_ID,
        dir: '/plugins/cast',
        origin: 'bundled',
        status: 'active',
        manifest: manifest(),
        instance: instance as never,
    };
    return {
        record,
        instance,
        /** Says what a speaker answers `status` with from now on. */
        answers(deviceId: string, status: Omit<OutputStatus, 'deviceId'>) {
            statuses.set(deviceId, { deviceId, ...status });
        },
    };
}

/** `deadair.output_casts`, in memory. */
export class MemoryCasts {
    rows: OutputCastRow[] = [];

    async list(): Promise<OutputCastRow[]> {
        return [...this.rows];
    }

    async save(cast: NewOutputCast): Promise<OutputCastRow> {
        this.rows = this.rows.filter(row => !(row.pluginId === cast.pluginId && row.deviceId === cast.deviceId));
        const row = {
            pluginId: cast.pluginId,
            deviceId: cast.deviceId,
            deviceName: cast.deviceName,
            mountPath: cast.mountPath,
            startedAt: DateTime.now(),
        };
        this.rows.push(row);
        return row;
    }

    async remove(pluginId: string, deviceId: string): Promise<boolean> {
        const before = this.rows.length;
        this.rows = this.rows.filter(row => !(row.pluginId === pluginId && row.deviceId === deviceId));
        return this.rows.length < before;
    }
}

export const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

/** Everything the outputs module's classes are built from, with the plugin and settings the test chose. */
export function outputsWorld(options: { records?: PluginRecord[]; settings?: Record<string, string> } = {}) {
    const plugin = speakerPlugin();
    const registry = new PluginRegistry();
    registry.setAll(options.records ?? [plugin.record]);
    const settings = settingsConfig({ 'stream.publicUrl': PUBLIC_URL, 'stream.title': 'deadair', ...options.settings });
    const nowPlaying = {
        getNowPlaying: () => ({ station: 'deadair', onAir: true, listeners: 1, mounts: [], show: { name: 'The late show' } }),
    } as unknown as NowPlayingService;
    const speakers = new OutputSpeakers(registry, new PluginInvoker(registry, stubPluginLog().log), settings.config, nowPlaying);
    const casts = new MemoryCasts();
    const { container } = stubContainer([[OutputsRepository, casts]]);
    return { plugin, registry, settings, speakers, casts, container, repository: casts as unknown as OutputsRepository };
}
