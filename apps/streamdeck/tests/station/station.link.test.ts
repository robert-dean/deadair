import { describe, expect, it, vi } from 'vitest';

import { StationLink } from '../../src/station/station.link.js';
import { StatusPoller } from '../../src/station/status.poller.js';

const settings = { address: 'radio.example.com', apiKey: 'da_key' };

describe('StationLink', () => {
    it('points the poller at the station the settings describe', () => {
        const poller = new StatusPoller();
        const reconfigure = vi.spyOn(poller, 'reconfigure');
        const link = new StationLink(poller, 'agent');
        link.apply(settings);
        expect(link.station?.apiBase).toBe('https://radio.example.com/api');
        expect(reconfigure).toHaveBeenCalledWith(link.sdk?.playout);
        expect(poller.current).toEqual({ stale: false });
    });

    it('changes nothing for settings that describe the station already in use', () => {
        const poller = new StatusPoller();
        const reconfigure = vi.spyOn(poller, 'reconfigure');
        const link = new StationLink(poller, 'agent');
        link.apply(settings);
        link.apply({ ...settings, address: 'https://radio.example.com/' });
        expect(reconfigure).toHaveBeenCalledTimes(1);
    });

    it('starts over for a new key or a new address, and stops for none', () => {
        const poller = new StatusPoller();
        const link = new StationLink(poller, 'agent');
        link.apply(settings);
        const first = link.sdk;
        link.apply({ ...settings, apiKey: 'da_other' });
        expect(link.sdk).not.toBe(first);
        link.apply({ address: '' });
        expect(link.station).toBeUndefined();
        expect(poller.current).toEqual({ failure: 'unconfigured', stale: false });
    });
});
