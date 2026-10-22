import { useState } from 'react';
import { Button, Card, Group, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { useSetPassword } from '../../api/auth.factors.queries';
import { isRateLimited } from '../../api/retry.policy';
import { apiErrorDetails, apiErrorMessage } from '../../api/sdk.error';
import { MIN_PASSWORD_LENGTH } from '../../auth/password.rule';
import { i18n } from '../../i18n/i18n.setup';
import { ErrorAlert } from '../shared/error.alert';
import { notifyDone } from '../shared/notify';
import { isStepUpCancelled, type useStepUpGate } from './step.up.dialog';

interface PasswordValues {
    current: string;
    password: string;
    confirm: string;
}

/**
 * What a refusal says about each field, in the console's own words.
 *
 * The API keys its details by request field. A refused current password is the console's to word,
 * since it is the one refusal everybody will meet, and whether it was wrong or missing is read off
 * what was sent rather than off the API's sentence, which may be reworded. A weak or reused new
 * password arrives with the strength checker's own sentence, which is the API's text and shown as it
 * comes, falling back to the console's when the checker had nothing specific to say.
 */
function fieldErrors(error: unknown, sentCurrent: boolean, resetting: boolean): Partial<Record<keyof PasswordValues, string>> | undefined {
    const details = apiErrorDetails(error);
    if (!details) return undefined;
    const errors: Partial<Record<keyof PasswordValues, string>> = {};
    if ('currentPassword' in details) {
        errors.current = sentCurrent
            ? i18n.t('settings:security.password.currentWrong')
            : resetting
              ? i18n.t('settings:security.password.resetExpired')
              : i18n.t('settings:security.password.currentMissing');
    }
    if ('password' in details) {
        const said = typeof details.password === 'string' ? details.password.trim() : '';
        errors.password = said.length > 0 ? said : i18n.t('settings:security.password.weak');
    }
    return Object.keys(errors).length > 0 ? errors : undefined;
}

/**
 * Changing the account's password, or adding one to an account that signs in without.
 *
 * The current password is asked for whenever there is one, except on arrival from a reset link
 * (`?reset=1`): the API accepts a sign-in link used in the last few minutes in its place, and a person
 * who asked for a reset is the one person who cannot type it. If the link was used too long ago the
 * API asks for the current password after all, and the field comes back saying why. Once the new
 * password is set the card is an ordinary one again, without reloading the page. Behind the re-verify
 * dialog once an authenticator or a passkey is enrolled, as every change on this page is.
 */
export function PasswordCard({ hasPassword, gate }: { hasPassword: boolean; gate: ReturnType<typeof useStepUpGate> }) {
    const { t } = useTranslation(['settings', 'common']);
    const setPassword = useSetPassword();
    // `?reset=1` is where a password-reset link lands once it has signed the person in. Read here
    // rather than by the page, as the linked sign-ins card reads its own, so nothing asks the router
    // before the factors have loaded.
    const reset = (useSearch({ strict: false }) as { reset?: boolean }).reset === true;
    // Whether this visit still counts as the reset: true until the new password is set, or until the
    // API says the link was used too long ago to stand in for the current password.
    const [resetting, setResetting] = useState(reset && hasPassword);
    const askCurrent = hasPassword && !resetting;

    const form = useForm<PasswordValues>({
        mode: 'uncontrolled',
        initialValues: { current: '', password: '', confirm: '' },
        validate: {
            current: value => (!askCurrent || value.length > 0 ? undefined : t('security.password.currentMissing')),
            password: value => (value.length >= MIN_PASSWORD_LENGTH ? undefined : t('security.password.tooShort', { count: MIN_PASSWORD_LENGTH })),
            confirm: (value, values) => (value === values.password ? undefined : t('security.password.mismatch')),
        },
    });

    async function submit(values: PasswordValues): Promise<void> {
        try {
            await gate.run(() => setPassword.mutateAsync({ password: values.password, ...(askCurrent ? { currentPassword: values.current } : {}) }));
            notifyDone(hasPassword ? t('security.password.changed') : t('security.password.added'));
            form.reset();
            setPassword.reset();
            setResetting(false);
        } catch (caught) {
            if (isStepUpCancelled(caught)) return;
            const errors = fieldErrors(caught, askCurrent && values.current.length > 0, resetting);
            if (errors?.current && resetting) setResetting(false);
            if (errors) form.setErrors(errors);
        }
    }

    // A refusal that names a field is drawn on the field; only the rest needs the alert.
    const failure = setPassword.error && !apiErrorDetails(setPassword.error) ? setPassword.error : undefined;

    // Read before the JSX rather than spread from inside it: the literal-string rule reads a field
    // name in a spread attribute as copy, and these are form keys, not words.
    const currentInput = form.getInputProps('current');
    const passwordInput = form.getInputProps('password');
    const confirmInput = form.getInputProps('confirm');

    return (
        <Card padding="lg">
            <form
                onSubmit={form.onSubmit(values => {
                    void submit(values);
                })}
            >
                <Stack gap="md">
                    <Stack gap="xxs">
                        <Title order={2} size="h4">
                            {resetting
                                ? t('security.password.resetTitle')
                                : hasPassword
                                  ? t('security.password.changeTitle')
                                  : t('security.password.addTitle')}
                        </Title>
                        <Text size="sm" c="dimmed">
                            {resetting
                                ? t('security.password.resetIntro')
                                : hasPassword
                                  ? t('security.password.changeIntro')
                                  : t('security.password.addIntro')}
                        </Text>
                    </Stack>

                    {failure ? (
                        <ErrorAlert title={t('security.password.failed')}>
                            {isRateLimited(failure) ? t('security.password.rateLimited') : apiErrorMessage(failure, t('security.password.fallback'))}
                        </ErrorAlert>
                    ) : undefined}

                    {askCurrent ? (
                        <PasswordInput
                            label={t('security.password.current')}
                            autoComplete="current-password"
                            disabled={setPassword.isPending}
                            key={form.key('current')}
                            {...currentInput}
                        />
                    ) : undefined}
                    <PasswordInput
                        label={t('security.password.new')}
                        autoComplete="new-password"
                        disabled={setPassword.isPending}
                        key={form.key('password')}
                        {...passwordInput}
                    />
                    <PasswordInput
                        label={t('security.password.confirm')}
                        autoComplete="new-password"
                        disabled={setPassword.isPending}
                        key={form.key('confirm')}
                        {...confirmInput}
                    />
                    <Group justify="flex-end">
                        <Button type="submit" loading={setPassword.isPending}>
                            {hasPassword ? t('security.password.change') : t('security.password.add')}
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Card>
    );
}
