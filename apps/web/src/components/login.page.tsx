import { useState } from 'react';
import { Alert, Button, Card, Center, Divider, Group, Image, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { useLoginMutation, useMagicLinkMutation, useOidcSignInMutation } from '../api/auth.mutations';
import { useSigninProviders } from '../api/auth.providers.queries';
import { isRateLimited, retryAfterMs } from '../api/retry.policy';
import { apiErrorDetails, apiErrorMessage, isInvalidToken } from '../api/sdk.error';
import { safeRedirectTarget } from '../auth/redirect.target';
import { i18n } from '../i18n/i18n.setup';
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
    return wait === undefined ? i18n.t('auth:rateLimited.wait') : i18n.t('auth:rateLimited.retryIn', { seconds: Math.ceil(wait / 1000) });
}

/**
 * What to tell the user about a failed sign-in, or undefined when the failure was field-level and
 * has already gone to the form. A rate limit gets the server's own wait rather than a flat retry,
 * because the login mutation deliberately does not retry itself.
 */
function signInError(error: unknown): string | undefined {
    if (isInvalidToken(error)) {
        return i18n.t('auth:login.invalid');
    }
    if (isRateLimited(error)) {
        return rateLimitedMessage(error);
    }
    if (apiErrorDetails(error)) {
        return undefined;
    }
    return apiErrorMessage(error, i18n.t('auth:login.fallback'));
}

export function LoginPage({ redirect }: LoginPageProps) {
    const { t } = useTranslation('auth');
    const navigate = useNavigate();
    const login = useLoginMutation();
    const magicLink = useMagicLinkMutation();
    const providers = useSigninProviders().data ?? [];
    const oidc = useOidcSignInMutation();
    // A sentence that has to outlive the mutation it came from: the challenge expiring resets the
    // login, and the reset would take the explanation with it.
    const [notice, setNotice] = useState<string>();

    const form = useForm<LoginValues>({
        mode: 'uncontrolled',
        initialValues: { email: '', password: '' },
        validate: {
            email: value => (value.trim().length > 0 ? undefined : t('login.emailRequired')),
            password: value => (value.length > 0 ? undefined : t('login.passwordRequired')),
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
            // `href` rather than `to`: the target is a path that may carry a query (an app's
            // authorization request does), and `to` would read the whole of it as a path.
            await navigate({ href: safeRedirectTarget(redirect) });
        } catch (caught) {
            const details = apiErrorDetails(caught);
            if (details) {
                form.setErrors(details);
            }
        }
    }

    const challenge = login.data?.result === 'mfa_required' ? login.data : undefined;
    const error = login.error ? signInError(login.error) : undefined;
    const linkSent = magicLink.isSuccess;

    /**
     * Ask for a sign-in link.
     *
     * Validates the email field alone: the password is what this is an alternative to, so requiring
     * it to be filled in first would defeat the point.
     */
    function requestLink(): void {
        setNotice(undefined);
        const email = form.getValues().email.trim();
        if (email.length === 0) {
            form.setFieldError('email', t('login.emailRequired'));
            return;
        }
        magicLink.mutate({ email });
    }

    // Read before the JSX rather than spread from inside it: the literal-string rule reads a field
    // name in a spread attribute as copy, and these are form keys, not words.
    const emailInput = form.getInputProps('email');
    const passwordInput = form.getInputProps('password');

    return (
        <Center mih="70vh">
            <Card padding="xl" w="100%" maw={400}>
                <Stack gap="md">
                    {/* The one place the mark is the first thing you see: there is no shell
                        around this page, so the badge is what says which station you are at. */}
                    <Stack gap="xs" align="center">
                        <Image src="/logo-mark.png" alt="" aria-hidden w={64} h={64} />
                        <Stack gap="xxxs" align="center">
                            <Title order={2}>{challenge ? t('step.title') : linkSent ? t('login.checkInbox') : t('login.signIn')}</Title>
                            <Text c="dimmed" size="sm">
                                {challenge ? t('step.subtitle') : linkSent ? t('login.linkOnItsWay') : t('login.staffOnly')}
                            </Text>
                        </Stack>
                    </Stack>
                    {challenge ? (
                        <ChallengePanel
                            challenge={challenge}
                            onComplete={() => navigate({ href: safeRedirectTarget(redirect) })}
                            onExpired={() => {
                                login.reset();
                                setNotice(t('login.timedOut'));
                            }}
                            onStartOver={() => {
                                login.reset();
                            }}
                        />
                    ) : linkSent ? (
                        <Stack gap="md">
                            <Text size="sm">{t('login.linkHint')}</Text>
                            <Button
                                variant="default"
                                onClick={() => {
                                    magicLink.reset();
                                }}
                                fullWidth
                            >
                                {t('login.usePassword')}
                            </Button>
                        </Stack>
                    ) : (
                        <form
                            onSubmit={form.onSubmit(values => {
                                void submit(values);
                            })}
                        >
                            <Stack gap="md">
                                {notice ? (
                                    <Alert color="yellow" title={t('login.startAgain')}>
                                        {notice}
                                    </Alert>
                                ) : undefined}
                                {error ? <ErrorAlert title={t('signInFailed')}>{error}</ErrorAlert> : undefined}
                                {oidc.error ? (
                                    <ErrorAlert title={t('login.providerFailedTitle')} error={oidc.error} fallback={t('login.providerFailed')} />
                                ) : undefined}
                                {magicLink.error ? (
                                    <ErrorAlert title={t('login.noLinkSent')} error={magicLink.error} fallback={t('login.linkFailed')} />
                                ) : undefined}
                                <TextInput
                                    label={t('login.email')}
                                    placeholder={t('login.emailPlaceholder')}
                                    type="email"
                                    autoComplete="username"
                                    disabled={login.isPending}
                                    key={form.key('email')}
                                    {...emailInput}
                                />
                                <PasswordInput
                                    label={t('login.password')}
                                    autoComplete="current-password"
                                    disabled={login.isPending}
                                    key={form.key('password')}
                                    {...passwordInput}
                                />
                                <Button type="submit" loading={login.isPending} fullWidth>
                                    {t('login.signIn')}
                                </Button>
                                {/* An alternative to the password rather than a step after it, so
                                    it asks for nothing but the address already typed above. */}
                                <Group justify="center">
                                    <Button
                                        variant="subtle"
                                        size="compact-sm"
                                        loading={magicLink.isPending}
                                        disabled={login.isPending}
                                        onClick={requestLink}
                                    >
                                        {t('login.emailLink')}
                                    </Button>
                                </Group>
                                {/* Only when the operator has set one up, so a station without any
                                    looks exactly as it did. Each leaves the console for the provider,
                                    which sends the browser back to /auth/callback. */}
                                {providers.length > 0 ? (
                                    <Stack gap="xs">
                                        <Divider label={t('login.or')} labelPosition="center" />
                                        {providers.map(provider => (
                                            <Button
                                                key={provider.name}
                                                variant="default"
                                                fullWidth
                                                loading={oidc.isPending && oidc.variables?.provider === provider.name}
                                                disabled={login.isPending || (oidc.isPending && oidc.variables?.provider !== provider.name)}
                                                onClick={() => {
                                                    setNotice(undefined);
                                                    oidc.mutate({ provider: provider.name, redirect: safeRedirectTarget(redirect) });
                                                }}
                                            >
                                                {t('login.continueWith', { provider: provider.label })}
                                            </Button>
                                        ))}
                                    </Stack>
                                ) : undefined}
                            </Stack>
                        </form>
                    )}
                </Stack>
            </Card>
        </Center>
    );
}
