// The cast menu is the console's whole surface for putting the station on a speaker, so what is
// worth testing is what it offers: the speakers already playing (with a way to stop each), the ones
// that could be, one entry per mount a speaker can take, and an honest word when there are none.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutputCast, OutputDevice } from '@deadair/sdk';

import { CastMenu } from '../../../src/components/desk/cast.menu';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listCasts = vi.fn();
const listOutputDevices = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        outputs: {
            listCasts: () => listCasts(),
            listOutputDevices: () => listOutputDevices(),
        },
    },
}));

const device = (overrides: Partial<OutputDevice> = {}): OutputDevice => ({
    pluginId: 'deadair.cast',
    deviceId: 'chromecast:10.0.0.5',
    name: 'Kitchen',
    address: '10.0.0.5',
    protocol: 'chromecast',
    mounts: [{ format: 'mp3', path: '/live.mp3' }],
    casting: false,
    ...overrides,
});

const cast = (overrides: Partial<OutputCast> = {}): OutputCast => ({
    pluginId: 'deadair.cast',
    deviceId: 'chromecast:10.0.0.6',
    deviceName: 'Den',
    mountPath: '/live.mp3',
    startedAt: '2026-10-03T12:00:00Z' as unknown as OutputCast['startedAt'],
    phase: 'playing',
    ...overrides,
});

function renderMenu() {
    const onStart = vi.fn();
    const onStop = vi.fn();
    render(<CastMenu onStart={onStart} onStop={onStop} busy={false} />);
    return { onStart, onStop };
}

afterEach(() => {
    vi.clearAllMocks();
});

describe('CastMenu', () => {
    it('says how many speakers are playing, and does not list speakers until it is opened', async () => {
        listCasts.mockResolvedValue({ casts: [cast(), cast({ deviceId: 'b', deviceName: 'Hall' })] });
        renderMenu();

        expect(await screen.findByRole('button', { name: 'Playing on 2 speakers' })).toBeInTheDocument();
        expect(listOutputDevices).not.toHaveBeenCalled();
    });

    it('plays the station on a speaker that takes one mount', async () => {
        listCasts.mockResolvedValue({ casts: [] });
        listOutputDevices.mockResolvedValue({ devices: [device()], problems: [] });
        const { onStart } = renderMenu();
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Play on a speaker' }));
        await user.click(await screen.findByRole('menuitem', { name: /Kitchen/ }));

        expect(onStart).toHaveBeenCalledWith({ pluginId: 'deadair.cast', deviceId: 'chromecast:10.0.0.5', mountPath: '/live.mp3' });
    });

    it('offers one entry per mount when a speaker takes several, named by format', async () => {
        listCasts.mockResolvedValue({ casts: [] });
        listOutputDevices.mockResolvedValue({
            devices: [
                device({
                    mounts: [
                        { format: 'mp3', path: '/live.mp3' },
                        { format: 'aac', path: '/live.aac' },
                    ],
                }),
            ],
            problems: [],
        });
        const { onStart } = renderMenu();
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Play on a speaker' }));
        await user.click(await screen.findByRole('menuitem', { name: /AAC/ }));

        expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ mountPath: '/live.aac' }));
    });

    it('stops a speaker that is playing, and lists it as playing rather than as one to start', async () => {
        listCasts.mockResolvedValue({ casts: [cast({ phase: 'buffering' })] });
        listOutputDevices.mockResolvedValue({ devices: [device({ deviceId: 'chromecast:10.0.0.6', name: 'Den', casting: true })], problems: [] });
        const { onStop } = renderMenu();
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Playing on 1 speaker' }));
        const playing = await screen.findByRole('menuitem', { name: /Den.*Buffering/ });
        await waitFor(() => expect(listOutputDevices).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByText('Looking for speakers…')).not.toBeInTheDocument());
        expect(screen.queryAllByRole('menuitem', { name: /Den/ })).toHaveLength(1);
        // Every speaker is playing, so there is no "Speakers" section left to head.
        expect(screen.queryByText('Speakers')).not.toBeInTheDocument();

        await user.click(playing);

        expect(onStop).toHaveBeenCalledWith('deadair.cast', 'chromecast:10.0.0.6');
    });

    it('greys out a speaker that plays none of the station’s streams', async () => {
        listCasts.mockResolvedValue({ casts: [] });
        listOutputDevices.mockResolvedValue({ devices: [device({ mounts: [] })], problems: [] });
        renderMenu();
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Play on a speaker' }));

        expect(await screen.findByRole('menuitem', { name: /Plays none of the station’s streams/ })).toBeDisabled();
    });

    it('says once when the station cannot look for speakers on its own network', async () => {
        listCasts.mockResolvedValue({ casts: [] });
        listOutputDevices.mockResolvedValue({ devices: [device()], problems: [], discoverySeesNothing: true });
        renderMenu();
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Play on a speaker' }));

        expect(await screen.findByText(/never found a speaker on its network by itself/)).toBeInTheDocument();
    });

    it('says there are no speakers yet, and names a plugin that could not list its own', async () => {
        listCasts.mockResolvedValue({ casts: [] });
        listOutputDevices.mockResolvedValue({ devices: [], problems: [{ pluginId: 'deadair.cast', message: 'no' }] });
        renderMenu();
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Play on a speaker' }));

        expect(await screen.findByText(/No speakers yet/)).toBeInTheDocument();
        expect(screen.getByText('deadair.cast could not list its speakers.')).toBeInTheDocument();
    });
});
