import { useState } from 'react';
import { ActionIcon, Badge, Box, Button, Card, Group, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconPlus } from '@tabler/icons-react';
import type { ClockBand, ClockBandInput } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { useClockBands, useCreateClockBand, useDeleteClockBand, useUpdateClockBand } from '../../api/clock.queries';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { severityColor } from '../shared/status';
import { BandEditor, type BandTarget } from './band.editor';
import { FormatClockDial } from './format.clock.dial';
import { i18n } from '../../i18n/i18n.setup';

/**
 * The station's format clock, on the page that already answers "what happens when".
 *
 * The grid above says what a stretch of the day PLAYS and who hosts it; this says what the station
 * SAYS while it does — a bulletin at half past, an ident at the top of the hour. They are two halves
 * of one question, which is why they share a page rather than each having their own.
 *
 * ## A list rather than a second grid
 *
 * A band is a rule about every hour, not a block with a place on a week. Drawing `:30 news` onto the
 * timetable would mean drawing it twenty-four times a day across seven columns to express one line,
 * and the thing an operator edits would be buried under the thing it produces.
 *
 * ## Order is preference, so it is the one thing that can be dragged
 *
 * Two rules wanting the same boundary is settled by which is higher, and nothing else here has any
 * ordering meaning. The arrows write a position rather than a rank: they swap the two rows' own
 * positions, so a move is one edit that cannot renumber the list underneath somebody.
 *
 * ## Switched off is drawn, not hidden
 *
 * The API answers with every band including the ones in nothing, because an operator cannot turn a
 * rule back on that they cannot see. That is what a commented-out line used to be.
 */
export function ClockPanel() {
    const { t } = useTranslation('schedule');
    const clock = useClockBands();
    const create = useCreateClockBand();
    const update = useUpdateClockBand();
    const remove = useDeleteClockBand();

    const [editing, setEditing] = useState<BandTarget | undefined>(undefined);

    const bands = clock.data?.bands ?? [];
    // What the station can actually make right now. Read through {@link canProduce} rather than
    // directly, because an empty set and an unanswered query are the same value and only one of
    // them means anything.
    const producible = new Set(clock.data?.producibleKinds ?? []);
    const canProduce = (kind: string) => clock.data === undefined || producible.has(kind);
    // The complement, for the dial: it marks what will be passed over rather than what will run.
    const unproducible = new Set(bands.filter(band => !canProduce(band.kind)).map(band => band.kind));

    const close = () => {
        setEditing(undefined);
        create.reset();
        update.reset();
    };

    const submit = (draft: ClockBandInput) => {
        const done = { onSuccess: close };
        if (editing?.kind === 'edit') update.mutate({ id: editing.band.id, body: draft }, done);
        else create.mutate(draft, done);
    };

    /**
     * Swap one band with its neighbour.
     *
     * Two writes rather than a reorder endpoint, because the two rows are the whole of what changed:
     * a list-wide renumbering would be a bigger claim than the gesture made, and each answer carries
     * the whole clock back so the second write lands on what the first one produced.
     *
     * Awaited in sequence rather than chained through the first write's `onSuccess`, which is not a
     * style choice: starting a second `mutate` on the SAME mutation from inside the first one's
     * callback replaces the options the first is still settling against, and react-query throws
     * reading `onSettled` off what is no longer there. The rejection is swallowed because a failed
     * write is already on the page as `update.error`, and the row springs back on its own since the
     * list is drawn from what the server last said.
     */
    const move = async (index: number, by: -1 | 1) => {
        const band = bands[index];
        const other = bands[index + by];
        if (band === undefined || other === undefined) return;

        try {
            await update.mutateAsync({ id: band.id, body: { ...bodyOf(band), position: other.position } });
            await update.mutateAsync({ id: other.id, body: { ...bodyOf(other), position: band.position } });
        } catch {
            // Reported through `update.error` above.
        }
    };

    return (
        <Card padding="lg">
            <Stack gap="sm">
                <Group justify="space-between" align="flex-start">
                    <Stack gap={2}>
                        <Eyebrow>{t('clock.title')}</Eyebrow>
                        <Text size="sm" c="dimmed" maw={620}>
                            {t('clock.description')}
                        </Text>
                    </Stack>
                    <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconPlus size={14} />}
                        onClick={() => setEditing({ kind: 'new', position: (bands.at(-1)?.position ?? -1) + 1 })}
                    >
                        {t('clock.addBand')}
                    </Button>
                </Group>

                {clock.error ? (
                    <ErrorAlert title={t('clock.loadFailedTitle')} error={clock.error} fallback={t('clock.loadFailedFallback')} />
                ) : undefined}

                {update.error ? (
                    <ErrorAlert title={t('clock.changeFailedTitle')} error={update.error} fallback={t('clock.changeFailedFallback')} />
                ) : undefined}

                {remove.error ? (
                    <ErrorAlert title={t('clock.deleteFailedTitle')} error={remove.error} fallback={t('clock.deleteFailedFallback')} />
                ) : undefined}

                {clock.data && bands.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {t('clock.noBands')}
                    </Text>
                ) : undefined}

                {/* The dial beside the list rather than instead of it. The list is the editor —
                    a band is four fields and you cannot type into a circle — and the dial is the
                    one thing rows cannot show: the SHAPE of an hour, and whether three rules have
                    piled up inside four minutes. It drops below the list on a narrow window, where
                    a 220px circle beside a table is two cramped columns. */}
                {bands.length > 0 ? (
                    <Group align="flex-start" gap="xl" wrap="wrap">
                        <Box visibleFrom="md" style={{ flexShrink: 0 }}>
                            <FormatClockDial bands={bands} unproducible={unproducible} />
                        </Box>
                        <Box style={{ flex: 1, minWidth: 320 }}>
                            <Table.ScrollContainer minWidth={440}>
                                <Table verticalSpacing="xs" highlightOnHover>
                                    <Table.Tbody>
                                        {bands.map((band, index) => (
                                            <Table.Tr key={band.id} style={{ cursor: 'pointer' }} onClick={() => setEditing({ kind: 'edit', band })}>
                                                <Table.Td w={110} className="da-num">
                                                    <Text size="sm" c={band.enabled ? undefined : 'dimmed'}>
                                                        {whenOf(band)}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text size="sm" c={band.enabled ? undefined : 'dimmed'}>
                                                        {band.kind}
                                                        {band.topicLabel === undefined ? '' : ` · ${band.topicLabel}`}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td w={170}>
                                                    {/* A rule switched off says nothing about whether the
                                            station could honour it, so only one of these is ever
                                            worth drawing: what an operator does about a band that
                                            is off is turn it on. */}
                                                    {!band.enabled ? (
                                                        <Badge size="xs" variant="light" color="gray">
                                                            {t('clock.off')}
                                                        </Badge>
                                                    ) : canProduce(band.kind) ? undefined : (
                                                        <Tooltip multiline maw={320} label={t('clock.cannotProduceHint', { kind: band.kind })}>
                                                            {/* `tt="none"` because the badge carries a
                                                    sentence rather than a one-word state, and
                                                    Mantine's uppercase default made it wide enough
                                                    to be truncated to "NOTHING CAN PRODUCE T…". */}
                                                            <Badge size="xs" variant="light" color={severityColor.notice} tt="none">
                                                                {t('clock.cannotProduce')}
                                                            </Badge>
                                                        </Tooltip>
                                                    )}
                                                </Table.Td>
                                                <Table.Td w={80}>
                                                    {/* The arrows are the only control on the row: everything else
                                            about a band is edited in the sheet the row opens. */}
                                                    <Group gap={2} justify="flex-end" onClick={event => event.stopPropagation()}>
                                                        <ActionIcon
                                                            size="sm"
                                                            variant="subtle"
                                                            aria-label={t('clock.moveUp')}
                                                            disabled={index === 0}
                                                            onClick={() => void move(index, -1)}
                                                        >
                                                            <IconArrowUp size={14} />
                                                        </ActionIcon>
                                                        <ActionIcon
                                                            size="sm"
                                                            variant="subtle"
                                                            aria-label={t('clock.moveDown')}
                                                            disabled={index === bands.length - 1}
                                                            onClick={() => void move(index, 1)}
                                                        >
                                                            <IconArrowDown size={14} />
                                                        </ActionIcon>
                                                    </Group>
                                                </Table.Td>
                                            </Table.Tr>
                                        ))}
                                    </Table.Tbody>
                                </Table>
                            </Table.ScrollContainer>
                        </Box>
                    </Group>
                ) : undefined}
            </Stack>

            <BandEditor
                // Keyed on what it is open on, so the form reads its values once per band rather than
                // keeping the last one's under a new title. `useForm` reads `initialValues` once per
                // MOUNT, so the key has to change on close as well: a constant `new` left the second
                // new band showing the first one's answers, which is how the first band added through
                // this panel came out at the position the panel had been built with rather than the
                // one it was opened with. Same spelling as the slot editor's `keyOf` next door.
                key={editing === undefined ? 'closed' : editing.kind === 'edit' ? editing.band.id : `new:${editing.position}`}
                {...(editing === undefined ? {} : { target: editing })}
                kinds={clock.data?.producibleKinds ?? []}
                onClose={close}
                onSubmit={submit}
                onDelete={id => remove.mutate(id, { onSuccess: close })}
                saving={create.isPending || update.isPending}
                deleting={remove.isPending}
                error={create.error ?? update.error}
            />
        </Card>
    );
}

/**
 * When this band fires, as the sentence its editor wrote.
 *
 * Exported for the on-air page's summary of the same clock. Two spellings of ":30" is how one page
 * and the next start describing one rule differently.
 */
export function whenOf(band: ClockBand): string {
    if (band.at === 'interval') return i18n.t('schedule:clock.every', { minutes: Math.round((band.everyMs ?? 0) / 60_000) });

    const minute = String(band.minute ?? 0).padStart(2, '0');
    return band.hour === undefined ? `:${minute}` : `${String(band.hour).padStart(2, '0')}:${minute}`;
}

/** A band as the shape a write takes: everything but the id, which the URL carries. */
const bodyOf = (band: ClockBand): ClockBandInput => ({
    kind: band.kind,
    at: band.at,
    ...(band.hour === undefined ? {} : { hour: band.hour }),
    ...(band.minute === undefined ? {} : { minute: band.minute }),
    ...(band.everyMs === undefined ? {} : { everyMs: band.everyMs }),
    // What it is about goes back too: `PUT` replaces the row, so a reorder that sent only the
    // position would quietly turn a technology bulletin into a general one.
    ...(band.topicId === undefined ? {} : { topicId: band.topicId }),
    position: band.position,
    enabled: band.enabled,
});
