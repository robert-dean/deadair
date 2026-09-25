import { useMemo, useState } from 'react';
import { Badge, Button, Card, Code, Group, Select, Stack, Text, Title } from '@mantine/core';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import type { ConsoleLanguage } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { version } from '../../../package.json';
import {
    exportConsoleLanguage,
    useChooseConsoleLanguage,
    useConsoleLanguageChoice,
    useConsoleLanguagePack,
    useConsoleLanguages,
    useRemoveConsoleLanguage,
} from '../../api/languages.queries';
import { sdkError } from '../../api/sdk.error';
import { en } from '../../i18n/en/en.catalog';
import { checkLanguagePack } from '../../i18n/language.check';
import { englishPack, languagePackFilename, languagePackText } from '../../i18n/language.pack';
import { ConfirmModal } from '../shared/confirm.modal';
import { saveDownload } from '../shared/download';
import { ErrorAlert } from '../shared/error.alert';
import { formatDate } from '../shared/format.date';
import { LanguageImportModal } from './language.import';

/**
 * The languages the console can be shown in, and the file a translation starts from.
 *
 * English is built in. Every other language is a language pack an admin imported, stored on the
 * station for every operator's console to load; this card lists them, imports one with a preview,
 * exports one back out for its translator to carry on, and removes one. Anybody who is not an admin
 * sees the same card and is refused by the station if they try to change it.
 *
 * Not a station setting. What language the console is in has nothing to do with what the station
 * broadcasts in (`stream.language`), and the two are never wired together.
 */
export function LanguagesCard() {
    const { t } = useTranslation('settings');
    const languages = useConsoleLanguages();
    const [importing, setImporting] = useState(false);

    const exportEnglish = () => {
        const pack = englishPack(version);
        saveDownload(languagePackText(pack), languagePackFilename(pack), 'application/json');
    };

    return (
        // The anchor the section list and the command palette both jump to, clear of the sticky header.
        <Card padding="lg" id="languages" style={{ scrollMarginTop: 76 }}>
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        {t('languages.title')}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {t('languages.intro')}
                    </Text>
                </Stack>

                <LanguagePicker languages={languages.data?.languages ?? []} />

                <Group justify="space-between" wrap="wrap" gap="sm">
                    <Stack gap={2}>
                        <Text size="sm" fw={500}>
                            {t('languages.english.name')}
                        </Text>
                        <Text size="xs" c="dimmed">
                            {t('languages.english.builtIn', { version })}
                        </Text>
                    </Stack>
                    <Button variant="default" leftSection={<IconDownload size={16} />} onClick={exportEnglish}>
                        {t('languages.english.export')}
                    </Button>
                </Group>

                {languages.error ? (
                    <ErrorAlert title={t('languages.listFailed')} error={languages.error} fallback={t('languages.listFailedBody')} />
                ) : undefined}
                {languages.data?.languages.map(language => (
                    <InstalledLanguage key={language.locale} language={language} />
                ))}

                <Group justify="space-between" wrap="wrap" gap="sm">
                    <Text size="xs" c="dimmed" maw={520}>
                        {t('languages.footnote')}
                    </Text>
                    <Button leftSection={<IconUpload size={16} />} onClick={() => setImporting(true)}>
                        {t('languages.import.open')}
                    </Button>
                </Group>
            </Stack>
            <LanguageImportModal opened={importing} onClose={() => setImporting(false)} />
        </Card>
    );
}

/** The value the picker uses for "no choice": follow the browser. A `Select` needs a string. */
const FOLLOW_BROWSER = '';

/**
 * Which language YOUR console is shown in, kept with your account so it follows you from browser to
 * browser. Anybody who can use the console may choose for themselves (`platform.view`, which every
 * operator role grants); nothing about it needs an admin.
 *
 * "As this browser prefers" is a choice of its own: it is what an operator who never chose has, and
 * picking it forgets a choice so the browser decides again. Each language is named in itself,
 * because an operator looking for their own language is looking for the word they know.
 */
function LanguagePicker({ languages }: { languages: readonly ConsoleLanguage[] }) {
    const { t } = useTranslation('settings');
    const choice = useConsoleLanguageChoice();
    const choose = useChooseConsoleLanguage();

    const data = [
        { value: FOLLOW_BROWSER, label: t('languages.picker.browser') },
        { value: 'en', label: t('languages.english.name') },
        ...languages.map(language => ({ value: language.locale, label: language.name })),
    ];

    return (
        <Stack gap="xs">
            <Select
                label={t('languages.picker.label')}
                description={t('languages.picker.description')}
                data={data}
                value={choice.data?.locale ?? FOLLOW_BROWSER}
                allowDeselect={false}
                disabled={choice.isPending || choose.isPending}
                onChange={value => choose.mutate(value === null || value === FOLLOW_BROWSER ? undefined : value)}
                maw={360}
            />
            {choose.error ? (
                <ErrorAlert title={t('languages.picker.failedTitle')} error={choose.error} fallback={t('languages.picker.failed')} />
            ) : undefined}
        </Stack>
    );
}

/**
 * One imported language: what it is, how much of this console it covers, and the two things an admin
 * does with it.
 *
 * The coverage is this console's own reading of the pack, not a figure stored with it, because it
 * moves with the console: an upgrade adds strings the pack has never seen.
 */
function InstalledLanguage({ language }: { language: ConsoleLanguage }) {
    const { t } = useTranslation('settings');
    const pack = useConsoleLanguagePack(language.locale);
    const remove = useRemoveConsoleLanguage();
    const [confirming, setConfirming] = useState(false);
    const [exportFailed, setExportFailed] = useState<unknown>(undefined);

    const reading = useMemo(() => (pack.data === undefined ? undefined : checkLanguagePack(pack.data, en)), [pack.data]);
    const percent = reading?.ok === true && reading.total > 0 ? Math.floor((reading.translated / reading.total) * 100) : undefined;

    const exportPack = () => {
        setExportFailed(undefined);
        exportConsoleLanguage(language.locale).catch(setExportFailed);
    };

    return (
        <Stack gap="xs">
            <Group justify="space-between" wrap="wrap" gap="sm">
                <Stack gap={2}>
                    <Group gap="xs">
                        <Text size="sm" fw={500}>
                            {language.name}
                        </Text>
                        <Code>{language.locale}</Code>
                        {percent === undefined ? undefined : (
                            <Badge variant="light" color={percent === 100 ? 'green' : 'yellow'}>
                                {t('languages.installed.coverage', { percent })}
                            </Badge>
                        )}
                    </Group>
                    <Text size="xs" c="dimmed">
                        {language.madeFor === ''
                            ? t('languages.installed.imported', { date: formatDate(language.importedAt) })
                            : t('languages.installed.importedFor', { date: formatDate(language.importedAt), madeFor: language.madeFor })}
                    </Text>
                </Stack>
                <Group gap="xs">
                    <Button variant="default" size="compact-sm" leftSection={<IconDownload size={14} />} onClick={exportPack}>
                        {t('languages.installed.export')}
                    </Button>
                    <Button variant="subtle" color="red" size="compact-sm" onClick={() => setConfirming(true)}>
                        {t('languages.installed.remove')}
                    </Button>
                </Group>
            </Group>
            {exportFailed ? (
                <ErrorAlert title={t('languages.installed.exportFailed')} error={exportFailed} fallback={t('languages.installed.exportFailedBody')} />
            ) : undefined}

            <ConfirmModal
                opened={confirming}
                onClose={() => setConfirming(false)}
                onConfirm={() => remove.mutate(language.locale, { onSuccess: () => setConfirming(false) })}
                title={t('languages.remove.title', { name: language.name })}
                confirmLabel={t('languages.remove.confirm')}
                confirming={remove.isPending}
                // A 403 says only "Forbidden"; the console's own sentence says who may.
                error={sdkError(remove.error)?.status === 403 ? new Error() : remove.error}
                errorTitle={t('languages.remove.failedTitle')}
                errorFallback={t('languages.remove.failed')}
            >
                {t('languages.remove.body', { name: language.name })}
            </ConfirmModal>
        </Stack>
    );
}
