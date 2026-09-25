import { Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

import { version } from '../../../package.json';
import { englishPack, languagePackFilename, languagePackText } from '../../i18n/language.pack';
import { saveDownload } from '../shared/download';

/**
 * The languages the console can be shown in, and the file a translation starts from.
 *
 * English is built in and, so far, the only one. What an operator can do here today is take the
 * console's English away as a language pack, the same file the release attaches, stamped with the
 * version it came from: a translator fills it in, and the same file comes back as a language.
 *
 * Not a station setting. What language the console is in has nothing to do with what the station
 * broadcasts in (`stream.language`), and the two are never wired together.
 */
export function LanguagesCard() {
    const { t } = useTranslation('settings');

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

                <Text size="xs" c="dimmed">
                    {t('languages.footnote')}
                </Text>
            </Stack>
        </Card>
    );
}
