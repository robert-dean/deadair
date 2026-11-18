import { Card, SimpleGrid, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { AttentionItem, PluginSummary, StationCheckup, StorageReport } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { CATALOG_TRACK_DEFAULTS } from '../catalog/catalog.page.params';
import { PLUGINS_PAGE_DEFAULTS } from '../plugins/plugin.page.params';
import type { SilenceReading } from '../playout/silence.reading';
import { formatBytes } from '../shared/format.bytes';
import type { StatusTone } from '../shared/status';
import { StatusLamp } from '../shared/status.lamp';
import { formatCount } from '../../i18n/format.locale';
import { i18n } from '../../i18n/i18n.setup';

/**
 * Every generation is bounded at ten minutes (`GENERATION_BUDGET_MS` in the API), so a slot held past
 * this is a stream that stopped arriving rather than a long answer.
 */
export const STUCK_AFTER_MS = 10 * 60_000;

/** The sections a tile can point at, each the `id` its section carries on the page. */
export const CHECKUP_ANCHORS = {
    onAir: 'checkup-on-air',
    needsYou: 'checkup-needs-you',
    loops: 'checkup-loops',
    model: 'checkup-model',
    plugins: 'checkup-plugins',
    library: 'checkup-library',
    disk: 'checkup-disk',
    build: 'checkup-build',
} as const;

export type CheckupTileKey = keyof typeof CHECKUP_ANCHORS;

/** Where a tile goes: down the page to its section, or to the page that owns the thing. */
export type CheckupTileTarget = { kind: 'anchor'; id: string } | { kind: 'plugins' } | { kind: 'tracks' };

export interface CheckupTile {
    key: CheckupTileKey;
    tone: StatusTone;
    /** The short reading under the tile's name. */
    value: string;
    pulse: boolean;
    target: CheckupTileTarget;
}

/** One reader's state, as the tiles need it: still coming, broken, or answered. */
export type Reading<T> = { state: 'pending' } | { state: 'failed' } | { state: 'read'; data: T };

export interface CheckupReadings {
    onAir: Reading<SilenceReading>;
    attention: Reading<AttentionItem[]>;
    plugins: Reading<PluginSummary[]>;
    checkup: Reading<StationCheckup>;
    storage: Reading<StorageReport>;
}

/**
 * The page's readings, folded into one tile per section.
 *
 * Nothing here is a new judgement about the station. Each tone is one the section below already
 * draws: the tally's own reading for On air, the attention list's severity, the plugin rows' lamp, the
 * model's stuck line and the disk's amber counts. Loops, Library and Build have no fault signal, since
 * `Heartbeat` deliberately declines to say what "too long" means, so their tiles are neutral and only
 * carry a figure. A tile never claims more than its section would.
 */
export function checkupTiles(readings: CheckupReadings): CheckupTile[] {
    const anchor = (key: CheckupTileKey): CheckupTileTarget => ({ kind: 'anchor', id: CHECKUP_ANCHORS[key] });

    return [
        tile('onAir', readings.onAir, anchor('onAir'), reading => ({ tone: reading.tone, value: reading.label, pulse: reading.live })),
        tile('needsYou', readings.attention, anchor('needsYou'), items => ({
            tone: attentionTone(items),
            value:
                items.length === 0
                    ? i18n.t('station:checkup.tiles.needsYou.clear')
                    : i18n.t('station:checkup.tiles.needsYou.count', { count: items.length }),
        })),
        tile('plugins', readings.plugins, { kind: 'plugins' }, plugins => {
            const unhappy = plugins.filter(plugin => plugin.enabled && plugin.status !== 'active');
            if (unhappy.length === 0) {
                const active = plugins.filter(plugin => plugin.status === 'active').length;
                return { tone: 'ok', value: i18n.t('station:checkup.tiles.plugins.running', { active, total: plugins.length }) };
            }
            return {
                tone: unhappy.some(plugin => plugin.status === 'failed') ? 'fault' : 'standby',
                value: i18n.t('station:checkup.tiles.plugins.unhappy', { count: unhappy.length }),
            };
        }),
        tile('model', readings.checkup, anchor('model'), checkup => {
            const { model, readAt } = checkup;
            if (model === undefined) return { tone: 'fault', value: i18n.t('station:checkup.tiles.unreadable') };
            const holder = model.holder;
            if (holder === undefined) return { tone: 'ok', value: i18n.t('station:checkup.tiles.model.free') };
            const stuck = readAt.toMillis() - holder.heldSince.toMillis() > STUCK_AFTER_MS;
            return stuck
                ? { tone: 'fault', value: i18n.t('station:checkup.tiles.model.stuck') }
                : { tone: 'ok', value: i18n.t('station:checkup.tiles.model.busy') };
        }),
        tile('disk', readings.storage, anchor('disk'), storage => {
            const loose = storage.stores.reduce((sum, store) => sum + store.orphanFiles + store.rowsWithNoFile, 0);
            if (loose > 0) return { tone: 'fault', value: i18n.t('station:checkup.tiles.disk.loose', { count: loose, files: formatCount(loose) }) };
            return { tone: 'ok', value: formatBytes(storage.stores.reduce((sum, store) => sum + store.bytes, 0)) };
        }),
        tile('loops', readings.checkup, anchor('loops'), checkup =>
            checkup.heartbeats === undefined
                ? { tone: 'fault', value: i18n.t('station:checkup.tiles.unreadable') }
                : { tone: 'off', value: i18n.t('station:checkup.tiles.loops.count', { count: checkup.heartbeats.length }) },
        ),
        tile('library', readings.checkup, { kind: 'tracks' }, checkup =>
            checkup.backlog === undefined
                ? { tone: 'fault', value: i18n.t('station:checkup.tiles.unreadable') }
                : {
                      tone: 'off',
                      value: i18n.t('station:checkup.tiles.library.measured', {
                          measured: formatCount(checkup.backlog.measured),
                          total: formatCount(checkup.backlog.total),
                      }),
                  },
        ),
        tile('build', readings.checkup, anchor('build'), checkup => ({
            tone: 'off',
            value: checkup.version ?? checkup.revision?.slice(0, 7) ?? i18n.t('station:checkup.tiles.build.unstamped'),
        })),
    ];
}

/**
 * Needs you by the worst thing on the list. A notice is "nobody has set this up yet", which is not
 * a fault and is drawn as standby, for the reason `Severity` gives for keeping it apart.
 */
function attentionTone(items: AttentionItem[]): StatusTone {
    if (items.length === 0) return 'ok';
    return items.some(item => item.severity === 'failure' || item.severity === 'warning') ? 'fault' : 'standby';
}

/** A tile for one section, with the two states every reader shares worded once. */
function tile<T>(
    key: CheckupTileKey,
    reading: Reading<T>,
    target: CheckupTileTarget,
    read: (data: T) => { tone: StatusTone; value: string; pulse?: boolean },
): CheckupTile {
    if (reading.state === 'pending') return { key, tone: 'off', value: i18n.t('station:checkup.tiles.reading'), pulse: false, target };
    if (reading.state === 'failed') return { key, tone: 'fault', value: i18n.t('station:checkup.tiles.unreadable'), pulse: false, target };
    const { tone, value, pulse = false } = read(reading.data);
    return { key, tone, value, pulse, target };
}

/**
 * The tiles across the top of the page: each section's state at a glance, and the way to it.
 *
 * Two to a row on a phone and four on a desk, so the eight make a square block either way rather
 * than one ragged line.
 */
export function CheckupTiles({ tiles }: { tiles: CheckupTile[] }) {
    const { t } = useTranslation('station');
    return (
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs" component="nav" aria-label={t('checkup.tiles.label')}>
            {tiles.map(tile => (
                <TileCard key={tile.key} tile={tile} title={t(`checkup.section.${tile.key}`)} />
            ))}
        </SimpleGrid>
    );
}

function TileCard({ tile, title }: { tile: CheckupTile; title: string }) {
    const body = (
        <>
            <Text size="xs" c="dimmed" mb={4}>
                {title}
            </Text>
            <StatusLamp tone={tile.tone} label={tile.value} pulse={tile.pulse} />
        </>
    );
    const common = { padding: 'sm', withBorder: true, 'data-tile': tile.key, style: { textDecoration: 'none', color: 'inherit' } } as const;

    switch (tile.target.kind) {
        case 'plugins':
            return (
                <Card {...common} renderRoot={(props: object) => <Link to="/plugins" search={PLUGINS_PAGE_DEFAULTS} {...props} />}>
                    {body}
                </Card>
            );
        case 'tracks':
            return (
                <Card {...common} renderRoot={(props: object) => <Link to="/catalog/tracks" search={CATALOG_TRACK_DEFAULTS} {...props} />}>
                    {body}
                </Card>
            );
        case 'anchor':
            return (
                <Card {...common} component="a" href={`#${tile.target.id}`}>
                    {body}
                </Card>
            );
    }
}
