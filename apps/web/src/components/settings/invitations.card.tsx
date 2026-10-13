import { useState } from 'react';
import { Alert, Anchor, Button, Card, Code, Group, Modal, Select, Stack, Switch, Table, Text, TextInput, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import type { Invitation, PlatformRole } from '@deadair/sdk';

import { isLoopback } from '../../api/party.queries';
import { apiErrorMessage, sdkError } from '../../api/sdk.error';
import { invitationLink, useCreateInvitation, useInvitations, useRevokeInvitation } from '../../api/users.queries';
import { ConfirmModal } from '../shared/confirm.modal';
import { CopyButton } from '../shared/copy.button';
import { ErrorAlert } from '../shared/error.alert';
import { formatDate } from '../shared/format.date';
import { notifyDone } from '../shared/notify';
import { PageSkeleton } from '../shared/page.skeleton';
import { PhoneCard } from '../shared/phone.card';
import type { StatusTone } from '../shared/status';
import { StatusLamp } from '../shared/status.lamp';
import { usePhone } from '../shared/use.phone';
import { isStepUpCancelled, StepUpDialog, useStepUpGate } from './step.up.dialog';

type Gate = ReturnType<typeof useStepUpGate>;

const ROLES: readonly PlatformRole[] = ['listener', 'admin'];

/** Only an open invitation is live; the rest are history somebody chose or the clock decided. */
const STATE_TONES: Record<Invitation['state'], StatusTone> = { pending: 'ok', accepted: 'off', revoked: 'off', expired: 'off' };

/**
 * Inviting somebody, and the invitations so far.
 *
 * The station mints the link and the admin sends it however they like, or has the station email it
 * when a mail server is set up. The link is shown
 * on demand rather than in the row, and an admin's link asks first, because whoever opens it first
 * runs the station. Every change is behind the re-verify dialog, which the API asks for whenever the
 * admin acting has a strong factor they have not proved recently.
 */
export function InvitationsCard() {
    const { t } = useTranslation('settings');
    const phone = usePhone();
    const invitations = useInvitations();
    const gate = useStepUpGate();
    const [showing, setShowing] = useState<Invitation>();

    const list = invitations.data?.data ?? [];

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        {t('people.invitations.title')}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {t('people.invitations.intro')}
                    </Text>
                </Stack>

                <InviteForm gate={gate} onCreated={setShowing} />

                <Title order={3} size="h5">
                    {t('people.invitations.list.title')}
                </Title>

                {invitations.isPending ? <PageSkeleton variant="rows" count={2} /> : undefined}
                {invitations.error ? (
                    <ErrorAlert
                        title={t('people.invitations.unavailable.title')}
                        error={invitations.error}
                        fallback={t('people.invitations.unavailable.fallback')}
                    />
                ) : undefined}
                {invitations.data && list.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {t('people.invitations.list.empty')}
                    </Text>
                ) : undefined}

                {list.length > 0 && phone ? (
                    <Stack gap="xxs">
                        {list.map(invitation => (
                            <PhoneCard
                                key={invitation.id}
                                opacity={invitation.state === 'pending' ? 1 : 0.6}
                                title={
                                    <Text size="sm" fw={500} truncate>
                                        {invitation.email}
                                    </Text>
                                }
                                subtitle={
                                    <Text size="xs" c="dimmed" truncate>
                                        {t(`people.role.${invitation.role}`)} · {describeWhen(t, invitation)}
                                    </Text>
                                }
                                figure={<StatusLamp tone={STATE_TONES[invitation.state]} label={t(`people.invitations.state.${invitation.state}`)} />}
                                below={
                                    <Group justify="flex-end" mt="xs">
                                        <InvitationActions invitation={invitation} gate={gate} onShow={() => setShowing(invitation)} />
                                    </Group>
                                }
                            />
                        ))}
                    </Stack>
                ) : undefined}

                {list.length > 0 && !phone ? (
                    <Table.ScrollContainer minWidth={720}>
                        <Table verticalSpacing="sm" horizontalSpacing="sm">
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>{t('people.invitations.column.person')}</Table.Th>
                                    <Table.Th>{t('people.invitations.column.role')}</Table.Th>
                                    <Table.Th>{t('people.invitations.column.state')}</Table.Th>
                                    <Table.Th>{t('people.invitations.column.expires')}</Table.Th>
                                    <Table.Th>{t('people.invitations.column.invitedBy')}</Table.Th>
                                    <Table.Th w={260} />
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {list.map(invitation => (
                                    <Table.Tr key={invitation.id} style={{ opacity: invitation.state === 'pending' ? 1 : 0.6 }}>
                                        <Table.Td maw={260}>
                                            <Text size="sm" fw={500} truncate>
                                                {invitation.email}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="sm">{t(`people.role.${invitation.role}`)}</Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <StatusLamp
                                                tone={STATE_TONES[invitation.state]}
                                                label={t(`people.invitations.state.${invitation.state}`)}
                                            />
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="sm" className="da-num">
                                                {describeWhen(t, invitation)}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td maw={200}>
                                            <Text size="sm" c="dimmed" truncate>
                                                {invitation.invitedBy}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <InvitationActions invitation={invitation} gate={gate} onShow={() => setShowing(invitation)} />
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                ) : undefined}
            </Stack>

            <LinkModal invitation={showing} onClose={() => setShowing(undefined)} />
            <StepUpDialog gate={gate} />
        </Card>
    );
}

type T = ReturnType<typeof useTranslation<'settings'>>['t'];

/** The date worth showing for where an invitation stands: when it runs out, or when it was used or withdrawn. */
function describeWhen(t: T, invitation: Invitation): string {
    if (invitation.state === 'accepted' && invitation.acceptedAt)
        return t('people.invitations.when.accepted', { date: formatDate(invitation.acceptedAt) });
    if (invitation.state === 'revoked' && invitation.revokedAt)
        return t('people.invitations.when.revoked', { date: formatDate(invitation.revokedAt) });
    return formatDate(invitation.expiresAt);
}

function InviteForm({ gate, onCreated }: { gate: Gate; onCreated: (invitation: Invitation) => void }) {
    const { t } = useTranslation('settings');
    const create = useCreateInvitation();
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<PlatformRole>('listener');
    // On by default for an admin, whose link is better in their own inbox than on a screen; off for
    // a listener, whose link is as often handed over in person.
    const [send, setSend] = useState(false);
    const [failure, setFailure] = useState<unknown>();

    async function submit(): Promise<void> {
        setFailure(undefined);
        try {
            const invitation = await gate.run(() => create.mutateAsync({ email, role, send }));
            setEmail('');
            setRole('listener');
            setSend(false);
            notifyDone(t(send ? 'people.invitations.emailed' : 'people.invitations.created', { email: invitation.email }));
            // An emailed link has gone where it should; the console shows one only when the admin
            // is the one who will pass it on.
            if (!send) onCreated(invitation);
        } catch (caught) {
            if (!isStepUpCancelled(caught)) setFailure(caught);
        }
    }

    return (
        <form
            onSubmit={event => {
                event.preventDefault();
                void submit();
            }}
        >
            <Stack gap="sm">
                {failure ? (
                    <ErrorAlert title={t('people.invitations.form.errorTitle')}>
                        <Stack gap="xxs">
                            <Text size="sm">{apiErrorMessage(failure, t('people.invitations.form.errorFallback'))}</Text>
                            {/* The one refusal an admin can fix from here, drawn off the status as the
                                email enrolment card draws it, rather than off the sentence. */}
                            {sdkError(failure)?.status === 503 ? (
                                <Anchor size="sm" renderRoot={(props: object) => <Link to="/settings/mail" {...props} />}>
                                    {t('security.email.openMail')}
                                </Anchor>
                            ) : undefined}
                        </Stack>
                    </ErrorAlert>
                ) : undefined}
                <Group align="flex-end" gap="sm">
                    <TextInput
                        label={t('people.invitations.form.email.label')}
                        placeholder={t('people.invitations.form.email.placeholder')}
                        type="email"
                        value={email}
                        onChange={event => setEmail(event.currentTarget.value)}
                        style={{ flex: 1, minWidth: 220 }}
                    />
                    <Select
                        label={t('people.invitations.form.role.label')}
                        w={160}
                        data={ROLES.map(value => ({ value, label: t(`people.role.${value}`) }))}
                        value={role}
                        allowDeselect={false}
                        onChange={next => {
                            const chosen = (next as PlatformRole | null) ?? 'listener';
                            setRole(chosen);
                            setSend(chosen === 'admin');
                        }}
                    />
                    <Button type="submit" loading={create.isPending} disabled={email.trim().length === 0}>
                        {t('people.invitations.form.submit')}
                    </Button>
                </Group>
                <Text size="xs" c="dimmed">
                    {t(`people.roleHelp.${role}`)}
                </Text>
                <Switch
                    label={t('people.invitations.form.send.label')}
                    description={t('people.invitations.form.send.description')}
                    checked={send}
                    onChange={event => setSend(event.currentTarget.checked)}
                />
            </Stack>
        </form>
    );
}

/** Show the link, send it again, and withdraw it: what an open invitation offers, and only an open one. */
function InvitationActions({ invitation, gate, onShow }: { invitation: Invitation; gate: Gate; onShow: () => void }) {
    const { t } = useTranslation('settings');
    const create = useCreateInvitation();
    const revoke = useRevokeInvitation();
    const [confirming, setConfirming] = useState<'again' | 'revoke'>();
    const [failure, setFailure] = useState<unknown>();

    function close(): void {
        setConfirming(undefined);
        setFailure(undefined);
    }

    // Sending again is inviting the same address into the same role, which withdraws this one: the
    // way to a fresh link for one that ran out, or that the person lost. Asked first, because the
    // link they may already have stops working.
    async function confirmAgain(): Promise<void> {
        setFailure(undefined);
        try {
            await gate.run(() => create.mutateAsync({ email: invitation.email, role: invitation.role }));
            close();
            notifyDone(t('people.invitations.again.done', { email: invitation.email }));
        } catch (caught) {
            if (!isStepUpCancelled(caught)) setFailure(caught);
        }
    }

    async function confirmRevoke(): Promise<void> {
        setFailure(undefined);
        try {
            await gate.run(() => revoke.mutateAsync({ id: invitation.id }));
            close();
            notifyDone(t('people.invitations.revoke.done', { email: invitation.email }));
        } catch (caught) {
            if (!isStepUpCancelled(caught)) setFailure(caught);
        }
    }

    const open = invitation.state === 'pending';
    const canSendAgain = invitation.state === 'pending' || invitation.state === 'expired';

    return (
        <Group gap="xxs" justify="flex-end" wrap="nowrap">
            {open && invitation.token ? (
                <Button variant="subtle" size="compact-sm" onClick={onShow}>
                    {t('people.invitations.link.action')}
                </Button>
            ) : undefined}
            {canSendAgain ? (
                <Button variant="subtle" size="compact-sm" onClick={() => setConfirming('again')}>
                    {t('people.invitations.again.action')}
                </Button>
            ) : undefined}
            {open ? (
                <Button variant="subtle" color="red" size="compact-sm" onClick={() => setConfirming('revoke')}>
                    {t('people.invitations.revoke.action')}
                </Button>
            ) : undefined}

            <ConfirmModal
                opened={confirming === 'again'}
                onClose={close}
                onConfirm={() => void confirmAgain()}
                title={t('people.invitations.again.title', { email: invitation.email })}
                confirmLabel={t('people.invitations.again.action')}
                confirming={create.isPending}
                error={failure}
                errorTitle={t('people.invitations.again.errorTitle')}
                errorFallback={t('people.invitations.again.errorFallback')}
            >
                {t('people.invitations.again.body')}
            </ConfirmModal>
            <ConfirmModal
                opened={confirming === 'revoke'}
                onClose={close}
                onConfirm={() => void confirmRevoke()}
                title={t('people.invitations.revoke.title', { email: invitation.email })}
                confirmLabel={t('people.invitations.revoke.action')}
                confirming={revoke.isPending}
                error={failure}
                errorTitle={t('people.invitations.revoke.errorTitle')}
                errorFallback={t('people.invitations.revoke.errorFallback')}
            >
                {t('people.invitations.revoke.body')}
            </ConfirmModal>
        </Group>
    );
}

/**
 * The link and its QR code. An admin's waits for a second press, since whoever opens it first runs
 * the station and a screen shared at the wrong moment would hand that over.
 */
function LinkModal({ invitation, onClose }: { invitation: Invitation | undefined; onClose: () => void }) {
    const { t } = useTranslation('settings');
    const [revealed, setRevealed] = useState<string>();

    const token = invitation?.token;
    const hidden = invitation?.role === 'admin' && revealed !== invitation.id;
    const link = token ? invitationLink(token) : undefined;

    return (
        <Modal
            opened={invitation !== undefined && token !== undefined}
            onClose={() => {
                setRevealed(undefined);
                onClose();
            }}
            title={invitation ? t('people.invitations.link.title', { email: invitation.email }) : undefined}
            centered
        >
            {invitation && link ? (
                <Stack gap="md">
                    <Text size="sm">{t('people.invitations.link.body', { email: invitation.email, date: formatDate(invitation.expiresAt) })}</Text>
                    {isLoopback() ? (
                        <Alert color="yellow" variant="light" p="xs">
                            <Text size="xs">{t('people.invitations.link.loopback', { origin: window.location.origin })}</Text>
                        </Alert>
                    ) : undefined}
                    {hidden ? (
                        <Stack gap="sm">
                            <Alert color="red" variant="light">
                                {t('people.invitations.link.adminConfirm')}
                            </Alert>
                            <Button color="red" variant="light" onClick={() => setRevealed(invitation.id)}>
                                {t('people.invitations.link.adminReveal')}
                            </Button>
                        </Stack>
                    ) : (
                        <>
                            <Group justify="center">
                                <QRCodeSVG
                                    value={link}
                                    size={176}
                                    marginSize={2}
                                    bgColor="#ffffff"
                                    fgColor="#000000"
                                    title={t('people.invitations.link.qrTitle')}
                                />
                            </Group>
                            <Group gap="xs" wrap="nowrap" align="flex-start">
                                <Code style={{ overflowWrap: 'anywhere', flex: 1 }}>{link}</Code>
                                <CopyButton value={link} />
                            </Group>
                        </>
                    )}
                </Stack>
            ) : undefined}
        </Modal>
    );
}
