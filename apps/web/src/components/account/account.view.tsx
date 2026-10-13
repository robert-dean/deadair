import { Anchor, Box, Button, Card, Container, Group, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { SecurityCard } from '../settings/security.card';
import { StationMark } from '../shell/station.mark';

export interface AccountViewProps {
    loggingOut: boolean;
    onLogout: () => void;
}

/**
 * The console for somebody who holds no admin role: their own account, and the way to the apps.
 *
 * The rest of the console is the station's controls, and a listener reading the running order and
 * every setting was what this replaced: the API refused every change they tried, but nothing said
 * why they were looking at it. What is left is the one thing a listener does need a browser for:
 * how they sign in, which is also where they set up a new second step after an admin has reset theirs.
 */
export function AccountView({ loggingOut, onLogout }: AccountViewProps) {
    const { t } = useTranslation('account');
    const origin = window.location.origin;

    return (
        <Box>
            <Group h={52} px="md" justify="space-between" className="da-scanlines" style={{ borderBottom: '1px solid var(--da-border)' }}>
                <StationMark />
                <Button variant="default" size="compact-sm" loading={loggingOut} onClick={onLogout}>
                    {t('signOut')}
                </Button>
            </Group>
            <Container size={760} px="md" py="lg">
                <Stack gap="lg">
                    <Stack gap="xxs">
                        <Title order={1}>{t('title')}</Title>
                        <Text size="sm" c="dimmed">
                            {t('intro')}
                        </Text>
                    </Stack>

                    <Card padding="lg">
                        <Stack gap="sm">
                            <Title order={2} size="h4">
                                {t('listen.title')}
                            </Title>
                            <Group>
                                <Button component="a" href={`deadair://connect?station=${encodeURIComponent(origin)}`}>
                                    {t('listen.app')}
                                </Button>
                            </Group>
                            <Text size="sm" c="dimmed">
                                {t('listen.appHelp')}
                            </Text>
                            <Anchor href={`${origin}/live.mp3`} size="sm">
                                {t('listen.stream')}
                            </Anchor>
                        </Stack>
                    </Card>

                    <SecurityCard />
                </Stack>
            </Container>
        </Box>
    );
}
