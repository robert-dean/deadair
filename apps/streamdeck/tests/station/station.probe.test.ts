import { SdkError, type NowPlaying, type PlayoutStatus } from '@deadair/sdk';
import { describe, expect, it, vi } from 'vitest';

import { probeStation, type ProbeClients } from '../../src/station/station.probe.js';
import { airing } from '../fixtures/playout.status.js';

const KEY = 'da_4mR9xQ2vLp7TnB3kW8sYc1Hf6JdZ0aGeUoNiPrVtXyMbSw5qKj';
const settings = { address: 'radio.example.com', apiKey: KEY };

function clients(nowPlaying: () => Promise<NowPlaying>, status: () => Promise<PlayoutStatus> = async () => airing()) {
    const anonymous = vi.fn((_apiBase: string) => ({ nowplaying: { getNowPlaying: nowPlaying } }));
    const keyed = vi.fn(() => ({ playout: { getPlayoutStatus: status } }));
    return { clients: { anonymous, keyed } as unknown as ProbeClients, anonymous, keyed };
}

const station = async (): Promise<NowPlaying> => ({ station: 'Dead Air FM', onAir: true, listeners: 1, mounts: [] }) as unknown as NowPlaying;
const refused = (status: number) => async () => Promise.reject(new SdkError(status, 'x', {}, new Headers()));

describe('probeStation', () => {
    it('says what is missing before asking anything', async () => {
        const { clients: none, anonymous } = clients(station);
        expect((await probeStation({}, none)).text).toMatch(/^Enter the station's address/);
        expect((await probeStation({ address: 'ftp://x' }, none)).text).toMatch(/http:\/\/ or https:\/\//);
        expect((await probeStation({ address: 'radio.example.com' }, none)).text).toMatch(/^Enter an API key/);
        expect(anonymous).not.toHaveBeenCalled();
    });

    it('asks the public route first, without the key, at the API root', async () => {
        const { clients: both, anonymous } = clients(station);
        const result = await probeStation(settings, both);
        expect(anonymous).toHaveBeenCalledWith('https://radio.example.com/api');
        expect(result.ok).toBe(true);
        expect(result.text).toMatch(/^Connected to Dead Air FM\./);
        expect(result.text).toContain('Read and manage');
    });

    it('tells an address that answers nothing from one that is not a station', async () => {
        expect((await probeStation(settings, clients(() => Promise.reject(new TypeError('fetch failed'))).clients)).text).toBe(
            'Nothing answered at radio.example.com. Check the address, and that the station is running.',
        );
        expect((await probeStation(settings, clients(refused(404)).clients)).text).toBe(
            'radio.example.com answered, but not as a deadair station. Check the address.',
        );
    });

    it('blames the key only once the address has answered', async () => {
        const result = await probeStation(settings, clients(station, refused(401)).clients);
        expect(result).toEqual({ ok: false, text: 'Found Dead Air FM, but it refused this API key. It may be mistyped, revoked or expired.' });
        expect((await probeStation(settings, clients(station, refused(403)).clients)).text).toMatch(/may not read the station/);
    });

    it('notices a session token pasted where a key belongs', async () => {
        const result = await probeStation({ ...settings, apiKey: 'eyJhbGciOiJIUzI1NiJ9.x.y' }, clients(station).clients);
        expect(result.ok).toBe(true);
        expect(result.text).toContain('does not look like an API key');
    });
});
