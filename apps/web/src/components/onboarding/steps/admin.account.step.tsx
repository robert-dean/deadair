import { Button, Group, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useTranslation } from 'react-i18next';

import { useSubmitAdminAccount } from '../../../api/onboarding.queries';
import { isRateLimited, retryAfterMs } from '../../../api/retry.policy';
import { apiErrorDetails, apiErrorMessage, sdkError } from '../../../api/sdk.error';
import { i18n } from '../../../i18n/i18n.setup';
import { ErrorAlert } from '../../shared/error.alert';
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
        return wait === undefined ? i18n.t('onboarding:admin.rateLimited') : i18n.t('onboarding:admin.retryIn', { count: Math.ceil(wait / 1000) });
    }
    if (apiErrorDetails(error)) {
        return undefined;
    }
    return apiErrorMessage(error, i18n.t('onboarding:admin.fallback'));
}

/** Creates the first administrator, which is what the `admin.account` requirement is waiting on. */
export function AdminAccountStep({ requirement, onComplete }: OnboardingStepProps) {
    const { t } = useTranslation('onboarding');
    const submitAdminAccount = useSubmitAdminAccount();

    const form = useForm<AdminAccountValues>({
        mode: 'uncontrolled',
        initialValues: { email: '', password: '', confirmPassword: '' },
        validate: {
            email: value => (EMAIL_PATTERN.test(value) ? undefined : t('admin.emailInvalid')),
            password: value => (value.length >= MIN_PASSWORD_LENGTH ? undefined : t('admin.passwordShort', { count: MIN_PASSWORD_LENGTH })),
            confirmPassword: (value, values) => (value === values.password ? undefined : t('admin.passwordMismatch')),
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

    // Read before the JSX rather than spread from inside it: the literal-string rule reads a field
    // name in a spread attribute as copy, and these are form keys, not words.
    const emailInput = form.getInputProps('email');
    const passwordInput = form.getInputProps('password');
    const confirmInput = form.getInputProps('confirmPassword');

    return (
        <form
            onSubmit={form.onSubmit(values => {
                void submit(values);
            })}
        >
            <Stack gap="md" mt="xl">
                {requirement.description ? <Text c="dimmed">{requirement.description}</Text> : undefined}
                {error ? <ErrorAlert title={t('admin.failed')}>{error}</ErrorAlert> : undefined}
                <TextInput
                    label={t('admin.email')}
                    placeholder={t('admin.emailPlaceholder')}
                    type="email"
                    autoComplete="username"
                    disabled={submitAdminAccount.isPending}
                    key={form.key('email')}
                    {...emailInput}
                />
                <PasswordInput
                    label={t('admin.password')}
                    autoComplete="new-password"
                    disabled={submitAdminAccount.isPending}
                    key={form.key('password')}
                    {...passwordInput}
                />
                <PasswordInput
                    label={t('admin.confirmPassword')}
                    autoComplete="new-password"
                    disabled={submitAdminAccount.isPending}
                    key={form.key('confirmPassword')}
                    {...confirmInput}
                />
                <Group justify="flex-end">
                    <Button type="submit" loading={submitAdminAccount.isPending}>
                        {t('admin.create')}
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}
