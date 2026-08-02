import { useState } from 'react';
import { Alert, Button, Card, Center, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useNavigate } from '@tanstack/react-router';
import { SdkError } from '@deadair/sdk';

import { sdk } from '../api/client';
import { apiErrorDetails, apiErrorMessage } from '../api/sdk.error';
import { safeRedirectTarget } from '../auth/redirect.target';
import { setSession } from '../auth/session.store';

interface LoginValues {
    email: string;
    password: string;
}

export interface LoginPageProps {
    /** The raw `?redirect=` value. Sanitised before it is followed. */
    redirect?: string;
}

export function LoginPage({ redirect }: LoginPageProps) {
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);
    const [mfaRequired, setMfaRequired] = useState(false);

    const form = useForm<LoginValues>({
        mode: 'uncontrolled',
        initialValues: { email: '', password: '' },
        validate: {
            email: value => (value.trim().length > 0 ? undefined : 'Enter your email address'),
            password: value => (value.length > 0 ? undefined : 'Enter your password'),
        },
    });

    async function submit(values: LoginValues): Promise<void> {
        setSubmitting(true);
        setError(undefined);
        setMfaRequired(false);
        try {
            const response = await sdk.authentication.requestToken({
                grant_type: 'password',
                username: values.email,
                password: values.password,
            });
            if (response.result === 'mfa_required') {
                setMfaRequired(true);
                return;
            }
            setSession(response.access_token, response.expires_in);
            await navigate({ to: safeRedirectTarget(redirect) });
        } catch (caught) {
            if (caught instanceof SdkError && caught.status === 401) {
                setError('Invalid email or password');
                return;
            }
            const details = apiErrorDetails(caught);
            if (details) {
                form.setErrors(details);
                return;
            }
            setError(apiErrorMessage(caught, 'Could not sign you in. Try again.'));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Center mih="60vh">
            <Card withBorder padding="xl" radius="md" w="100%" maw={400}>
                <form
                    onSubmit={form.onSubmit(values => {
                        void submit(values);
                    })}
                >
                    <Stack gap="md">
                        <Stack gap={4}>
                            <Title order={2}>Sign in</Title>
                            <Text c="dimmed" size="sm">
                                Station controls are staff only.
                            </Text>
                        </Stack>
                        {mfaRequired ? (
                            <Alert color="yellow" title="Second factor required">
                                Your account needs a second factor, which this build cannot complete yet.
                            </Alert>
                        ) : undefined}
                        {error ? (
                            <Alert color="red" title="Sign-in failed">
                                {error}
                            </Alert>
                        ) : undefined}
                        <TextInput
                            label="Email"
                            placeholder="you@example.com"
                            type="email"
                            autoComplete="username"
                            disabled={submitting}
                            key={form.key('email')}
                            {...form.getInputProps('email')}
                        />
                        <PasswordInput
                            label="Password"
                            autoComplete="current-password"
                            disabled={submitting}
                            key={form.key('password')}
                            {...form.getInputProps('password')}
                        />
                        <Button type="submit" loading={submitting} fullWidth>
                            Sign in
                        </Button>
                    </Stack>
                </form>
            </Card>
        </Center>
    );
}
