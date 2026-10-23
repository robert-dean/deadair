import { Chip, Group, Select, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { TrackStateCounts } from '@deadair/sdk';

import { severityColor } from '../shared/status';
import { MEASURE_FAILURES, type MeasureFailureParam } from './catalog.page.params';
import { EMPTY_CHIP_STYLES } from './track.state.filter';
import { formatCount } from '../../i18n/format.locale';

/** The two measurement filters as the list carries them. Empty strings are no filter. */
export interface TrackMeasurement {
    analyzer: string;
    failure: MeasureFailureParam | '';
}

export interface TrackMeasurementFilterProps {
    counts?: TrackStateCounts;
    value: TrackMeasurement;
    onChange: (next: TrackMeasurement) => void;
}

/**
 * Which analysis plugin measured a record, and which way a measurement failed.
 *
 * The second line under the record states, and narrower: the states say what the station HAS of a
 * record, this says what the measurement walk DID to it. "Measured by" is the selector for measuring
 * a detector's records again once it turns out to have been wrong about a class of them, which was
 * a `psql` query before this; the failure kinds are what decides when the walk tries again.
 *
 * Drawn only once something has been measured. A failure chip with nothing behind it stays drawn and
 * disabled for `TrackStateFilter`'s reason, but only once ANY measurement has failed: a station whose
 * walk has never failed sees no row of zeroes about it.
 */
export function TrackMeasurementFilter({ counts, value, onChange }: TrackMeasurementFilterProps) {
    const { t } = useTranslation('catalog');
    if (counts === undefined) return undefined;

    const failures = counts.measureFailures;
    const anyFailed = failures.unfetchable + failures.undecodable + failures.truncated > 0;
    // Still drawn while a filter is chosen, so a filter that came in on a link can always be taken off.
    if (counts.analyzers.length === 0 && !anyFailed && value.analyzer === '' && value.failure === '') return undefined;

    // The chosen analyzer stays in the list even when nothing it measured is left, so the box never
    // shows a value it cannot name.
    const analyzers =
        counts.analyzers.some(entry => entry.pluginId === value.analyzer) || value.analyzer === ''
            ? counts.analyzers
            : [...counts.analyzers, { pluginId: value.analyzer, count: 0 }];

    return (
        <Group gap="md" align="center" wrap="wrap">
            <Select
                size="xs"
                w={260}
                label={t('measurementFilter.analyzerLabel')}
                placeholder={t('measurementFilter.anyAnalyzer')}
                clearable
                data={analyzers.map(entry => ({
                    value: entry.pluginId,
                    label: t('measurementFilter.analyzerOption', { pluginId: entry.pluginId, count: entry.count, records: formatCount(entry.count) }),
                }))}
                value={value.analyzer === '' ? null : value.analyzer}
                onChange={analyzer => onChange({ ...value, analyzer: analyzer ?? '' })}
            />
            {anyFailed || value.failure !== '' ? (
                <Group gap="xs" align="center">
                    <Text size="xs" c="dimmed">
                        {t('measurementFilter.failedLabel')}
                    </Text>
                    {MEASURE_FAILURES.map(kind => {
                        const count = failures[kind];
                        const chosen = value.failure === kind;
                        return (
                            <Chip
                                key={kind}
                                size="xs"
                                color={severityColor.failure}
                                checked={chosen}
                                disabled={count === 0 && !chosen}
                                styles={count === 0 && !chosen ? EMPTY_CHIP_STYLES : undefined}
                                onChange={checked => onChange({ ...value, failure: checked ? kind : '' })}
                            >
                                <span className="da-num" style={{ fontWeight: 600 }}>
                                    {formatCount(count)}
                                </span>{' '}
                                {t(`measurementFilter.failure.${kind}`)}
                            </Chip>
                        );
                    })}
                </Group>
            ) : undefined}
        </Group>
    );
}
