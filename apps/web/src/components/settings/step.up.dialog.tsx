import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Modal, Select, Stack, Text } from '@mantine/core';
import type { MfaRequiredResponseOutput } from '@deadair/sdk';

import { authenticatorFactors, useMfaCodeMutation, useStartStepUp } from '../../api/auth.factors.queries';
import { isRateLimited, retryAfterMs } from '../../api/retry.policy';
import { apiErrorMessage, isInvalidToken, stepUpRequirement } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { ONE_TIME_CODE_LENGTH, OneTimeCodeInput } from '../shared/one.time.code.input';

/** Thrown to the caller of `run` when the operator closes the dialog without a code. */
export class StepUpCancelled extends Error {
    constructor() {
        super('Re-verification cancelled');
        this.name = 'StepUpCancelled';
    }
}

export function isStepUpCancelled(error: unknown): boolean {
    return error instanceof StepUpCancelled;
}

interface Deferred {
    resolve: () => void;
    reject: (error: Error) => void;
}

export interface StepUpGate {
    /**
     * Runs an action, and when the API refuses it for want of a recent strong factor, asks for
     * a code and runs it once more. Any other failure, and a cancelled dialog, reject as they are.
     */
    run: <T>(action: () => Promise<T>) => Promise<T>;
    /** Whether the dialog is open. Read by {@link StepUpDialog}. */
    opened: boolean;
    /** @internal the dialog's two exits. */
    settle: (outcome: 'verified' | 'cancelled') => void;
}

/**
 * The state behind a step-up: a promise the dialog settles.
 *
 * A hook plus a component rather than one component with callbacks, because the caller wants to
 * write `await gate.run(() => remove(...))` and carry on, and a callback-shaped dialog would make
 * every caller re-implement "try, ask, try again" around its own mutation.
 */
export function useStepUpGate(): StepUpGate {
    const [opened, setOpened] = useState(false);
    const deferred = useRef<Deferred>(undefined);

    const settle = useCallback((outcome: 'verified' | 'cancelled') => {
        const pending = deferred.current;
        deferred.current = undefined;
        setOpened(false);
        if (outcome === 'verified') pending?.resolve();
        else pending?.reject(new StepUpCancelled());
    }, []);

    const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
        try {
            return await action();
        } catch (caught) {
            if (stepUpRequirement(caught) === undefined) throw caught;
        }
        await new Promise<void>((resolve, reject) => {
            deferred.current = { resolve, reject };
            setOpened(true);
        });
        return await action();
    }, []);

    return { run, opened, settle };
}

/** What to tell the operator about a refused code, in the dialog's own words. */
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
 * Re-verifying with an authenticator, for a change the API will not make on an old session.
 *
 * The API mints a challenge for the current session when the dialog opens, the code completes
 * it, and the session is rotated onto a token that carries the fresh factor. The action the gate
 * was asked to run then runs again against that token.
 *
 * The body mounts with the dialog and unmounts with it, so every opening starts from nothing: a
 * fresh challenge (one has a life of minutes, and one minted earlier would already be dead), an
 * empty field, and no error left over from last time.
 */
export function StepUpDialog({ gate }: { gate: StepUpGate }) {
    return (
        <Modal opened={gate.opened} onClose={() => gate.settle('cancelled')} title="Confirm it is you" centered>
            {gate.opened ? <StepUpBody gate={gate} /> : undefined}
        </Modal>
    );
}

function StepUpBody({ gate }: { gate: StepUpGate }) {
    const start = useStartStepUp();
    const submit = useMfaCodeMutation();
    const [code, setCode] = useState('');
    const [methodId, setMethodId] = useState<string>();
    const inflight = useRef(false);

    // `mutate` is stable across renders, so this runs once per mount, which is once per opening.
    const { mutate: mint } = start;
    useEffect(() => {
        mint(undefined, {
            onSuccess: response => {
                if (response.result === 'mfa_required') {
                    setMethodId(authenticatorFactors({ challengeId: response.challenge_id, factors: response.factors })[0]?.method_id);
                }
            },
        });
    }, [mint]);

    const challenge: MfaRequiredResponseOutput | undefined = start.data?.result === 'mfa_required' ? start.data : undefined;
    const factors = challenge ? authenticatorFactors({ challengeId: challenge.challenge_id, factors: challenge.factors }) : [];
    const nothingToVerifyWith = start.data !== undefined && factors.length === 0;

    async function verify(value: string): Promise<void> {
        if (inflight.current || !challenge || methodId === undefined || value.length !== ONE_TIME_CODE_LENGTH) return;
        inflight.current = true;
        try {
            const response = await submit.mutateAsync({ challengeId: challenge.challenge_id, methodId, code: value });
            if (response.result === 'token') gate.settle('verified');
        } catch {
            // Reported below, off the mutation's own error.
        } finally {
            inflight.current = false;
        }
    }

    return (
        <form
            onSubmit={event => {
                event.preventDefault();
                void verify(code);
            }}
        >
            <Stack gap="md">
                <Text size="sm">Enter the code from your authenticator app to make this change.</Text>

                {start.error ? (
                    <ErrorAlert title="Could not start" error={start.error} fallback="The station could not issue a challenge." />
                ) : undefined}
                {nothingToVerifyWith ? (
                    <Alert color="yellow" title="Nothing to verify with">
                        This account has no authenticator this console can ask for.
                    </Alert>
                ) : undefined}
                {submit.error ? <ErrorAlert title="Not verified">{codeError(submit.error)}</ErrorAlert> : undefined}

                {factors.length > 1 ? (
                    <Select
                        label="Which authenticator"
                        data={factors.map(factor => ({ value: factor.method_id, label: factor.label ?? 'Authenticator' }))}
                        value={methodId}
                        onChange={value => setMethodId(value ?? undefined)}
                        allowDeselect={false}
                        disabled={submit.isPending}
                    />
                ) : undefined}

                <OneTimeCodeInput
                    label="Authenticator code"
                    value={code}
                    onChange={setCode}
                    onComplete={value => void verify(value)}
                    disabled={submit.isPending || !challenge}
                />

                <Group justify="flex-end">
                    <Button variant="default" onClick={() => gate.settle('cancelled')} disabled={submit.isPending}>
                        Cancel
                    </Button>
                    <Button type="submit" loading={submit.isPending} disabled={!challenge || code.length !== ONE_TIME_CODE_LENGTH}>
                        Verify
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}
