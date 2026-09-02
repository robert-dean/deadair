import { Group, NumberInput, Select, Text, Textarea, Checkbox } from '@mantine/core';
import type { GetInputPropsReturnType } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';

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

/** A plugin and one of its playlists as the single string a picker can hold. */
export const sourceValue = (pluginId: string, playlistId: string): string => `${pluginId} ${playlistId}`;

/**
 * The pair back out of a picker's value.
 *
 * Both halves or neither: one without the other is not a source anything could read, which is the
 * same call `ScheduleRepository`'s row mapper makes on the way out of the database.
 */
export function splitSource(value: string | null | undefined): { pluginId: string; playlistId: string } | undefined {
    // At the FIRST separator rather than every one. A plugin id has no spaces, but a playlist id is
    // a provider's and nothing here can promise it has none either — and `split(' ')` would quietly
    // keep the first word of one and drop the rest, which is a source that reads back as a different
    // playlist rather than as an error.
    const at = (value ?? '').indexOf(' ');
    if (at <= 0) return undefined;

    const pluginId = value!.slice(0, at);
    const playlistId = value!.slice(at + 1);

    return playlistId ? { pluginId, playlistId } : undefined;
}

/**
 * Where the records come from: a plugin and one of its playlists.
 *
 * Choosing nothing is a real answer rather than an empty field — it is a broadcast the station
 * fills for itself, which is what a rotation with no playlist behind it is.
 */
export function SourceField({ description, ...input }: GetInputPropsReturnType & { description?: string }) {
    const playlists = useQuery(playlistsListOptions);
    const options = (playlists.data?.playlists ?? []).map(entry => ({
        value: sourceValue(entry.pluginId, entry.id),
        label: `${entry.name} — ${entry.pluginName}`,
    }));

    return (
        <Select
            label="Playing from"
            description={description ?? 'Leave it empty for a broadcast the station fills itself.'}
            data={options}
            searchable
            clearable
            clearButtonProps={{ 'aria-label': 'Play from no playlist' }}
            nothingFoundMessage={playlists.isPending ? 'Reading the plugins…' : 'No playlists on offer'}
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
            description={description ?? 'In your own words, for the model that chooses records. Leave it empty and the host programmes.'}
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
