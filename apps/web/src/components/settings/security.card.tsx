import { useRef, useState } from 'react';
import { Anchor, Badge, Button, Card, Code, Group, Image, Stack, Text, TextInput, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { AuthenticationFactor } from '@deadair/sdk';

import {
    type AuthenticatorRegistration,
    type EmailRegistration,
    useFactors,
    useRegisterAuthenticator,
    useRegisterEmail,
    useRemoveFactor,
    useVerifyAuthenticator,
    useVerifyEmail,
} from '../../api/auth.factors.queries';
import { isRateLimited, retryAfterMs } from '../../api/retry.policy';
import { apiErrorMessage, isInvalidToken, sdkError } from '../../api/sdk.error';
import { i18n } from '../../i18n/i18n.setup';
import { ConfirmModal } from '../shared/confirm.modal';
import { CopyButton } from '../shared/copy.button';
import { ErrorAlert } from '../shared/error.alert';
import { notifyDone, notifySaved } from '../shared/notify';
import { ONE_TIME_CODE_LENGTH, OneTimeCodeInput } from '../shared/one.time.code.input';
import { PageSkeleton } from '../shared/page.skeleton';
import { LinkedSigninsCard } from './linked.signins.card';
import { isStepUpCancelled, StepUpDialog, useStepUpGate } from './step.up.dialog';

/** What a factor is called in the list. The API's labels are for authenticators; the rest are what they are. */
function factorName(factor: AuthenticationFactor): string {
    switch (factor.method) {
        case 'authenticator':
            return factor.label ?? i18n.t('settings:security.factor.authenticator');
        case 'password':
            return i18n.t('settings:security.factor.password');
        case 'email':
            return factor.label
                ? i18n.t('settings:security.factor.emailLabelled', { label: factor.label })
                : i18n.t('settings:security.factor.email');
        case 'fido':
            return factor.label ?? i18n.t('settings:security.factor.passkey');
        case 'phone':
            return factor.label ?? i18n.t('settings:security.factor.phone');
        case 'oidc':
            return factor.label ? i18n.t('settings:security.factor.oidcLabelled', { label: factor.label }) : i18n.t('settings:security.factor.oidc');
    }
}

/**
 * How the operator signs in.
 *
 * The one section of Settings about a person rather than the station. Enrolling an authenticator
 * here is what turns the second step on: from then on every sign-in to this account asks for the
 * code after the password, and removing the last one turns it off again. Both are gated the same
 * way on the API side, on a strong factor verified in the last few minutes, which is why either
 * may open the re-verify dialog first.
 *
 * An email address is the other thing that can be enrolled, and it is a different kind of factor:
 * it is where a code or a sign-in link is SENT rather than something the operator holds, so it is
 * offered as a second step only when the station has a mail server to send through. Enrolling one
 * is behind the same gate, and it is the only enrolment here whose first step has an effect
 * outside the console.
 */
export function SecurityCard() {
    const { t } = useTranslation('settings');
    const factors = useFactors();
    const gate = useStepUpGate();

    const authenticators = (factors.data ?? []).filter(factor => factor.method === 'authenticator');
    // Linked providers have a card of their own below, with the link and unlink they need.
    const others = (factors.data ?? []).filter(factor => factor.method !== 'authenticator' && factor.method !== 'oidc');

    return (
        <Stack gap="lg">
            <Card padding="lg">
                <Stack gap="md">
                    <Stack gap="xxs">
                        <Title order={2} size="h4">
                            {t('security.title')}
                        </Title>
                        <Text size="sm" c="dimmed">
                            {t('security.intro')}
                        </Text>
                    </Stack>

                    {factors.isPending ? <PageSkeleton variant="rows" count={2} /> : undefined}
                    {factors.error ? (
                        <ErrorAlert title={t('security.unavailable.title')} error={factors.error} fallback={t('security.unavailable.fallback')} />
                    ) : undefined}

                    {factors.data ? (
                        <Stack gap="xs">
                            {others.map(factor => (
                                <FactorRow key={`${factor.method}:${factor.methodId}`} factor={factor} />
                            ))}
                            {authenticators.map(factor => (
                                <AuthenticatorRow key={factor.methodId} factor={factor} gate={gate} />
                            ))}
                            {authenticators.length === 0 ? (
                                <Text size="sm" c="dimmed">
                                    {t('security.noAuthenticator')}
                                </Text>
                            ) : undefined}
                        </Stack>
                    ) : undefined}
                </Stack>
            </Card>

            {factors.data ? <LinkedSigninsCard factors={factors.data} gate={gate} /> : undefined}
            {factors.data ? <EnrolAuthenticatorCard gate={gate} /> : undefined}
            {factors.data ? <EnrolEmailCard gate={gate} /> : undefined}

            <StepUpDialog gate={gate} />
        </Stack>
    );
}

function FactorRow({ factor }: { factor: AuthenticationFactor }) {
    return (
        <Group justify="space-between" wrap="nowrap">
            <Text size="sm">{factorName(factor)}</Text>
            <Badge variant="light" color="gray">
                {factor.kind}
            </Badge>
        </Group>
    );
}

function AuthenticatorRow({ factor, gate }: { factor: AuthenticationFactor; gate: ReturnType<typeof useStepUpGate> }) {
    const { t } = useTranslation('settings');
    const remove = useRemoveFactor();
    const [confirming, setConfirming] = useState(false);
    const [failure, setFailure] = useState<unknown>();

    async function confirmRemove(): Promise<void> {
        setFailure(undefined);
        try {
            await gate.run(() => remove.mutateAsync({ method: 'authenticator', methodId: factor.methodId }));
            setConfirming(false);
            notifyDone(t('security.remove.done', { name: factorName(factor) }));
        } catch (caught) {
            // The dialog was closed without a code; the row is exactly as it was.
            if (isStepUpCancelled(caught)) return;
            setFailure(caught);
        }
    }

    return (
        <Group justify="space-between" wrap="nowrap">
            <Group gap="xs">
                <Text size="sm">{factorName(factor)}</Text>
                <Badge variant="light" color="teal">
                    {t('security.authenticatorBadge')}
                </Badge>
            </Group>
            <Button variant="subtle" color="red" size="compact-sm" onClick={() => setConfirming(true)}>
                {t('security.remove.action')}
            </Button>
            <ConfirmModal
                opened={confirming}
                onClose={() => {
                    setConfirming(false);
                    setFailure(undefined);
                }}
                onConfirm={() => void confirmRemove()}
                title={t('security.remove.title', { name: factorName(factor) })}
                confirmLabel={t('security.remove.action')}
                confirming={remove.isPending}
                error={failure}
                errorTitle={t('security.remove.errorTitle')}
                errorFallback={t('security.remove.errorFallback')}
            >
                {remove.isPending ? t('security.remove.bodyPending') : t('security.remove.body')}
            </ConfirmModal>
        </Group>
    );
}

/** What to tell the operator about a refused code. */
function codeError(error: unknown): string {
    if (isInvalidToken(error)) return i18n.t('settings:code.invalid');
    if (isRateLimited(error)) {
        const wait = retryAfterMs(error);
        return wait === undefined ? i18n.t('settings:code.rateLimited') : i18n.t('settings:code.rateLimitedFor', { seconds: Math.ceil(wait / 1000) });
    }
    return apiErrorMessage(error, i18n.t('settings:code.fallback'));
}

/**
 * Enrolling an authenticator: a label, then the QR code, then the first code it shows.
 *
 * The secret is printed beside the QR for an app that cannot scan, with a copy button, and the
 * first code is what proves the scan took before the factor is written. A second enrolment on an
 * account that already has one is behind the re-verify dialog, which is why the register call
 * runs through the gate.
 */
function EnrolAuthenticatorCard({ gate }: { gate: ReturnType<typeof useStepUpGate> }) {
    const { t } = useTranslation(['settings', 'common']);
    const register = useRegisterAuthenticator();
    const verify = useVerifyAuthenticator();
    const [label, setLabel] = useState('');
    const [registration, setRegistration] = useState<AuthenticatorRegistration>();
    const [code, setCode] = useState('');
    const [failure, setFailure] = useState<unknown>();
    const inflight = useRef(false);

    async function start(): Promise<void> {
        setFailure(undefined);
        try {
            setRegistration(await gate.run(() => register.mutateAsync({ label })));
        } catch (caught) {
            if (!isStepUpCancelled(caught)) setFailure(caught);
        }
    }

    async function finish(value: string): Promise<void> {
        if (inflight.current || !registration || value.length !== ONE_TIME_CODE_LENGTH) return;
        inflight.current = true;
        setFailure(undefined);
        try {
            await verify.mutateAsync({ registrationId: registration.registrationId, code: value, codeVerifier: registration.codeVerifier });
            notifySaved(t('security.authenticator.saved'));
            setRegistration(undefined);
            setCode('');
            setLabel('');
        } catch (caught) {
            setFailure(caught);
            setCode('');
        } finally {
            inflight.current = false;
        }
    }

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        {t('security.authenticator.title')}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {t('security.authenticator.intro')}
                    </Text>
                </Stack>

                {failure ? (
                    <ErrorAlert title={registration ? t('security.notEnrolled') : t('security.authenticator.startFailed')}>
                        {registration ? codeError(failure) : apiErrorMessage(failure, t('security.authenticator.startFallback'))}
                    </ErrorAlert>
                ) : undefined}

                {registration ? (
                    <form
                        onSubmit={event => {
                            event.preventDefault();
                            void finish(code);
                        }}
                    >
                        <Stack gap="md">
                            <Group justify="center">
                                <Image src={registration.qrCode} alt={t('security.authenticator.qrAlt')} w={200} h={200} fit="contain" />
                            </Group>
                            <Stack gap="xxs">
                                <Text size="sm">{t('security.authenticator.byHand')}</Text>
                                <Group gap="xs" wrap="nowrap">
                                    <Code style={{ overflowWrap: 'anywhere' }}>{registration.secret}</Code>
                                    <CopyButton value={registration.secret} />
                                </Group>
                            </Stack>
                            <OneTimeCodeInput
                                label={t('security.authenticator.firstCode')}
                                value={code}
                                onChange={setCode}
                                onComplete={value => void finish(value)}
                                disabled={verify.isPending}
                            />
                            <Group justify="flex-end">
                                <Button
                                    variant="default"
                                    onClick={() => {
                                        setRegistration(undefined);
                                        setCode('');
                                        setFailure(undefined);
                                    }}
                                    disabled={verify.isPending}
                                >
                                    {t('common:action.cancel')}
                                </Button>
                                <Button type="submit" loading={verify.isPending} disabled={code.length !== ONE_TIME_CODE_LENGTH}>
                                    {t('security.authenticator.verify')}
                                </Button>
                            </Group>
                        </Stack>
                    </form>
                ) : (
                    <Group align="flex-end" wrap="nowrap">
                        <TextInput
                            label={t('security.authenticator.label.label')}
                            description={t('security.authenticator.label.description')}
                            placeholder={t('security.authenticator.label.placeholder')}
                            value={label}
                            onChange={event => setLabel(event.currentTarget.value)}
                            style={{ flex: 1 }}
                        />
                        <Button onClick={() => void start()} loading={register.isPending}>
                            {t('security.authenticator.showQr')}
                        </Button>
                    </Group>
                )}
            </Stack>
        </Card>
    );
}

/**
 * Enrolling an email address: the address, then the code the station mails to it.
 *
 * The same two steps as the authenticator card and for the same reason — nothing is written until
 * the second one proves the operator can reach what they typed — but the halves carry different
 * weight. An authenticator's secret comes back in the first response, so its second step only
 * confirms the scan; here the first step is what SENDS a message, so pressing the button has an
 * effect out in the world and "Send it again" is a real request rather than a re-render.
 *
 * The verifier is minted once for the enrolment and handed back on every resend, because the API's
 * pending registration keeps re-sending the same code: a fresh verifier per press would leave the
 * operator holding a code bound to one this browser had already discarded.
 *
 * A station with no mail server cannot do any of this, and the card does not try to work that out
 * for itself. `resolveMailSettings` is the single definition of "is mail configured" and it lives
 * on the API, which refuses with a 503 naming the page that fixes it; a second definition here
 * would be one more thing to drift. What the card adds is the link, since the operator reading that
 * sentence is the person who can act on it.
 */
function EnrolEmailCard({ gate }: { gate: ReturnType<typeof useStepUpGate> }) {
    const { t } = useTranslation(['settings', 'common']);
    const register = useRegisterEmail();
    const verify = useVerifyEmail();
    const [address, setAddress] = useState('');
    const [registration, setRegistration] = useState<EmailRegistration>();
    const [code, setCode] = useState('');
    const [failure, setFailure] = useState<unknown>();
    const inflight = useRef(false);

    // Behind the gate for the reason the authenticator's enrolment is: once the account has a
    // strong factor, binding another way in is a change a stolen session would want to make.
    async function send(): Promise<void> {
        setFailure(undefined);
        try {
            const issued = await gate.run(() =>
                register.mutateAsync({ value: registration?.value ?? address, ...(registration ? { codeVerifier: registration.codeVerifier } : {}) }),
            );
            setRegistration(issued);
        } catch (caught) {
            if (!isStepUpCancelled(caught)) setFailure(caught);
        }
    }

    async function finish(value: string): Promise<void> {
        if (inflight.current || !registration || value.length !== ONE_TIME_CODE_LENGTH) return;
        inflight.current = true;
        setFailure(undefined);
        try {
            await verify.mutateAsync({ registrationId: registration.registrationId, code: value, codeVerifier: registration.codeVerifier });
            notifySaved(t('security.email.saved'));
            setRegistration(undefined);
            setCode('');
            setAddress('');
        } catch (caught) {
            setFailure(caught);
            setCode('');
        } finally {
            inflight.current = false;
        }
    }

    function cancel(): void {
        setRegistration(undefined);
        setCode('');
        setFailure(undefined);
    }

    // Only the send can fail this way, and only for one reason, so the link is drawn off the status
    // rather than off the sentence: matching on the message would break the moment it is reworded.
    const noMailServer = !registration && sdkError(failure)?.status === 503;

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        {t('security.email.title')}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {t('security.email.intro')}
                    </Text>
                </Stack>

                {failure ? (
                    <ErrorAlert title={registration ? t('security.notEnrolled') : t('security.email.sendFailed')}>
                        <Stack gap="xxs">
                            <Text size="sm">{registration ? codeError(failure) : apiErrorMessage(failure, t('security.email.sendFallback'))}</Text>
                            {noMailServer ? (
                                <Anchor size="sm" renderRoot={(props: object) => <Link to="/settings/mail" {...props} />}>
                                    {t('security.email.openMail')}
                                </Anchor>
                            ) : undefined}
                        </Stack>
                    </ErrorAlert>
                ) : undefined}

                {registration ? (
                    <form
                        onSubmit={event => {
                            event.preventDefault();
                            void finish(code);
                        }}
                    >
                        <Stack gap="md">
                            <Text size="sm" c="dimmed">
                                {t('security.email.sent', { address: registration.value })}
                            </Text>
                            <OneTimeCodeInput
                                label={t('security.email.code')}
                                value={code}
                                onChange={setCode}
                                onComplete={value => void finish(value)}
                                disabled={verify.isPending}
                            />
                            <Group justify="space-between">
                                <Button
                                    variant="subtle"
                                    size="compact-sm"
                                    loading={register.isPending}
                                    disabled={verify.isPending}
                                    onClick={() => void send()}
                                >
                                    {t('security.email.resend')}
                                </Button>
                                <Group gap="xs">
                                    <Button variant="default" onClick={cancel} disabled={verify.isPending}>
                                        {t('common:action.cancel')}
                                    </Button>
                                    <Button type="submit" loading={verify.isPending} disabled={code.length !== ONE_TIME_CODE_LENGTH}>
                                        {t('security.email.verify')}
                                    </Button>
                                </Group>
                            </Group>
                        </Stack>
                    </form>
                ) : (
                    <form
                        onSubmit={event => {
                            event.preventDefault();
                            void send();
                        }}
                    >
                        <Group align="flex-end" wrap="nowrap">
                            <TextInput
                                label={t('security.email.address.label')}
                                description={t('security.email.address.description')}
                                placeholder={t('security.email.address.placeholder')}
                                type="email"
                                value={address}
                                onChange={event => setAddress(event.currentTarget.value)}
                                style={{ flex: 1 }}
                            />
                            <Button type="submit" loading={register.isPending} disabled={address.trim().length === 0}>
                                {t('security.email.send')}
                            </Button>
                        </Group>
                    </form>
                )}
            </Stack>
        </Card>
    );
}
