import { useState } from 'react';
import { Button, Code, FileButton, Group, List, Modal, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { version } from '../../../package.json';
import { useConsoleLanguages, useImportConsoleLanguage } from '../../api/languages.queries';
import { sdkError } from '../../api/sdk.error';
import { en } from '../../i18n/en/en.catalog';
import { checkLanguagePack, type LanguagePackReading } from '../../i18n/language.check';
import type { LanguagePack } from '../../i18n/language.pack';
import { formatDate } from '../shared/format.date';
import { ErrorAlert } from '../shared/error.alert';
import { usePhone } from '../shared/use.phone';

export interface LanguageImportModalProps {
    opened: boolean;
    onClose: () => void;
}

/** How many of a long list a preview names before it says how many more there are. */
const LISTED = 8;

/**
 * Importing a language pack: choose the file, see what this console makes of it, then install it.
 *
 * The preview is this console's own check (`i18n/language.check.ts`), run before anything is sent.
 * What it reports is what an operator reading the console in that language will actually get: how
 * much is translated, and which strings will show in English instead, because the pack lacks them or
 * got them wrong. None of that stops the install. A pack half translated is a pack half the console
 * can use, and English fills the rest string by string; the header alone can make a file unusable.
 *
 * Only an admin may install one. The console does not know who is an admin, as it does not
 * anywhere else, so anybody else finds out from the station's refusal.
 */
export function LanguageImportModal({ opened, onClose }: LanguageImportModalProps) {
    const phone = usePhone();
    const { t } = useTranslation(['settings', 'common']);
    const installed = useConsoleLanguages();
    const write = useImportConsoleLanguage();

    // What was read, held so Install sends exactly what was previewed rather than re-reading a file
    // the operator may have changed on disk in between.
    const [pack, setPack] = useState<LanguagePack | undefined>(undefined);
    const [reading, setReading] = useState<LanguagePackReading | undefined>(undefined);
    const [refusal, setRefusal] = useState<string | undefined>(undefined);

    const close = () => {
        setPack(undefined);
        setReading(undefined);
        setRefusal(undefined);
        write.reset();
        onClose();
    };

    const choose = async (file: File | null) => {
        if (file === null) return;
        setPack(undefined);
        setReading(undefined);
        setRefusal(undefined);
        write.reset();

        let parsed: unknown;
        try {
            parsed = JSON.parse(await file.text());
        } catch {
            setRefusal(t('languages.import.unreadable', { name: file.name }));
            return;
        }

        const check = checkLanguagePack(parsed, en);
        if (!check.ok) {
            setRefusal(t(`languages.import.refusal.${check.refusal}`, { name: file.name }));
            return;
        }
        // The header as the check read it (the tag canonical, the name trimmed) over the file's own.
        setPack({ ...(parsed as LanguagePack), locale: check.locale, name: check.name });
        setReading(check);
    };

    const install = () => {
        if (pack === undefined) return;
        write.mutate(pack, { onSuccess: close });
    };

    const replacing = reading === undefined ? undefined : installed.data?.languages.find(language => language.locale === reading.locale);
    const percent = reading === undefined || reading.total === 0 ? 0 : Math.floor((reading.translated / reading.total) * 100);

    return (
        <Modal opened={opened} onClose={close} title={t('languages.import.title')} size="lg" fullScreen={phone}>
            <Stack gap="md">
                <Text size="sm">{t('languages.import.intro')}</Text>

                <Group>
                    <FileButton onChange={file => void choose(file)} accept="application/json,.json">
                        {props => (
                            <Button variant="default" {...props}>
                                {reading === undefined ? t('languages.import.choose') : t('languages.import.chooseAnother')}
                            </Button>
                        )}
                    </FileButton>
                </Group>

                {refusal ? <ErrorAlert title={t('languages.import.refusedTitle')}>{refusal}</ErrorAlert> : undefined}

                {reading ? (
                    <Stack gap="sm">
                        <Text fw={600}>
                            {reading.name} <Code>{reading.locale}</Code>
                        </Text>
                        <Text size="sm">{t('languages.import.coverage', { translated: reading.translated, total: reading.total, percent })}</Text>
                        {reading.direction === 'rtl' ? <Text size="sm">{t('languages.import.rightToLeft')}</Text> : undefined}
                        {reading.madeFor !== '' && reading.madeFor !== version ? (
                            <Text size="sm" c="dimmed">
                                {t('languages.import.madeFor', { madeFor: reading.madeFor, version })}
                            </Text>
                        ) : undefined}
                        {replacing ? (
                            <Text size="sm" c="dimmed">
                                {t('languages.import.replaces', { name: replacing.name, date: formatDate(replacing.importedAt) })}
                            </Text>
                        ) : undefined}

                        <KeyList
                            title={t('languages.import.faults', { count: reading.faults.length })}
                            keys={reading.faults.map(fault => `${fault.key} (${t(`languages.import.fault.${fault.fault}`)})`)}
                        />
                        <KeyList title={t('languages.import.unknown', { count: reading.unknown.length })} keys={reading.unknown} />
                    </Stack>
                ) : undefined}

                {/* A 403 says only "Forbidden"; the console's own sentence says who may. */}
                {write.error ? (
                    <ErrorAlert
                        title={t('languages.import.failedTitle')}
                        error={sdkError(write.error)?.status === 403 ? undefined : write.error}
                        fallback={t('languages.import.failed')}
                    />
                ) : undefined}

                <Group justify="flex-end">
                    <Button variant="default" onClick={close}>
                        {t('common:action.cancel')}
                    </Button>
                    <Button onClick={install} disabled={pack === undefined} loading={write.isPending}>
                        {reading ? t('languages.import.install', { name: reading.name }) : t('languages.import.installNothing')}
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}

/** A count, and the first few keys it is counting, for a translator to go and fix. */
function KeyList({ title, keys }: { title: string; keys: string[] }) {
    const { t } = useTranslation('settings');
    if (keys.length === 0) return undefined;
    return (
        <Stack gap={4}>
            <Text size="sm">{title}</Text>
            <List size="xs" spacing={2}>
                {keys.slice(0, LISTED).map(key => (
                    <List.Item key={key}>
                        <Code>{key}</Code>
                    </List.Item>
                ))}
            </List>
            {keys.length > LISTED ? (
                <Text size="xs" c="dimmed">
                    {t('languages.import.andMore', { count: keys.length - LISTED })}
                </Text>
            ) : undefined}
        </Stack>
    );
}
