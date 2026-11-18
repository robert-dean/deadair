import { Card, Stack, Text } from '@mantine/core';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { usePersonas } from '../../api/personas.queries';
import type { Mood } from '../programme/programme.fields';
import { Eyebrow } from '../shared/eyebrow';
import { weekdayShort } from '../../i18n/format.locale';
import { DAYS } from './schedule.day';

/** What the summary reads off the form: the few fields that say what a listener would notice. */
export interface ShowSummaryValues {
    label: string;
    startsAt: string;
    endsAt: string;
    days: readonly string[];
    special: boolean;
    byRule: boolean;
    dates: readonly [string | null, string | null];
    yearly: boolean;
    enabled: boolean;
    live: boolean;
    personaId: string;
    guestCount: number;
    coHostCount: number;
    sourceKind: 'playlist' | 'station' | 'chart' | undefined;
    mode: string;
    brief: string;
    eraFrom: number | string;
    eraTo: number | string;
    moods: readonly Mood[];
    mixFlow: boolean;
    callins: boolean;
}

/**
 * The show as a few plain lines, beside the form that writes it.
 *
 * Thirty fields are thirty answers, and an operator checking a show wants the sentence they add up
 * to: when it is on, who presents it, where its records come from and what it is asked for. It reads
 * the form as it stands, saved or not, and never the station: it says what Save would write.
 */
export function ShowSummary({ values }: { values: ShowSummaryValues }) {
    const { t } = useTranslation(['schedule', 'programme']);
    const personas = usePersonas();
    const host = personas.data?.personas.find(persona => persona.id === values.personaId)?.label;

    const lines = linesOf(t, values, host);

    return (
        <Card withBorder component="section" aria-label={t('slot.summary.title')}>
            <Stack gap="sm">
                <Eyebrow>{t('slot.summary.title')}</Eyebrow>
                <Text fw={600}>{values.label.trim() || t('slot.summary.untitled')}</Text>
                {lines.map(line => (
                    <Text key={line} size="sm" c="dimmed" lineClamp={3}>
                        {line}
                    </Text>
                ))}
            </Stack>
        </Card>
    );
}

/** The summary's lines, in the order a listener would want them. Exported for its test. */
export function linesOf(t: TFunction<['schedule', 'programme']>, values: ShowSummaryValues, host: string | undefined): string[] {
    const lines: string[] = [t('slot.summary.times', { start: values.startsAt, end: values.endsAt })];

    if (values.special && values.byRule) lines.push(t('slot.summary.byRule'));
    else {
        if (values.special) {
            const [from, to] = values.dates;
            lines.push(from && to ? t('slot.summary.dates', { from, to }) : t('slot.summary.noDates'));
            if (values.yearly) lines.push(t('slot.summary.yearly'));
        }
        const days = DAYS.filter(day => values.days.includes(String(day)));
        lines.push(days.length === 0 ? t('slot.summary.everyDay') : days.map(day => weekdayShort(day)).join(', '));
    }

    if (!values.enabled) lines.push(t('slot.summary.off'));
    if (values.live) {
        lines.push(t('slot.summary.live'));
        return lines;
    }

    lines.push(host ?? t('slot.summary.ownHost'));
    if (values.coHostCount > 0) lines.push(t('slot.summary.coHosts', { count: values.coHostCount }));
    if (values.guestCount > 0) lines.push(t('slot.summary.sittingIn', { count: values.guestCount }));

    lines.push(`${t(`slot.summary.source.${values.sourceKind ?? 'none'}`)} · ${t(`programme:shape.mode.${modeOf(values.mode)}`)}`);
    if (values.brief.trim()) lines.push(t('slot.summary.asked', { brief: values.brief.trim() }));

    const from = typeof values.eraFrom === 'number' ? values.eraFrom : undefined;
    const to = typeof values.eraTo === 'number' ? values.eraTo : undefined;
    if (from !== undefined && to !== undefined) lines.push(t('slot.summary.period', { from, to }));
    else if (from !== undefined) lines.push(t('slot.summary.periodFrom', { from }));
    else if (to !== undefined) lines.push(t('slot.summary.periodTo', { to }));

    if (values.moods.length > 0)
        lines.push(t('slot.summary.leans', { moods: values.moods.map(mood => t(`programme:mood.options.${mood}`)).join(' → ') }));
    if (values.mixFlow) lines.push(t('slot.summary.mixFlow'));
    if (values.callins) lines.push(t('slot.summary.callins'));

    return lines;
}

const modeOf = (mode: string): 'rotation' | 'setlist' | 'feature' => (mode === 'setlist' || mode === 'feature' ? mode : 'rotation');
