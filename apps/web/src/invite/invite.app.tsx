import { useEffect, useRef, useState } from 'react';
import { Alert, Anchor, Button, Code, Container, Group, Image, PasswordInput, Radio, Stack, Text, TextInput, Title } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { InvitationAccepted, InvitationAcceptStartResponse, InvitationDetails, InvitationSecondStep } from '@deadair/sdk';

import { apiErrorDetails, apiErrorMessage, sdkError } from '../api/sdk.error';
import { createPasskey, isPasskeyCancelled, passkeysAvailable } from '../auth/webauthn';
import { ErrorAlert } from '../components/shared/error.alert';
import { CopyButton } from '../components/shared/copy.button';
import { MIN_PASSWORD_LENGTH } from '../auth/password.rule';
import { ONE_TIME_CODE_LENGTH, OneTimeCodeInput } from '../components/shared/one.time.code.input';
import { inviteSdk } from './invite.client';
import { tokenFromHash } from './invite.token';

/** Why the page cannot go on, from what the station answered. */
type Stop = 'gone' | 'taken';

function stopFor(error: unknown): Stop | undefined {
    const status = sdkError(error)?.status;
    if (status === 404) return 'gone';
    if (status === 409) return 'taken';
    return undefined;
}

/**
 * The invite page: somebody was sent a link and opened it.
 *
 * The token arrives after `#`, which no server sees, and is tidied out of the address bar once read.
 * **Nothing is asked of the station until the person presses something.** A mail scanner or a chat
 * app's link preview that opens the link, scripts and all, finds a page with a button on it and
 * spends nothing; even the read of what the invitation is for waits for the press.
 *
 * Then: the address they were invited at (fixed), a password, and a second step, an authenticator
 * app or a passkey, as an onboarded admin has. The account is made in one request at the end, so
 * leaving half way saves nothing and the link still works.
 */
export function InviteApp() {
    const { t } = useTranslation('invite');
    const [token] = useState(() => {
        const read = tokenFromHash(window.location.hash);
        if (read !== undefined) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        return read;
    });

    // A second invitation link opened in this tab changes only the fragment, which reloads nothing,
    // so the page would carry on with the first token. Starting over is the honest answer. The
    // `replaceState` that tidies the token away fires no `hashchange`, so this never loops.
    useEffect(() => {
        const startOver = () => window.location.reload();
        window.addEventListener('hashchange', startOver);
        return () => window.removeEventListener('hashchange', startOver);
    }, []);

    const details = useMutation({ retry: false, mutationFn: (value: string) => inviteSdk.users.invitations.readInvitation({ token: value }) });
    const [accepted, setAccepted] = useState<InvitationAccepted>();
    const [stop, setStop] = useState<Stop>();

    const stopped = stop ?? stopFor(details.error);

    return (
        <Container size={560} px="md" py="lg">
            <Stack gap="lg">
                <Stack gap={4}>
                    {details.data ? (
                        <Text size="sm" c="dimmed" tt="uppercase" fw={600}>
                            {details.data.stationName}
                        </Text>
                    ) : undefined}
                    <Title order={1} size="h2">
                        {accepted ? t('done.title') : t('title')}
                    </Title>
                </Stack>

                {token === undefined ? <Notice title={t('noToken.title')} body={t('noToken.body')} /> : undefined}
                {stopped ? <Notice title={t(`${stopped}.title`)} body={t(`${stopped}.body`)} /> : undefined}

                {token !== undefined && !stopped && !details.data ? (
                    <Stack gap="md">
                        <Text>{t('intro')}</Text>
                        {details.error ? <Text c="dimmed">{t('unreachable')}</Text> : undefined}
                        <Button loading={details.isPending} onClick={() => details.mutate(token)}>
                            {details.error ? t('retry') : t('open')}
                        </Button>
                    </Stack>
                ) : undefined}

                {token !== undefined && !stopped && details.data && !accepted ? (
                    <SignUp token={token} details={details.data} onAccepted={setAccepted} onStop={setStop} />
                ) : undefined}

                {accepted ? <Done accepted={accepted} /> : undefined}
            </Stack>
        </Container>
    );
}

interface SignUpProps {
    token: string;
    details: InvitationDetails;
    onAccepted: (accepted: InvitationAccepted) => void;
    onStop: (stop: Stop) => void;
}

/** The address, a password, and a second step; then the second step's own screen. */
function SignUp({ token, details, onAccepted, onStop }: SignUpProps) {
    const { t } = useTranslation('invite');
    const canPasskey = passkeysAvailable();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [method, setMethod] = useState<InvitationSecondStep>('authenticator');
    const [setup, setSetup] = useState<InvitationAcceptStartResponse>();

    const start = useMutation({
        retry: false,
        mutationFn: () => inviteSdk.users.invitations.startAcceptingInvitation({ token, password, method }),
        onSuccess: setSetup,
        onError: error => {
            const halt = stopFor(error);
            if (halt) onStop(halt);
        },
    });

    if (setup) {
        return (
            <SecondStep
                token={token}
                password={password}
                setup={setup}
                onAccepted={onAccepted}
                onStop={onStop}
                onBack={() => {
                    setSetup(undefined);
                    start.reset();
                }}
            />
        );
    }

    const mismatch = confirm.length > 0 && confirm !== password;
    const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
    // The station's own reason, from the strength check: zxcvbn's warning, worded for a person.
    const weakness = apiErrorDetails(start.error)?.password;
    const ready = password.length >= MIN_PASSWORD_LENGTH && confirm === password;

    return (
        <form
            onSubmit={event => {
                event.preventDefault();
                if (ready) start.mutate();
            }}
        >
            <Stack gap="lg">
                <Text>{t(`role.${details.role}`, { station: details.stationName })}</Text>

                <Stack gap="sm">
                    <Title order={2} size="h4">
                        {t('account.title')}
                    </Title>
                    <TextInput
                        label={t('account.email')}
                        description={t('account.emailHelp')}
                        value={details.email}
                        readOnly
                        autoComplete="username"
                    />
                    <PasswordInput
                        label={t('account.password')}
                        value={password}
                        onChange={event => setPassword(event.currentTarget.value)}
                        autoComplete="new-password"
                        error={tooShort ? t('account.tooShort') : weakness}
                    />
                    <PasswordInput
                        label={t('account.passwordConfirm')}
                        value={confirm}
                        onChange={event => setConfirm(event.currentTarget.value)}
                        autoComplete="new-password"
                        error={mismatch ? t('account.mismatch') : undefined}
                    />
                </Stack>

                <Stack gap="sm">
                    <Title order={2} size="h4">
                        {t('secondStep.title')}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {t('secondStep.intro')}
                    </Text>
                    <Radio.Group value={method} onChange={value => setMethod(value as InvitationSecondStep)}>
                        <Stack gap="sm">
                            <Radio value="authenticator" label={t('secondStep.authenticator')} description={t('secondStep.authenticatorHelp')} />
                            {canPasskey ? (
                                <Radio value="fido" label={t('secondStep.passkey')} description={t('secondStep.passkeyHelp')} />
                            ) : undefined}
                        </Stack>
                    </Radio.Group>
                </Stack>

                {start.error && !weakness && !stopFor(start.error) ? (
                    <ErrorAlert title={t('failed')}>{apiErrorMessage(start.error, t('fallback'))}</ErrorAlert>
                ) : undefined}

                <Button type="submit" loading={start.isPending} disabled={!ready}>
                    {t('secondStep.continue')}
                </Button>
            </Stack>
        </form>
    );
}

interface SecondStepProps {
    token: string;
    password: string;
    setup: InvitationAcceptStartResponse;
    onAccepted: (accepted: InvitationAccepted) => void;
    onStop: (stop: Stop) => void;
    onBack: () => void;
}

/** Proving the second step, which is also what makes the account. */
function SecondStep({ token, password, setup, onAccepted, onStop, onBack }: SecondStepProps) {
    const { t } = useTranslation('invite');
    const [code, setCode] = useState('');
    // The code field submits on its sixth digit and the button submits too; an account is made once.
    const inflight = useRef(false);

    const accept = useMutation({
        retry: false,
        mutationFn: async (value: string) => {
            if (setup.method === 'authenticator') {
                return await inviteSdk.users.invitations.acceptInvitation({
                    method: 'authenticator',
                    token,
                    password,
                    registrationId: setup.registrationId,
                    code: value,
                });
            }
            const credential = await createPasskey(setup.attestation);
            return await inviteSdk.users.invitations.acceptInvitation({
                method: 'fido',
                token,
                password,
                registrationId: setup.registrationId,
                credential,
            });
        },
        onSuccess: onAccepted,
        onError: error => {
            const halt = stopFor(error);
            if (halt) onStop(halt);
            setCode('');
        },
    });

    async function submit(value: string): Promise<void> {
        if (inflight.current) return;
        if (setup.method === 'authenticator' && value.length !== ONE_TIME_CODE_LENGTH) return;
        inflight.current = true;
        try {
            await accept.mutateAsync(value);
        } catch {
            // Reported below off the mutation's own error.
        } finally {
            inflight.current = false;
        }
    }

    const refused = sdkError(accept.error)?.status === 401;
    const failure = accept.error && !isPasskeyCancelled(accept.error) && !stopFor(accept.error) ? accept.error : undefined;

    return (
        <form
            onSubmit={event => {
                event.preventDefault();
                void submit(code);
            }}
        >
            <Stack gap="md">
                <Title order={2} size="h4">
                    {setup.method === 'authenticator' ? t('authenticator.title') : t('passkey.title')}
                </Title>
                <Text size="sm" c="dimmed">
                    {setup.method === 'authenticator' ? t('authenticator.intro') : t('passkey.intro')}
                </Text>

                {failure ? (
                    <ErrorAlert title={t('failed')}>
                        {refused
                            ? setup.method === 'authenticator'
                                ? t('authenticator.refused')
                                : t('passkey.refused')
                            : apiErrorMessage(failure, t('fallback'))}
                    </ErrorAlert>
                ) : undefined}

                {setup.method === 'authenticator' ? (
                    <>
                        <Group justify="center">
                            <Image src={setup.qrCode} alt={t('authenticator.qrAlt')} w={200} h={200} fit="contain" bg="white" p={6} />
                        </Group>
                        <Stack gap="xxs">
                            <Text size="sm">{t('authenticator.byHand')}</Text>
                            <Group gap="xs" wrap="nowrap">
                                <Code style={{ overflowWrap: 'anywhere' }}>{setup.secret}</Code>
                                <CopyButton value={setup.secret} />
                            </Group>
                        </Stack>
                        <OneTimeCodeInput
                            label={t('authenticator.code')}
                            value={code}
                            onChange={setCode}
                            onComplete={value => void submit(value)}
                            disabled={accept.isPending}
                        />
                        <Button type="submit" loading={accept.isPending} disabled={code.length !== ONE_TIME_CODE_LENGTH}>
                            {t('authenticator.finish')}
                        </Button>
                    </>
                ) : (
                    <Button loading={accept.isPending} onClick={() => void submit('')}>
                        {t('passkey.create')}
                    </Button>
                )}

                <Button variant="subtle" size="compact-sm" onClick={onBack} disabled={accept.isPending}>
                    {t('back')}
                </Button>
            </Stack>
        </form>
    );
}

/** What to do next, by role: a listener goes to the app or the stream, an admin to the console. */
function Done({ accepted }: { accepted: InvitationAccepted }) {
    const { t } = useTranslation('invite');
    const origin = window.location.origin;

    return (
        <Stack gap="md">
            <Alert color="green" variant="light">
                {t('done.signInAs', { email: accepted.email })}
            </Alert>
            {accepted.role === 'listener' ? (
                <Stack gap="sm">
                    <Button component="a" href={`deadair://connect?station=${encodeURIComponent(origin)}`}>
                        {t('done.listener.app')}
                    </Button>
                    <Text size="sm" c="dimmed">
                        {t('done.listener.appHelp')}
                    </Text>
                    <Anchor href={`${origin}/live.mp3`}>{t('done.listener.stream')}</Anchor>
                </Stack>
            ) : (
                <Button component="a" href="/">
                    {t('done.admin.console')}
                </Button>
            )}
        </Stack>
    );
}

function Notice({ title, body }: { title: string; body: string }) {
    return (
        <Stack gap="xs" py="md">
            <Title order={2} size="h4">
                {title}
            </Title>
            <Text c="dimmed">{body}</Text>
        </Stack>
    );
}
