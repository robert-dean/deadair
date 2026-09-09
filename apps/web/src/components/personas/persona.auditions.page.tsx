import { useState } from 'react';
import { Button, Group, NumberInput, Select, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';

import { usePersonas } from '../../api/personas.queries';
import { playlistsListOptions } from '../../api/playlists.queries';
import { useCancelPersonaAudition, usePersonaAuditions, useStartPersonaAudition } from '../../api/persona.auditions.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageSkeleton } from '../shared/page.skeleton';
import { splitSource, sourceValue } from '../programme/programme.fields';
import { PersonaAuditionCard } from './persona.audition.card';

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
 * So this runs the same writers over a playlist, one break per transition, and airs none of it.
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
    const playlists = useQuery(playlistsListOptions);

    // Hosts only. A caller is cast into a production and never presents, so auditioning one over a
    // playlist would be measuring something the station will not ask it to do.
    const hosts = (personas.data?.personas ?? []).filter(one => one.kind !== 'caller');

    const [chosen, setChosen] = useState<string | undefined>(persona);
    const [source, setSource] = useState<string | null>(null);
    const [breaks, setBreaks] = useState<number>(DEFAULT_BREAKS);
    const [open, setOpen] = useState<string | undefined>(undefined);

    // The character the page is about: whichever was picked, else whoever a link named, else the one
    // on air — which is the one an operator is most likely to be asking about.
    const personaId = chosen ?? persona ?? hosts.find(one => one.active)?.id ?? hosts[0]?.id ?? '';
    const host = hosts.find(one => one.id === personaId);

    const runs = usePersonaAuditions(personaId);
    const start = useStartPersonaAudition(personaId);
    const cancel = useCancelPersonaAudition(personaId);

    const picked = splitSource(source);
    const playlist = picked?.kind === 'playlist' ? picked : undefined;
    const named = (playlists.data?.playlists ?? []).find(
        one => playlist !== undefined && one.pluginId === playlist.pluginId && one.id === playlist.playlistId,
    );

    return (
        <Stack gap="lg">
            <Stack gap="xs">
                <Group gap="sm" align="flex-end" wrap="wrap">
                    <Select
                        label="Character"
                        data={hosts.map(one => ({ value: one.id, label: one.active ? `${one.label} (on air)` : one.label }))}
                        value={personaId === '' ? null : personaId}
                        onChange={value => {
                            setChosen(value ?? undefined);
                            setOpen(undefined);
                        }}
                        disabled={personas.isLoading}
                        searchable
                        w={240}
                    />
                    <Select
                        label="Playlist"
                        description="Read once, when you press Start."
                        data={(playlists.data?.playlists ?? []).map(one => ({
                            value: sourceValue(one.pluginId, one.id),
                            label: `${one.name} — ${one.pluginName}`,
                        }))}
                        value={source}
                        onChange={setSource}
                        disabled={playlists.isLoading}
                        searchable
                        clearable
                        w={320}
                    />
                    <NumberInput
                        label="Breaks"
                        value={breaks}
                        onChange={value => setBreaks(typeof value === 'number' ? value : DEFAULT_BREAKS)}
                        min={1}
                        max={50}
                        clampBehavior="strict"
                        w={110}
                    />
                    <Button
                        loading={start.isPending}
                        disabled={playlist === undefined || personaId === ''}
                        onClick={() => {
                            if (playlist === undefined) return;
                            start.mutate({
                                pluginId: playlist.pluginId,
                                playlistId: playlist.playlistId,
                                limit: breaks,
                                ...(named === undefined ? {} : { name: named.name }),
                            });
                        }}
                    >
                        Start
                    </Button>
                </Group>

                <Text size="xs" c="dimmed">
                    Nothing here airs, and nothing is spent: the character&apos;s notebook and stories are read for each break and left where they
                    are. Each break waits for the model behind everything the station is doing for itself, so a run fills in over minutes.
                </Text>
            </Stack>

            {personas.isError ? <ErrorAlert title="Could not read the roster" error={personas.error} /> : undefined}
            {playlists.isError ? <ErrorAlert title="Could not read the playlists" error={playlists.error} /> : undefined}
            {start.isError ? (
                <ErrorAlert title="Nothing was started" error={start.error} fallback="That audition could not be started." />
            ) : undefined}
            {cancel.isError ? <ErrorAlert title="Could not stop that audition" error={cancel.error} /> : undefined}
            {runs.isError ? <ErrorAlert title="Could not read this character’s auditions" error={runs.error} /> : undefined}

            {runs.isLoading ? <PageSkeleton variant="rows" /> : undefined}

            {runs.data?.auditions.length === 0 ? (
                <EmptyState title={`${host?.label ?? 'This character'} has not been auditioned yet`}>
                    Pick a playlist above and press Start. Ten breaks is about an hour of radio, and you can read them as they land.
                </EmptyState>
            ) : undefined}

            <Stack gap="sm">
                {(runs.data?.auditions ?? []).map(run => (
                    <PersonaAuditionCard
                        key={run.id}
                        personaId={personaId}
                        run={run}
                        {...(host?.voice === undefined ? {} : { voice: host.voice })}
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
