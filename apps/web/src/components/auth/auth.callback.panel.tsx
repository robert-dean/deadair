import { Button, Card, Center, Image, Stack, Text, Title } from '@mantine/core';
import { Link, useNavigate } from '@tanstack/react-router';

import type { AuthCallbackOutcome } from '../../api/auth.callback.queries';
import { ErrorAlert } from '../shared/error.alert';
import { ChallengePanel } from './challenge.panel';

export interface AuthCallbackPanelProps {
    /** Anything but `signed-in`; the route navigates away on that one rather than drawing. */
    outcome: Exclude<AuthCallbackOutcome, { kind: 'signed-in' }>;
}

/**
 * What the console shows somebody who followed a sign-in link.
 *
 * Two endings. The link proved the inbox and the account also wants a second factor, in which case
 * the same panel a password sign-in uses is drawn here — a link is one factor, and an account with
 * an authenticator enrolled has not finished. Or the link was no good, which is usually not an
 * error at all: it is single use, and reloading the page or a mail scanner having fetched it first
 * both land here. Said in those words rather than as a status code.
 */
export function AuthCallbackPanel({ outcome }: AuthCallbackPanelProps) {
    const navigate = useNavigate();

    return (
        <Center mih="70vh">
            <Card padding="xl" w="100%" maw={400}>
                <Stack gap="md">
                    <Stack gap="xs" align="center">
                        <Image src="/logo-mark.png" alt="" aria-hidden w={64} h={64} />
                        <Stack gap="xxxs" align="center">
                            <Title order={2}>{outcome.kind === 'challenge' ? 'One more step' : 'Not signed in'}</Title>
                            <Text c="dimmed" size="sm">
                                {outcome.kind === 'challenge' ? 'One more factor, and you are in.' : 'That link did not get you in.'}
                            </Text>
                        </Stack>
                    </Stack>
                    {outcome.kind === 'challenge' ? (
                        <ChallengePanel
                            challenge={outcome.challenge}
                            onComplete={() => navigate({ to: '/' })}
                            onExpired={() => navigate({ to: '/login' })}
                            onStartOver={() => navigate({ to: '/login' })}
                            startOverLabel="Sign in another way"
                        />
                    ) : (
                        <Stack gap="md">
                            <ErrorAlert title={outcome.spent ? 'Link already used' : 'Sign-in failed'} tone={outcome.spent ? 'warning' : 'failure'}>
                                {outcome.message}
                            </ErrorAlert>
                            <Button renderRoot={(props: object) => <Link to="/login" {...props} />} fullWidth>
                                Back to sign in
                            </Button>
                        </Stack>
                    )}
                </Stack>
            </Card>
        </Center>
    );
}
