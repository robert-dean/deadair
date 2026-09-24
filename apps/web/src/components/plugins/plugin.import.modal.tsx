import { useState } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { IconPackage, IconUpload, IconX } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { PluginImportResult } from '@deadair/sdk';

import { useImportPlugin } from '../../api/plugins.queries';
import { apiErrorMessage, sdkError } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { notifyDone } from '../shared/notify';

export interface PluginImportModalProps {
    opened: boolean;
    onClose(): void;
}

/**
 * The door into the plugins directory for somebody with no shell on the box: the tarball `npm pack`
 * writes, dropped in the browser.
 *
 * The copy repeats the trust stance in one line rather than implying a check that does not exist
 * (`packages/plugin-sdk/CLAUDE.md` § "Trust and egress"): the station reads a plugin's manifest by
 * loading its code, exactly as a rescan does, so importing is already running it. What landing
 * disabled buys is that the station does not USE it until somebody switches it on, and the trust
 * dialog asks the first time they do.
 */
export function PluginImportModal({ opened, onClose }: PluginImportModalProps) {
    const { t } = useTranslation(['plugins', 'common']);
    const importPlugin = useImportPlugin();
    const [file, setFile] = useState<File | undefined>(undefined);
    const [needsRestart, setNeedsRestart] = useState<string | undefined>(undefined);

    const close = () => {
        setFile(undefined);
        setNeedsRestart(undefined);
        importPlugin.reset();
        onClose();
    };

    const send = async () => {
        if (file === undefined) return;
        const body = new FormData();
        body.append('file', file);

        const result = await importPlugin.mutateAsync(body).catch(() => undefined);
        if (result === undefined) return;

        const name = nameOf(result);
        setFile(undefined);
        if (result.restartRequired) {
            // Kept open: this is the one outcome where the plugin on screen is not yet the plugin
            // that was dropped, and a toast that fades is the wrong place to say so.
            setNeedsRestart(name);
            return;
        }
        notifyDone(t('import.done', { name }));
        close();
    };

    return (
        <Modal opened={opened} onClose={close} title={t('import.title')} centered size="lg">
            <Stack gap="md">
                <Text size="sm">{t('import.warning')}</Text>

                {importPlugin.isError ? <ErrorAlert title={t('import.error.title')}>{importError(importPlugin.error, t)}</ErrorAlert> : undefined}

                {needsRestart === undefined ? undefined : (
                    <ErrorAlert tone="warning" title={t('import.restart.title')}>
                        {t('import.restart.body', { name: needsRestart })}
                    </ErrorAlert>
                )}

                <Dropzone
                    onDrop={files => {
                        setNeedsRestart(undefined);
                        setFile(files[0]);
                    }}
                    accept={ACCEPTED}
                    maxFiles={1}
                    multiple={false}
                    maxSize={MAX_BYTES}
                    loading={importPlugin.isPending}
                    inputProps={{ 'aria-label': t('import.dropzoneLabel') }}
                >
                    <Group justify="center" gap="md" mih={90} style={{ pointerEvents: 'none' }}>
                        <Dropzone.Accept>
                            <IconUpload size={32} />
                        </Dropzone.Accept>
                        <Dropzone.Reject>
                            <IconX size={32} />
                        </Dropzone.Reject>
                        <Dropzone.Idle>
                            <IconPackage size={32} />
                        </Dropzone.Idle>
                        <Stack gap={2}>
                            <Text size="sm">{file === undefined ? t('import.dropzonePrompt') : file.name}</Text>
                            <Text size="xs" c="dimmed">
                                {t('import.dropzoneHint')}
                            </Text>
                        </Stack>
                    </Group>
                </Dropzone>

                <Group justify="flex-end">
                    <Button variant="default" onClick={close} disabled={importPlugin.isPending}>
                        {needsRestart === undefined ? t('common:action.cancel') : t('import.close')}
                    </Button>
                    <Button
                        leftSection={<IconUpload size={16} />}
                        loading={importPlugin.isPending}
                        disabled={file === undefined}
                        onClick={() => void send()}
                    >
                        {t('import.submit')}
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}

/** What an import refusal means, in the operator's terms. The loader's own reason reaches them verbatim. */
function importError(error: unknown, t: TFunction<'plugins'>): string {
    if (sdkError(error)?.status === 403) return t('import.error.forbidden');
    return apiErrorMessage(error, t('import.error.fallback'));
}

/** The imported plugin's name as the catalogue now has it, or its id when it is somehow not listed. */
function nameOf(result: PluginImportResult): string {
    return result.plugins.find(plugin => plugin.id === result.pluginId)?.name ?? result.pluginId;
}

/**
 * What the dropzone offers. Keyed on the extension as much as the type, because browsers disagree
 * about what a `.tgz` is (`application/gzip`, `application/x-gzip`, `application/x-compressed-tar`,
 * or nothing at all). The server decides by the file's first bytes, and says why when it refuses.
 */
const ACCEPTED = {
    'application/gzip': ['.tgz', '.gz'],
    'application/x-gzip': ['.tgz', '.gz'],
    'application/x-compressed-tar': ['.tgz', '.gz'],
    'application/octet-stream': ['.tgz', '.gz'],
};

/** `MAX_PLUGIN_ARCHIVE_BYTES`, which the server enforces. Here so an obvious mistake is not a round trip. */
const MAX_BYTES = 64 * 1024 * 1024;
