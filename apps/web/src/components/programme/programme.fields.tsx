import { Group, NumberInput, Select, Text, Textarea, Checkbox } from '@mantine/core';
import type { GetInputPropsReturnType } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';

import { chartsListOptions } from '../../api/charts.queries';
import { playlistsListOptions } from '../../api/playlists.queries';
import { usePersonas } from '../../api/personas.queries';

/**
 * What a broadcast IS, as one field set, wherever it is being described.
 *
 * ## A slot and a broadcast are the same declaration
 *
 * `ScheduleSlot` is `PutOnAirInput` plus a when-half and nothing else, which the slot editor has
 * said in a comment for as long as it has existed. So the source, the host, the brief, the period,
 * the shape and the phone were each written three times over — in the slot editor, in the desk's
 * own briefing box, and in the sustaining panel — in three different state idioms, with the era
 * pair byte-identical in all three and four paragraphs of prose duplicated between them. Three
 * copies of a form is three places for one wording to drift, and it had: the era inputs carried
 * visible labels in one and only `aria-label` in another.
 *
 * ## Fields rather than one switchable block
 *
 * Each caller shows a different subset — sustaining has no host and no shape, the desk has no
 * when-half and no source — so a single component taking six booleans would spend its type
 * signature describing which of its own fields exist. Composing named fields keeps every caller's
 * form its own, keeps Mantine's error wiring intact through {@link GetInputPropsReturnType}, and
 * still leaves exactly one copy of every label, option list and paragraph.
 *
 * The pair encoding is here for the same reason: a plugin and a playlist travel as one option value
 * because a picker holds one string, and that was encoded at four sites and decoded at three.
 */

/**
 * What a picker's one string can name.
 *
 * A discriminated union rather than a second optional field, because the two are alternatives all
 * the way down: `PutOnAirInput` takes a playlist pair or a chart id and refuses to make sense of
 * both, and a slot stores one or the other. A shape that could hold neither-or-both would push that
 * decision into every caller.
 */
export type ProgrammeSource = { kind: 'playlist'; pluginId: string; playlistId: string } | { kind: 'chart'; chartId: string };

/**
 * The tag every encoded value carries, and why it is there at all.
 *
 * The encoding used to be `pluginId playlistId` and nothing else, which was unambiguous while a
 * playlist was the only thing a source could be. It is not: a chart id is already qualified as
 * `plugin:chart`, so it holds no space and would decode as "not a source" — and a Last.fm `tag:`
 * chart can legitimately hold one, so it might decode as a playlist instead. Tagging BOTH arms is
 * what avoids that, and tagging both rather than only the new one is what keeps a plugin
 * legitimately called `chart` from colliding with the tag. It is the same first-versus-last
 * reasoning `chart.ids.ts` writes down on the API side.
 */
const SEPARATOR = ' ';

/** A plugin and one of its playlists as the single string a picker can hold. */
export const sourceValue = (pluginId: string, playlistId: string): string => `playlist${SEPARATOR}${pluginId}${SEPARATOR}${playlistId}`;

/** A qualified chart id as the same. */
export const chartSourceValue = (chartId: string): string => `chart${SEPARATOR}${chartId}`;

/**
 * A picker's value back out.
 *
 * `undefined` for anything that is not one — no tag, an unknown tag, or a missing half — because
 * the caller's next move is the same in every case: treat it as no source rather than guess what
 * was meant. That is the call `ScheduleRepository`'s row mapper already makes on the way out of the
 * database.
 */
export function splitSource(value: string | null | undefined): ProgrammeSource | undefined {
    const at = (value ?? '').indexOf(SEPARATOR);
    if (at <= 0) return undefined;

    const tag = value!.slice(0, at);
    const rest = value!.slice(at + SEPARATOR.length);
    if (rest.length === 0) return undefined;

    if (tag === 'chart') return { kind: 'chart', chartId: rest };
    if (tag !== 'playlist') return undefined;

    // At the FIRST separator rather than every one. A plugin id has no spaces, but a playlist id is
    // a provider's and nothing here can promise it has none either — and `split(' ')` would quietly
    // keep the first word of one and drop the rest, which is a source that reads back as a different
    // playlist rather than as an error.
    const split = rest.indexOf(SEPARATOR);
    if (split <= 0) return undefined;

    const playlistId = rest.slice(split + SEPARATOR.length);
    return playlistId ? { kind: 'playlist', pluginId: rest.slice(0, split), playlistId } : undefined;
}

/**
 * Where the records come from: one of the plugins' playlists, or a published chart.
 *
 * Choosing nothing is a real answer rather than an empty field — it is a broadcast the station
 * fills for itself, which is what a rotation with no source behind it is.
 *
 * ## Two groups in one picker rather than two pickers
 *
 * A playlist and a chart are alternatives, not settings that combine, and `PutOnAirInput` says so
 * by taking one or the other. Two controls would let an operator fill in both and leave the console
 * deciding which wins, which is a decision nobody asked it to make. The groups are what say the two
 * are different KINDS of thing while still being one choice.
 *
 * They differ in one way worth knowing before choosing: a playlist names copies the station can
 * already fetch, and a chart names records, so airing a chart has the station look each one up and
 * ingest it. A station with `rotation.discover` off can play almost none of one.
 */
export function SourceField({ description, ...input }: GetInputPropsReturnType & { description?: string }) {
    const playlists = useQuery(playlistsListOptions);
    const charts = useQuery(chartsListOptions);

    const playlistOptions = (playlists.data?.playlists ?? []).map(entry => ({
        value: sourceValue(entry.pluginId, entry.id),
        label: `${entry.name} — ${entry.pluginName}`,
    }));
    const chartOptions = (charts.data?.charts ?? []).map(entry => ({
        value: chartSourceValue(entry.id),
        label: `${entry.name} — ${entry.pluginId}`,
    }));

    // Groups only where there is something to group. A station with no chart plugin should see the
    // list it has always seen rather than a heading over it explaining an absence.
    const data =
        chartOptions.length === 0
            ? playlistOptions
            : [
                  { group: 'Playlists', items: playlistOptions },
                  { group: 'Charts', items: chartOptions },
              ];

    return (
        <Select
            label="Playing from"
            description={description ?? 'Leave it empty for a broadcast the station fills itself.'}
            data={data}
            searchable
            clearable
            clearButtonProps={{ 'aria-label': 'Play from no playlist or chart' }}
            nothingFoundMessage={playlists.isPending || charts.isPending ? 'Reading the plugins…' : 'Nothing on offer'}
            {...input}
        />
    );
}

/**
 * Which way round a chart is played, shown only once one is chosen.
 *
 * A countdown is the shape a chart show has on the radio, so it leads and it is what an unset slot
 * means. Meaningless for a playlist, which is why this is its own field rather than a row that sits
 * there greyed out under every other kind of source.
 */
export function ChartOrderField(input: GetInputPropsReturnType) {
    return (
        <Select
            label="Played"
            description="A countdown ends on number one, which is the shape a chart show has."
            data={[
                { value: 'countdown', label: 'Countdown, ending on number one' },
                { value: 'ranked', label: 'Number one first' },
                { value: 'unordered', label: 'No fixed order' },
            ]}
            allowDeselect={false}
            {...input}
        />
    );
}

/**
 * Who presents it.
 *
 * Bound for as long as the broadcast lasts, which is the point: without it the presenter drifts
 * back to the station's own halfway through a show somebody cast.
 */
export function HostField({ markOnAir = false, ...input }: GetInputPropsReturnType & { markOnAir?: boolean }) {
    const personas = usePersonas();
    const options = (personas.data?.personas ?? []).map(persona => ({
        value: persona.id,
        // Only where a broadcast is being started NOW, because "on air" is a fact about this moment
        // rather than about a slot that comes round on Tuesdays.
        label: markOnAir && persona.active ? `${persona.label} (on air)` : persona.label,
    }));

    return <Select label="Hosted by" description="Empty means whichever persona the station has on air." data={options} clearable {...input} />;
}

/** What it is asked to play, in the operator's own words. */
export function BriefField({ description, ...input }: GetInputPropsReturnType & { description?: string }) {
    return (
        <Textarea
            label="Asked to play"
            description={description ?? 'In your own words, for the model that chooses records. Leave it empty and the station plays its ordinary rotation. The host only presents.'}
            autosize
            minRows={2}
            maxLength={BRIEF_MAX}
            placeholder="warm and unhurried"
            {...input}
        />
    );
}

/**
 * The ceiling the contract puts on a brief, shared so the box cannot promise more than the API takes.
 *
 * The two used to differ — a slot allowed 2000 and `putOnAir` 500 — which is one box behaving
 * differently on two pages for no reason a person could see.
 */
export const BRIEF_MAX = 500;

/**
 * The period it plays, as two years.
 *
 * Beside the brief and not inside it, because a period is the one part of an instruction that can
 * be a number, and a number reaches the record DRAW as well as the model. So it holds on a station
 * with nothing configured to read prose: "nothing after 1979" in the brief is a hope, 1979 here is
 * a rule.
 */
export function EraFields({ from, to }: { from: GetInputPropsReturnType; to: GetInputPropsReturnType }) {
    return (
        <Group grow>
            <NumberInput
                label="From year"
                description="Empty means no lower bound."
                placeholder="1970"
                min={1900}
                max={2100}
                allowDecimal={false}
                hideControls
                className="da-num"
                {...from}
            />
            <NumberInput
                label="To year"
                description="Empty means no upper bound."
                placeholder="1979"
                min={1900}
                max={2100}
                allowDecimal={false}
                hideControls
                className="da-num"
                {...to}
            />
        </Group>
    );
}

/** Why an undated record is not excluded by a period. Read under {@link EraFields} wherever it appears. */
export function EraNote() {
    return (
        <Text size="xs" c="dimmed">
            A record whose release year the catalogue does not know is played whatever the period. Leaving it out is not evidence of the wrong decade,
            and demanding one would empty the draw on a library nothing has enriched.
        </Text>
    );
}

/** What a broadcast is, and what happens when it reaches the end of what it holds. */
export function ShapeFields({ mode, onEnd }: { mode: GetInputPropsReturnType; onEnd: GetInputPropsReturnType }) {
    return (
        <Group grow>
            <Select
                label="Mode"
                data={[
                    { value: 'rotation', label: 'Rotation' },
                    { value: 'setlist', label: 'Setlist' },
                    { value: 'feature', label: 'Feature' },
                ]}
                allowDeselect={false}
                {...mode}
            />
            <Select
                label="When it runs out"
                data={[
                    { value: 'extend', label: 'Keep going' },
                    { value: 'repeat', label: 'Start again' },
                    { value: 'stop', label: 'Stop' },
                ]}
                allowDeselect={false}
                {...onEnd}
            />
        </Group>
    );
}

/**
 * What "start again" actually replays, said wherever {@link ShapeFields} is drawn.
 *
 * The reassurance is the point: an operator who has told the station never to play something needs
 * to know that repeating a block does not reach past that.
 */
export function ShapeNote({ what = 'broadcast' }: { what?: string }) {
    return (
        <Text size="xs" c="dimmed">
            Starting again replays what this {what} already aired. It never reaches further than that: a record you disliked stays off the air whether
            the {what} is running for the first time or the fifth.
        </Text>
    );
}

/**
 * Whether somebody phones in.
 *
 * A format decision rather than something a station does by being one, so it is off unless asked
 * for. Ticked sends `true` and unticked sends NOTHING, which is why this is a checkbox over a field
 * that is nullable underneath: absent leaves `rotation.callins` standing, where an explicit `false`
 * would be every broadcast overruling a station that takes calls every hour. The station's own
 * default is off, so "station off, this show on" is the case that needs saying and the one this
 * says. The third state is reachable in the column when something wants to express it.
 */
export function CallinsField(input: GetInputPropsReturnType) {
    return (
        <Checkbox
            label="Take calls during this broadcast"
            description="A phone-in is written and spoken a turn at a time, so it lands minutes after it is asked for. A setlist or a feature takes none whatever this says."
            {...input}
        />
    );
}
