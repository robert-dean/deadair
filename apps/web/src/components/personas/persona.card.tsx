import type { Dispatch, SetStateAction } from 'react';
import { ActionIcon, Anchor, Badge, Button, Card, Group, Menu, Stack, Text } from '@mantine/core';
import { IconDots, IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import type { Persona, ScriptHistorySummaryRow, Voice } from '@deadair/sdk';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { useDeletePersona, useRehearsePersona, useSetStationHost } from '../../api/personas.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { SUMMARY_HOURS, type useScriptSummary } from '../../api/scripts.queries';
import { fetchVoiceSample, type useVoices } from '../../api/voices.queries';
import type { useVoicePreview } from '../voices/voice.preview';
import { notifyDone } from '../shared/notify';
import { severityColor, toneColor } from '../shared/status';
import { hasKind, kindsOf, presents } from './persona.kind';
import { PersonaNotesPanel } from './persona.notes';
import { PersonaStoriesPanel } from './persona.stories';
import { PersonaMemoryPanel } from './persona.memory';
import { PersonaPerformancePanel } from './persona.performance';
import { PersonaRehearsalPanel } from './persona.rehearsal';

interface PersonaCardProps {
    persona: Persona;
    all: readonly Persona[];
    phone: boolean;
    voices: ReturnType<typeof useVoices>;
    preview: ReturnType<typeof useVoicePreview>;
    summary: ReturnType<typeof useScriptSummary>;
    setStationHost: ReturnType<typeof useSetStationHost>;
    rehearse: ReturnType<typeof useRehearsePersona>;
    remove: ReturnType<typeof useDeletePersona>;
    notebook: string | undefined;
    setNotebook: Dispatch<SetStateAction<string | undefined>>;
    shelf: string | undefined;
    setShelf: Dispatch<SetStateAction<string | undefined>>;
    memory: string | undefined;
    setMemory: Dispatch<SetStateAction<string | undefined>>;
    performance: string | undefined;
    setPerformance: Dispatch<SetStateAction<string | undefined>>;
    exporting: string | undefined;
    exportFailure: { of: string; error: unknown } | undefined;
    save: (id?: string) => Promise<void>;
    onEdit: (persona: Persona) => void;
    onDelete: (persona: Persona) => void;
}

/** One character on the roster. Split out of `personas.page.tsx` unchanged; every piece of state stays on the page. */
export function PersonaCard({
    persona,
    all,
    phone,
    voices,
    preview,
    summary,
    setStationHost,
    rehearse,
    remove,
    notebook,
    setNotebook,
    shelf,
    setShelf,
    memory,
    setMemory,
    performance,
    setPerformance,
    exporting,
    exportFailure,
    save,
    onEdit,
    onDelete,
}: PersonaCardProps) {
    const { t } = useTranslation('personas');

    return (
        <Card>
            {/* Wraps on a phone rather than holding its intrinsic width: at 500px the
            action row otherwise stayed full size while the left column collapsed
            toward zero, and the buttons printed over the persona's name. */}
            <Group justify="space-between" align="flex-start" wrap={phone ? 'wrap' : 'nowrap'}>
                <Stack gap="xxs" style={{ minWidth: 0 }}>
                    <Group gap="xs">
                        <Text fw={600}>{persona.label}</Text>
                        {/* Two badges rather than one, because the flag underneath
                        them answers two different questions and this card used to
                        print the wrong answer to the one an operator is asking.
                        `presenting` is who is writing breaks right now; `active` is
                        who does it when the broadcast on air names nobody. They are
                        the same character on an ordinary station and they are not
                        during a show with its own host, which is exactly when
                        somebody is looking at this page. */}
                        {persona.presenting ? (
                            <Badge color="green" variant="light">
                                {t('card.onAirNow')}
                            </Badge>
                        ) : undefined}
                        {/* A co-host is on air too, beside the one writing the
                        breaks; without this a two-presenter show badged only one. */}
                        {persona.coHosting ? (
                            <Badge color="green" variant="light">
                                {t('card.coHostingNow')}
                            </Badge>
                        ) : undefined}
                        {persona.defaultHost && !persona.presenting ? (
                            <Badge color="gray" variant="light">
                                {t('card.stationsOwn')}
                            </Badge>
                        ) : undefined}
                        {persona.djName ? (
                            <Badge variant="outline" color="gray">
                                {persona.djName}
                            </Badge>
                        ) : undefined}
                        {/* Listed once, under the first kind it has, and badged with
                        the rest: a host who also drops by somebody else's show is
                        one character, not a host card and a guest card. */}
                        {kindsOf(persona)
                            .slice(1)
                            .map(kind => (
                                <Badge key={kind} variant="outline" color="gray">
                                    {t(`card.alsoKind.${kind}`)}
                                </Badge>
                            ))}
                    </Group>
                    {/* Unconstrained free text: without a clamp, a long style sentence
                    sets the card's own height, and on a phone a wrapped action row
                    beneath it would be pushed further down with every word. */}
                    <Text size="sm" c="dimmed" lineClamp={3}>
                        {persona.style}
                    </Text>
                    <PersonaSummary persona={persona} />
                    <RingsIn persona={persona} roster={all} />

                    {persona.voice ? (
                        <Group gap="xxs" wrap="nowrap">
                            <Text size="xs" c="dimmed">
                                {/* Both halves: the slot is what the editor and the
                                voices page call it, and what it maps to is the only
                                part saying anything about the sound. A station with
                                no speech plugin gets the slot alone, which is all
                                anything knows then. */}
                                {t('card.speaksAs', { voice: describeVoice(persona.voice, voices.data?.voices, t) })}
                            </Text>
                            <ActionIcon
                                variant="subtle"
                                size="xs"
                                loading={preview.isLoading(persona.voice)}
                                aria-label={t('card.playVoice', { label: persona.label })}
                                onClick={() => preview.play(persona.voice!, () => fetchVoiceSample(persona.voice!), t('shared.voicePreviewFailed'))}
                            >
                                {preview.isPlaying(persona.voice) ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
                            </ActionIcon>
                        </Group>
                    ) : undefined}

                    <PersonaRecord counts={countsFor(persona.key, summary.data?.rows)} />

                    {/* In the card's own column rather than the row of buttons, because
                    it goes somewhere rather than doing something. Keyed on the
                    persona's KEY rather than its id, since that is what
                    `script_history` stamps: the rows outlive the character, so what
                    it said survives it being deleted. */}
                    <Group gap="sm" wrap="nowrap">
                        <Anchor
                            size="xs"
                            renderRoot={(props: object) => (
                                <Link to="/voice" search={{ tab: 'said', segment: '', persona: persona.key }} {...props} />
                            )}
                        >
                            {t('card.said')}
                        </Anchor>
                    </Group>

                    {persona.voice && preview.failureFor(persona.voice) ? (
                        <Text size="xs" c={severityColor.failure}>
                            {preview.failureFor(persona.voice)}
                        </Text>
                    ) : undefined}
                </Stack>
                <Group gap="xs" wrap="nowrap" {...(phone ? PHONE_ACTIONS : {})}>
                    {/* Not offered for a caller at all, rather than offered and refused:
                    somebody who phones in cannot present the station, and the API
                    and the database both say so. A button that always fails is a
                    question the page should not have asked. */}
                    {persona.defaultHost || !presents(persona) ? undefined : (
                        <Button
                            variant="light"
                            size="compact-sm"
                            loading={setStationHost.isPending && setStationHost.variables === persona.id}
                            onClick={() =>
                                setStationHost.mutate(persona.id, {
                                    // The card redraws with the badge moved, which
                                    // is easy to miss on a page of eleven cards
                                    // where the one that changed may be scrolled
                                    // past. The sentence says what actually
                                    // happened, because this is the station's own
                                    // host rather than the show's: a broadcast that
                                    // named its own keeps it until that show ends.
                                    onSuccess: () => notifyDone(t('card.madeHost', { label: persona.label })),
                                })
                            }
                        >
                            {t('card.makeHost')}
                        </Button>
                    )}
                    {/* Spends a generation and changes nothing, so it is a plain button
                    rather than something behind a confirmation — but it takes the
                    one model slot, which is why only one runs at a time. */}
                    <Button
                        variant="subtle"
                        size="compact-sm"
                        loading={rehearse.isPending && rehearse.variables === persona.id}
                        disabled={rehearse.isPending}
                        onClick={() => rehearse.mutate(persona.id)}
                    >
                        {t('card.rehearse')}
                    </Button>
                    <Button variant="subtle" size="compact-sm" onClick={() => onEdit(persona)}>
                        {t('shared.edit')}
                    </Button>
                    {/* Notebook, Stories, Export and Delete behind one control: six
                    equal-weight buttons put Delete at the same visual weight as Put
                    on air, which is the one action anybody comes to this page for.
                    The pending state for Delete lives on this trigger rather than on
                    its `Menu.Item` — a menu item has no `loading` prop, and the
                    confirmation modal that actually fires the mutation closes the
                    menu long before the request resolves, so a spinner inside the
                    dropdown would never be seen. */}
                    <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                            <ActionIcon
                                variant="subtle"
                                loading={remove.isPending && remove.variables === persona.id}
                                aria-label={t('card.more', { label: persona.label })}
                            >
                                <IconDots size={16} />
                            </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                            {/* One at a time: the panel fetches per character, and
                            every open notebook is a request nobody asked for. */}
                            <Menu.Item onClick={() => setNotebook(current => (current === persona.id ? undefined : persona.id))}>
                                {notebook === persona.id ? t('card.menu.hideNotebook') : t('card.menu.notebook')}
                            </Menu.Item>
                            <Menu.Item onClick={() => setShelf(current => (current === persona.id ? undefined : persona.id))}>
                                {shelf === persona.id ? t('card.menu.hideStories') : t('card.menu.stories')}
                            </Menu.Item>
                            <Menu.Item onClick={() => setMemory(current => (current === persona.id ? undefined : persona.id))}>
                                {memory === persona.id ? t('card.menu.hideMemory') : t('card.menu.memory')}
                            </Menu.Item>
                            <Menu.Item onClick={() => setPerformance(current => (current === persona.id ? undefined : persona.id))}>
                                {performance === persona.id ? t('card.menu.hidePerformance') : t('card.menu.performance')}
                            </Menu.Item>
                            <Menu.Item
                                disabled={exporting === persona.id}
                                onClick={() => {
                                    void save(persona.id);
                                }}
                            >
                                {exporting === persona.id ? t('card.menu.exporting') : t('card.menu.export')}
                            </Menu.Item>
                            <Menu.Divider />
                            {/* The one action here that loses something an operator
                            wrote, so it is the one that asks first and says what
                            goes with it — and the one kept last and in red. */}
                            <Menu.Item color="red" onClick={() => onDelete(persona)}>
                                {t('shared.delete')}
                            </Menu.Item>
                        </Menu.Dropdown>
                    </Menu>
                </Group>
            </Group>

            {/* Each failure belongs to the button that asked for it. A page-level alert
            for a per-card button puts the reason at the top of a list of fourteen,
            where an operator working on the ninth will not see it. */}
            {setStationHost.error && setStationHost.variables === persona.id ? (
                <CardFailure error={setStationHost.error} fallback={t('card.failure.host')} />
            ) : undefined}

            {rehearse.error && rehearse.variables === persona.id ? (
                <CardFailure error={rehearse.error} fallback={t('card.failure.rehearse')} />
            ) : undefined}

            {exportFailure?.of === persona.id ? <CardFailure error={exportFailure.error} fallback={t('card.failure.export')} /> : undefined}

            {/* Keyed on the persona it was actually run for rather than simply rendered
            under whichever card is last: one result is held at a time, and a panel
            that stayed put while a different persona was rehearsed would attribute
            one character's words to another. */}
            {rehearse.data?.personaId === persona.id ? (
                <PersonaRehearsalPanel rehearsal={rehearse.data} {...(persona.voice === undefined ? {} : { voice: persona.voice })} />
            ) : undefined}

            {notebook === persona.id ? <PersonaNotesPanel personaId={persona.id} /> : undefined}

            {shelf === persona.id ? <PersonaStoriesPanel personaId={persona.id} /> : undefined}

            {memory === persona.id ? <PersonaMemoryPanel personaId={persona.id} label={persona.label} /> : undefined}

            {performance === persona.id ? <PersonaPerformancePanel personaKey={persona.key} /> : undefined}
        </Card>
    );
}

/** This character's attempts in the window, or nothing when it has made none. */
function countsFor(key: string, rows: ScriptHistorySummaryRow[] | undefined): ScriptHistorySummaryRow | undefined {
    return rows?.find(row => row.personaKey === key);
}

/**
 * How a character is doing on air, which is the one thing about it no sheet can say.
 *
 * A decline is drawn in the same dimmed text as everything else, deliberately: it is the writer
 * registry working, and painting it as a fault would teach an operator to go looking for a break
 * that was covered for exactly as designed. What IS worth a colour is `failed`, where something
 * threw — and only when there is one, so a healthy character carries no red at all.
 *
 * A character with no attempts says nothing rather than "0 written". It has not been on air lately,
 * which the row's own absence already says, and three zeroes read as a fault that has not happened.
 */
function PersonaRecord({ counts }: { counts?: ScriptHistorySummaryRow }) {
    const { t } = useTranslation('personas');
    if (counts === undefined) return undefined;

    return (
        <Group gap="xxs" wrap="nowrap">
            <Text size="xs" c="dimmed" className="da-num">
                {t('card.record.counts', { written: counts.written, declined: counts.declined })}
            </Text>
            {counts.failed > 0 ? (
                <Text size="xs" c={toneColor.fault} className="da-num">
                    {t('card.record.failed', { failed: counts.failed })}
                </Text>
            ) : undefined}
            <Text size="xs" c="dimmed">
                {t('card.record.window', { count: SUMMARY_HOURS })}
            </Text>
        </Group>
    );
}

/** What a character is missing, or nothing at all when it is missing nothing. */
function PersonaSummary({ persona }: { persona: Persona }) {
    const { t } = useTranslation('personas');
    const summary = summarise(persona, t);
    if (summary === undefined) return undefined;

    return (
        <Text size="xs" c="dimmed">
            {summary}
        </Text>
    );
}

/**
 * Which hosts a caller rings in to, named, or nothing for a caller tied to nobody.
 *
 * Nothing rather than "rings in to anybody", because that is what every caller did before ties
 * existed and a line on every card saying so would be the ordinary case reported as news. An id the
 * roster does not hold is skipped: the tie went with its host, and the list is a moment behind.
 */
function RingsIn({ persona, roster }: { persona: Persona; roster: readonly Persona[] }) {
    const { t } = useTranslation('personas');
    const names = (persona.hosts ?? []).flatMap(id => {
        const host = roster.find(row => row.id === id);
        return host === undefined ? [] : [host.label];
    });
    if (names.length === 0) return undefined;
    // One list of ties narrows both jobs, so it is worded for the one they do: somebody who only
    // drops by does not ring in.
    const line = hasKind(persona, 'caller') ? t('card.ringsIn', { names: names.join(', ') }) : t('card.dropsBy', { names: names.join(', ') });

    return (
        <Text size="xs" c="dimmed">
            {line}
        </Text>
    );
}

/** One card's own bad news, in the place the button that caused it is. */
function CardFailure({ error, fallback }: { error: unknown; fallback: string }) {
    return (
        <Text size="xs" c={severityColor.failure} mt="xs" ta="right">
            {apiErrorMessage(error, fallback)}
        </Text>
    );
}

/**
 * A voice as something an operator can hear in their head, or as the word they typed.
 *
 * The station voice id is a name this station chose and the engine has never heard of, so on its own
 * it says nothing about the sound. The plugin's description is what does — and it is absent exactly
 * when nothing can speak, which is when the key is all there is.
 */
function describeVoice(voiceId: string, voices: Voice[] | undefined, t: TFunction<'personas'>): string {
    const voice = voices?.find(candidate => candidate.id === voiceId);
    return voice?.description === undefined ? voiceId : t('card.voiceWithDescription', { voice: voiceId, description: voice.description });
}

/** A card's action row on a phone: its own full-width line under the text, pushed to the right. */
const PHONE_ACTIONS = { w: '100%', justify: 'flex-end' } as const;

/**
 * The one line under a persona, which says something only when there is something to say.
 *
 * It used to state three facts about every character — its phrasings, its markers, its voice —
 * which on a roster of seeds is the same sentence fourteen times over, and a line that reads
 * identically on every card is a line nobody reads on any of them. So each half is now printed only
 * when it DEVIATES from a character that is fully equipped, and a card with nothing wrong carries no
 * summary at all.
 *
 * All three deviations are ordinary states rather than faults, which is why this is dimmed text and
 * not a warning: a character with no phrasings of its own still gets the station's, and one with no
 * markers is simply not checked. What they have in common is that each is a thing an operator
 * would otherwise discover by putting the character on air.
 */
function summarise(persona: Persona, t: TFunction<'personas'>): string | undefined {
    const parts: string[] = [];

    // Only somebody who presents is asked about phrasings: they are the station's floor under a break,
    // and a caller or a guest writes no breaks. Saying one has none would report the design as a gap.
    const phrasings = (persona.templates ?? '').split('\n').filter(line => line.trim().length > 0).length;
    if (phrasings === 0 && presents(persona)) {
        parts.push(t('card.summary.noPhrasings'));
    }

    if ((persona.dictionMarkers?.length ?? 0) === 0) parts.push(t('card.summary.unchecked'));

    if (!persona.voice) parts.push(t('card.summary.defaultVoice'));

    return parts.length === 0 ? undefined : parts.join(' · ');
}
