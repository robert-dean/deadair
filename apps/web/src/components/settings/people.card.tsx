import { useState } from 'react';
import { Badge, Button, Card, Group, Pagination, SegmentedControl, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { PlatformRole, UserSummary } from '@deadair/sdk';

import { useCurrentSession, useUsers } from '../../api/users.queries';
import { ErrorAlert } from '../shared/error.alert';
import { formatDate } from '../shared/format.date';
import { PageSkeleton } from '../shared/page.skeleton';
import { PhoneCard } from '../shared/phone.card';
import { StatusLamp } from '../shared/status.lamp';
import { usePhone } from '../shared/use.phone';
import { PersonDrawer } from './person.drawer';

/** Rows per page. A station has dozens of people rather than thousands, so one size is enough. */
export const PEOPLE_PAGE_SIZE = 25;

/** How long the search box waits after the last keystroke before asking. */
const SEARCH_DEBOUNCE_MS = 300;

type StatusFilter = 'active' | 'inactive' | 'all';

const ROLES: readonly PlatformRole[] = ['admin', 'listener'];

/**
 * Everybody with an account, for an admin deciding who may do what.
 *
 * Opens on the active people, because a switched-off account is kept rather than deleted and would
 * otherwise sit in the list forever. Each row opens the person in a drawer, which is where every
 * change is made: the list is for finding somebody, not for acting on them by accident.
 */
export function PeopleCard() {
    const { t } = useTranslation('settings');
    const phone = usePhone();
    const [search, setSearch] = useState('');
    const [debouncedSearch] = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
    const [role, setRole] = useState<PlatformRole>();
    const [status, setStatus] = useState<StatusFilter>('active');
    const [page, setPage] = useState(0);
    const [openId, setOpenId] = useState<string>();
    const session = useCurrentSession();

    const users = useUsers({
        page,
        pageSize: PEOPLE_PAGE_SIZE,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(role ? { role } : {}),
        ...(status === 'all' ? {} : { active: status === 'active' }),
    });

    const list = users.data?.data ?? [];
    const total = users.data?.meta.total ?? 0;
    const pageCount = Math.ceil(total / PEOPLE_PAGE_SIZE);
    const selfId = session.data?.actorId;

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        {t('people.title')}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {t('people.intro')}
                    </Text>
                </Stack>

                <Group align="flex-end" gap="sm">
                    <TextInput
                        label={t('people.filter.search.label')}
                        placeholder={t('people.filter.search.placeholder')}
                        leftSection={<IconSearch size={14} aria-hidden />}
                        value={search}
                        onChange={event => {
                            setSearch(event.currentTarget.value);
                            setPage(0);
                        }}
                        style={{ flex: 1, minWidth: 200 }}
                    />
                    <Select
                        label={t('people.filter.role.label')}
                        w={160}
                        data={[
                            { value: '', label: t('people.filter.role.any') },
                            ...ROLES.map(value => ({ value, label: t(`people.role.${value}`) })),
                        ]}
                        value={role ?? ''}
                        allowDeselect={false}
                        onChange={next => {
                            setRole(next ? (next as PlatformRole) : undefined);
                            setPage(0);
                        }}
                    />
                    <SegmentedControl
                        aria-label={t('people.filter.status.label')}
                        data={[
                            { value: 'active', label: t('people.filter.status.active') },
                            { value: 'inactive', label: t('people.filter.status.inactive') },
                            { value: 'all', label: t('people.filter.status.all') },
                        ]}
                        value={status}
                        onChange={next => {
                            setStatus(next as StatusFilter);
                            setPage(0);
                        }}
                    />
                </Group>

                {users.isPending ? <PageSkeleton variant="rows" count={3} /> : undefined}
                {users.error ? (
                    <ErrorAlert title={t('people.unavailable.title')} error={users.error} fallback={t('people.unavailable.fallback')} />
                ) : undefined}

                {users.data && list.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {t('people.empty')}
                    </Text>
                ) : undefined}

                {users.data && list.length > 0 && phone ? (
                    <Stack gap="xxs">
                        {list.map(person => (
                            <PersonPhoneCard key={person.id} person={person} isSelf={person.id === selfId} onOpen={() => setOpenId(person.id)} />
                        ))}
                    </Stack>
                ) : undefined}

                {users.data && list.length > 0 && !phone ? (
                    <Table.ScrollContainer minWidth={720}>
                        <Table verticalSpacing="sm" horizontalSpacing="sm" highlightOnHover>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>{t('people.column.person')}</Table.Th>
                                    <Table.Th>{t('people.column.role')}</Table.Th>
                                    <Table.Th>{t('people.column.lastSignIn')}</Table.Th>
                                    <Table.Th>{t('people.column.signIn')}</Table.Th>
                                    <Table.Th>{t('people.column.status')}</Table.Th>
                                    <Table.Th w={100} />
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {list.map(person => (
                                    <PersonRow key={person.id} person={person} isSelf={person.id === selfId} onOpen={() => setOpenId(person.id)} />
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                ) : undefined}

                {users.data ? (
                    <Group justify="space-between">
                        <Text size="sm" c="dimmed">
                            {t('people.results', { count: total })}
                        </Text>
                        {pageCount > 1 ? <Pagination total={pageCount} value={page + 1} onChange={next => setPage(next - 1)} size="sm" /> : undefined}
                    </Group>
                ) : undefined}
            </Stack>

            <PersonDrawer id={openId} isSelf={openId !== undefined && openId === selfId} onClose={() => setOpenId(undefined)} />
        </Card>
    );
}

interface PersonProps {
    person: UserSummary;
    isSelf: boolean;
    onOpen: () => void;
}

/** The address a person is known by, or a plain word for an account that has none. */
function PersonName({ person, isSelf }: Pick<PersonProps, 'person' | 'isSelf'>) {
    const { t } = useTranslation('settings');
    return (
        <Group gap="xs" wrap="nowrap">
            <Text size="sm" fw={500} truncate c={person.email ? undefined : 'dimmed'}>
                {person.email ?? t('people.noAddress')}
            </Text>
            {isSelf ? (
                <Badge size="xs" variant="light">
                    {t('people.you')}
                </Badge>
            ) : undefined}
        </Group>
    );
}

function roleWord(t: ReturnType<typeof useTranslation<'settings'>>['t'], role: PlatformRole | undefined): string {
    return role ? t(`people.role.${role}`) : t('people.role.none');
}

function PersonRow({ person, isSelf, onOpen }: PersonProps) {
    const { t } = useTranslation('settings');
    return (
        <Table.Tr style={{ opacity: person.active ? 1 : 0.6 }}>
            <Table.Td maw={320}>
                <PersonName person={person} isSelf={isSelf} />
            </Table.Td>
            <Table.Td>
                <Text size="sm">{roleWord(t, person.role)}</Text>
            </Table.Td>
            <Table.Td>
                <Text size="sm" className="da-num">
                    {person.lastSignInAt ? formatDate(person.lastSignInAt) : t('people.never')}
                </Text>
            </Table.Td>
            <Table.Td>
                <Text size="sm" c={person.hasStrongFactor ? undefined : 'dimmed'}>
                    {person.hasStrongFactor ? t('people.strong') : t('people.weak')}
                </Text>
            </Table.Td>
            <Table.Td>
                <StatusLamp tone={person.active ? 'ok' : 'off'} label={t(person.active ? 'people.state.active' : 'people.state.inactive')} />
            </Table.Td>
            <Table.Td ta="right">
                <Button variant="subtle" size="compact-sm" onClick={onOpen}>
                    {t('people.manage')}
                </Button>
            </Table.Td>
        </Table.Tr>
    );
}

function PersonPhoneCard({ person, isSelf, onOpen }: PersonProps) {
    const { t } = useTranslation('settings');
    const role = roleWord(t, person.role);
    return (
        <PhoneCard
            opacity={person.active ? 1 : 0.6}
            onClick={onOpen}
            aria-label={person.email ?? t('people.noAddress')}
            title={<PersonName person={person} isSelf={isSelf} />}
            subtitle={
                <Text size="xs" c="dimmed" truncate>
                    {person.lastSignInAt
                        ? t('people.phone.lastSignIn', { role, date: formatDate(person.lastSignInAt) })
                        : t('people.phone.neverSignedIn', { role })}
                </Text>
            }
            figure={<StatusLamp tone={person.active ? 'ok' : 'off'} label={t(person.active ? 'people.state.active' : 'people.state.inactive')} />}
        />
    );
}
