import { useState } from 'react';
import { Alert, Button, Card, Center, Image, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useNavigate } from '@tanstack/react-router';

import { useLoginMutation } from '../api/auth.mutations';
import { isRateLimited, retryAfterMs } from '../api/retry.policy';
import { apiErrorDetails, apiErrorMessage, isInvalidToken } from '../api/sdk.error';
import { safeRedirectTarget } from '../auth/redirect.target';
import { ChallengePanel } from './auth/challenge.panel';
import { ErrorAlert } from './shared/error.alert';

interface LoginValues {
    email: string;
    password: string;
}

export interface LoginPageProps {
    /** The raw `?redirect=` value. Sanitised before it is followed. */
    redirect?: string;
}

/** The server's own wait, or a flat sentence when it did not say. */
function rateLimitedMessage(error: unknown): string {
    const wait = retryAfterMs(error);
    return wait === undefined
        ? 'Too many attempts. Wait a moment and try again.'
        : `Too many attempts. Try again in ${Math.ceil(wait / 1000)} seconds.`;
}

/**
 * What to tell the user about a failed sign-in, or undefined when the failure was field-level and
 * has already gone to the form. A rate limit gets the server's own wait rather than a flat retry,
 * because the login mutation deliberately does not retry itself.
 */
function signInError(error: unknown): string | undefined {
    if (isInvalidToken(error)) {
        return 'Invalid email or password';
    }
    if (isRateLimited(error)) {
        return rateLimitedMessage(error);
    }
    if (apiErrorDetails(error)) {
        return undefined;
    }
    return apiErrorMessage(error, 'Could not sign you in. Try again.');
}

export function LoginPage({ redirect }: LoginPageProps) {
    const navigate = useNavigate();
    const login = useLoginMutation();
    // A sentence that has to outlive the mutation it came from: the challenge expiring resets the
    // login, and the reset would take the explanation with it.
    const [notice, setNotice] = useState<string>();

    const form = useForm<LoginValues>({
        mode: 'uncontrolled',
        initialValues: { email: '', password: '' },
        validate: {
            email: value => (value.trim().length > 0 ? undefined : 'Enter your email address'),
            password: value => (value.length > 0 ? undefined : 'Enter your password'),
        },
    });

    async function submit(values: LoginValues): Promise<void> {
        setNotice(undefined);
        try {
            const response = await login.mutateAsync(values);
            // A 200 that stopped at a challenge, not a failure — hence the branch rather than a catch.
            if (response.result === 'mfa_required') {
                return;
            }
            await navigate({ to: safeRedirectTarget(redirect) });
        } catch (caught) {
            const details = apiErrorDetails(caught);
            if (details) {
                form.setErrors(details);
            }
        }
    }

    const challenge = login.data?.result === 'mfa_required' ? login.data : undefined;
    const error = login.error ? signInError(login.error) : undefined;

    return (
        <Center mih="70vh">
            <Card padding="xl" w="100%" maw={400}>
                <Stack gap="md">
                    {/* The one place the mark is the first thing you see: there is no shell
                        around this page, so the badge is what says which station you are at. */}
                    <Stack gap="xs" align="center">
                        <Image src="/logo-mark.png" alt="" aria-hidden w={64} h={64} />
                        <Stack gap="xxxs" align="center">
                            <Title order={2}>{challenge ? 'One more step' : 'Sign in'}</Title>
                            <Text c="dimmed" size="sm">
                                {challenge ? 'One more factor, and you are in.' : 'Station controls are staff only.'}
                            </Text>
                        </Stack>
                    </Stack>
                    {challenge ? (
                        <ChallengePanel
                            challenge={challenge}
                            onComplete={() => navigate({ to: safeRedirectTarget(redirect) })}
                            onExpired={() => {
                                login.reset();
                                setNotice('That sign-in timed out. Enter your password again.');
                            }}
                            onStartOver={() => {
                                login.reset();
                            }}
                        />
                    ) : (
                        <form
                            onSubmit={form.onSubmit(values => {
                                void submit(values);
                            })}
                        >
                            <Stack gap="md">
                                {notice ? (
                                    <Alert color="yellow" title="Start again">
                                        {notice}
                                    </Alert>
                                ) : undefined}
                                {error ? <ErrorAlert title="Sign-in failed">{error}</ErrorAlert> : undefined}
                                <TextInput
                                    label="Email"
                                    placeholder="you@example.com"
                                    type="email"
                                    autoComplete="username"
                                    disabled={login.isPending}
                                    key={form.key('email')}
                                    {...form.getInputProps('email')}
                                />
                                <PasswordInput
                                    label="Password"
                                    autoComplete="current-password"
                                    disabled={login.isPending}
                                    key={form.key('password')}
                                    {...form.getInputProps('password')}
                                />
                                <Button type="submit" loading={login.isPending} fullWidth>
                                    Sign in
                                </Button>
                            </Stack>
                        </form>
                    )}
                </Stack>
            </Card>
        </Center>
    );
}
