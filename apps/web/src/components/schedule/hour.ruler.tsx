import { useMemo } from 'react';
import { Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import type { AsRunEntry, ClockBand, PlayoutNowPlaying, StationOrderItem } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { useAsRun } from '../../api/as.run.queries';
import { useClockBands } from '../../api/clock.queries';
import { useStationOrder } from '../../api/director.queries';
import { usePlayoutStatus } from '../../api/playout.queries';
import { airTimesOf } from '../onair/order.runs.dry';
import { Eyebrow } from '../shared/eyebrow';
import { weekdayOf } from './schedule.day';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** One thing heard inside the hour, in minutes past it. A break has no length worth drawing, so it is a point. */
export interface HourMark {
    kind: 'record' | 'break';
    title: string;
    from: number;
    /** Where a record stops, clipped to the hour. Absent for a break. */
    to?: number;
    /** Whether it has already gone out, read off the as-run log, rather than projected from the running order. */
    past: boolean;
}

/** A band of the format clock that wants this hour, at its minute. */
export interface HourBand {
    id: string;
    minute: number;
    label: string;
    hard: boolean;
}

export interface HourRuler {
    /** Which hour this is, on the station's clock. */
    hour: number;
    /** Minutes past the hour it is now. */
    now: number;
    marks: HourMark[];
    bands: HourBand[];
}

export interface HourRulerInput {
    /** The station's clock now, `YYYY-MM-DD HH:mm:ss`. */
    stationNow: string;
    /** The same moment on the browser's clock, in milliseconds, which is the clock the as-run log and the projection are on. */
    nowMs: number;
    asRun: readonly AsRunEntry[];
    items: StationOrderItem[];
    nowPlaying: PlayoutNowPlaying | undefined;
    bands: readonly ClockBand[];
}

/**
 * The station's current hour laid out against its format clock.
 *
 * ## Two clocks, one hour
 *
 * The as-run log and the projected air times are moments, while the hour and a band's minute are
 * readings of the station's own clock, which need not be the browser's zone. The station's reading of
 * now and the browser's moment for now are taken together, so the difference between them turns any
 * moment into the station's minute past the hour without this file knowing a timezone.
 *
 * ## What is drawn
 *
 * What has gone out this hour comes from the as-run log, because that is what happened. What is still
 * to come comes from the running order through `airTimesOf`, the same projection the desk's clock rail
 * draws, so the two cannot disagree about when the next record starts. A talk-over is left out: it is
 * heard over a record that is already drawn. The bands are the clock bands that want this hour: on,
 * at a time rather than an interval, and naming this hour and this weekday or none.
 */
export function hourRulerOf({ stationNow, nowMs, asRun, items, nowPlaying, bands }: HourRulerInput): HourRuler {
    const hour = Number(stationNow.slice(11, 13));
    const minute = Number(stationNow.slice(14, 16));
    const second = Number(stationNow.slice(17, 19));
    const hourStart = nowMs - (minute * MINUTE_MS + second * 1000);
    const hourEnd = hourStart + HOUR_MS;
    const minutesIn = (ms: number) => Math.min(60, Math.max(0, (ms - hourStart) / MINUTE_MS));

    const marks: HourMark[] = [];

    // What went out, oldest first, each record running until the next thing began or until now.
    const heard = asRun
        .filter(entry => entry.kind === 'record' || entry.kind === 'break' || entry.kind === 'programme')
        .map(entry => ({ entry, at: entry.at.toMillis(), ended: entry.endedAt?.toMillis() }))
        .filter(({ at, ended }) => at < nowMs && (ended ?? nowMs) > hourStart)
        .sort((a, b) => a.at - b.at);
    for (const { entry, at, ended } of heard) {
        const title = entry.title ?? '';
        if (entry.kind === 'record') marks.push({ kind: 'record', title, from: minutesIn(at), to: minutesIn(ended ?? nowMs), past: true });
        else if (at >= hourStart) marks.push({ kind: 'break', title, from: minutesIn(at), past: true });
    }

    // What is still to come, by the desk's own projection. The item on air is already drawn from the log.
    const { byId } = airTimesOf(items, nowPlaying, nowMs);
    for (const item of items) {
        const time = byId.get(item.id);
        if (time === undefined || item.state === 'airing' || item.overAtMs !== undefined) continue;
        if (time.atMs < nowMs || time.atMs >= hourEnd) continue;
        if (item.kind === 'track') {
            const to = item.durationMs === undefined ? undefined : minutesIn(time.atMs + item.durationMs);
            marks.push({ kind: 'record', title: item.title, from: minutesIn(time.atMs), to: to ?? minutesIn(time.atMs), past: false });
        } else marks.push({ kind: 'break', title: item.title, from: minutesIn(time.atMs), past: false });
    }

    const weekday = weekdayOf(stationNow.slice(0, 10));
    const wanted = bands
        .filter(band => band.enabled && band.at === 'clock' && band.minute !== undefined)
        .filter(band => band.hour === undefined || band.hour === hour)
        .filter(band => band.days === undefined || band.days.length === 0 || band.days.includes(weekday))
        .map(band => ({ id: band.id, minute: band.minute!, label: band.topicLabel ?? band.kind, hard: band.hard === true }))
        .sort((a, b) => a.minute - b.minute);

    return { hour, now: minute + second / 60, marks, bands: wanted };
}

const at = (minutes: number) => `${(minutes / 60) * 100}%`;

/** Where a record sits along the ruler. */
function span(from: number, to: number) {
    return { position: 'absolute', top: 18, height: 22, left: at(from), width: at(Math.max(0.4, to - from)) } as const;
}

/** Where a break or the now line sits along the ruler. */
function point(minutes: number, top: number, height: number, width: number) {
    return { position: 'absolute', top, height, width, left: `calc(${at(minutes)} - ${width / 2}px)` } as const;
}

/**
 * This hour, as it went and as it is going to go, under the minutes the format clock asks for.
 *
 * Drawn on Today between what is on now and the format clock itself, because it is the clock's
 * answer: the dial says a bulletin wants half past, and this says whether the hour actually has room
 * for one there. Past records are drawn solid and the ones still to come outlined, because one is a
 * fact and the other a projection that a skip or a refill will move.
 */
export function HourRulerPanel({ stationNow }: { stationNow: string }) {
    const { t } = useTranslation('schedule');
    const asRun = useAsRun();
    const order = useStationOrder();
    const playout = usePlayoutStatus(true);
    const clock = useClockBands();

    const entries = useMemo(() => asRun.data?.pages[0]?.entries ?? [], [asRun.data]);
    const ruler = hourRulerOf({
        stationNow,
        nowMs: Date.now(),
        asRun: entries,
        items: order.data?.items ?? [],
        nowPlaying: playout.data?.nowPlaying,
        bands: clock.data?.bands ?? [],
    });
    const hour = String(ruler.hour).padStart(2, '0');

    return (
        <Stack gap={6} component="section" aria-label={t('hourRuler.label', { hour })}>
            <Eyebrow>{t('hourRuler.label', { hour })}</Eyebrow>
            <Box pos="relative" h={44}>
                <Box
                    style={{ position: 'absolute', top: 18, height: 22, left: 0, right: 0, border: '1px solid var(--da-border)', borderRadius: 4 }}
                    aria-hidden
                />
                {ruler.bands.map(band => (
                    <Tooltip
                        key={band.id}
                        label={t(band.hard ? 'hourRuler.bandHard' : 'hourRuler.band', {
                            minute: String(band.minute).padStart(2, '0'),
                            label: band.label,
                        })}
                    >
                        <Box style={{ ...point(band.minute, 0, 44, 2), background: 'var(--mantine-color-grape-filled)' }}>
                            <Text size="xs" c="grape" fw={600} style={{ position: 'absolute', top: -2, left: 5, whiteSpace: 'nowrap' }}>
                                {band.label}
                            </Text>
                        </Box>
                    </Tooltip>
                ))}
                {ruler.marks.map(mark =>
                    mark.kind === 'record' ? (
                        <Tooltip key={`${mark.past}-${mark.from}-${mark.title}`} label={mark.title}>
                            <Box
                                aria-label={t(mark.past ? 'hourRuler.aired' : 'hourRuler.coming', { title: mark.title })}
                                style={{
                                    ...span(mark.from, mark.to ?? mark.from),
                                    background: mark.past ? 'var(--mantine-color-teal-light)' : 'transparent',
                                    border: '1px solid var(--mantine-color-teal-outline)',
                                    borderRadius: 3,
                                    opacity: mark.past ? 0.85 : 1,
                                }}
                            />
                        </Tooltip>
                    ) : (
                        <Tooltip key={`${mark.past}-${mark.from}-${mark.title}`} label={mark.title}>
                            <Box
                                aria-label={t(mark.past ? 'hourRuler.aired' : 'hourRuler.coming', { title: mark.title })}
                                style={{ ...point(mark.from, 24, 10, 10), borderRadius: '50%', background: 'var(--mantine-color-orange-filled)' }}
                            />
                        </Tooltip>
                    ),
                )}
                <Box aria-hidden style={{ ...point(ruler.now, 14, 30, 2), background: 'var(--mantine-color-red-filled)' }} />
            </Box>
            <Group justify="space-between" gap={0} aria-hidden>
                {[0, 15, 30, 45, 60].map(minute => (
                    <Text key={minute} size="xs" c="dimmed" className="da-num">
                        {t('hourRuler.minute', { minute: String(minute % 60).padStart(2, '0') })}
                    </Text>
                ))}
            </Group>
        </Stack>
    );
}
