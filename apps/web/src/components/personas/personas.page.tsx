import { Fragment, useState } from 'react';
import { Button, CloseButton, Menu, Stack, Text, TextInput } from '@mantine/core';
import type { Persona, PersonaInput } from '@deadair/sdk';
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
import { useScriptSummary } from '../../api/scripts.queries';
import { useVoices } from '../../api/voices.queries';
import { useVoicePreview } from '../voices/voice.preview';
import { EmptyState } from '../shared/empty.state';
import { Eyebrow } from '../shared/eyebrow';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { usePhone } from '../shared/use.phone';
import { PersonaCard } from './persona.card';
import { PersonaDeleteModal } from './persona.delete.modal';
import { PersonaEditor } from './persona.editor';
import { hasKind, kindOf, presents, type PersonaKind } from './persona.kind';
import { PersonaImportModal } from './persona.import';
import { PresenterNamePanel } from './presenter.name.panel';
import { StoryWaitPanel } from './story.wait.panel';
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
    // Which character a delete is being asked about. Holding the persona rather than its id, so the
    // dialog can name what it is about to take without looking it back up.
    const [deleting, setDeleting] = useState<Persona | undefined>(undefined);
    // A sieve over a list already in hand, so it is state rather than a search param and there is
    // nothing to debounce: no request rides it, and a URL naming a filter over a client-side list
    // would be a link to somebody else's half-typed word.
    const [filter, setFilter] = useState('');
    // A download is not state this app holds, so there is no query and no mutation behind it — only
    // whether one is in flight, and what went wrong if it did. Keyed by persona id, with the roster
    // export under `ROSTER`, so a failure lands on the card that asked for it rather than at the top
    // of a list of fourteen. See `CardFailure`.
    // Its own dialog rather than a drop zone on the page, because taking a file in is three steps —
    // choose, read what it would do, do it — and none of them belongs beside a roster.
    const [importing, setImporting] = useState(false);
    const [exporting, setExporting] = useState<string | undefined>(undefined);
    const [exportFailure, setExportFailure] = useState<{ of: string; error: unknown } | undefined>(undefined);

    const save = async (id?: string) => {
        const of = id ?? ROSTER;
        setExporting(of);
        setExportFailure(undefined);
        try {
            await exportPersonas(id);
        } catch (error) {
            setExportFailure({ of, error });
        } finally {
            setExporting(undefined);
        }
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
    const shown = matching(ordered(all), filter);

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
                        {/* The whole roster as one file: a backup an operator can keep, and the shape
                            somebody else's station can read. It carries no id and nothing about who
                            is on air, so nothing about this station travels with it. */}
                        <Button
                            variant="default"
                            loading={exporting === ROSTER}
                            disabled={all.length === 0}
                            onClick={() => {
                                void save();
                            }}
                        >
                            {t('page.exportAll')}
                        </Button>
                        {/* The other half of Export, and the reason either exists: a character in a
                            file is the thing somebody would actually send somebody else. */}
                        <Button variant="default" onClick={() => setImporting(true)}>
                            {t('page.import')}
                        </Button>
                        {/* Safe to press twice: it writes only what is missing, overwrites nothing an
                            operator has rewritten, and puts nothing on air. That is what keeps it a
                            plain button rather than something behind a confirmation. */}
                        <Button variant="default" loading={restore.isPending} onClick={() => restore.mutate(undefined)}>
                            {t('page.restore')}
                        </Button>
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

            {/* Draws itself only when the show on air named a host of its own, which is the one
                state where the "On air" badge below is not who is speaking. */}
            <PresentingBanner />

            {/* What an unnamed host is called. Above the roster rather than on the station card,
                because every host below with a name of its own overrides it. */}
            <PresenterNamePanel hosts={all.filter(presents)} />

            {/* How long a story in parts or a running joke rests between tellings. Beside the name
                for the same reason: it is about every character below, not about one of them. */}
            <StoryWaitPanel />

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

            {/* Only once the roster is long enough to be worth sieving. A search box over six cards
                is a control that costs more attention than it saves. */}
            {all.length > FILTER_FROM ? (
                <TextInput
                    value={filter}
                    onChange={event => setFilter(event.currentTarget.value)}
                    placeholder={t('page.filter.placeholder')}
                    aria-label={t('page.filter.placeholder')}
                    maw={360}
                    rightSection={
                        filter.length > 0 ? <CloseButton size="sm" onClick={() => setFilter('')} aria-label={t('page.filter.clear')} /> : undefined
                    }
                />
            ) : undefined}

            {all.length > 0 && shown.length === 0 ? <EmptyState>{t('page.noMatch')}</EmptyState> : undefined}

            <Stack gap="sm">
                {shown.map((persona, index) => (
                    <Fragment key={persona.id}>
                        {/* A heading at each changeover rather than two separate lists, which would
                            mean either duplicating this card or lifting ten pieces of state into a
                            component to share it. The roster is already ordered hosts-then-callers,
                            so one comparison with the card above is the whole of it — and a filter
                            that matches only callers correctly draws only that heading. */}
                        {index === 0 || kindOf(shown[index - 1]!) !== kindOf(persona) ? <Eyebrow>{t(HEADINGS[kindOf(persona)])}</Eyebrow> : undefined}
                        <PersonaCard
                            persona={persona}
                            all={all}
                            phone={phone}
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
                            exporting={exporting}
                            exportFailure={exportFailure}
                            save={save}
                            onEdit={setEditing}
                            onDelete={setDeleting}
                        />
                    </Fragment>
                ))}
            </Stack>

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

/** Everything a character can be looked up by: what it is called, what it is, and who it says it is. */
function matching(personas: Persona[], filter: string): Persona[] {
    const term = filter.trim().toLowerCase();
    if (term.length === 0) return personas;

    return personas.filter(persona =>
        [persona.label, persona.key, persona.style, persona.djName ?? ''].some(field => field.toLowerCase().includes(term)),
    );
}
