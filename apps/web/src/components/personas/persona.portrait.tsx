import { useState } from 'react';
import { Button, Group, Stack, Text } from '@mantine/core';
import { IconPhoto } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

import { artSrc } from '../../api/art';
import { usePersonaPortraits, useRemovePersonaPortrait, useReplacePersonaPortrait } from '../../api/persona.portrait.queries';
import { ConfirmModal } from '../shared/confirm.modal';
import { ErrorAlert } from '../shared/error.alert';
import { UploadDropzone } from '../shared/upload.dropzone';

/** What the API takes, decided there by the bytes. Here so a wrong file is refused before it is sent. */
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * A picture of the presenter, which a listener's player shows while this persona is on air.
 *
 * Saved the moment it is dropped rather than with the sheet around it, which the description says:
 * it is a file rather than a field, and holding a dropped picture until Save would mean holding bytes
 * in a form that can be discarded.
 */
export function PersonaPortrait({ personaId, name }: { personaId: string; name: string }) {
    const { t } = useTranslation('personas');
    const portraits = usePersonaPortraits();
    const replace = useReplacePersonaPortrait();
    const remove = useRemovePersonaPortrait();
    const [removing, setRemoving] = useState(false);

    const portrait = portraits.data?.portraits.find(candidate => candidate.personaId === personaId);
    const busy = replace.isPending || remove.isPending;

    return (
        <Stack gap="xs">
            <Stack gap={2}>
                <Text size="sm" fw={500}>
                    {t('portrait.label')}
                </Text>
                <Text size="xs" c="dimmed">
                    {t('portrait.description')}
                </Text>
            </Stack>

            {portraits.isError ? <ErrorAlert title={t('portrait.readFailed')} error={portraits.error} /> : undefined}
            {replace.isError ? <ErrorAlert title={t('portrait.replaceFailed')} error={replace.error} /> : undefined}

            <Group gap="md" align="center" wrap="nowrap">
                {portrait === undefined ? undefined : (
                    <img
                        src={artSrc(portrait.url)}
                        alt={t('portrait.alt', { name })}
                        width={72}
                        height={72}
                        style={{ borderRadius: 'var(--mantine-radius-sm)', objectFit: 'cover', flexShrink: 0 }}
                    />
                )}
                <UploadDropzone
                    icon={IconPhoto}
                    iconSize={24}
                    minHeight={56}
                    prompt={portrait === undefined ? t('portrait.drop.add') : t('portrait.drop.replace')}
                    style={{ flex: 1 }}
                    onDrop={files => {
                        const file = files[0];
                        if (file === undefined) return;
                        const body = new FormData();
                        body.append('file', file);
                        replace.mutate({ personaId, body });
                    }}
                    accept={ACCEPTED}
                    maxSize={MAX_BYTES}
                    maxFiles={1}
                    loading={busy}
                />
                {portrait === undefined ? undefined : (
                    <Button variant="default" size="xs" disabled={busy} onClick={() => setRemoving(true)}>
                        {t('portrait.remove')}
                    </Button>
                )}
            </Group>

            <ConfirmModal
                opened={removing}
                title={t('portrait.removeTitle', { name })}
                confirmLabel={t('portrait.removeConfirm')}
                confirming={remove.isPending}
                error={remove.error}
                errorTitle={t('portrait.removeFailed')}
                onConfirm={() => remove.mutate(personaId, { onSuccess: () => setRemoving(false) })}
                onClose={() => {
                    remove.reset();
                    setRemoving(false);
                }}
            >
                {t('portrait.removeBody')}
            </ConfirmModal>
        </Stack>
    );
}
