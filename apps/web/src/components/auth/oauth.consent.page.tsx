import { useEffect } from 'react';
import { Alert, Badge, Button, Card, Center, Group, Image, Loader, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { Trans, useTranslation } from 'react-i18next';

import { useApproveAuthorization, useAuthorizationRequest, useDenyAuthorization } from '../../api/oauth.queries';
import { isStepUpCancelled, StepUpDialog, useStepUpGate } from '../settings/step.up.dialog';
import { ErrorAlert } from '../shared/error.alert';

export interface OAuthConsentPageProps {
    /** The query string the app sent the browser here with, as `window.location.search` holds it. */
    query: string;
    /** Where the browser goes next. `window.location.assign` in the app; a spy in a test. */
    leave?: (url: string) => void;
}

/**
 * Where an app asks to act as the signed-in person, and they say yes or no.
 *
 * The app sent the browser here with an OAuth authorization request in the query string. The station
 * validates it and stashes it for this person; this page shows what it found and sends back their
 * answer. Either answer leaves the console for the app's own address, carrying a code or a refusal.
 *
 * Three outcomes of reading the request. A good one is shown for a decision. One the app got wrong in
 * a way it should hear about (a scope, a missing challenge) goes straight back to it. One naming an
 * app the station does not know, or an address the app did not register, is shown here and never
 * followed, because following it is how an authorization server becomes an open redirect.
 *
 * What the app can do is what the person can do: the page says so plainly rather than listing scopes
 * nothing checks. The address it will be sent back to is shown, because that is who actually
 * receives the approval, and a warning when every address it registered is this computer's own,
 * which only an app running on it should need.
 */
export function OAuthConsentPage({ query, leave = url => window.location.assign(url) }: OAuthConsentPageProps) {
    const { t } = useTranslation('auth');
    const request = useAuthorizationRequest(query);
    const approve = useApproveAuthorization();
    const deny = useDenyAuthorization();
    const gate = useStepUpGate();

    const result = request.data;

    // A request the app should hear about goes back to it without anybody being asked.
    useEffect(() => {
        if (result?.kind === 'redirect') leave(result.redirectUrl);
    }, [result, leave]);

    async function answer(allow: boolean, requestId: string): Promise<void> {
        try {
            const outcome = allow ? await gate.run(() => approve.mutateAsync(requestId)) : await deny.mutateAsync(requestId);
            leave(outcome.redirectUrl);
        } catch (caught) {
            // The re-verify dialog was closed without a code: nothing was approved, and the page stays.
            if (isStepUpCancelled(caught)) return;
        }
    }

    return (
        <Center mih="70vh">
            <Card padding="xl" w="100%" maw={440}>
                <Stack gap="md">
                    {request.isPending || result?.kind === 'redirect' ? (
                        <Group gap="sm" justify="center">
                            <Loader size="sm" />
                            <Text c="dimmed" size="sm">
                                {result?.kind === 'redirect' ? t('consent.sendingBack') : t('consent.reading')}
                            </Text>
                        </Group>
                    ) : undefined}

                    {request.error ? (
                        <ErrorAlert title={t('consent.readFailedTitle')} error={request.error} fallback={t('consent.readFailed')} />
                    ) : undefined}

                    {result?.kind === 'refuse' ? (
                        <Stack gap="xs">
                            <Title order={2}>{t('consent.refusedHeading')}</Title>
                            <ErrorAlert title={t('consent.refused')}>{result.description}</ErrorAlert>
                            <Text size="sm" c="dimmed">
                                {t('consent.nothingSent')}
                            </Text>
                        </Stack>
                    ) : undefined}

                    {result?.kind === 'context' ? (
                        <Stack gap="md">
                            <Stack gap="xs" align="center">
                                {result.logoUri ? <Image src={result.logoUri} alt="" w={48} h={48} fit="contain" /> : undefined}
                                <Title order={2} ta="center">
                                    {t('consent.wantsToConnect', { client: result.clientName ?? t('consent.anApp') })}
                                </Title>
                                <Badge variant="light" color="gray">
                                    {t(`consent.kind.${result.clientKind}`)}
                                </Badge>
                            </Stack>

                            <Text size="sm">{t('consent.canDo')}</Text>
                            <Text size="sm">
                                <Trans
                                    t={t}
                                    i18nKey="consent.answerSentTo"
                                    values={{ host: result.redirectHost }}
                                    components={{ strong: <strong /> }}
                                />
                            </Text>

                            {result.loopbackOnly ? (
                                <Alert color="yellow" icon={<IconAlertTriangle size={16} />} title={t('consent.loopbackTitle')}>
                                    {t('consent.loopback')}
                                </Alert>
                            ) : undefined}

                            {approve.error ? (
                                <ErrorAlert title={t('consent.notApproved')} error={approve.error} fallback={t('consent.notApprovedFallback')} />
                            ) : undefined}
                            {deny.error ? (
                                <ErrorAlert title={t('consent.notSent')} error={deny.error} fallback={t('consent.notSentFallback')} />
                            ) : undefined}

                            <Group grow>
                                <Button
                                    variant="default"
                                    loading={deny.isPending}
                                    disabled={approve.isPending}
                                    onClick={() => void answer(false, result.requestId)}
                                >
                                    {t('consent.deny')}
                                </Button>
                                <Button loading={approve.isPending} disabled={deny.isPending} onClick={() => void answer(true, result.requestId)}>
                                    {t('consent.allow')}
                                </Button>
                            </Group>
                        </Stack>
                    ) : undefined}
                </Stack>
            </Card>
            <StepUpDialog gate={gate} />
        </Center>
    );
}
