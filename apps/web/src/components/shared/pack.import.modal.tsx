import { useState } from 'react';
import { Button, FileButton, Group, List, Modal, Stack, Text } from '@mantine/core';
import type { PackImportPlan } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { apiErrorMessage } from '../../api/sdk.error';
import { ErrorAlert } from './error.alert';
import { ImportNotices } from './import.notices';
import { usePhone } from './use.phone';

/** How many of a long list a preview names before it says how many more there are. */
const LISTED = 8;

/**
 * The named fields of a file, and only those, or `undefined` for something that is not a document at all.
 *
 * The contract refuses a key it does not know, and whatever made the file may have added one, which is no
 * reason to refuse it. Whether the fields that are here make a usable file is the station's to say, in its
 * preview.
 */
export function packFieldsIn<TFile>(text: string, fields: readonly (keyof TFile & string)[]): TFile | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;

    const document = parsed as Record<string, unknown>;
    return Object.fromEntries(fields.map(field => [field, document[field]])) as TFile;
}

/** The part of a react-query mutation this dialog drives. */
interface PackMutation<TFile, TAnswer> {
    mutate: (file: TFile, options?: { onSuccess?: (answer: TAnswer) => void }) => void;
    reset: () => void;
    isPending: boolean;
    isError: boolean;
    error: unknown;
}

export interface PackImportModalProps<TFile, TResult> {
    opened: boolean;
    onClose: () => void;
    title: string;
    intro: string;
    /** The sentence above the list of what would be added, including how those rows arrive. */
    addingLine: (count: number) => string;
    /** The file's text as the API's document, or `undefined` for one that is not a document. */
    read: (text: string) => TFile | undefined;
    preview: PackMutation<TFile, PackImportPlan>;
    write: PackMutation<TFile, TResult>;
}

/**
 * Importing a station's authored rows from a file: choose it, see what the station makes of it, then add.
 *
 * The preview is the station's own, so it is the same reading the import will act on, and what was read is
 * held so Import sends exactly what was previewed rather than a file changed on disk since. Only the words
 * that name the rows are the caller's. Everything else about a file behaves the same whichever rows it holds.
 */
export function PackImportModal<TFile, TResult>({
    opened,
    onClose,
    title,
    intro,
    addingLine,
    read,
    preview,
    write,
}: PackImportModalProps<TFile, TResult>) {
    const phone = usePhone();
    const { t } = useTranslation('common');
    const [file, setFile] = useState<TFile | undefined>();
    const [plan, setPlan] = useState<PackImportPlan | undefined>();
    const [unreadable, setUnreadable] = useState<string | undefined>();

    const reset = () => {
        setFile(undefined);
        setPlan(undefined);
        setUnreadable(undefined);
        preview.reset();
        write.reset();
    };
    const close = () => {
        reset();
        onClose();
    };

    const choose = async (picked: File | null) => {
        if (picked === null) return;
        reset();

        const document = read(await picked.text());
        if (document === undefined) {
            setUnreadable(t('packImport.unreadable', { name: picked.name }));
            return;
        }
        preview.mutate(document, {
            onSuccess: answer => {
                setFile(document);
                setPlan(answer);
            },
        });
    };

    return (
        <Modal opened={opened} onClose={close} title={title} size="lg" fullScreen={phone}>
            <Stack gap="md">
                <Text size="sm">{intro}</Text>

                <Group>
                    <FileButton onChange={picked => void choose(picked)} accept="application/json,.json">
                        {props => (
                            <Button variant="default" loading={preview.isPending} {...props}>
                                {plan === undefined ? t('packImport.choose') : t('packImport.chooseAnother')}
                            </Button>
                        )}
                    </FileButton>
                </Group>

                {unreadable ? <ErrorAlert title={t('packImport.refused')}>{unreadable}</ErrorAlert> : undefined}
                {preview.isError ? (
                    <ErrorAlert title={t('packImport.refused')}>{apiErrorMessage(preview.error, t('packImport.refusedFallback'))}</ErrorAlert>
                ) : undefined}
                {write.isError ? (
                    <ErrorAlert title={t('packImport.failed')}>{apiErrorMessage(write.error, t('packImport.failedFallback'))}</ErrorAlert>
                ) : undefined}

                {plan === undefined ? undefined : (
                    <Stack gap="sm">
                        <Text fw={600}>{plan.name}</Text>
                        {plan.adding.length === 0 ? (
                            <Text size="sm">{t('packImport.nothingToAdd')}</Text>
                        ) : (
                            <Stack gap={4}>
                                <Text size="sm">{addingLine(plan.adding.length)}</Text>
                                <List size="sm">
                                    {plan.adding.slice(0, LISTED).map((words, index) => (
                                        <List.Item key={`${words}-${index}`}>{words}</List.Item>
                                    ))}
                                </List>
                                {plan.adding.length > LISTED ? (
                                    <Text size="xs" c="dimmed">
                                        {t('packImport.andMore', { count: plan.adding.length - LISTED })}
                                    </Text>
                                ) : undefined}
                            </Stack>
                        )}
                        {plan.skipped.length === 0 ? undefined : (
                            <Text size="sm" c="dimmed">
                                {t('packImport.skipped', { count: plan.skipped.length })}
                            </Text>
                        )}
                        {plan.dropped.length === 0 ? undefined : (
                            <Stack gap={4}>
                                <Text size="sm">{t('packImport.dropped', { count: plan.dropped.length })}</Text>
                                <List size="sm">
                                    {plan.dropped.slice(0, LISTED).map(dropped => (
                                        <List.Item key={dropped.entry}>
                                            {t('packImport.droppedEntry', {
                                                entry: dropped.entry,
                                                words: dropped.words ?? t('packImport.unnamed'),
                                                reason: dropped.reason,
                                            })}
                                        </List.Item>
                                    ))}
                                </List>
                                {plan.dropped.length > LISTED ? (
                                    <Text size="xs" c="dimmed">
                                        {t('packImport.andMore', { count: plan.dropped.length - LISTED })}
                                    </Text>
                                ) : undefined}
                            </Stack>
                        )}
                        {plan.notices.length === 0 ? undefined : <ImportNotices notices={plan.notices} />}
                    </Stack>
                )}

                <Group justify="flex-end">
                    <Button variant="default" onClick={close}>
                        {t('packImport.cancel')}
                    </Button>
                    <Button
                        disabled={file === undefined || plan === undefined || plan.adding.length === 0}
                        loading={write.isPending}
                        onClick={() => {
                            if (file !== undefined) write.mutate(file, { onSuccess: close });
                        }}
                    >
                        {t('packImport.add')}
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}
