import { useState } from 'react';
import { Alert, Button, Group, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { SdkError } from '@deadair/sdk';

import { submitAdminAccountRequirement } from '../../../api/onboarding';
import { apiErrorDetails, apiErrorMessage } from '../../../api/sdk.error';
import type { OnboardingStepProps } from '../onboarding.steps';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Matches the auth contract: string(min=8, max=256). */
const MIN_PASSWORD_LENGTH = 8;

interface AdminAccountValues {
    email: string;
    password: string;
    confirmPassword: string;
}

/** Creates the first administrator, which is what the `admin.account` requirement is waiting on. */
export function AdminAccountStep({ requirement, onComplete }: OnboardingStepProps) {
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);

    const form = useForm<AdminAccountValues>({
        mode: 'uncontrolled',
        initialValues: { email: '', password: '', confirmPassword: '' },
        validate: {
            email: value => (EMAIL_PATTERN.test(value) ? undefined : 'Enter a valid email address'),
            password: value => (value.length >= MIN_PASSWORD_LENGTH ? undefined : `Use at least ${MIN_PASSWORD_LENGTH} characters`),
            confirmPassword: (value, values) => (value === values.password ? undefined : 'Passwords do not match'),
        },
    });

    async function submit(values: AdminAccountValues): Promise<void> {
        setSubmitting(true);
        setError(undefined);
        try {
            const remaining = await submitAdminAccountRequirement({ email: values.email, password: values.password });
            onComplete(remaining);
        } catch (caught) {
            if (caught instanceof SdkError && caught.status === 409) {
                // An administrator already exists: let the wizard re-check and route onward.
                onComplete();
                return;
            }
            const details = apiErrorDetails(caught);
            if (details) {
                form.setErrors(details);
                return;
            }
            setError(apiErrorMessage(caught, 'Could not create the administrator account. Try again.'));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form
            onSubmit={form.onSubmit(values => {
                void submit(values);
            })}
        >
            <Stack gap="md" mt="xl">
                {requirement.description ? <Text c="dimmed">{requirement.description}</Text> : undefined}
                {error ? (
                    <Alert color="red" title="Setup failed">
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
                    autoComplete="new-password"
                    disabled={submitting}
                    key={form.key('password')}
                    {...form.getInputProps('password')}
                />
                <PasswordInput
                    label="Confirm password"
                    autoComplete="new-password"
                    disabled={submitting}
                    key={form.key('confirmPassword')}
                    {...form.getInputProps('confirmPassword')}
                />
                <Group justify="flex-end">
                    <Button type="submit" loading={submitting}>
                        Create administrator
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}
