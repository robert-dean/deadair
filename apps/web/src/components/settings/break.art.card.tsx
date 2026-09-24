import { Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { IconPhoto, IconUpload, IconX } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { BreakArtwork } from '@deadair/sdk';

import { artSrc } from '../../api/art';
import { useBreakArtwork, useReplaceBreakArtwork, useRevertBreakArtwork } from '../../api/break.art.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { PageSkeleton } from '../shared/page.skeleton';

/** What the station will take in. The server decides by the BYTES; this only saves an obvious mistake a round trip. */
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Matched to `MAX_BREAK_ART_BYTES` on the other side, which says why it is four rather than twenty-five. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * The pictures a listener's player shows.
 *
 * ## Why this is in Settings and not on the Voice destination
 *
 * Because it is about what a listener SEES rather than about what the station says. The kinds listed
 * here are the same `segments.kind` the format clock books — weather, news — but nothing on this page
 * changes a break: it changes the tile drawn beside its title on a phone, a desktop app, a hardware
 * player's artwork slot and the console's own transport. That is the same family of question as the
 * public URL and the mount, which is why it sits with them.
 *
 * ## Why only some kinds are here
 *
 * The listing answers with kinds the station actually holds bytes for, which is every kind this
 * repository ships a picture for plus any an operator has uploaded one for. A kind with neither is
 * absent, and a break of that kind wears the station's logo — which is what every break did before
 * any of this existed, and is not a row worth drawing.
 */
export function BreakArtCard() {
    const { t } = useTranslation('settings');
    const artwork = useBreakArtwork();
    const replace = useReplaceBreakArtwork();
    const revert = useRevertBreakArtwork();

    if (artwork.isPending) return <PageSkeleton variant="rows" count={2} />;
    if (artwork.isError) return <ErrorAlert title={t('breakArt.readFailed')} error={artwork.error} />;

    const breaks = artwork.data?.breaks ?? [];

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        {t('breakArt.title')}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {t('breakArt.intro')}
                    </Text>
                </Stack>

                {replace.isError ? <ErrorAlert title={t('breakArt.replaceFailed')} error={replace.error} /> : undefined}
                {revert.isError ? <ErrorAlert title={t('breakArt.revertFailed')} error={revert.error} /> : undefined}

                {breaks.length === 0 ? (
                    <EmptyState title={t('breakArt.empty.title')}>{t('breakArt.empty.body')}</EmptyState>
                ) : (
                    <Stack gap="lg">
                        {breaks.map(one => (
                            <BreakRow
                                key={one.kind}
                                artwork={one}
                                busy={replace.isPending || revert.isPending}
                                onReplace={file => {
                                    const body = new FormData();
                                    body.append('file', file);
                                    replace.mutate({ kind: one.kind, body });
                                }}
                                onRevert={() => revert.mutate(one.kind)}
                            />
                        ))}
                    </Stack>
                )}
            </Stack>
        </Card>
    );
}

/**
 * One kind: what it wears now, and the two things that can be done about it.
 *
 * Revert is drawn for every kind and disabled where there is nothing to go back to, rather than
 * hidden: a kind whose only picture is an upload is exactly where somebody looks for that button,
 * and a control that is absent reads as a feature that is missing.
 */
function BreakRow({
    artwork,
    busy,
    onReplace,
    onRevert,
}: {
    artwork: BreakArtwork;
    busy: boolean;
    onReplace: (file: File) => void;
    onRevert: () => void;
}) {
    const { t } = useTranslation('settings');
    return (
        <Stack gap="sm">
            <Group justify="space-between" align="center" wrap="nowrap">
                <Group gap="md" align="center" wrap="nowrap">
                    {/* `artSrc` resolves the API-root path exactly as it does for a record's cover,
                        because that is what this is. */}
                    <img
                        src={artSrc(artwork.url)}
                        alt={t('breakArt.alt', { kind: artwork.kind })}
                        width={72}
                        height={72}
                        style={{ borderRadius: 'var(--mantine-radius-sm)', objectFit: 'cover', flexShrink: 0 }}
                    />
                    <Stack gap={4}>
                        <Eyebrow>{artwork.kind}</Eyebrow>
                        <Badge size="sm" variant="light" color={artwork.source === 'shipped' ? 'gray' : 'grape'}>
                            {artwork.source === 'shipped' ? t('breakArt.source.shipped') : t('breakArt.source.yours')}
                        </Badge>
                    </Stack>
                </Group>
                <Button
                    variant="default"
                    size="xs"
                    disabled={busy || !artwork.hasShipped || artwork.source === 'shipped'}
                    onClick={onRevert}
                    title={artwork.hasShipped ? undefined : t('breakArt.revert.nothingShipped')}
                >
                    {t('breakArt.revert.action')}
                </Button>
            </Group>

            <Dropzone
                onDrop={files => {
                    const file = files[0];
                    if (file !== undefined) onReplace(file);
                }}
                accept={ACCEPTED}
                maxSize={MAX_BYTES}
                maxFiles={1}
                loading={busy}
            >
                <Group justify="center" gap="md" mih={72} style={{ pointerEvents: 'none' }}>
                    <Dropzone.Accept>
                        <IconUpload size={28} />
                    </Dropzone.Accept>
                    <Dropzone.Reject>
                        <IconX size={28} />
                    </Dropzone.Reject>
                    <Dropzone.Idle>
                        <IconPhoto size={28} />
                    </Dropzone.Idle>
                    <Stack gap={2}>
                        <Text size="sm">{t('breakArt.drop.title')}</Text>
                        <Text size="xs" c="dimmed">
                            {t('breakArt.drop.hint')}
                        </Text>
                    </Stack>
                </Group>
            </Dropzone>
        </Stack>
    );
}
