import { useState } from 'react';
import { Checkbox, MultiSelect, Stack, Text } from '@mantine/core';
import type { Segment } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';
import type { GetInputPropsReturnType } from '@mantine/form';

import { useScopeSegment, useSegments } from '../../api/segments.queries';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';

/**
 * The kinds of recording that make a show sound like itself, in the order they are drawn: a jingle
 * between records, an ident between talk breaks, and a bed under the breaks the station writes.
 * The API's `JINGLE_KIND`, `IDENT_KIND` and `BED_KIND`.
 */
const SOUND_KINDS = ['jingle', 'ident', 'bed'] as const;
type SoundKind = (typeof SOUND_KINDS)[number];

/**
 * A show's own sound: which jingles, idents and music beds are its, and whether its breaks have a bed.
 *
 * The recordings are the library's, and choosing one here sets that RECORDING's scope through the
 * same route the Segments page uses, so it is saved as it is chosen rather than with the show. That is
 * what it is: a fact about the recording (which shows it airs on), and a show deleted later takes
 * nothing with it but its own id on the recording.
 *
 * A recording scoped to no show airs on every show that has none of its own, so choosing one of those
 * here makes it this show's alone. The option says so before it is chosen.
 */
export function ShowSoundField({ slotId, beds }: { slotId: string | undefined; beds: GetInputPropsReturnType }) {
    const { t } = useTranslation('schedule');

    return (
        <Stack gap="xs">
            <Eyebrow>{t('slot.sound.title')}</Eyebrow>
            <Checkbox label={t('slot.sound.bedsLabel')} description={t('slot.sound.bedsDescription')} {...beds} />
            {slotId === undefined ? (
                <Text size="xs" c="dimmed">
                    {t('slot.sound.saveFirst')}
                </Text>
            ) : (
                <ShowRecordings slotId={slotId} />
            )}
        </Stack>
    );
}

/** The three pickers, for a show that already has an id to scope a recording to. */
function ShowRecordings({ slotId }: { slotId: string }) {
    const { t } = useTranslation('schedule');
    const segments = useSegments();
    const scope = useScopeSegment();
    const [failed, setFailed] = useState<unknown>();

    // Only what an operator gave the station can be scoped, and only once it can air.
    const recordings = (segments.data?.segments ?? []).filter(segment => segment.source === 'library' && segment.state === 'ready');

    const choose = async (kind: SoundKind, chosen: string[]) => {
        setFailed(undefined);
        const ofKind = recordings.filter(segment => segment.kind === kind);
        try {
            for (const segment of ofKind) {
                const slotIds = segment.slotIds ?? [];
                const has = slotIds.includes(slotId);
                const wants = chosen.includes(segment.id);
                if (has === wants) continue;

                await scope.mutateAsync({
                    id: segment.id,
                    scope: {
                        slotIds: wants ? [...slotIds, slotId] : slotIds.filter(id => id !== slotId),
                        personaIds: segment.personaIds ?? [],
                    },
                });
            }
        } catch (error) {
            setFailed(error);
        }
    };

    return (
        <Stack gap="xs">
            {failed === undefined ? undefined : <ErrorAlert title={t('slot.sound.saveFailed')} error={failed} />}
            {SOUND_KINDS.map(kind => {
                const ofKind = recordings.filter(segment => segment.kind === kind);
                return (
                    <MultiSelect
                        key={kind}
                        label={t(`slot.sound.kind.${kind}`)}
                        placeholder={ofKind.length === 0 ? t('slot.sound.noneInLibrary') : undefined}
                        disabled={ofKind.length === 0 || scope.isPending}
                        data={ofKind.map(segment => ({ value: segment.id, label: optionLabel(segment, t('slot.sound.everyShow')) }))}
                        value={ofKind.filter(segment => (segment.slotIds ?? []).includes(slotId)).map(segment => segment.id)}
                        onChange={chosen => void choose(kind, chosen)}
                        searchable
                        clearable
                    />
                );
            })}
            <Text size="xs" c="dimmed">
                {t('slot.sound.note')}
            </Text>
        </Stack>
    );
}

/** A recording's name, marked when it currently airs on every show, so choosing it is not a surprise. */
function optionLabel(segment: Segment, everyShow: string): string {
    const scoped = (segment.slotIds ?? []).length + (segment.personaIds ?? []).length > 0;
    return scoped ? segment.label : `${segment.label} (${everyShow})`;
}
