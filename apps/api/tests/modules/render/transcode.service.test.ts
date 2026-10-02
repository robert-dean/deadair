// Which plugin makes the copies listeners share, and the three ways of not getting one.
//
// `mixer.service.test.ts`'s harness one capability over. What differs is that the outcomes are told
// apart, because the route answers them differently: nothing to encode with, or an encoder that
// cannot, is a 503; an encoder that tried and failed is a 502.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import { PluginError } from '@deadair/plugin-sdk';

import { TranscodeService } from '../../../src/modules/render/transcode.service.js';
import { resetDefaultPickReports } from '../../../src/modules/plugins/plugin.selection.js';

const stubLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

const REQUEST = { url: 'http://station.test/segments/a/audio?t=signed', bitrateKbps: 64, channels: 1 };

function build(options: { plugins?: Array<[string, string[]]>; configured?: string; transcode?: () => Promise<unknown> } = {}) {
    resetDefaultPickReports();

    const transcode = vi.fn(options.transcode ?? (async () => ({ mime: 'audio/mp4', audio: new Response(new Uint8Array([1])).body! })));
    const join = vi.fn();
    const records = (options.plugins ?? [['deadair.analyzer', ['analysis', 'mixer', 'transcode']]]).map(([id, capabilities]) => ({
        id,
        status: 'active',
        manifest: { id, capabilities },
        instance: { transcode, join },
    }));

    const invoker = { invoke: vi.fn(async (_id: string, _op: string, fn: () => Promise<unknown>) => fn()) };
    const config = {
        get: vi.fn((key: string, fallback: unknown) => (key === 'render.transcodePluginId' ? (options.configured ?? '') : fallback)),
    } as unknown as AppConfig;

    const service = new TranscodeService({ list: () => records } as never, invoker as never, config, stubLogger());
    return { service, transcode, invoker };
}

describe('TranscodeService.transcode', () => {
    it('makes the copy through the chosen plugin, through the invoker', async () => {
        const { service, transcode, invoker } = build();

        const outcome = await service.transcode('Top of the hour', REQUEST);

        expect(outcome.ok).toBe(true);
        expect(transcode).toHaveBeenCalledWith(REQUEST);
        expect(invoker.invoke).toHaveBeenCalledWith('deadair.analyzer', 'transcode.transcode', expect.any(Function), expect.anything());
    });

    it('says there is nothing to encode with, rather than throwing, when no plugin declares it', async () => {
        const { service, transcode } = build({ plugins: [['deadair.analyzer', ['analysis', 'mixer']]] });

        const outcome = await service.transcode('Top of the hour', REQUEST);

        expect(outcome).toMatchObject({ ok: false, reason: 'none' });
        expect(transcode).not.toHaveBeenCalled();
    });

    it('does not fall back to another plugin when the one named is not there', async () => {
        const { service, transcode } = build({ configured: 'deadair.elsewhere' });

        expect(await service.transcode('Top of the hour', REQUEST)).toMatchObject({ ok: false, reason: 'none' });
        expect(transcode).not.toHaveBeenCalled();
    });

    it('tells an encoder that cannot apart from one that failed', async () => {
        const cannot = build({ transcode: async () => Promise.reject(new PluginError('older sidecar').withCode('unsupported')) });
        expect(await cannot.service.transcode('x', REQUEST)).toMatchObject({ ok: false, reason: 'unsupported' });

        const failed = build({ transcode: async () => Promise.reject(new PluginError('undecodable').withCode('upstream')) });
        expect(await failed.service.transcode('x', REQUEST)).toMatchObject({ ok: false, reason: 'failed' });
    });
});
