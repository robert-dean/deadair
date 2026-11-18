import { Anchor, Badge, Group, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { PlayoutStatus } from '@deadair/sdk';

import { usePlayhead } from '../playout/playhead';
import { formatDuration } from '../shared/format.duration';

/**
 * What is on air, from anywhere: the record and how long it has left, and a way back to the desk.
 *
 * The desk was the only page that said what was playing, and the rail was the way back to it. With
 * the rail gone, an operator three pages deep in Settings still wants to know the record is about to
 * end, so the header carries it. Nothing at all while nothing is playing: the tally beside the
 * wordmark already says why the station is quiet, and a chip reading "nothing" would say it twice.
 */
export function OnAirChip({ status }: { status: PlayoutStatus | undefined }) {
    const { t } = useTranslation('shell');
    const nowPlaying = status?.nowPlaying;
    const playhead = usePlayhead(nowPlaying);
    if (nowPlaying === undefined) return undefined;

    const remaining = playhead === undefined ? undefined : `−${formatDuration(playhead.remainingMs)}`;
    return (
        <Anchor
            underline="never"
            c="var(--da-text)"
            visibleFrom="lg"
            aria-label={
                remaining === undefined
                    ? t('onAir.labelNoTime', { title: nowPlaying.item.title })
                    : t('onAir.label', { title: nowPlaying.item.title, remaining })
            }
            renderRoot={(props: object) => <Link to="/" {...props} />}
            style={{ border: '1px solid var(--da-border)', borderRadius: 999, padding: '3px 12px 3px 5px', maxWidth: 340, minWidth: 0 }}
        >
            <Group gap={8} wrap="nowrap" aria-hidden>
                <Badge size="sm" color="red" variant="filled" radius="xl" style={{ flexShrink: 0 }}>
                    {t('onAir.tag')}
                </Badge>
                <Text size="xs" truncate>
                    {nowPlaying.item.title}
                </Text>
                {remaining === undefined ? undefined : (
                    <Text size="xs" c="dimmed" className="da-num" style={{ flexShrink: 0 }}>
                        {remaining}
                    </Text>
                )}
            </Group>
        </Anchor>
    );
}
