// The two ends of a schedule file on the service: a preview writes nothing, the import writes what it said, and
// a version this station cannot read is refused before anything is written.

import { describe, expect, it, vi } from 'vitest';

import type { PersonaRepository } from '../../../src/modules/personas/persona.repository.js';
import type { StationPlaylistsRepository } from '../../../src/modules/playlists/station.playlists.repository.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import { ScheduleFileService } from '../../../src/modules/schedule/schedule.file.service.js';
import type { ScheduleRepository } from '../../../src/modules/schedule/schedule.repository.js';
import type { ScheduleService } from '../../../src/modules/schedule/schedule.service.js';
import type { SchedulePack } from '../../../src/modules/schedule/types/schedule.types.js';
import { settingsConfig } from '../../utils/settings.config.js';

const file: SchedulePack = {
    format: 'deadair.schedule',
    version: 1,
    name: 'A file',
    slots: [
        { label: 'One', startsAtMinutes: 60, endsAtMinutes: 120, days: [], mode: 'rotation', onEnd: 'extend' },
        { label: 'Two', startsAtMinutes: 9999, endsAtMinutes: 120, days: [], mode: 'rotation', onEnd: 'extend' },
    ],
};

function service() {
    const create = vi.fn(async () => undefined);
    const files = new ScheduleFileService(
        { list: async () => [], create } as unknown as ScheduleRepository,
        { list: async () => ({ slots: [] }) } as unknown as ScheduleService,
        { list: async () => [] } as unknown as PersonaRepository,
        { list: async () => [] } as unknown as StationPlaylistsRepository,
        { list: () => [] } as unknown as PluginRegistry,
        settingsConfig({ 'station.timezone': 'America/New_York' }).config,
    );
    return { files, create };
}

describe('ScheduleFileService', () => {
    it('previews without writing', async () => {
        const { files, create } = service();
        const plan = await files.previewImport(file);
        expect(plan.adding).toEqual(['One']);
        expect(plan.dropped.map(dropped => dropped.entry)).toEqual([2]);
        expect(create).not.toHaveBeenCalled();
    });

    it('writes what the preview named, switched off', async () => {
        const { files, create } = service();
        const plan = await files.previewImport(file);
        const answer = await files.importPack(file);
        expect(answer.plan).toEqual(plan);
        expect(create).toHaveBeenCalledOnce();
        expect(create.mock.calls[0]).toEqual([expect.objectContaining({ label: 'One', off: true })]);
    });

    it('refuses a newer version before writing anything', async () => {
        const { files, create } = service();
        await expect(files.importPack({ ...file, version: 2 })).rejects.toThrow();
        expect(create).not.toHaveBeenCalled();
    });
});
