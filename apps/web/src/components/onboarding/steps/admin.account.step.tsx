import { Alert, Button, Group, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';

import { useSubmitAdminAccount } from '../../../api/onboarding.queries';
import { isRateLimited, retryAfterMs } from '../../../api/retry.policy';
import { apiErrorDetails, apiErrorMessage, sdkError } from '../../../api/sdk.error';
import type { OnboardingStepProps } from '../onboarding.steps';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Matches the auth contract: string(min=8, max=256). */
const MIN_PASSWORD_LENGTH = 8;

interface AdminAccountValues {
    email: string;
    password: string;
    confirmPassword: string;
}

function setupError(error: unknown): string | undefined {
    if (isRateLimited(error)) {
        const wait = retryAfterMs(error);
        return wait === undefined
            ? 'Too many attempts. Wait a moment and try again.'
            : `Too many attempts. Try again in ${Math.ceil(wait / 1000)} seconds.`;
    }
    if (apiErrorDetails(error)) {
        return undefined;
    }
    return apiErrorMessage(error, 'Could not create the administrator account. Try again.');
}

/** Creates the first administrator, which is what the `admin.account` requirement is waiting on. */
export function AdminAccountStep({ requirement, onComplete }: OnboardingStepProps) {
    const submitAdminAccount = useSubmitAdminAccount();

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
        try {
            const remaining = await submitAdminAccount.mutateAsync({ email: values.email, password: values.password });
            onComplete(remaining);
        } catch (caught) {
            if (sdkError(caught)?.status === 409) {
                // An administrator already exists: let the wizard re-check and route onward.
                onComplete();
                return;
            }
            const details = apiErrorDetails(caught);
            if (details) {
                form.setErrors(details);
            }
        }
    }

    // A 409 is handled by moving on, so it must not also be reported as a failure.
    const failure = submitAdminAccount.error;
    const error = failure && sdkError(failure)?.status !== 409 ? setupError(failure) : undefined;

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
                    disabled={submitAdminAccount.isPending}
                    key={form.key('email')}
                    {...form.getInputProps('email')}
                />
                <PasswordInput
                    label="Password"
                    autoComplete="new-password"
                    disabled={submitAdminAccount.isPending}
                    key={form.key('password')}
                    {...form.getInputProps('password')}
                />
                <PasswordInput
                    label="Confirm password"
                    autoComplete="new-password"
                    disabled={submitAdminAccount.isPending}
                    key={form.key('confirmPassword')}
                    {...form.getInputProps('confirmPassword')}
                />
                <Group justify="flex-end">
                    <Button type="submit" loading={submitAdminAccount.isPending}>
                        Create administrator
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}
