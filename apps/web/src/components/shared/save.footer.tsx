import { Button, Group, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export interface SaveFooterProps {
    /** While the save is in flight. */
    saving: boolean;
    /** Whether the last save went through and nothing has been changed since: the form is not dirty. */
    saved: boolean;
}

/**
 * The foot of a settings form: its Save button, and "Saved." beside it once the last save went through
 * and the operator has not touched the form since.
 *
 * "Saved." goes the moment the form is edited again, because it describes the values on screen and
 * those are no longer the ones saved. Four single-setting panels wrote this footer out by hand.
 */
export function SaveFooter({ saving, saved }: SaveFooterProps) {
    const { t } = useTranslation();
    return (
        <Group justify="flex-end" gap="md">
            {saved ? (
                <Text size="sm" c="dimmed">
                    {t('saveFooter.saved')}
                </Text>
            ) : undefined}
            <Button type="submit" loading={saving}>
                {t('action.save')}
            </Button>
        </Group>
    );
}
