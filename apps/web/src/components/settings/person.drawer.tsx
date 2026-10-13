import { useState } from 'react';
import { Alert, Button, Divider, Drawer, Group, Select, Stack, Table, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { PlatformRole, UserDetail } from '@deadair/sdk';

import { useChangeUserRole, useDeactivateUser, useReactivateUser, useResetUserMfa, useSignOutUser, useUser } from '../../api/users.queries';
import { ConfirmModal } from '../shared/confirm.modal';
import { ErrorAlert } from '../shared/error.alert';
import { formatDate } from '../shared/format.date';
import { notifyDone } from '../shared/notify';
import { PageSkeleton } from '../shared/page.skeleton';
import { StatusLamp } from '../shared/status.lamp';
import { usePhone } from '../shared/use.phone';
import { isStepUpCancelled, StepUpDialog, useStepUpGate } from './step.up.dialog';

const ROLES: readonly PlatformRole[] = ['admin', 'listener'];

type Action = 'signOut' | 'resetMfa' | 'deactivate' | 'reactivate';

export interface PersonDrawerProps {
    /** The person open, or nothing when the drawer is closed. */
    id: string | undefined;
    /** Whether that person is whoever is signed in, whose own role and status another admin changes. */
    isSelf: boolean;
    onClose: () => void;
}

/**
 * One person: how they sign in, where they are signed in, and everything an admin may change.
 *
 * Every change is behind the re-verify dialog, which the API asks for whenever the admin acting has a
 * strong factor they have not proved recently, and every change but the role asks first. The role
 * does not, because changing it back is the same control.
 */
export function PersonDrawer({ id, isSelf, onClose }: PersonDrawerProps) {
    const { t } = useTranslation('settings');
    const phone = usePhone();
    const person = useUser(id);

    return (
        <Drawer
            opened={id !== undefined}
            onClose={onClose}
            position="right"
            size={phone ? '100%' : 'lg'}
            title={
                <Text fw={600} truncate>
                    {person.data?.email ?? t('people.noAddress')}
                </Text>
            }
        >
            {person.isPending ? <PageSkeleton variant="rows" count={4} /> : undefined}
            {person.error ? (
                <ErrorAlert title={t('people.drawer.unavailable.title')} error={person.error} fallback={t('people.drawer.unavailable.fallback')} />
            ) : undefined}
            {person.data ? <PersonDetail person={person.data} isSelf={isSelf} /> : undefined}
        </Drawer>
    );
}

function PersonDetail({ person, isSelf }: { person: UserDetail; isSelf: boolean }) {
    const { t } = useTranslation('settings');
    const gate = useStepUpGate();
    const changeRole = useChangeUserRole();
    const [roleFailure, setRoleFailure] = useState<unknown>();
    const email = person.email ?? t('people.noAddress');

    async function chooseRole(role: PlatformRole): Promise<void> {
        setRoleFailure(undefined);
        try {
            await gate.run(() => changeRole.mutateAsync({ id: person.id, role }));
            notifyDone(t('people.drawer.roleChanged', { email, role: t(`people.role.${role}`) }));
        } catch (caught) {
            if (!isStepUpCancelled(caught)) setRoleFailure(caught);
        }
    }

    return (
        <Stack gap="lg">
            <Group gap="sm">
                <StatusLamp tone={person.active ? 'ok' : 'off'} label={t(person.active ? 'people.state.active' : 'people.state.inactive')} />
                <Text size="sm" c={person.hasStrongFactor ? undefined : 'dimmed'}>
                    {person.hasStrongFactor ? t('people.strong') : t('people.weak')}
                </Text>
            </Group>

            {isSelf ? (
                <Alert variant="light" color="gray">
                    {t('people.drawer.ownAccount')}
                </Alert>
            ) : undefined}

            <Stack gap="xs">
                {roleFailure ? (
                    <ErrorAlert title={t('people.drawer.roleErrorTitle')} error={roleFailure} fallback={t('people.drawer.roleErrorFallback')} />
                ) : undefined}
                <Select
                    label={t('people.drawer.role.label')}
                    description={t('people.drawer.role.description')}
                    data={ROLES.map(value => ({ value, label: t(`people.role.${value}`) }))}
                    renderOption={({ option }) => (
                        <Stack gap={0}>
                            <Text size="sm">{option.label}</Text>
                            <Text size="xs" c="dimmed">
                                {t(`people.roleHelp.${option.value as PlatformRole}`)}
                            </Text>
                        </Stack>
                    )}
                    value={person.role ?? null}
                    placeholder={t('people.role.none')}
                    allowDeselect={false}
                    disabled={isSelf || changeRole.isPending}
                    onChange={next => {
                        if (next && next !== person.role) void chooseRole(next as PlatformRole);
                    }}
                />
            </Stack>

            <PersonActions person={person} isSelf={isSelf} gate={gate} />

            <Divider />

            <Stack gap="xs">
                <Title order={3} size="h5">
                    {t('people.drawer.factors.title')}
                </Title>
                {person.factors.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {t('people.drawer.factors.empty')}
                    </Text>
                ) : (
                    person.factors.map(factor => (
                        <Group key={`${factor.method}:${factor.methodId}`} justify="space-between" wrap="nowrap">
                            <Text size="sm">{t(`people.drawer.method.${factor.method}`)}</Text>
                            <Text size="sm" c="dimmed" truncate>
                                {factor.label}
                            </Text>
                        </Group>
                    ))
                )}
            </Stack>

            <Stack gap="xs">
                <Title order={3} size="h5">
                    {t('people.drawer.sessions.title')}
                </Title>
                {person.sessions.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {t('people.drawer.sessions.empty')}
                    </Text>
                ) : (
                    person.sessions.map(session => (
                        <Stack key={session.sessionToken} gap={0}>
                            <Text size="sm" truncate>
                                {session.userAgent ?? t('people.drawer.sessions.unknownDevice')}
                            </Text>
                            <Text size="xs" c="dimmed" className="da-num">
                                {t('people.drawer.sessions.lastSeen', { date: formatDate(session.lastAccessedAt) })}
                            </Text>
                        </Stack>
                    ))
                )}
            </Stack>

            <Stack gap="xs">
                <Title order={3} size="h5">
                    {t('people.drawer.signIns.title')}
                </Title>
                {person.signIns.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {t('people.drawer.signIns.empty')}
                    </Text>
                ) : (
                    <Table verticalSpacing={4} horizontalSpacing="xs">
                        <Table.Tbody>
                            {person.signIns.map(signIn => (
                                <Table.Tr key={signIn.occurredAt.toISO()}>
                                    <Table.Td>
                                        <Text size="sm" className="da-num">
                                            {formatDate(signIn.occurredAt)}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Text size="sm" c="dimmed">
                                            {signIn.mfaSatisfied ? t('people.drawer.signIns.withSecond') : t('people.drawer.signIns.withoutSecond')}
                                        </Text>
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                )}
            </Stack>

            <StepUpDialog gate={gate} />
        </Stack>
    );
}

/**
 * Sign out, reset the second step, and switch off or on, each asked about first. Switching off is
 * not offered on your own account, which the API refuses too; the second-step reset is, because an
 * admin whose phone has broken is exactly who needs it.
 */
function PersonActions({ person, isSelf, gate }: { person: UserDetail; isSelf: boolean; gate: ReturnType<typeof useStepUpGate> }) {
    const { t } = useTranslation('settings');
    const signOut = useSignOutUser();
    const resetMfa = useResetUserMfa();
    const deactivate = useDeactivateUser();
    const reactivate = useReactivateUser();
    const [confirming, setConfirming] = useState<Action>();
    const [failure, setFailure] = useState<unknown>();
    const email = person.email ?? t('people.noAddress');

    const mutations = { signOut, resetMfa, deactivate, reactivate } as const;

    function close(): void {
        setConfirming(undefined);
        setFailure(undefined);
    }

    async function confirm(action: Action): Promise<void> {
        setFailure(undefined);
        try {
            await gate.run<unknown>(() => mutations[action].mutateAsync({ id: person.id }));
            close();
            notifyDone(t(`people.drawer.${action}.done`, { email }));
        } catch (caught) {
            if (!isStepUpCancelled(caught)) setFailure(caught);
        }
    }

    const offered: Action[] = ['signOut', 'resetMfa', ...(isSelf ? [] : [person.active ? ('deactivate' as const) : ('reactivate' as const)])];

    return (
        <Group gap="xs">
            {offered.map(action => (
                <Button
                    key={action}
                    variant={action === 'deactivate' ? 'light' : 'default'}
                    color={action === 'deactivate' ? 'red' : undefined}
                    size="compact-sm"
                    onClick={() => setConfirming(action)}
                >
                    {t(`people.drawer.${action}.action`)}
                </Button>
            ))}

            {offered.map(action => (
                <ConfirmModal
                    key={action}
                    opened={confirming === action}
                    onClose={close}
                    onConfirm={() => void confirm(action)}
                    title={t(`people.drawer.${action}.title`, { email })}
                    confirmLabel={t(`people.drawer.${action}.action`)}
                    confirming={mutations[action].isPending}
                    error={failure}
                    errorTitle={t(`people.drawer.${action}.errorTitle`)}
                    errorFallback={t(`people.drawer.${action}.errorFallback`)}
                >
                    {t(`people.drawer.${action}.body`)}
                </ConfirmModal>
            ))}
        </Group>
    );
}
