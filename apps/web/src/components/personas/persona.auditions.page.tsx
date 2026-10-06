import { useState } from 'react';
import { Button, Group, NumberInput, Select, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { usePersonas } from '../../api/personas.queries';
import { playlistsListOptions } from '../../api/playlists.queries';
import { chartsListOptions } from '../../api/charts.queries';
import { useCancelPersonaAudition, usePersonaAuditions, useStartPersonaAudition } from '../../api/persona.auditions.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageSkeleton } from '../shared/page.skeleton';
import { SourceField, splitSource, type ProgrammeSource } from '../programme/programme.fields';
import { PersonaAuditionCard } from './persona.audition.card';
import { presents } from './persona.kind';

/** What an operator gets if they press Start without thinking about it: an hour of radio, roughly. */
const DEFAULT_BREAKS = 10;

/**
 * A character over an hour of records, before it goes on air.
 *
 * The rehearsal on the Characters tab writes ONE break against two fixed invented records. That is
 * the right shape for judging a sheet edit — the pair never moves, so two readings a minute apart
 * are comparable — and it is the wrong shape for the question this page answers: does the character
 * hold up over real material? Does it repeat itself by the fourth break? Does the model start
 * declining once there are facts in front of it?
 *
 * So this runs the same writers over a playlist or a chart, one break per transition, and airs none
 * of it.
 *
 * ## It fills in slowly, and says so
 *
 * Each break waits for the model behind everything the station is doing for itself, and is taken off
 * it the moment a real break wants it. A run of ten is minutes on a quiet station and longer on a
 * busy one, which is why it is queued rather than awaited and why the page polls. Closing the tab
 * costs nothing: the run is a row, and the jobs carry on without anybody watching.
 */
export function PersonaAuditionsPage({ persona }: { persona?: string }) {
    const personas = usePersonas();
    // Read here as well as in the picker, for the name a run is captioned with. The same queries, so
    // the picker's reads answer these.
    const playlists = useQuery(playlistsListOptions);
    const charts = useQuery(chartsListOptions);
    const { t } = useTranslation('personas');

    // Hosts only. A caller is cast into a production and never presents, so auditioning one over a
    // playlist would be measuring something the station will not ask it to do.
    const hosts = (personas.data?.personas ?? []).filter(presents);

    const [chosen, setChosen] = useState<string | undefined>(persona);
    const [source, setSource] = useState<string | null>(null);
    const [breaks, setBreaks] = useState<number>(DEFAULT_BREAKS);
    const [open, setOpen] = useState<string | undefined>(undefined);

    // The character the page is about: whichever was picked, else whoever a link named, else the one
    // presenting — which is the one an operator is most likely to be asking about. `presenting`
    // rather than the station's own host, because the question is whose breaks they have been
    // hearing.
    const personaId = chosen ?? persona ?? hosts.find(one => one.presenting)?.id ?? hosts[0]?.id ?? '';
    const host = hosts.find(one => one.id === personaId);

    const runs = usePersonaAuditions(personaId);
    const start = useStartPersonaAudition(personaId);
    const cancel = useCancelPersonaAudition(personaId);

    const picked = splitSource(source);
    const name = captionOf(picked, playlists.data?.playlists ?? [], charts.data?.charts ?? []);

    return (
        <Stack gap="lg">
            <Stack gap="xs">
                <Group gap="sm" align="flex-end" wrap="wrap">
                    <Select
                        label={t('auditions.character')}
                        data={hosts.map(one => ({ value: one.id, label: one.presenting ? t('auditions.onAir', { label: one.label }) : one.label }))}
                        value={personaId === '' ? null : personaId}
                        onChange={value => {
                            setChosen(value ?? undefined);
                            setOpen(undefined);
                        }}
                        disabled={personas.isLoading}
                        searchable
                        w={240}
                    />
                    <SourceField
                        label={t('auditions.source')}
                        description={t('auditions.sourceDescription')}
                        clearLabel={t('auditions.sourceClear')}
                        stationPlaylists
                        value={source}
                        onChange={setSource}
                        w={320}
                    />
                    <NumberInput
                        label={t('auditions.breaks')}
                        value={breaks}
                        onChange={value => setBreaks(typeof value === 'number' ? value : DEFAULT_BREAKS)}
                        min={1}
                        max={50}
                        clampBehavior="strict"
                        w={110}
                    />
                    <Button
                        loading={start.isPending}
                        disabled={picked === undefined || personaId === ''}
                        onClick={() => {
                            if (picked === undefined) return;
                            start.mutate({ ...requestSource(picked), limit: breaks, ...(name === undefined ? {} : { name }) });
                        }}
                    >
                        {t('auditions.start')}
                    </Button>
                </Group>

                <Text size="xs" c="dimmed">
                    {t('auditions.note')}
                </Text>
            </Stack>

            {personas.isError ? <ErrorAlert title={t('auditions.rosterError')} error={personas.error} /> : undefined}
            {playlists.isError ? <ErrorAlert title={t('auditions.playlistsError')} error={playlists.error} /> : undefined}
            {start.isError ? (
                <ErrorAlert title={t('auditions.startError.title')} error={start.error} fallback={t('auditions.startError.fallback')} />
            ) : undefined}
            {cancel.isError ? <ErrorAlert title={t('auditions.cancelError')} error={cancel.error} /> : undefined}
            {runs.isError ? <ErrorAlert title={t('auditions.runsError')} error={runs.error} /> : undefined}

            {runs.isLoading ? <PageSkeleton variant="rows" /> : undefined}

            {runs.data?.auditions.length === 0 ? (
                <EmptyState title={host === undefined ? t('auditions.empty.titleUnknown') : t('auditions.empty.title', { label: host.label })}>
                    {t('auditions.empty.body')}
                </EmptyState>
            ) : undefined}

            <Stack gap="sm">
                {(runs.data?.auditions ?? []).map(run => (
                    <PersonaAuditionCard
                        key={run.id}
                        personaId={personaId}
                        run={run}
                        {...(host?.voice === undefined ? {} : { voice: host.voice })}
                        {...(host?.soundboard === undefined ? {} : { soundboard: host.soundboard })}
                        open={open === run.id}
                        onToggle={() => setOpen(current => (current === run.id ? undefined : run.id))}
                        onCancel={() => cancel.mutate(run.id)}
                        stopping={cancel.isPending && cancel.variables === run.id}
                    />
                ))}
            </Stack>
        </Stack>
    );
}

/** The picked source as the request names it: exactly one of the three, as the station requires. */
function requestSource(picked: ProgrammeSource) {
    if (picked.kind === 'station') return { stationPlaylistId: picked.stationPlaylistId };
    if (picked.kind === 'chart') return { chartId: picked.chartId };
    return { pluginId: picked.pluginId, playlistId: picked.playlistId };
}

/**
 * What the run is captioned with, from the listing the picker drew it from. Absent for a station
 * playlist, whose name the station reads for itself, and for anything the listing no longer holds.
 */
function captionOf(
    picked: ProgrammeSource | undefined,
    playlists: readonly { pluginId: string; id: string; name: string }[],
    charts: readonly { id: string; name: string }[],
): string | undefined {
    if (picked?.kind === 'playlist') return playlists.find(one => one.pluginId === picked.pluginId && one.id === picked.playlistId)?.name;
    if (picked?.kind === 'chart') return charts.find(one => one.id === picked.chartId)?.name;
    return undefined;
}
