import { Button, Card, Group, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useTranslation } from 'react-i18next';

import { useSetPassword } from '../../api/auth.factors.queries';
import { isRateLimited } from '../../api/retry.policy';
import { apiErrorDetails, apiErrorMessage } from '../../api/sdk.error';
import { i18n } from '../../i18n/i18n.setup';
import { ErrorAlert } from '../shared/error.alert';
import { notifyDone } from '../shared/notify';
import { isStepUpCancelled, type useStepUpGate } from './step.up.dialog';

/** Matches the auth contract: string(min=8, max=256). */
const MIN_PASSWORD_LENGTH = 8;

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
function fieldErrors(error: unknown, sentCurrent: boolean): Partial<Record<keyof PasswordValues, string>> | undefined {
    const details = apiErrorDetails(error);
    if (!details) return undefined;
    const errors: Partial<Record<keyof PasswordValues, string>> = {};
    if ('currentPassword' in details) {
        errors.current = sentCurrent ? i18n.t('settings:security.password.currentWrong') : i18n.t('settings:security.password.currentMissing');
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
 * The current password is asked for whenever there is one: the API also accepts a sign-in link used
 * in the last few minutes in its place, which is the reset flow's way in, but a person on this page
 * remembers it or would not be changing it from here. Behind the re-verify dialog once an
 * authenticator or a passkey is enrolled, as every change on this page is.
 */
export function PasswordCard({ hasPassword, gate }: { hasPassword: boolean; gate: ReturnType<typeof useStepUpGate> }) {
    const { t } = useTranslation(['settings', 'common']);
    const setPassword = useSetPassword();

    const form = useForm<PasswordValues>({
        mode: 'uncontrolled',
        initialValues: { current: '', password: '', confirm: '' },
        validate: {
            current: value => (!hasPassword || value.length > 0 ? undefined : t('security.password.currentMissing')),
            password: value => (value.length >= MIN_PASSWORD_LENGTH ? undefined : t('security.password.tooShort', { count: MIN_PASSWORD_LENGTH })),
            confirm: (value, values) => (value === values.password ? undefined : t('security.password.mismatch')),
        },
    });

    async function submit(values: PasswordValues): Promise<void> {
        try {
            await gate.run(() => setPassword.mutateAsync({ password: values.password, ...(hasPassword ? { currentPassword: values.current } : {}) }));
            notifyDone(hasPassword ? t('security.password.changed') : t('security.password.added'));
            form.reset();
            setPassword.reset();
        } catch (caught) {
            if (isStepUpCancelled(caught)) return;
            const errors = fieldErrors(caught, hasPassword && values.current.length > 0);
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
                            {hasPassword ? t('security.password.changeTitle') : t('security.password.addTitle')}
                        </Title>
                        <Text size="sm" c="dimmed">
                            {hasPassword ? t('security.password.changeIntro') : t('security.password.addIntro')}
                        </Text>
                    </Stack>

                    {failure ? (
                        <ErrorAlert title={t('security.password.failed')}>
                            {isRateLimited(failure) ? t('security.password.rateLimited') : apiErrorMessage(failure, t('security.password.fallback'))}
                        </ErrorAlert>
                    ) : undefined}

                    {hasPassword ? (
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
