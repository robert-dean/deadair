import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Select, Stack, Text } from '@mantine/core';
import type { MfaChallengeFactorOutput, MfaRequiredResponseOutput } from '@deadair/sdk';

import { presentableFactors, useEmailCodeMutation, useMfaCodeMutation, useStartEmailChallenge } from '../../api/auth.factors.queries';
import { isRateLimited, retryAfterMs } from '../../api/retry.policy';
import { apiErrorMessage, authChallenge, isInvalidToken } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { ONE_TIME_CODE_LENGTH, OneTimeCodeInput } from '../shared/one.time.code.input';

/** The server's own wait, or a flat sentence when it did not say. */
function rateLimitedMessage(error: unknown): string {
    const wait = retryAfterMs(error);
    return wait === undefined ? 'Too many attempts. Wait a moment and try again.' : `Too many attempts. Try again in ${Math.ceil(wait / 1000)} seconds.`;
}

/**
 * What to tell the operator about a refused code. An expired challenge is not reported here: it
 * sends the page back to where the sign-in started, which is where the sentence about it belongs.
 */
export function codeError(error: unknown): string {
    if (isInvalidToken(error)) {
        return 'That code was not accepted. Wait for the next one and try again.';
    }
    if (isRateLimited(error)) {
        return rateLimitedMessage(error);
    }
    return apiErrorMessage(error, 'Could not check that code. Try again.');
}

/** Whether the API said the challenge itself is gone, rather than the code being wrong. */
export function challengeExpired(error: unknown): boolean {
    return authChallenge(error)?.error === 'invalid_challenge';
}

/** What the panel calls a factor in a picker and in its own copy. */
function factorLabel(factor: MfaChallengeFactorOutput): string {
    if (factor.method === 'email') return factor.label ?? 'Email';
    return factor.label ?? 'Authenticator';
}

export interface ChallengePanelProps {
    challenge: MfaRequiredResponseOutput;
    /** The code was accepted and the session is stored. */
    onComplete: () => void | Promise<void>;
    /** The challenge is gone; the sign-in has to start again. */
    onExpired: () => void;
    onStartOver: () => void;
    /** What the button that abandons the challenge says. The callback decides where it goes. */
    startOverLabel?: string;
}

/**
 * The second half of a sign-in that stopped at `mfa_required`.
 *
 * Presents an authenticator or an emailed code, preferring the authenticator when an account has
 * both — a code from an app is already on the phone, where an emailed one is a round trip through a
 * mail server. A challenge listing neither (a passkey enrolled through the API) is still told so
 * plainly rather than shown a field no code can satisfy.
 *
 * The two paths differ only in what the code is bound to, and it is not a detail the operator ever
 * sees: an authenticator code carries the enrolled factor's `method_id`, while an emailed one
 * carries the id of the challenge the API minted when it sent the message. Hence two mutations
 * behind one field.
 */
export function ChallengePanel({ challenge, onComplete, onExpired, onStartOver, startOverLabel = 'Start over' }: ChallengePanelProps) {
    const factors = presentableFactors({ challengeId: challenge.challenge_id, factors: challenge.factors });
    const submitAuthenticatorCode = useMfaCodeMutation();
    const submitEmailCode = useEmailCodeMutation();
    const startEmail = useStartEmailChallenge();

    const [code, setCode] = useState('');
    const [methodId, setMethodId] = useState<string | undefined>(factors[0]?.method_id);
    // The field submits itself on the sixth digit and the button submits too, and a code is
    // accepted exactly once: the second request would burn an attempt against a spent challenge.
    // A ref rather than `isPending`, which is state and lands a render too late to stop it.
    const inflight = useRef(false);

    const selected = factors.find(factor => factor.method_id === methodId);
    const isEmail = selected?.method === 'email';
    const emailChallengeId = startEmail.data?.email_challenge_id;

    // Asking for a code is what SENDS the email, so it happens when the operator lands on the email
    // factor rather than when they press something — there is nothing to type until it has been
    // sent. Keyed on the selected factor so switching to email asks once, and switching away and
    // back does not ask again while the first code is still good.
    const requestedFor = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (!isEmail || methodId === undefined || requestedFor.current === methodId) return;
        requestedFor.current = methodId;
        startEmail.mutate({ challengeId: challenge.challenge_id });
    }, [isEmail, methodId, challenge.challenge_id, startEmail]);

    const pending = submitAuthenticatorCode.isPending || submitEmailCode.isPending;

    async function verify(value: string): Promise<void> {
        if (inflight.current || methodId === undefined || value.length !== ONE_TIME_CODE_LENGTH) return;
        if (isEmail && emailChallengeId === undefined) return;
        inflight.current = true;
        try {
            const response = isEmail
                ? await submitEmailCode.mutateAsync({ challengeId: challenge.challenge_id, emailChallengeId: emailChallengeId!, code: value })
                : await submitAuthenticatorCode.mutateAsync({ challengeId: challenge.challenge_id, methodId, code: value });
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
                    {startOverLabel}
                </Button>
            </Stack>
        );
    }

    const submitError = submitEmailCode.error ?? submitAuthenticatorCode.error;
    const failure = submitError && !challengeExpired(submitError) ? codeError(submitError) : undefined;
    // The station could not send the code at all — an unconfigured mail server, or one that
    // refused. Reported as its own thing rather than as a bad code, because no code was typed.
    const sendFailure = startEmail.error ? apiErrorMessage(startEmail.error, 'Could not send a code to your email. Try again.') : undefined;
    const response = submitEmailCode.data ?? submitAuthenticatorCode.data;
    const anotherFactor = response?.result === 'mfa_required' ? 'The station asked for yet another factor, which this console cannot present.' : undefined;

    const codeReady = !isEmail || emailChallengeId !== undefined;

    return (
        <form
            onSubmit={event => {
                event.preventDefault();
                void verify(code);
            }}
        >
            <Stack gap="md">
                {(failure ?? anotherFactor) ? <ErrorAlert title="Not signed in">{failure ?? anotherFactor}</ErrorAlert> : undefined}
                {sendFailure ? <ErrorAlert title="No code sent">{sendFailure}</ErrorAlert> : undefined}
                {factors.length > 1 ? (
                    <Select
                        label="Verify with"
                        data={factors.map(factor => ({ value: factor.method_id, label: factorLabel(factor) }))}
                        value={methodId}
                        onChange={value => {
                            setMethodId(value ?? undefined);
                            setCode('');
                        }}
                        allowDeselect={false}
                        disabled={pending}
                    />
                ) : undefined}
                {isEmail && emailChallengeId !== undefined ? (
                    <Text c="dimmed" size="sm">
                        {`We sent a code to ${selected?.label ?? 'your email'}.`}
                    </Text>
                ) : undefined}
                <OneTimeCodeInput
                    label={isEmail ? 'Emailed code' : 'Authenticator code'}
                    value={code}
                    onChange={setCode}
                    onComplete={value => void verify(value)}
                    disabled={pending || startEmail.isPending || !codeReady}
                />
                <Button type="submit" loading={pending} disabled={code.length !== ONE_TIME_CODE_LENGTH || !codeReady} fullWidth>
                    Verify
                </Button>
                <Group justify="center" gap="xs">
                    {isEmail ? (
                        <Button
                            variant="subtle"
                            size="compact-sm"
                            loading={startEmail.isPending}
                            disabled={pending}
                            onClick={() => startEmail.mutate({ challengeId: challenge.challenge_id })}
                        >
                            Send it again
                        </Button>
                    ) : undefined}
                    <Button variant="subtle" size="compact-sm" onClick={onStartOver} disabled={pending}>
                        {startOverLabel}
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}
