import { useState } from 'react';
import { Button, Checkbox, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { Pad, PadPlacement, PadUse } from '@deadair/sdk';

import { ErrorAlert } from '../shared/error.alert';

/** In the order a break reads, which is the order the boxes are drawn and the order the station stores. */
const PLACEMENTS: readonly PadPlacement[] = ['start', 'middle', 'end'];

/** The catalog key for a partial set of placements, or `undefined` for all three (and for none). */
type OnlyKey = 'start' | 'middle' | 'end' | 'startMiddle' | 'startEnd' | 'middleEnd';

function onlyKey(placements: readonly PadPlacement[]): OnlyKey | undefined {
    const has = (placement: PadPlacement) => placements.includes(placement);
    const [start, middle, end] = [has('start'), has('middle'), has('end')];

    if (start && middle && end) return undefined;
    if (start && middle) return 'startMiddle';
    if (start && end) return 'startEnd';
    if (middle && end) return 'middleEnd';
    if (start) return 'start';
    if (middle) return 'middle';
    if (end) return 'end';
    return undefined;
}

/**
 * The line under a pad's name saying where and when it is used, or nothing for a pad left at the
 * default — every placement and no cue — so an untouched rack reads exactly as it did.
 */
export function PadUseSummary({ pad }: { pad: Pick<Pad, 'placements' | 'cue'> }) {
    const { t } = useTranslation('pads');
    const only = onlyKey(pad.placements);
    if (only === undefined && pad.cue === undefined) return null;

    const place = only === undefined ? undefined : t(`use.only.${only}`);
    const said =
        pad.cue === undefined ? place : place === undefined ? t('use.cueSummary', { cue: pad.cue }) : t('use.cueAndPlace', { cue: pad.cue, place });

    return (
        <Text size="xs" c="dimmed">
            {said}
        </Text>
    );
}

interface PadUseModalProps {
    /** The pad being set, or `undefined` while the modal is closed. Key the modal on its id. */
    pad: Pad | undefined;
    onClose: () => void;
    /** Writes the use. The modal closes itself only once this resolves, and shows the error if it throws. */
    onSave: (use: PadUse) => Promise<unknown>;
}

/**
 * Where in a break a sound may land, and when to reach for it.
 *
 * The two are edited together because they answer one question an operator has about a sound, and
 * the station writes them together. Placements are three boxes rather than a select, since any
 * combination is legal except none; a pad allowed nowhere is a pad turned down, and the reject on the
 * row is already the way to say that.
 */
export function PadUseModal({ pad, onClose, onSave }: PadUseModalProps) {
    const { t } = useTranslation('pads');
    // Started from the pad, and the caller keys this on the pad's id so each opening starts afresh:
    // a cancelled edit leaves nothing behind for the next sound.
    const [placements, setPlacements] = useState<PadPlacement[]>(() =>
        pad === undefined ? [...PLACEMENTS] : PLACEMENTS.filter(placement => pad.placements.includes(placement)),
    );
    const [cue, setCue] = useState(pad?.cue ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<unknown>(undefined);

    const toggle = (placement: PadPlacement, on: boolean) =>
        setPlacements(current => PLACEMENTS.filter(each => (each === placement ? on : current.includes(each))));

    const save = async () => {
        const trimmed = cue.trim();
        setSaving(true);
        setError(undefined);
        try {
            await onSave({ placements, ...(trimmed.length === 0 ? {} : { cue: trimmed }) });
            onClose();
        } catch (caught) {
            setError(caught);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal opened={pad !== undefined} onClose={onClose} title={t('use.title', { label: pad?.label ?? '' })}>
            <Stack gap="md">
                {error === undefined ? undefined : <ErrorAlert title={t('use.saveFailed')} error={error} />}

                <Stack gap={6}>
                    <Text size="sm" fw={500}>
                        {t('use.placements')}
                    </Text>
                    <Text size="xs" c="dimmed">
                        {t('use.placementsHint')}
                    </Text>
                    {PLACEMENTS.map(placement => (
                        <Checkbox
                            key={placement}
                            label={t(`use.${placement}`)}
                            checked={placements.includes(placement)}
                            onChange={event => toggle(placement, event.currentTarget.checked)}
                        />
                    ))}
                    {placements.length === 0 ? (
                        <Text size="xs" c="red">
                            {t('use.none')}
                        </Text>
                    ) : undefined}
                </Stack>

                <TextInput
                    label={t('use.cue')}
                    description={t('use.cueHint')}
                    placeholder={t('use.cuePlaceholder')}
                    maxLength={200}
                    value={cue}
                    onChange={event => setCue(event.currentTarget.value)}
                />

                <Group justify="flex-end" gap="xs">
                    <Button variant="default" onClick={onClose}>
                        {t('use.cancel')}
                    </Button>
                    <Button loading={saving} disabled={placements.length === 0} onClick={() => void save()}>
                        {t('use.save')}
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}
