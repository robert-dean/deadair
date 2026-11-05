import { Code, Divider, Stack, Text } from '@mantine/core';
import type { SelectProps } from '@mantine/core';
import type { Persona, PersonaDraftView, PersonaInput } from '@deadair/sdk';
import type { TFunction } from 'i18next';
import { Trans, useTranslation } from 'react-i18next';

import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { kindsOf, type PersonaKind } from './persona.kind';
import { quirkRowsOf, quirksOf, type QuirkRow } from './persona.quirks.field';
import { faultInTemplate, templateLines, type TemplateFault } from './template.vocabulary';

/**
 * The station's own placeholders as the phrasings field's help shows them.
 *
 * Handed in as values rather than written into the catalog, because `{{…}}` there is i18next's own
 * syntax and would be read as a variable. They are the station's vocabulary, not English, so no
 * translation should touch them.
 */
export const TEMPLATE_EXAMPLES = {
    previousTitle: '{{previous.title}}',
    previousArtist: '{{previous.artist}}',
    nextTitle: '{{next.title}}',
    nextArtist: '{{next.artist}}',
};

/**
 * What every dial in "How far they go" has in common.
 *
 * The caveat goes UNDER the control rather than above it. Four of these sit in a grid and their
 * caveats run to three, seven, five and eight lines, so with the description in its usual place the
 * four dropdowns landed at four different heights and the row read as broken rather than as four
 * answers to one question. Moving it below puts every control directly under a one-line label, which
 * lines them up — and it reads better anyway: the question, the answer, then what the answer costs.
 */
export const DIAL = {
    // Mantine types this one mutable, so `as const` on the object makes the tuple unassignable.
    inputWrapperOrder: ['label', 'input', 'description', 'error'] as SelectProps['inputWrapperOrder'],
    allowDeselect: false,
} as const;

/**
 * What the two voice settings come to together.
 *
 * They are two fields because they are two kinds of thing — brevity is a habit and latitude is a
 * permission — and they compose, so neither control can describe the result on its own. An operator
 * who has asked for a terse character with no filter should be able to read that back rather than
 * work it out from two dropdowns.
 *
 * It describes the SHAPE and never a word count. The ceilings live in `break.prompt.ts` and move
 * with what gets measured on air, and a number repeated here would be a second claim about them that
 * nothing keeps true.
 */
export function voiceReadout(
    brevity: string,
    latitude: string,
    storytelling: string,
    chattiness: string,
    trivia: string,
    t: TFunction<'personas'>,
): string {
    const length =
        brevity === 'one-line'
            ? t('editor.readout.length.oneLine')
            : brevity === 'short'
              ? t('editor.readout.length.short')
              : latitude === '' && trivia !== 'keen'
                ? t('editor.readout.length.usual')
                : t('editor.readout.length.long');

    const manner =
        latitude === 'unleashed'
            ? t('editor.readout.manner.unleashed')
            : latitude === 'loose'
              ? t('editor.readout.manner.loose')
              : t('editor.readout.manner.usual');

    // The third field is about MATERIAL rather than manner, so it is a sentence of its own rather
    // than another clause: what it changes is whether there is anything of the character's own life
    // in the prompt, which is a different question from how the character talks.
    const stories =
        storytelling === 'never'
            ? t('editor.readout.stories.never')
            : storytelling === 'often'
              ? t('editor.readout.stories.often')
              : t('editor.readout.stories.occasionally');

    // Material again, but the station's rather than the character's own: what it knows about the
    // records. A sentence of its own for the stories' reason.
    const lore =
        trivia === 'keen'
            ? t('editor.readout.lore')
            : trivia === 'always'
              ? t('editor.readout.loreAlways')
              : trivia === 'sometimes'
                ? t('editor.readout.loreSometimes')
                : trivia === 'never'
                  ? t('editor.readout.loreNever')
                  : '';

    // Frequency is the one of the four that is not about a break at all — it is about how many
    // there are — so it leads with "and" rather than joining the sentence about how one sounds.
    const often =
        chattiness === '' || chattiness === 'ordinary'
            ? ''
            : chattiness === 'relentless'
              ? t('editor.readout.often.relentless')
              : chattiness === 'chatty'
                ? t('editor.readout.often.chatty')
                : chattiness === 'sparing'
                  ? t('editor.readout.often.sparing')
                  : t('editor.readout.often.reserved');

    return t('editor.readout.sentence', { manner, length, lore, stories, often });
}

/**
 * What the station had to drop out of what the model wrote.
 *
 * Shown rather than quietly applied, because both of these are things an operator would otherwise
 * discover by putting the persona on air: a marker nothing says declines every break, and a phrasing
 * naming a value that does not exist is never picked. Neither looks like a fault from the outside —
 * they look like a model that is switched off and a phrasing the station never happens to choose.
 */
export function GenerationNotes({ generated }: { generated: { droppedMarkers: string[]; droppedTemplates: string[] } }) {
    const { t } = useTranslation('personas');
    if (generated.droppedMarkers.length === 0 && generated.droppedTemplates.length === 0) return undefined;

    return (
        <ErrorAlert tone="warning" title={t('editor.dropped.title')}>
            <Stack gap="xxs">
                {generated.droppedMarkers.length === 0 ? undefined : (
                    <Text size="sm">{t('editor.dropped.markers', { markers: generated.droppedMarkers.join(', ') })}</Text>
                )}
                {generated.droppedTemplates.length === 0 ? undefined : (
                    <Text size="sm">{t('editor.dropped.templates', { count: generated.droppedTemplates.length })}</Text>
                )}
            </Stack>
        </ErrorAlert>
    );
}

/**
 * One heading, so fourteen boxes read as four questions.
 *
 * The blurb is what turns a divider into a question. "How far they go" over four dropdowns is a
 * label; the sentence under it is the thing an operator needs before touching any of them, and it
 * was previously spread across four separate field descriptions that nobody reads in order.
 *
 * **It used to say each dial only ever asks for LESS than the station's own setting, and that stopped
 * being true.** `chattiness` asks for MORE breaks at two of its five rungs, and `latitude` was
 * already asking for more room at both of its. What was actually load-bearing in that sentence is
 * its second half — that none of these loosens a refusal — so that is what it says now, and the
 * direction claim is gone rather than qualified. A blurb that is true of three fields out of four is
 * worse than none: it is the one line an operator reads before deciding they understand the section.
 */
export function Section({ title, blurb }: { title: string; blurb: string }) {
    return (
        <Stack gap={2} mt="xs">
            <Divider mb={2} label={<Eyebrow>{title}</Eyebrow>} labelPosition="left" />
            <Text size="xs" c="dimmed">
                {blurb}
            </Text>
        </Stack>
    );
}

/** A template fault in the operator's words. `template.vocabulary.ts` only names the kind. */
function faultWords(t: TFunction<'personas'>, fault: TemplateFault): string {
    switch (fault.kind) {
        case 'unknown':
            return t('template.unknown', { placeholders: fault.placeholders.map(name => `{{${name}}}`).join(', ') });
        case 'strayBracket':
            return t('template.strayBracket');
        case 'noPlaceholder':
            return t('template.noPlaceholder');
    }
}

/**
 * What the station could not use in the phrasings box, line by line.
 *
 * Advisory and never blocking, deliberately: the API accepts any text, the vocabulary this is
 * checked against is a copy, and a console that refused a save over its own copy would stop working
 * the day the station learns a new placeholder. What it replaces is finding out by watching a
 * character for an evening and wondering why one of its six lines never comes up.
 *
 * The same three checks the generator already makes about a line a MODEL wrote, which is the point:
 * a line an operator typed was the only one nothing looked at.
 */
export function TemplateFaults({ raw }: { raw: string }) {
    const { t } = useTranslation('personas');
    const faults = templateLines(raw)
        .map(line => ({ line, fault: faultInTemplate(line) }))
        .filter((entry): entry is { line: string; fault: TemplateFault } => entry.fault !== undefined)
        .map(({ line, fault }) => ({ line, fault: faultWords(t, fault) }));

    if (faults.length === 0) return undefined;

    return (
        <ErrorAlert tone="warning" title={t('editor.faults.title', { count: faults.length })}>
            <Stack gap="xxs">
                {faults.map(({ line, fault }) => (
                    <Text key={line} size="sm">
                        {/* The line goes in as the element's own children rather than as a value, so
                            whatever an operator typed (a stray `<` included) is never parsed as markup. */}
                        <Trans
                            t={t}
                            i18nKey="editor.faults.line"
                            values={{ fault }}
                            components={{ code: <Code>{line.length > 80 ? `${line.slice(0, 80)}…` : line}</Code> }}
                        />
                    </Text>
                ))}
            </Stack>
        </ErrorAlert>
    );
}

/**
 * Markers the character is never shown saying, which is a weaker claim than a fault.
 *
 * A marker is what `readAnswer` counts to decide a script is in character, and the sample lines are
 * the model's evidence for how to use one — so a marker appearing in none of them is asking a model
 * to produce a word it has only been told about. It is a note rather than a warning because it is
 * frequently fine: an obvious word needs no example, and a sheet with no samples at all is making no
 * claim either way, which is why nothing is said then.
 */
export function UnusedMarkers({ markers, samples }: { markers: string; samples: string }) {
    const { t } = useTranslation('personas');
    const written = samples.trim().toLowerCase();
    if (written.length === 0) return undefined;

    const unused = markers
        .split('\n')
        .map(line => line.trim())
        .filter(marker => marker.length > 0)
        // Plain substring, which is what a marker ending in an apostrophe wants anyway: the
        // station's own check reads `in'` as a suffix, so finding it inside `talkin'` is a match
        // there and here alike.
        .filter(marker => !written.includes(marker.toLowerCase()));

    if (unused.length === 0) return undefined;

    return (
        <Text size="xs" c="dimmed">
            {t('editor.unusedMarkers', { markers: unused.join(', ') })}
        </Text>
    );
}

/**
 * The form's own shape: every list field is one string, one entry per line.
 *
 * Except `hosts`, which is ids picked from a list rather than lines anybody types, so it is held as
 * the array it is sent as.
 */
export interface FormValues {
    kinds: PersonaKind[];
    key: string;
    label: string;
    style: string;
    djName: string;
    voice: string;
    soundboard: string;
    background: string;
    brevity: string;
    latitude: string;
    chattiness: string;
    storytelling: string;
    growth: string;
    trivia: string;
    templates: string;
    diction: string;
    dictionMarkers: string;
    quirks: QuirkRow[];
    preoccupations: string;
    catchphrases: string;
    avoid: string;
    exclusiveSubjects: string;
    samples: string;
    sheetLanguage: string;
    hosts: string[];
}

/**
 * The validated fields, in the order the sheet draws them.
 *
 * Not derived from the `validate` object: that is keyed in the order the rules happened to be
 * written, and a save that faults on two of them should land on whichever the operator meets first.
 */
export const VALIDATED = ['label', 'key', 'kinds', 'style'] as const;

const linesOf = (values: string[] | undefined): string => (values ?? []).join('\n');

/** What the modal is called: which kind is being written, or which character is being edited. */
export const titleFor = (persona: Persona | undefined, kind: PersonaKind, t: TFunction<'personas'>): string =>
    persona !== undefined
        ? t('editor.title.edit', { label: persona.label })
        : kind === 'caller'
          ? t('editor.title.newCaller')
          : kind === 'guest'
            ? t('editor.title.newGuest')
            : kind === 'newsreader'
              ? t('editor.title.newNewsreader')
              : t('editor.title.newHost');

/**
 * A saved persona or a generated draft, as the form's values.
 *
 * Takes the DRAFT shape rather than `Persona`, since a saved one is that plus `id` and `active` and
 * this reads neither. That is what lets one function serve opening an existing persona and dropping
 * a generated one into the same fields.
 */
export function valuesOf(persona: PersonaDraftView | Persona | undefined, kind: PersonaKind): FormValues {
    return {
        // An `in` check, as `growth` is below: a generated draft says nothing of what a character does,
        // which is the operator's call, so a new one starts as the button they pressed.
        kinds: persona !== undefined && 'id' in persona ? kindsOf(persona) : [kind],
        key: persona?.key ?? '',
        label: persona?.label ?? '',
        style: persona?.style ?? '',
        djName: persona?.djName ?? '',
        voice: persona?.voice ?? '',
        soundboard: persona?.soundboard ?? '',
        background: persona?.background ?? '',
        brevity: persona?.brevity ?? '',
        latitude: persona?.latitude ?? '',
        chattiness: persona?.chattiness ?? '',
        storytelling: persona?.storytelling ?? '',
        // An `in` check rather than an optional read, because a GENERATED sheet genuinely has no
        // such field: a model writing a character must not be able to grant it autonomy, so the
        // field is absent from `PersonaDraftView` by design. See `growthOf`.
        growth: persona !== undefined && 'growth' in persona ? (persona.growth ?? '') : '',
        trivia: persona?.trivia ?? '',
        templates: persona?.templates ?? '',
        diction: linesOf(persona?.diction),
        dictionMarkers: linesOf(persona?.dictionMarkers),
        quirks: quirkRowsOf(persona?.quirks),
        preoccupations: linesOf(persona?.preoccupations),
        catchphrases: linesOf(persona?.catchphrases),
        avoid: linesOf(persona?.avoid),
        exclusiveSubjects: linesOf(persona?.exclusiveSubjects),
        samples: linesOf(persona?.samples),
        sheetLanguage: persona?.sheetLanguage ?? '',
        // An `in` check, as `growth` is: a generated draft carries no ties, which are this station's
        // own ids and nothing a model could know.
        hosts: persona !== undefined && 'hosts' in persona ? [...(persona.hosts ?? [])] : [],
    };
}

/**
 * The form as the API takes it.
 *
 * An empty field is left OUT rather than sent as an empty string, which is what makes "clear the
 * on-air name" mean "fall back to the station's" rather than "the presenter is called nothing".
 */
export function draftOf(values: FormValues): PersonaInput {
    const list = (raw: string): string[] | undefined => {
        const lines = raw
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        return lines.length === 0 ? undefined : lines;
    };
    const text = (raw: string): string | undefined => (raw.trim().length === 0 ? undefined : raw.trim());
    // Annotated and lifted out of the literal below, because inside it the narrowed union widens
    // back to `string` on its way through `omitUndefined`'s inference.
    const brevity: PersonaInput['brevity'] = values.brevity === 'short' || values.brevity === 'one-line' ? values.brevity : undefined;
    const latitude: PersonaInput['latitude'] = values.latitude === 'loose' || values.latitude === 'unleashed' ? values.latitude : undefined;
    const storytelling: PersonaInput['storytelling'] =
        values.storytelling === 'never' || values.storytelling === 'often' ? values.storytelling : undefined;
    // '' is `proposes`, which is the cautious rung and the one every character has until somebody
    // opts it out — so absent is the right shape for it, as with the rungs above.
    const growth: PersonaInput['growth'] = values.growth === 'self-directed' ? values.growth : undefined;
    // '' is the station's ordinary break, which is a rung that is not there, as with latitude.
    const trivia: PersonaInput['trivia'] =
        values.trivia === 'keen' || values.trivia === 'never' || values.trivia === 'always' || values.trivia === 'sometimes'
            ? values.trivia
            : undefined;
    // `ordinary` is the default and is sent as absent, matching how every other rung on this form
    // treats its middle: a stored value that means "unchanged" is a row saying what a null already says.
    const chattiness: PersonaInput['chattiness'] =
        values.chattiness === 'reserved' || values.chattiness === 'sparing' || values.chattiness === 'chatty' || values.chattiness === 'relentless'
            ? values.chattiness
            : undefined;

    return {
        key: values.key.trim(),
        kinds: values.kinds,
        label: values.label.trim(),
        style: values.style.trim(),
        ...omitUndefined({
            djName: text(values.djName),
            voice: text(values.voice),
            soundboard: text(values.soundboard),
            background: text(values.background),
            // '' is the station's usual length, which is an ABSENT field rather than a rung — the
            // same rule the on-air name follows.
            brevity,
            // Same rule: '' is the station's ordinary discipline, which is a field that is not there
            // rather than a rung meaning "no extra room".
            latitude,
            trivia,
            growth,
            // And again, with one difference worth knowing: the absent value here is the MIDDLE
            // rung rather than the bottom one. `occasionally` is what a character with nothing set
            // does, so it is the one option in the select with no value behind it — a persona that
            // never mentions its own past is a decision and is stored as `never`.
            chattiness,
            storytelling,
            // Not trimmed per line: the phrasings are parsed by the API the same way the station's
            // own setting is, and a blank line between two of them is somebody spacing their list.
            templates: text(values.templates),
            diction: list(values.diction),
            dictionMarkers: list(values.dictionMarkers),
            quirks: quirksOf(values.quirks),
            preoccupations: list(values.preoccupations),
            catchphrases: list(values.catchphrases),
            avoid: list(values.avoid),
            exclusiveSubjects: list(values.exclusiveSubjects),
            samples: list(values.samples),
            // Empty is left out: a new character then takes the station's language, and an edit keeps
            // what the character had.
            sheetLanguage: text(values.sheetLanguage),
            // Only somebody who rings in or drops by is tied. Absent unties them, which is what the
            // API reads it as.
            hosts: (values.kinds.includes('caller') || values.kinds.includes('guest')) && values.hosts.length > 0 ? values.hosts : undefined,
        }),
    };
}

function omitUndefined<T extends Record<string, unknown>>(values: T): Partial<T> {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}
