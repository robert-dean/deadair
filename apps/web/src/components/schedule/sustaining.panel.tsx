import { useState } from 'react';
import { Button, Card, Collapse, Group, Stack, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';
import type { CatalogPlaylist, StationChart } from '@deadair/sdk';

import { chartsListOptions } from '../../api/charts.queries';
import { playlistsListOptions } from '../../api/playlists.queries';
import { useSettings, useUpdateSettings } from '../../api/settings.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { BriefField, ChartOrderField, chartSourceValue, EraFields, SourceField, sourceValue, splitSource } from '../programme/programme.fields';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';

/**
 * The settings this writes, which `ScheduleService.sustaining()` reads on the other side.
 *
 * Named here rather than taken from the descriptors, because this panel draws its own controls
 * instead of rendering the registry's: the plugin and the playlist are ONE picker over what the
 * plugins actually offer, exactly as in the slot editor next door. Two hand-typed id boxes is the
 * failure a station's news categories already documented — an id derived from a name written in
 * another form. They stay declared in `settings.registry.ts` regardless, because `PUT /settings`
 * refuses a key nobody declared.
 */
const KEYS = {
    pluginId: 'schedule.sustainingPluginId',
    playlistId: 'schedule.sustainingPlaylistId',
    chartId: 'schedule.sustainingChartId',
    chartOrder: 'schedule.sustainingChartOrder',
    brief: 'schedule.sustainingBrief',
    eraFrom: 'schedule.sustainingEraFrom',
    eraTo: 'schedule.sustainingEraTo',
} as const;

interface FormValues {
    /**
     * A playlist pair or a chart id as one tagged option value, since a picker holds one string.
     * As the slot editor.
     *
     * Nullable because clearing the picker is what "no source" is, and Mantine answers that with
     * null rather than with the empty string the field was built with.
     */
    source: string | null;
    /** Which way round a chart is played. Saved only when the source IS one. */
    chartOrder: 'countdown' | 'ranked' | 'unordered';
    brief: string;
    /** Empty string is Mantine's "nothing typed" for a `NumberInput`, and it means no bound. */
    eraFrom: number | string;
    eraTo: number | string;
}

/**
 * What the station plays in the hours no block claims, on the page that draws those hours.
 *
 * ## A slot with the when-half removed
 *
 * That is what a sustaining source IS: a playlist or a chart, or a brief and a period, with no times and no days,
 * standing behind the grid rather than on it. So it is drawn with the controls the slot editor
 * already uses — one searchable picker over the plugins' real playlists and charts, a brief, and the two year
 * boxes — rather than as the five settings rows it is stored as. It lived on the settings page,
 * halfway down a card about rotation rules, under labels that had to re-explain the schedule in
 * order to say what they were for.
 *
 * ## Behind a fold, with the summary in view
 *
 * The same shape as `ClockOnAir` and `BriefTheStation`: what stays on the screen is the sentence
 * saying what plays between blocks, which is also the affordance for changing it. An operator
 * looking at a timetable is nearly always only looking at it.
 *
 * ## Nothing here is a block, so nothing here changes what is on air
 *
 * The tick hands the station over when it next finds a gap, exactly as it does for a block. A source
 * saved now is what the NEXT gap plays.
 */
export function SustainingPanel() {
    const settings = useSettings();
    const save = useUpdateSettings();
    const playlists = useQuery(playlistsListOptions);
    const charts = useQuery(chartsListOptions);
    const [opened, setOpened] = useState(false);

    const stored = storedValues(settings.data?.values ?? {});
    const catalog = playlists.data?.playlists ?? [];
    const chartMenu = charts.data?.charts ?? [];

    const submit = (next: FormValues) => {
        // `splitSource` takes the null clearing a Mantine `Select` leaves behind, which is the
        // gesture for "no source" and is not the empty string the field started as.
        const source = splitSource(next.source);
        const playlist = source?.kind === 'playlist' ? source : undefined;
        const chart = source?.kind === 'chart' ? source : undefined;

        // `null` rather than `''` for anything emptied: an explicit null deletes the row, which is
        // how a setting goes back to unset rather than being pinned to an empty string. The two
        // halves of a playlist go together, since one without the other names nothing a playlist
        // reader could be asked for — and the arm that was NOT chosen is cleared rather than left,
        // because a stale chart id beside a fresh playlist is a source that would win over it.
        save.mutate({
            [KEYS.pluginId]: playlist?.pluginId ?? null,
            [KEYS.playlistId]: playlist?.playlistId ?? null,
            [KEYS.chartId]: chart?.chartId ?? null,
            [KEYS.chartOrder]: chart === undefined ? null : next.chartOrder,
            [KEYS.brief]: next.brief.trim() === '' ? null : next.brief.trim(),
            [KEYS.eraFrom]: typeof next.eraFrom === 'number' ? next.eraFrom : null,
            [KEYS.eraTo]: typeof next.eraTo === 'number' ? next.eraTo : null,
        });
    };

    return (
        <Card padding="lg">
            <Stack gap="sm">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={2}>
                        <Eyebrow>Sustaining</Eyebrow>
                        {/* Nothing is claimed until the settings have answered. An unanswered read
                            and a station with nothing set are the same empty map, and only one of
                            them is worth a sentence. */}
                        <Text size="sm" c="dimmed" maw={620}>
                            {settings.data === undefined ? ' ' : summaryOf(stored, catalog, chartMenu)}
                        </Text>
                    </Stack>
                    <Button size="xs" variant="light" onClick={() => setOpened(open => !open)}>
                        {opened ? 'Done' : 'Change'}
                    </Button>
                </Group>

                {settings.error ? (
                    <ErrorAlert
                        title="The sustaining source could not be read"
                        error={settings.error}
                        fallback="What plays between blocks is unavailable."
                    />
                ) : undefined}

                <Collapse expanded={opened}>
                    {/* Keyed on what the server last said, so the form is BUILT from the answer
                        rather than from the empty map the first render has, and starts over after
                        every save. `useForm` reads `initialValues` once per mount, which is the same
                        reason the slot editor and the band editor are keyed by the page that opens
                        them — and why the hook lives in the child rather than here. */}
                    <SustainingForm
                        key={JSON.stringify(stored)}
                        initial={stored}
                        onSubmit={submit}
                        saving={save.isPending}
                        succeeded={save.isSuccess}
                        failure={save.isError ? apiErrorMessage(save.error, 'The sustaining source could not be saved.') : undefined}
                    />
                </Collapse>
            </Stack>
        </Card>
    );
}

interface SustainingFormProps {
    initial: FormValues;
    onSubmit: (values: FormValues) => void;
    saving: boolean;
    succeeded: boolean;
    failure?: string;
}

/**
 * The form itself, so the `key` above rebuilds its values rather than the whole card.
 *
 * The playlists are no longer passed down: `SourceField` reads them itself, off the same query key
 * the card above is already reading for its summary line, so it is one request either way.
 */
function SustainingForm({ initial, onSubmit, saving, succeeded, failure }: SustainingFormProps) {
    const form = useForm<FormValues>({ initialValues: initial });

    return (
        <form onSubmit={form.onSubmit(onSubmit)}>
            <Stack gap="md" pt="sm">
                {failure ? <ErrorAlert title="That could not be saved">{failure}</ErrorAlert> : undefined}

                <SourceField
                    description="Leave it empty and the station programmes the gap itself, from the words below."
                    {...form.getInputProps('source')}
                />

                {splitSource(form.values.source)?.kind === 'chart' ? <ChartOrderField {...form.getInputProps('chartOrder')} /> : undefined}

                <BriefField
                    description="In your own words, for the model that chooses records, exactly as a block's own brief works."
                    {...form.getInputProps('brief')}
                />

                {/* Beside the words rather than inside them, as on a block: a period is the one part
                    of an instruction that can be a number, and a number reaches the record DRAW as
                    well as the model, so it holds on a station with nothing configured to read prose. */}
                <EraFields from={form.getInputProps('eraFrom')} to={form.getInputProps('eraTo')} />

                <Text size="xs" c="dimmed">
                    A gap never falls silent: it plays this, or the station keeps whatever the last block left on. Saving changes nothing that is on
                    air now — the station moves at the first boundary after a block ends. A record whose release year the catalogue does not know is
                    played whatever the period.
                </Text>

                <Group justify="flex-end" gap="md">
                    {succeeded && !form.isDirty() ? (
                        <Text size="sm" c="dimmed">
                            Saved.
                        </Text>
                    ) : undefined}
                    <Button type="submit" loading={saving}>
                        Save
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}

/** A stored setting as the string a form field holds, where absent and empty are the same thing. */
function text(values: Record<string, unknown>, key: string): string {
    const value = values[key];
    return typeof value === 'string' ? value : '';
}

/** A stored setting as the number a `NumberInput` holds, where anything unparseable is no bound. */
function year(values: Record<string, unknown>, key: string): number | string {
    const value = values[key];
    if (typeof value === 'number') return value;

    // A settings layer holds strings, and `parseSetting` types one back on the way out — so this is
    // only the tolerance the rest of the console gives a hand-edited row, rather than a second
    // opinion about what a year is.
    const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : '';
}

/** The settings as the form's own values. */
function storedValues(values: Record<string, unknown>): FormValues {
    const pluginId = text(values, KEYS.pluginId);
    const playlistId = text(values, KEYS.playlistId);
    const chartId = text(values, KEYS.chartId);
    const chartOrder = text(values, KEYS.chartOrder);

    return {
        // `null` rather than `''` for "no source", because Mantine draws its clear cross for any
        // value that is not null — so an empty picker offering to be cleared is what an empty string
        // looks like on the screen.
        //
        // A chart first, which is the precedence the API reads these two with. Saying it differently
        // here would show a playlist the station is not actually sustaining from.
        source: chartId ? chartSourceValue(chartId) : pluginId && playlistId ? sourceValue(pluginId, playlistId) : null,
        chartOrder: chartOrder === 'ranked' || chartOrder === 'unordered' ? chartOrder : 'countdown',
        brief: text(values, KEYS.brief),
        eraFrom: year(values, KEYS.eraFrom),
        eraTo: year(values, KEYS.eraTo),
    };
}

/**
 * What plays between blocks, as one line.
 *
 * A playlist is named by its own NAME where the plugins have answered and by its id where they have
 * not, rather than the line waiting: a panel that said nothing until an unrelated read landed would
 * read as a station with no sustaining source, which is the one state this line exists to tell apart.
 *
 * With nothing set it says what the tick job says on the activity feed, in the same words: the
 * station keeps what was on. That is a working station rather than a fault, so it is not phrased as
 * one.
 */
function summaryOf(stored: FormValues, catalog: readonly CatalogPlaylist[], charts: readonly StationChart[]): string {
    const parts: string[] = [];

    const source = splitSource(stored.source);
    if (source?.kind === 'chart') {
        const known = charts.find(entry => entry.id === source.chartId);
        // The order goes in the line too, because "the top forty" and "the top forty counting down"
        // are two different hours and the picker is behind a fold.
        parts.push(`${known?.name ?? source.chartId}${stored.chartOrder === 'countdown' ? ', counting down' : ''}`);
    } else if (source !== undefined) {
        const known = catalog.find(entry => entry.pluginId === source.pluginId && entry.id === source.playlistId);
        parts.push(known ? `${known.name} — ${known.pluginName}` : source.playlistId);
    }
    if (stored.brief.trim() !== '') parts.push(`“${stored.brief.trim()}”`);

    const period = periodOf(stored.eraFrom, stored.eraTo);
    if (period !== undefined) parts.push(period);

    if (parts.length === 0) return 'Nothing is set to play between blocks, so a gap keeps whatever the last block left on.';

    return `Between blocks: ${parts.join(' · ')}`;
}

/** A period as an operator would say it, where either end may stand alone. */
function periodOf(from: number | string, to: number | string): string | undefined {
    const start = typeof from === 'number' ? from : undefined;
    const end = typeof to === 'number' ? to : undefined;

    if (start !== undefined && end !== undefined) return `${start}–${end}`;
    if (start !== undefined) return `${start} onwards`;
    if (end !== undefined) return `up to ${end}`;

    return undefined;
}
