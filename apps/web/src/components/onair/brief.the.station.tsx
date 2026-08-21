import { Button, Card, Group, NumberInput, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { useState } from 'react';

import { usePutStationOnAir } from '../../api/director.queries';
import { usePersonas } from '../../api/personas.queries';
import { apiErrorMessage } from '../../api/sdk.error';

/**
 * Starting a broadcast by saying what it should be.
 *
 * The other way on air is a playlist, from the playlists page, and this is the one that needs no
 * prepared material at all: the station is put on with an empty running order and a brief, and the
 * generator fills it against that brief. It keeps steering every refill for as long as the
 * broadcast runs, which is why the brief is stored on the running order rather than spent on the
 * first batch.
 *
 * **A broadcast action, like everything else on this page.** There is no draft and no save: pressing
 * this puts the station on air and every listener hears the result. The copy says so.
 *
 * It needs a model to programme with (`llm.setGenerator`, off by default) and it will not say so,
 * because this component cannot tell the difference between that being off and a model that answered
 * badly — what an operator sees either way is the station's own rotation, which is the designed
 * degradation rather than a failure to report. The help text names the setting instead.
 *
 * **Drawn whether or not there is already a running order**, which it was not to begin with: it sat
 * inside the empty-state block, and since Stop leaves the running order alone for Start to resume,
 * an operator who had ever been on air could not reach it again without emptying the order by hand.
 * `putOnAir` replaces the order and mints a new broadcast regardless of what is on, so the only thing
 * the two cases needed to differ in was saying so — {@link BriefTheStationProps.replacing}.
 *
 * ## The host is picked HERE, beside what to play, and that is the point
 *
 * A broadcast is a show and a show has a host. Choosing one here binds it to the running order for
 * as long as the broadcast lasts, so the presenter cannot drift back to the station's own halfway
 * through — which is exactly what the brief does one field to the left, for exactly the same reason.
 * Leaving it on the station's own host is the ordinary case and needs no thought.
 */
export interface BriefTheStationProps {
    /**
     * Whether there is a running order this would throw away.
     *
     * Only the copy: the request is the same one either way, since a brief always starts a new
     * broadcast rather than re-steering the one that is running.
     */
    replacing?: boolean;
}

export function BriefTheStation({ replacing = false }: BriefTheStationProps) {
    // Deliberately not seeded from the order's current brief. That would read as editing the brief
    // in place, and there is no such command: what this sends mints a NEW broadcast and drops
    // everything queued, so an empty box is the honest shape of it.
    const [brief, setBrief] = useState('');
    // `undefined` is "whoever the station has on air", which is the default and the common case.
    const [personaId, setPersonaId] = useState<string | undefined>(undefined);
    // The brief's exact half, and the one part of it that reaches the record DRAW rather than only
    // the model — so a period holds even where the words above do nothing. Empty is no bound at
    // either end, and the two are independent.
    const [eraFrom, setEraFrom] = useState<number | string>('');
    const [eraTo, setEraTo] = useState<number | string>('');
    const onAir = usePutStationOnAir();
    const personas = usePersonas();

    const asked = brief.trim();
    const failure = onAir.isError ? apiErrorMessage(onAir.error, 'The station could not be put on air.') : undefined;

    const start = () => {
        if (asked.length === 0) return;
        // The brief doubles as the label for this broadcast. An operator who asked for heavy metal
        // hits should see that on the page rather than "The station", and naming it anything else
        // would be inventing a second thing to read.
        onAir.mutate({
            brief: asked,
            name: asked,
            ...(personaId === undefined ? {} : { personaId }),
            ...(typeof eraFrom === 'number' ? { eraFrom } : {}),
            ...(typeof eraTo === 'number' ? { eraTo } : {}),
        });
    };

    return (
        <Card padding="xl">
            <Stack gap="sm" align="flex-start">
                <Text fw={500}>Tell the station what to play</Text>
                <Text size="sm" c="dimmed">
                    It programmes itself against this, from your own library first and from your providers when the library cannot fill it. A record
                    it does not own yet is fetched and kept. What you like and dislike is taken into account either way.
                </Text>
                {replacing ? (
                    <Text size="sm" c="orange.4">
                        This starts a new broadcast: everything still to come below is dropped, and what is playing stops.
                    </Text>
                ) : undefined}
                <Group gap="sm" wrap="nowrap" w="100%" align="flex-start">
                    <TextInput
                        flex={1}
                        placeholder="heavy metal hits"
                        aria-label="What the station should play"
                        value={brief}
                        maxLength={500}
                        onChange={event => setBrief(event.currentTarget.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter') start();
                        }}
                    />
                    <Select
                        w={220}
                        aria-label="Who is hosting"
                        placeholder="The station's host"
                        clearable
                        data={(personas.data?.personas ?? []).map(persona => ({
                            value: persona.id,
                            label: persona.active ? `${persona.label} (on air)` : persona.label,
                        }))}
                        value={personaId ?? null}
                        onChange={value => setPersonaId(value ?? undefined)}
                    />
                    <Tooltip
                        label={
                            failure ??
                            (replacing
                                ? 'Replaces the running order and starts programming against this. Every listener hears the result at once.'
                                : 'Puts the station on air and starts programming against this. Every listener hears the result.')
                        }
                        color={failure ? 'red' : undefined}
                        multiline
                        maw={320}
                    >
                        <Button color={failure ? 'red' : undefined} loading={onAir.isPending} disabled={asked.length === 0} onClick={start}>
                            Go on air
                        </Button>
                    </Tooltip>
                </Group>
                <Group gap="sm" wrap="nowrap" align="flex-start">
                    <NumberInput
                        w={120}
                        aria-label="Earliest year"
                        placeholder="From year"
                        min={1900}
                        max={2100}
                        allowDecimal={false}
                        hideControls
                        className="da-num"
                        value={eraFrom}
                        onChange={setEraFrom}
                    />
                    <NumberInput
                        w={120}
                        aria-label="Latest year"
                        placeholder="To year"
                        min={1900}
                        max={2100}
                        allowDecimal={false}
                        hideControls
                        className="da-num"
                        value={eraTo}
                        onChange={setEraTo}
                    />
                    <Text size="xs" c="dimmed" style={{ lineHeight: '36px' }}>
                        A period, if you want one. Unlike the words, it holds without a model.
                    </Text>
                </Group>
                <Text size="xs" c="dimmed">
                    The host stays with this broadcast until you go on air again. Leave it empty to use whichever persona the station has on air. A
                    record whose release year the catalogue does not know is played whatever the period.
                </Text>
                <Text size="xs" c="dimmed">
                    Needs a model to programme with: turn on “Let a model choose what the station plays” in settings. Without one the station falls
                    back to its own rotation, which ignores the brief.
                </Text>
            </Stack>
        </Card>
    );
}
