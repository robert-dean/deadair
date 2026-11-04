import { useState } from 'react';
import { Button, Group, Stack } from '@mantine/core';
import type { SchedulePack } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { exportSchedule, useImportSchedule, usePreviewScheduleImport } from '../../api/schedule.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { PackImportModal, packFieldsIn } from '../shared/pack.import.modal';

/** The schedule as a file: saving this station's, and adding another's, switched off. */
export function ScheduleFileButtons() {
    const { t } = useTranslation('schedule');
    const preview = usePreviewScheduleImport();
    const write = useImportSchedule();
    const [importing, setImporting] = useState(false);
    const [exportFailed, setExportFailed] = useState<string | undefined>();

    const saveExport = async () => {
        setExportFailed(undefined);
        try {
            await exportSchedule();
        } catch (error) {
            setExportFailed(apiErrorMessage(error, t('file.exportFailedFallback')));
        }
    };

    return (
        <Stack gap="xs">
            <Group gap="xs">
                <Button size="xs" variant="default" onClick={() => void saveExport()}>
                    {t('file.export')}
                </Button>
                <Button size="xs" variant="default" onClick={() => setImporting(true)}>
                    {t('file.importOpen')}
                </Button>
            </Group>
            {exportFailed ? <ErrorAlert title={t('file.exportFailedTitle')}>{exportFailed}</ErrorAlert> : undefined}
            <PackImportModal
                opened={importing}
                onClose={() => setImporting(false)}
                title={t('file.import.title')}
                intro={t('file.import.intro')}
                addingLine={count => t('file.import.adding', { count })}
                read={text => packFieldsIn<SchedulePack>(text, ['format', 'version', 'name', 'slots'])}
                preview={preview}
                write={write}
            />
        </Stack>
    );
}
