import { useState } from 'react';
import { ActionIcon, Anchor, Button, Group, Popover, Stack, Text, TextInput } from '@mantine/core';
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react';
import type { Pronunciation } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import {
    fetchPronunciationSample,
    useCreatePronunciation,
    usePronunciations,
    useSetPronunciationState,
    useUpdatePronunciation,
} from '../../api/pronunciations.queries';
import { ErrorAlert } from '../shared/error.alert';
import { severityColor } from '../shared/status';
import { useVoicePreview } from '../voices/voice.preview';

export interface PronunciationControlProps {
    /** The name as the catalog holds it, which is the written side of the entry. */
    name: string;
}

/**
 * Tell the station how to say this name, from the page the operator is looking at it on.
 *
 * The lexicon matches a written form case-insensitively and holds one entry per written form, a
 * turned-down one included (`holds` refuses a second), so this finds the entry the same way and
 * EDITS it when there is one: a proposal or a turned-down entry is rewritten and made active rather
 * than added beside, which the API would refuse. Saving here is always "say it this way", so the
 * entry ends up active whatever state it started in.
 *
 * The sample speaks the draft in the station's default voice; the pronunciations page is where a
 * respelling is tried across presenters.
 */
export function PronunciationControl({ name }: PronunciationControlProps) {
    const { t } = useTranslation('catalog');
    const lexicon = usePronunciations();
    const create = useCreatePronunciation();
    const update = useUpdatePronunciation();
    const setState = useSetPronunciationState();
    const preview = useVoicePreview();

    const [opened, setOpened] = useState(false);
    const [spoken, setSpoken] = useState('');

    const entry = findEntry(lexicon.data?.pronunciations ?? [], name);
    const saving = create.isPending || update.isPending || setState.isPending;
    const failure = create.error ?? update.error ?? setState.error;

    const open = () => {
        setSpoken(entry?.spoken ?? '');
        create.reset();
        update.reset();
        setState.reset();
        setOpened(true);
    };

    const save = async () => {
        const said = spoken.trim();
        if (entry === undefined) {
            await create.mutateAsync({ written: name, spoken: said });
        } else {
            if (said !== entry.spoken) await update.mutateAsync({ id: entry.id, body: { written: entry.written, spoken: said } });
            if (entry.state !== 'active') await setState.mutateAsync({ id: entry.id, body: { state: 'active' } });
        }
        setOpened(false);
    };

    // Nothing is drawn until the lexicon is known: a "Say it" offered for a name that already has an
    // entry would be refused when saved.
    if (lexicon.data === undefined) return undefined;

    const listenKey = 'artist';
    const playing = preview.isPlaying(listenKey);
    const sampleFailure = preview.failureFor(listenKey);

    return (
        <Popover position="bottom-start" withinPortal trapFocus opened={opened} onChange={setOpened} width={360}>
            <Popover.Target>
                {entry?.state === 'active' ? (
                    <Group gap="xs" align="baseline" wrap="nowrap">
                        <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                            {entry.spoken.length === 0 ? t('pronunciation.notSaid') : t('pronunciation.saidAs', { spoken: entry.spoken })}
                        </Text>
                        <Anchor component="button" type="button" size="xs" onClick={open}>
                            {t('pronunciation.change')}
                        </Anchor>
                    </Group>
                ) : (
                    <Button variant="subtle" color="gray" size="compact-xs" onClick={open}>
                        {entry?.state === 'suggested' ? t('pronunciation.proposed') : t('pronunciation.button')}
                    </Button>
                )}
            </Popover.Target>
            <Popover.Dropdown>
                <Stack gap="xs">
                    <Text size="xs" c="dimmed">
                        {entry?.state === 'suggested' ? t('pronunciation.proposedHint') : t('pronunciation.hint')}
                    </Text>
                    <Group gap="xs" align="flex-end" wrap="nowrap">
                        <TextInput
                            size="xs"
                            flex={1}
                            data-autofocus
                            label={t('pronunciation.field', { name })}
                            placeholder={t('pronunciation.placeholder')}
                            value={spoken}
                            onChange={event => setSpoken(event.currentTarget.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter') void save();
                            }}
                        />
                        <ActionIcon
                            size="md"
                            variant="subtle"
                            disabled={spoken.trim().length === 0}
                            loading={preview.isLoading(listenKey)}
                            aria-label={playing ? t('pronunciation.pause', { name }) : t('pronunciation.play', { name })}
                            onClick={() =>
                                preview.play(listenKey, () => fetchPronunciationSample(name, spoken.trim()), t('pronunciation.playFailed'))
                            }
                        >
                            {playing ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
                        </ActionIcon>
                    </Group>
                    {sampleFailure === undefined ? undefined : (
                        <Text size="xs" c={severityColor.failure}>
                            {sampleFailure}
                        </Text>
                    )}
                    {failure ? (
                        <ErrorAlert title={t('pronunciation.saveFailed')} error={failure} fallback={t('pronunciation.saveFailedFallback')} />
                    ) : undefined}
                    <Group gap="xs" justify="flex-end">
                        <Button size="xs" variant="subtle" color="gray" onClick={() => setOpened(false)}>
                            {t('pronunciation.cancel')}
                        </Button>
                        <Button size="xs" variant="light" loading={saving} onClick={save}>
                            {t('pronunciation.save')}
                        </Button>
                    </Group>
                </Stack>
            </Popover.Dropdown>
        </Popover>
    );
}

/**
 * The entry for this name, as the station would match it: case-insensitively, and one that is in use
 * or proposed ahead of a turned-down one, though the unique index allows only one of those besides.
 */
function findEntry(entries: readonly Pronunciation[], name: string): Pronunciation | undefined {
    const key = name.trim().toLowerCase();
    const matching = entries.filter(entry => entry.written.trim().toLowerCase() === key);
    return matching.find(entry => entry.state !== 'rejected') ?? matching[0];
}
