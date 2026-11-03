import { useState } from 'react';
import { Button, FileButton, Group, List, Modal, Stack, Text } from '@mantine/core';
import type { OccasionImportPlan, OccasionPack } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { useImportOccasions, usePreviewOccasionImport } from '../../api/occasions.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { usePhone } from '../shared/use.phone';

/** How many of a long list a preview names before it says how many more there are. */
const LISTED = 8;

/**
 * The file's own fields, and only those, or `undefined` for something that is not a document at all.
 *
 * The contract refuses a key it does not know, and whatever made the file may have added one, which is no
 * reason to refuse it. Whether the fields that are here make a pack is the station's to say, in its preview.
 */
export function packIn(text: string): OccasionPack | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;

    const { format, version, name, occasions } = parsed as Partial<OccasionPack>;
    return { format, version, name, occasions } as OccasionPack;
}

/**
 * Importing occasions from a file: choose it, see what the station makes of it, then add them.
 *
 * The preview is the station's own, so it is the same reading the import will act on, and what was read
 * is held so Import sends exactly what was previewed rather than a file changed on disk since.
 */
export function OccasionsImportModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
    const phone = usePhone();
    const { t } = useTranslation('schedule');
    const preview = usePreviewOccasionImport();
    const write = useImportOccasions();
    const [pack, setPack] = useState<OccasionPack | undefined>();
    const [plan, setPlan] = useState<OccasionImportPlan | undefined>();
    const [unreadable, setUnreadable] = useState<string | undefined>();

    const reset = () => {
        setPack(undefined);
        setPlan(undefined);
        setUnreadable(undefined);
        preview.reset();
        write.reset();
    };
    const close = () => {
        reset();
        onClose();
    };

    const choose = async (file: File | null) => {
        if (file === null) return;
        reset();

        const read = packIn(await file.text());
        if (read === undefined) {
            setUnreadable(t('occasions.import.unreadable', { name: file.name }));
            return;
        }
        preview.mutate(read, {
            onSuccess: answer => {
                setPack(read);
                setPlan(answer);
            },
        });
    };

    return (
        <Modal opened={opened} onClose={close} title={t('occasions.import.title')} size="lg" fullScreen={phone}>
            <Stack gap="md">
                <Text size="sm">{t('occasions.import.intro')}</Text>

                <Group>
                    <FileButton onChange={file => void choose(file)} accept="application/json,.json">
                        {props => (
                            <Button variant="default" loading={preview.isPending} {...props}>
                                {plan === undefined ? t('occasions.import.choose') : t('occasions.import.chooseAnother')}
                            </Button>
                        )}
                    </FileButton>
                </Group>

                {unreadable ? <ErrorAlert title={t('occasions.import.refused')}>{unreadable}</ErrorAlert> : undefined}
                {preview.isError ? (
                    <ErrorAlert title={t('occasions.import.refused')}>
                        {apiErrorMessage(preview.error, t('occasions.import.refusedFallback'))}
                    </ErrorAlert>
                ) : undefined}
                {write.isError ? (
                    <ErrorAlert title={t('occasions.import.failed')}>{apiErrorMessage(write.error, t('occasions.failedFallback'))}</ErrorAlert>
                ) : undefined}

                {plan === undefined ? undefined : (
                    <Stack gap="sm">
                        <Text fw={600}>{plan.name}</Text>
                        {plan.adding.length === 0 ? (
                            <Text size="sm">{t('occasions.import.nothingToAdd')}</Text>
                        ) : (
                            <Stack gap={4}>
                                <Text size="sm">{t('occasions.import.adding', { count: plan.adding.length })}</Text>
                                <List size="sm">
                                    {plan.adding.slice(0, LISTED).map(words => (
                                        <List.Item key={words}>{words}</List.Item>
                                    ))}
                                </List>
                                {plan.adding.length > LISTED ? (
                                    <Text size="xs" c="dimmed">
                                        {t('occasions.import.andMore', { count: plan.adding.length - LISTED })}
                                    </Text>
                                ) : undefined}
                            </Stack>
                        )}
                        {plan.skipped.length === 0 ? undefined : (
                            <Text size="sm" c="dimmed">
                                {t('occasions.import.skipped', { count: plan.skipped.length })}
                            </Text>
                        )}
                        {plan.dropped.length === 0 ? undefined : (
                            <Stack gap={4}>
                                <Text size="sm">{t('occasions.import.dropped', { count: plan.dropped.length })}</Text>
                                <List size="sm">
                                    {plan.dropped.slice(0, LISTED).map(dropped => (
                                        <List.Item key={dropped.entry}>
                                            {t('occasions.import.droppedEntry', {
                                                entry: dropped.entry,
                                                words: dropped.words ?? t('occasions.import.noWords'),
                                                reason: dropped.reason,
                                            })}
                                        </List.Item>
                                    ))}
                                </List>
                                {plan.dropped.length > LISTED ? (
                                    <Text size="xs" c="dimmed">
                                        {t('occasions.import.andMore', { count: plan.dropped.length - LISTED })}
                                    </Text>
                                ) : undefined}
                            </Stack>
                        )}
                    </Stack>
                )}

                <Group justify="flex-end">
                    <Button variant="default" onClick={close}>
                        {t('occasions.import.cancel')}
                    </Button>
                    <Button
                        disabled={pack === undefined || plan === undefined || plan.adding.length === 0}
                        loading={write.isPending}
                        onClick={() => {
                            if (pack !== undefined) write.mutate(pack, { onSuccess: close });
                        }}
                    >
                        {t('occasions.import.add')}
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}
