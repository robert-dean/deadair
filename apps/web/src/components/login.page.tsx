import { useRef, useState } from 'react';
import { Alert, Button, Card, Center, Group, Image, PasswordInput, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useNavigate } from '@tanstack/react-router';
import type { MfaRequiredResponseOutput } from '@deadair/sdk';

import { authenticatorFactors, useMfaCodeMutation } from '../api/auth.factors.queries';
import { useLoginMutation } from '../api/auth.mutations';
import { isRateLimited, retryAfterMs } from '../api/retry.policy';
import { apiErrorDetails, apiErrorMessage, authChallenge, isInvalidToken } from '../api/sdk.error';
import { safeRedirectTarget } from '../auth/redirect.target';
import { ErrorAlert } from './shared/error.alert';
import { ONE_TIME_CODE_LENGTH, OneTimeCodeInput } from './shared/one.time.code.input';

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

/**
 * What to tell the user about a refused code. An expired challenge is not reported here: it sends
 * the page back to the password step, which is where the sentence about it belongs.
 */
function codeError(error: unknown): string {
    if (isInvalidToken(error)) {
        return 'That code was not accepted. Wait for the next one and try again.';
    }
    if (isRateLimited(error)) {
        return rateLimitedMessage(error);
    }
    return apiErrorMessage(error, 'Could not check that code. Try again.');
}

/** Whether the API said the challenge itself is gone, rather than the code being wrong. */
function challengeExpired(error: unknown): boolean {
    return authChallenge(error)?.error === 'invalid_challenge';
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
                                {challenge ? 'Enter the code from your authenticator app.' : 'Station controls are staff only.'}
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

interface ChallengePanelProps {
    challenge: MfaRequiredResponseOutput;
    /** The code was accepted and the session is stored. */
    onComplete: () => void | Promise<void>;
    /** The challenge is gone; the password has to be entered again. */
    onExpired: () => void;
    onStartOver: () => void;
}

/**
 * The second half of a sign-in that stopped at `mfa_required`.
 *
 * Offers only what this console can present, which is an authenticator. A challenge listing more
 * than one lets the operator say which phone; one listing none at all (a passkey enrolled through
 * the API, say) is told so plainly rather than shown a field no code can satisfy.
 */
function ChallengePanel({ challenge, onComplete, onExpired, onStartOver }: ChallengePanelProps) {
    const factors = authenticatorFactors({ challengeId: challenge.challenge_id, factors: challenge.factors });
    const submitCode = useMfaCodeMutation();
    const [code, setCode] = useState('');
    const [methodId, setMethodId] = useState<string | undefined>(factors[0]?.method_id);
    // The field submits itself on the sixth digit and the button submits too, and a code is
    // accepted exactly once: the second request would burn an attempt against a spent challenge.
    // A ref rather than `isPending`, which is state and lands a render too late to stop it.
    const inflight = useRef(false);

    async function verify(value: string): Promise<void> {
        if (inflight.current || methodId === undefined || value.length !== ONE_TIME_CODE_LENGTH) return;
        inflight.current = true;
        try {
            const response = await submitCode.mutateAsync({ challengeId: challenge.challenge_id, methodId, code: value });
            if (response.result === 'token') {
                await onComplete();
            }
        } catch (caught) {
            if (challengeExpired(caught)) {
                onExpired();
            }
        } finally {
            inflight.current = false;
        }
    }

    if (factors.length === 0) {
        return (
            <Stack gap="md">
                <Alert color="yellow" title="Second factor required">
                    This account needs a second factor that this console cannot present. Sign in with the factor you enrolled, or ask whoever runs the
                    station to reset it.
                </Alert>
                <Button variant="default" onClick={onStartOver} fullWidth>
                    Start over
                </Button>
            </Stack>
        );
    }

    const failure = submitCode.error && !challengeExpired(submitCode.error) ? codeError(submitCode.error) : undefined;
    const anotherFactor =
        submitCode.data?.result === 'mfa_required' ? 'The station asked for yet another factor, which this console cannot present.' : undefined;

    return (
        <form
            onSubmit={event => {
                event.preventDefault();
                void verify(code);
            }}
        >
            <Stack gap="md">
                {(failure ?? anotherFactor) ? <ErrorAlert title="Not signed in">{failure ?? anotherFactor}</ErrorAlert> : undefined}
                {factors.length > 1 ? (
                    <Select
                        label="Which authenticator"
                        data={factors.map(factor => ({ value: factor.method_id, label: factor.label ?? 'Authenticator' }))}
                        value={methodId}
                        onChange={value => setMethodId(value ?? undefined)}
                        allowDeselect={false}
                        disabled={submitCode.isPending}
                    />
                ) : undefined}
                <OneTimeCodeInput
                    label="Authenticator code"
                    value={code}
                    onChange={setCode}
                    onComplete={value => void verify(value)}
                    disabled={submitCode.isPending}
                />
                <Button type="submit" loading={submitCode.isPending} disabled={code.length !== ONE_TIME_CODE_LENGTH} fullWidth>
                    Verify
                </Button>
                <Group justify="center">
                    <Button variant="subtle" size="compact-sm" onClick={onStartOver} disabled={submitCode.isPending}>
                        Start over
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}
