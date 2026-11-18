import { useState } from 'react';
import { ActionIcon, Button, Chip, CloseButton, Group, Menu, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDots } from '@tabler/icons-react';
import type { Persona, PersonaInput, ScheduleNow, ScheduleSlot, ScriptHistorySummaryRow } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import {
    exportPersonas,
    useCreatePersona,
    useDeletePersona,
    usePersonas,
    useSetStationHost,
    useRehearsePersona,
    useRestorePersonas,
    useUpdatePersona,
} from '../../api/personas.queries';
import { usePersonaPortraits } from '../../api/persona.portrait.queries';
import { useCurrentSlot, useSchedule } from '../../api/schedule.queries';
import { SUMMARY_HOURS, useScriptSummary } from '../../api/scripts.queries';
import { useVoices } from '../../api/voices.queries';
import { useVoicePreview } from '../voices/voice.preview';
import { EmptyState } from '../shared/empty.state';
import { Eyebrow } from '../shared/eyebrow';
import { notifyDone } from '../shared/notify';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { usePhone } from '../shared/use.phone';
import { PersonaCard } from './persona.card';
import { PersonaDeleteModal } from './persona.delete.modal';
import { PersonaEditor } from './persona.editor';
import { hasKind, kindOf, type PersonaKind } from './persona.kind';
import { PersonaImportModal } from './persona.import';
import { PresentingBanner } from './presenting.banner';

/**
 * Who the station is when it opens its mouth.
 *
 * One persona is on air at a time, and putting one there changes four things at once: what the
 * model is told to sound like, what the station says when the model declines, which voice speaks it,
 * and what it programmes towards. That is the reason this is a page rather than four settings — a
 * character is one decision.
 *
 * A change is heard on the NEXT break rather than immediately, and the page says so. Breaks are
 * written a little ahead of their slot, so whatever is already rendered airs in the character it
 * was written in; nothing here can reach into audio that already exists.
 */
export function PersonasPage() {
    const phone = usePhone();
    const { t } = useTranslation('personas');
    const personas = usePersonas();
    const create = useCreatePersona();
    const update = useUpdatePersona();
    const remove = useDeletePersona();
    const setStationHost = useSetStationHost();
    const restore = useRestorePersonas();
    const rehearse = useRehearsePersona();
    // What the keys on these cards actually sound like, and one player shared by all of them.
    const voices = useVoices(true);
    const preview = useVoicePreview();
    // How each of them is doing on air. One call for the whole roster, since the question is asked
    // about a list and a card each would open this page with nineteen requests.
    const summary = useScriptSummary();
    // One listing for every card's avatar, rather than a request per card.
    const portraits = usePersonaPortraits();
    // Who the schedule hands the air to next: the current-slot read says which block follows, and
    // only the slot list knows who hosts it.
    const now = useCurrentSlot();
    const schedule = useSchedule();

    // `undefined` is closed; a persona is editing that one; `null` is a new one. The one place in
    // this app where null earns its keep: "no editor" and "an editor with nothing in it" are
    // genuinely different states.
    const [editing, setEditing] = useState<Persona | null | undefined>(undefined);
    // Which of the two New buttons was pressed. Only read while `editing` is null: an existing
    // character carries its own kind, and this is the answer for one that has no row yet.
    const [writing, setWriting] = useState<PersonaKind>('host');
    // Which character's notebook is open, or none. One at a time, because the panel fetches per
    // persona and a page of nineteen open notebooks is nineteen requests nobody asked for.
    const [notebook, setNotebook] = useState<string | undefined>(undefined);
    // Its own toggle rather than a second tab inside the notebook's, because they are two different
    // questions about a character: what it has picked up from its own broadcasts, and what happened
    // to it before any of them. One open panel each, for the reason the notebook has one.
    const [shelf, setShelf] = useState<string | undefined>(undefined);
    // And a third, for the same reason again: what this character has actually TOLD, which is the
    // only one of the three that is a record rather than a store, and the one an operator opens to
    // undo something.
    const [memory, setMemory] = useState<string | undefined>(undefined);
    // A fourth, for how its breaks are doing by the checks and by the operator.
    const [performance, setPerformance] = useState<string | undefined>(undefined);
    // Which character a delete is being asked about. Holding the persona rather than its id, so the
    // dialog can name what it is about to take without looking it back up.
    const [deleting, setDeleting] = useState<Persona | undefined>(undefined);
    // A sieve over a list already in hand, so it is state rather than a search param and there is
    // nothing to debounce: no request rides it, and a URL naming a filter over a client-side list
    // would be a link to somebody else's half-typed word.
    const [filter, setFilter] = useState('');
    // Which part of the roster is in view. The same reasoning as the box: a sieve over a list in hand.
    const [only, setOnly] = useState<Only>('all');
    // A download is not state this app holds, so there is no query and no mutation behind it — only
    // whether one is in flight, and what went wrong if it did. Keyed by persona id, with the roster
    // export under `ROSTER`, so a failure lands on the card that asked for it rather than at the top
    // of a list of fourteen. See `CardFailure` in `persona.card.tsx`.
    // Its own dialog rather than a drop zone on the page, because taking a file in is three steps —
    // choose, read what it would do, do it — and none of them belongs beside a roster.
    const [importing, setImporting] = useState(false);
    const [exporting, setExporting] = useState<string | undefined>(undefined);
    const [exportFailure, setExportFailure] = useState<{ of: string; error: unknown } | undefined>(undefined);

    const save = async (id?: string): Promise<boolean> => {
        const of = id ?? ROSTER;
        setExporting(of);
        setExportFailure(undefined);
        try {
            await exportPersonas(id);
            return true;
        } catch (error) {
            setExportFailure({ of, error });
            return false;
        } finally {
            setExporting(undefined);
        }
    };

    // The roster export's progress, as a notification: the item that asked for it has closed with its
    // menu by the time the file is ready. Success replaces the spinner with a sentence; a failure
    // takes it away and leaves the reason in the page-level alert, which is where failures stay.
    const saveRoster = async () => {
        const id = notifications.show({ message: t('page.exporting'), loading: true, autoClose: false, withCloseButton: false, withBorder: true });
        const saved = await save();
        notifications.hide(id);
        if (saved) notifyDone(t('page.exported'));
    };

    const close = () => {
        setEditing(undefined);
        create.reset();
        update.reset();
    };

    const closeDelete = () => {
        setDeleting(undefined);
        remove.reset();
    };

    const submit = (draft: PersonaInput) => {
        const done = { onSuccess: close };
        if (editing === null) create.mutate(draft, done);
        else if (editing !== undefined) update.mutate({ id: editing.id, body: draft }, done);
    };

    const all = personas.data?.personas ?? [];
    const rows = summary.data?.rows;
    const shown = matching(ordered(all), filter).filter(persona => inView(persona, only, rows));
    const nextHost = nextHostId(now.data, schedule.data?.slots);
    // In roster order, one group per heading, so each heading sits over a grid of its own.
    const groups = grouped(shown);

    return (
        <Stack gap="lg">
            <PageHeader
                title={t('page.title')}
                description={
                    <Text c="dimmed" size="sm">
                        {t('page.description')}
                    </Text>
                }
                actions={
                    <>
                        {/* Export all, Import and Restore built-ins behind one control: they are
                            about the roster as a file, and an operator comes to this page for a
                            character, so three equal buttons beside New host were weight in the wrong
                            place. A menu item cannot spin, so the trigger carries the pending state
                            (as a card's own menu does for Delete) and the export reports itself as a
                            notification. */}
                        <Menu position="bottom-end" withinPortal>
                            <Menu.Target>
                                {/* Icon-only on a phone: at 375px the word pushed New host off the
                                    right edge of the row. */}
                                {phone ? (
                                    <ActionIcon
                                        variant="default"
                                        size="input-sm"
                                        loading={exporting === ROSTER || restore.isPending}
                                        aria-label={t('page.more.label')}
                                    >
                                        <IconDots size={16} />
                                    </ActionIcon>
                                ) : (
                                    <Button
                                        variant="default"
                                        leftSection={<IconDots size={16} />}
                                        loading={exporting === ROSTER || restore.isPending}
                                        aria-label={t('page.more.label')}
                                    >
                                        {t('page.more.button')}
                                    </Button>
                                )}
                            </Menu.Target>
                            <Menu.Dropdown>
                                {/* The whole roster as one file: a backup an operator can keep, and the
                                    shape somebody else's station can read. It carries no id and nothing
                                    about who is on air, so nothing about this station travels with it. */}
                                <Menu.Item
                                    disabled={all.length === 0 || exporting === ROSTER}
                                    onClick={() => {
                                        void saveRoster();
                                    }}
                                >
                                    {t('page.exportAll')}
                                </Menu.Item>
                                {/* The other half of Export, and the reason either exists: a character in
                                    a file is the thing somebody would actually send somebody else. */}
                                <Menu.Item onClick={() => setImporting(true)}>{t('page.import')}</Menu.Item>
                                {/* Safe to press twice: it writes only what is missing, overwrites
                                    nothing an operator has rewritten, and puts nothing on air. That is
                                    what keeps it a plain item rather than something behind a
                                    confirmation. */}
                                <Menu.Item
                                    disabled={restore.isPending}
                                    onClick={() => restore.mutate(undefined, { onSuccess: () => notifyDone(t('page.restored')) })}
                                >
                                    {t('page.restore')}
                                </Menu.Item>
                            </Menu.Dropdown>
                        </Menu>
                        {/* What a character is FOR is chosen before the form rather than in it,
                            because it is not a property somebody edits afterwards: a host presents,
                            a caller rings in, a guest drops by and a newsreader reads the news. The
                            three that never present share one menu, so the row stays a row on a
                            narrow desk; New host stays a button of its own, as the ordinary case. */}
                        <Menu position="bottom-end" withinPortal>
                            <Menu.Target>
                                <Button variant="default">{t('page.newOther')}</Button>
                            </Menu.Target>
                            <Menu.Dropdown>
                                <Menu.Item
                                    onClick={() => {
                                        setWriting('caller');
                                        setEditing(null);
                                    }}
                                >
                                    {t('page.newCaller')}
                                </Menu.Item>
                                <Menu.Item
                                    onClick={() => {
                                        setWriting('guest');
                                        setEditing(null);
                                    }}
                                >
                                    {t('page.newGuest')}
                                </Menu.Item>
                                {/* Only while the station has none: it reads the news in one voice,
                                    and the database refuses a second. */}
                                {all.some(persona => hasKind(persona, 'newsreader')) ? undefined : (
                                    <Menu.Item
                                        onClick={() => {
                                            setWriting('newsreader');
                                            setEditing(null);
                                        }}
                                    >
                                        {t('page.newNewsreader')}
                                    </Menu.Item>
                                )}
                            </Menu.Dropdown>
                        </Menu>
                        <Button
                            onClick={() => {
                                setWriting('host');
                                setEditing(null);
                            }}
                        >
                            {t('page.newHost')}
                        </Button>
                    </>
                }
            />

            {personas.error ? (
                <ErrorAlert title={t('page.loadError.title')} error={personas.error} fallback={t('page.loadError.fallback')} />
            ) : undefined}

            {/* Who is speaking now, in every state, and the two settings that reach every host
                (the presenter name and the story wait), which open from it rather than taking
                a card each above the roster. */}
            {personas.data === undefined ? undefined : <PresentingBanner roster={all} />}

            {/* The one failure that stays page-level, because the button that asks for it is up
                here and it is about the list rather than about any row in it. Putting one on air,
                rehearsing one and deleting one all report on the card that asked. */}
            {restore.error ? (
                <ErrorAlert title={t('page.restoreError.title')} error={restore.error} fallback={t('page.restoreError.fallback')} />
            ) : undefined}

            {/* Page-level for the same reason, and only for the ROSTER export: the button that asked
                is up here. A single character's failure lands on its own card. */}
            {exportFailure?.of === ROSTER ? (
                <ErrorAlert title={t('page.exportError.title')} error={exportFailure.error} fallback={t('page.exportError.fallback')} />
            ) : undefined}

            {personas.isPending ? (
                <Stack gap="sm">
                    <PageSkeleton variant="card" />
                    <PageSkeleton variant="card" />
                </Stack>
            ) : undefined}

            {personas.data?.personas.length === 0 ? <EmptyState>{t('page.empty')}</EmptyState> : undefined}

            {all.length > 0 ? (
                <Group gap="sm" justify="space-between" align="center">
                    {/* Which part of the roster to look at. Hosts and callers-and-guests by what a
                        character may be cast as, so a host who also drops by is in both; and the
                        ones that spoke in the last day, which is the question during a show. */}
                    <Chip.Group value={only} onChange={value => setOnly(value as Only)}>
                        <Group gap="xs">
                            {ONLY.map(value => (
                                <Chip key={value} value={value} size="sm" variant="light">
                                    {value === 'spoke' ? t('page.only.spoke', { count: SUMMARY_HOURS }) : t(`page.only.${value}`)}
                                </Chip>
                            ))}
                        </Group>
                    </Chip.Group>
                    {/* Only once the roster is long enough to be worth sieving. A search box over six
                        cards is a control that costs more attention than it saves. */}
                    {all.length > FILTER_FROM ? (
                        <TextInput
                            value={filter}
                            onChange={event => setFilter(event.currentTarget.value)}
                            placeholder={t('page.filter.placeholder')}
                            aria-label={t('page.filter.placeholder')}
                            w={280}
                            maw="100%"
                            rightSection={
                                filter.length > 0 ? (
                                    <CloseButton size="sm" onClick={() => setFilter('')} aria-label={t('page.filter.clear')} />
                                ) : undefined
                            }
                        />
                    ) : undefined}
                </Group>
            ) : undefined}

            {all.length > 0 && shown.length === 0 ? <EmptyState>{t('page.noMatch')}</EmptyState> : undefined}

            {groups.map(([kind, members]) => (
                <Stack key={kind} gap="xs">
                    {/* A heading over each kind rather than one undivided grid: who the station IS
                        and who it might put on the phone are different questions. The roster is
                        already ordered hosts-then-callers, so a filter that matches only callers
                        correctly draws only that heading. */}
                    <Eyebrow>{t(HEADINGS[kind])}</Eyebrow>
                    <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }} spacing="sm" verticalSpacing="sm">
                        {members.map(persona => {
                            const portrait = portraits.data?.portraits.find(row => row.personaId === persona.id)?.url;
                            return (
                                <PersonaCard
                                    key={persona.id}
                                    persona={persona}
                                    all={all}
                                    voices={voices}
                                    preview={preview}
                                    summary={summary}
                                    setStationHost={setStationHost}
                                    rehearse={rehearse}
                                    remove={remove}
                                    notebook={notebook}
                                    setNotebook={setNotebook}
                                    shelf={shelf}
                                    setShelf={setShelf}
                                    memory={memory}
                                    setMemory={setMemory}
                                    performance={performance}
                                    setPerformance={setPerformance}
                                    exporting={exporting}
                                    exportFailure={exportFailure}
                                    save={save}
                                    onEdit={setEditing}
                                    onDelete={setDeleting}
                                    next={persona.id === nextHost}
                                    {...(portrait === undefined ? {} : { portraitUrl: portrait })}
                                />
                            );
                        })}
                    </SimpleGrid>
                </Stack>
            ))}

            <PersonaEditor
                // Keyed, so opening a different persona builds a fresh form rather than showing the
                // last one's values under the new one's title.
                key={editing === null ? `new-${writing}` : (editing?.id ?? 'closed')}
                {...(editing === null || editing === undefined ? {} : { persona: editing })}
                kind={editing ? kindOf(editing) : writing}
                opened={editing !== undefined}
                onClose={close}
                onSubmit={submit}
                saving={create.isPending || update.isPending}
                error={create.error ?? update.error ?? undefined}
            />

            <PersonaImportModal opened={importing} onClose={() => setImporting(false)} />

            <PersonaDeleteModal
                {...(deleting === undefined ? {} : { persona: deleting })}
                opened={deleting !== undefined}
                onClose={closeDelete}
                // Closed only once it worked: a delete that failed leaves the dialog up holding the
                // reason, where a dialog that closed anyway would report a loss that did not happen.
                onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: closeDelete })}
                deleting={remove.isPending}
                error={remove.error ?? undefined}
            />
        </Stack>
    );
}

/** Below this many characters, a filter box is a control that costs more attention than it saves. */
const FILTER_FROM = 6;

/**
 * What the roster export is keyed as, so one piece of state covers both buttons.
 *
 * A sentinel rather than a second pair of state variables, and it cannot collide with a persona id:
 * those are uuids, and this is not one.
 */
const ROSTER = 'roster';

/**
 * The roster, with whoever the station falls back to at the top.
 *
 * Server order otherwise, and a stable sort, because the order personas were written in is the only
 * other thing an operator has to find one by. The station's own host being fourteen cards down was
 * the list saying nothing about which card matters.
 */
function ordered(personas: Persona[]): Persona[] {
    return [...personas].sort(
        // Hosts first, then callers, and the station's own host at the top of the hosts. Two halves
        // rather than one roster because they answer different questions — who the station IS, and
        // who it might put on the phone — and mixing them alphabetically buries both.
        // Whoever is actually speaking goes above the station's own host, on the same argument:
        // the card an operator is looking for during a show is the character they can hear.
        (left, right) =>
            rank(kindOf(left)) - rank(kindOf(right)) ||
            Number(right.presenting) - Number(left.presenting) ||
            Number(right.coHosting ?? false) - Number(left.coHosting ?? false) ||
            Number(right.defaultHost) - Number(left.defaultHost),
    );
}

/** Hosts, then the newsreader, then callers, then guests. */
const rank = (kind: PersonaKind): number => ({ host: 0, newsreader: 1, caller: 2, guest: 3 })[kind];

/** The heading over each half of the roster. */
const HEADINGS = {
    host: 'page.heading.hosts',
    newsreader: 'page.heading.newsreader',
    caller: 'page.heading.callers',
    guest: 'page.heading.guests',
} as const;

/** The parts of the roster the chips choose between. */
const ONLY = ['all', 'hosts', 'others', 'spoke'] as const;
type Only = (typeof ONLY)[number];

/**
 * Whether a character is in the part of the roster the chips chose. "Spoke" is anything written in
 * the summary's window, which is the same day the card's own record counts.
 */
function inView(persona: Persona, only: Only, rows: ScriptHistorySummaryRow[] | undefined): boolean {
    switch (only) {
        case 'all':
            return true;
        case 'hosts':
            return hasKind(persona, 'host');
        case 'others':
            return hasKind(persona, 'caller') || hasKind(persona, 'guest');
        case 'spoke':
            return (rows?.find(row => row.personaKey === persona.key)?.written ?? 0) > 0;
    }
}

/** The shown roster cut at each change of heading, in order. */
function grouped(personas: Persona[]): [PersonaKind, Persona[]][] {
    const groups: [PersonaKind, Persona[]][] = [];
    for (const persona of personas) {
        const kind = kindOf(persona);
        const last = groups.at(-1);
        if (last?.[0] === kind) last[1].push(persona);
        else groups.push([kind, [persona]]);
    }
    return groups;
}

/**
 * Who hosts the next block on the schedule, or nothing when it names nobody of its own.
 *
 * `upcoming` starts with the block on now when there is one, so "next" is the first block that has
 * not started yet. Both readings are the station's own zone-naive `YYYY-MM-DD HH:mm:ss`, so comparing
 * them as strings is comparing them as times. A block without a host of its own is the station's own
 * host, which the roster already badges, so it earns no "Next".
 */
export function nextHostId(now: ScheduleNow | undefined, slots: ScheduleSlot[] | undefined): string | undefined {
    if (now === undefined || slots === undefined) return undefined;
    const following = now.upcoming.find(block => block.start > now.now);
    if (following === undefined) return undefined;
    return slots.find(slot => slot.id === following.slotId)?.personaId;
}

/** Everything a character can be looked up by: what it is called, what it is, and who it says it is. */
function matching(personas: Persona[], filter: string): Persona[] {
    const term = filter.trim().toLowerCase();
    if (term.length === 0) return personas;

    return personas.filter(persona =>
        [persona.label, persona.key, persona.style, persona.djName ?? ''].some(field => field.toLowerCase().includes(term)),
    );
}
