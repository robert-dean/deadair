import { useRef, useState } from 'react';
import { Badge, Button, Card, Code, CopyButton, Group, Image, Stack, Text, TextInput, Title } from '@mantine/core';
import type { AuthenticationFactor } from '@deadair/sdk';

import {
    type AuthenticatorRegistration,
    useFactors,
    useRegisterAuthenticator,
    useRemoveFactor,
    useVerifyAuthenticator,
} from '../../api/auth.factors.queries';
import { isRateLimited, retryAfterMs } from '../../api/retry.policy';
import { apiErrorMessage, isInvalidToken } from '../../api/sdk.error';
import { ConfirmModal } from '../shared/confirm.modal';
import { ErrorAlert } from '../shared/error.alert';
import { notifyDone, notifySaved } from '../shared/notify';
import { ONE_TIME_CODE_LENGTH, OneTimeCodeInput } from '../shared/one.time.code.input';
import { PageSkeleton } from '../shared/page.skeleton';
import { isStepUpCancelled, StepUpDialog, useStepUpGate } from './step.up.dialog';

/** What a factor is called in the list. The API's labels are for authenticators; the rest are what they are. */
function factorName(factor: AuthenticationFactor): string {
    switch (factor.method) {
        case 'authenticator':
            return factor.label ?? 'Authenticator';
        case 'password':
            return 'Password';
        case 'email':
            return factor.label ? `Email, ${factor.label}` : 'Email';
        case 'fido':
            return factor.label ?? 'Passkey';
        case 'phone':
            return factor.label ?? 'Phone';
        case 'oidc':
            return factor.label ? `${factor.label} sign-in` : 'Single sign-on';
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
 */
export function SecurityCard() {
    const factors = useFactors();
    const gate = useStepUpGate();

    const authenticators = (factors.data ?? []).filter(factor => factor.method === 'authenticator');
    const others = (factors.data ?? []).filter(factor => factor.method !== 'authenticator');

    return (
        <Stack gap="lg">
            <Card padding="lg">
                <Stack gap="md">
                    <Stack gap="xxs">
                        <Title order={2} size="h4">
                            Security
                        </Title>
                        <Text size="sm" c="dimmed">
                            With an authenticator enrolled, every sign-in to this account asks for its code after the password. Lose the phone and the
                            README says how to get back in from the box.
                        </Text>
                    </Stack>

                    {factors.isPending ? <PageSkeleton variant="rows" count={2} /> : undefined}
                    {factors.error ? (
                        <ErrorAlert
                            title="Sign-in methods unavailable"
                            error={factors.error}
                            fallback="The station could not read how you sign in."
                        />
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
                                    No authenticator yet. Sign-in is the password alone.
                                </Text>
                            ) : undefined}
                        </Stack>
                    ) : undefined}
                </Stack>
            </Card>

            {factors.data ? <EnrolAuthenticatorCard gate={gate} /> : undefined}

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
    const remove = useRemoveFactor();
    const [confirming, setConfirming] = useState(false);
    const [failure, setFailure] = useState<unknown>();

    async function confirmRemove(): Promise<void> {
        setFailure(undefined);
        try {
            await gate.run(() => remove.mutateAsync({ method: 'authenticator', methodId: factor.methodId }));
            setConfirming(false);
            notifyDone(`${factorName(factor)} removed.`);
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
                    authenticator
                </Badge>
            </Group>
            <Button variant="subtle" color="red" size="compact-sm" onClick={() => setConfirming(true)}>
                Remove
            </Button>
            <ConfirmModal
                opened={confirming}
                onClose={() => {
                    setConfirming(false);
                    setFailure(undefined);
                }}
                onConfirm={() => void confirmRemove()}
                title={`Remove ${factorName(factor)}?`}
                confirmLabel="Remove"
                confirming={remove.isPending}
                error={failure}
                errorTitle="Not removed"
                errorFallback="The authenticator is still enrolled."
            >
                {`Codes from this app will stop being accepted. ${
                    remove.isPending ? '' : 'If it is the last authenticator on the account, sign-in goes back to the password alone.'
                }`}
            </ConfirmModal>
        </Group>
    );
}

/** What to tell the operator about a refused code. */
function codeError(error: unknown): string {
    if (isInvalidToken(error)) return 'That code was not accepted. Wait for the next one and try again.';
    if (isRateLimited(error)) {
        const wait = retryAfterMs(error);
        return wait === undefined
            ? 'Too many attempts. Wait a moment and try again.'
            : `Too many attempts. Try again in ${Math.ceil(wait / 1000)} seconds.`;
    }
    return apiErrorMessage(error, 'Could not check that code. Try again.');
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
            notifySaved('Authenticator');
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
                        Add an authenticator
                    </Title>
                    <Text size="sm" c="dimmed">
                        Any app that shows six-digit codes: Google Authenticator, 1Password, Aegis. Scan the code, then enter the first number it
                        shows.
                    </Text>
                </Stack>

                {failure ? (
                    <ErrorAlert title={registration ? 'Not enrolled' : 'Could not start'}>
                        {registration ? codeError(failure) : apiErrorMessage(failure, 'The station could not start an enrolment.')}
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
                                <Image src={registration.qrCode} alt="Authenticator QR code" w={200} h={200} fit="contain" />
                            </Group>
                            <Stack gap="xxs">
                                <Text size="sm">Or enter this key by hand:</Text>
                                <Group gap="xs" wrap="nowrap">
                                    <Code style={{ overflowWrap: 'anywhere' }}>{registration.secret}</Code>
                                    <CopyButton value={registration.secret}>
                                        {({ copied, copy }) => (
                                            <Button variant="subtle" size="compact-xs" onClick={copy}>
                                                {copied ? 'Copied' : 'Copy'}
                                            </Button>
                                        )}
                                    </CopyButton>
                                </Group>
                            </Stack>
                            <OneTimeCodeInput
                                label="First code"
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
                                    Cancel
                                </Button>
                                <Button type="submit" loading={verify.isPending} disabled={code.length !== ONE_TIME_CODE_LENGTH}>
                                    Verify and enrol
                                </Button>
                            </Group>
                        </Stack>
                    </form>
                ) : (
                    <Group align="flex-end" wrap="nowrap">
                        <TextInput
                            label="Label"
                            description="So you can tell this one apart later"
                            placeholder="Phone"
                            value={label}
                            onChange={event => setLabel(event.currentTarget.value)}
                            style={{ flex: 1 }}
                        />
                        <Button onClick={() => void start()} loading={register.isPending}>
                            Show QR code
                        </Button>
                    </Group>
                )}
            </Stack>
        </Card>
    );
}
