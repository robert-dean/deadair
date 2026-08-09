import { describe, expect, it, vi } from 'vitest';
import type { StationSettings } from '@deadair/sdk';
import { SettingsPage } from '../../../src/components/settings/settings.page';
import { render, screen } from '../../utils/render';

const getSettings = vi.fn();
vi.mock('../../../src/api/client', () => ({
    sdk: { settings: { getSettings: (...a: unknown[]) => getSettings(...a), updateSettings: vi.fn() } },
}));

const SETTINGS: StationSettings = {
    descriptors: [{ group: 'station', key: 'stream.title', label: 'Station name', type: 'string', default: 'Deadair' }],
    values: { 'stream.title': 'Old FM' },
    configured: {},
};

describe('dbg', () => {
    it('dumps', async () => {
        getSettings.mockResolvedValue(SETTINGS);
        render(<SettingsPage />);
        const el = await screen.findByLabelText('Station name');
        console.log('TAG', el.tagName, 'VALUE', JSON.stringify((el as HTMLInputElement).value));
        expect(true).toBe(true);
    });
});
