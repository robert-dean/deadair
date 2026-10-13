import { useState } from 'react';
import { Button, Divider, Drawer, Group, Loader, Stack, Text, TextInput, Textarea, Title, UnstyledButton } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ListenerRequest, RequestableTrack } from '@deadair/sdk';

import { sdkError } from '../api/sdk.error';
import { formatClock } from '../i18n/format.locale';
import { partySdk } from './party.client';
import { EMPTY_FORM, PARTY_RULES, isOpen, mayInsist, outcomeOf, requestBody, rowKey, searchTerm, type PartyForm } from './party.rules';
import type { StoredGuest } from './party.session';

interface Props {
    guest: StoredGuest;
    /** The station answered 401: the party is over for this guest. */
    onEnded: () => void;
}

/**
 * Search, ask, and see what became of it: the listener apps' request page, for a guest.
 *
 * With nothing typed the page is the guest's own requests, asked again every fifteen seconds while it
 * shows, because the station tells a page nothing when one moves on. A result opens a sheet rather than
 * sending at once: a request is one at a time and cannot be taken back, and the sheet is where the name
 * and the dedication go.
 */
export function PartyRequests({ guest, onEnded }: Props) {
    const { t } = useTranslation('party');
    const queryClient = useQueryClient();
    const [typed, setTyped] = useState('');
    const [settled] = useDebouncedValue(typed, PARTY_RULES.searchDebounceMs);
    const term = searchTerm(settled);
    const [chosen, setChosen] = useState<RequestableTrack | undefined>();
    const [form, setForm] = useState<PartyForm>(EMPTY_FORM);

    /** Every call goes through here, so a 401 from any of them ends the party for this page. */
    const asGuest = async <T,>(call: () => Promise<T>): Promise<T> => {
        try {
            return await call();
        } catch (error) {
            if (sdkError(error)?.status === 401) onEnded();
            throw error;
        }
    };

    const search = useQuery({
        queryKey: ['party', 'search', term],
        queryFn: () => asGuest(() => partySdk.requests.searchRequestableRecords({ q: term!, limit: PARTY_RULES.searchLimit })),
        enabled: term !== undefined,
        retry: false,
    });

    const mine = useQuery({
        queryKey: ['party', 'mine'],
        queryFn: () => asGuest(() => partySdk.requests.listMyRequests()),
        refetchInterval: PARTY_RULES.pollMs,
        retry: false,
    });

    const send = useMutation({
        mutationFn: (track: RequestableTrack) => asGuest(() => partySdk.requests.createRequest(requestBody(track, form))),
        onSuccess: request => {
            setChosen(undefined);
            // The name is who the guest is, so it stays for the next one; the rest was for this record.
            setForm({ ...EMPTY_FORM, name: form.name });
            setTyped('');
            void queryClient.invalidateQueries({ queryKey: ['party', 'mine'] });
            notifications.show({ message: outcomeWords(request) });
        },
        onError: error => {
            const status = sdkError(error)?.status;
            if (status === 401) return;
            if (status === 404) {
                setChosen(undefined);
                void search.refetch();
                notifications.show({ color: 'red', message: t('outcome.gone') });
                return;
            }
            notifications.show({ color: 'red', message: t('outcome.failed') });
        },
    });

    // Overruling the station on a refusal makes a new request, decided like any other, so it is told
    // the same way a request just sent is.
    const insist = useMutation({
        mutationFn: (request: ListenerRequest) => asGuest(() => partySdk.requests.insistOnRequest(request.id)),
        onSuccess: request => notifications.show({ message: outcomeWords(request) }),
        onError: error => {
            const status = sdkError(error)?.status;
            if (status === 401) return;
            notifications.show({ color: 'red', message: status === 409 ? t('outcome.spent') : t('outcome.failed') });
        },
        onSettled: () => void queryClient.invalidateQueries({ queryKey: ['party', 'mine'] }),
    });

    const outcomeWords = (request: ListenerRequest): string => {
        const outcome = outcomeOf(request);
        if (outcome.kind === 'refused') return outcome.reason ?? t('outcome.refused');
        return outcome.kind === 'waiting' ? t('outcome.waiting', { title: outcome.title }) : t('outcome.onItsWay', { title: outcome.title });
    };

    const field = (key: keyof PartyForm, max: number) => ({
        value: form[key],
        onChange: (event: { currentTarget: { value: string } }) => setForm({ ...form, [key]: event.currentTarget.value.slice(0, max) }),
    });

    const nameField = field('name', PARTY_RULES.nameMax);
    const dedicateField = field('dedicateTo', PARTY_RULES.dedicateMax);
    const messageField = field('message', PARTY_RULES.messageMax);

    return (
        <Stack gap="lg">
            <TextInput
                aria-label={t('search.label')}
                placeholder={t('search.placeholder')}
                value={typed}
                onChange={event => setTyped(event.currentTarget.value)}
                rightSection={search.isFetching ? <Loader size="xs" /> : undefined}
                size="md"
                autoComplete="off"
                autoCorrect="off"
            />

            {term === undefined ? (
                <Stack gap="md">
                    <Text size="sm" c="dimmed">
                        {t('intro')}
                    </Text>
                    <Text size="sm" c="dimmed">
                        {t('endsAt', { time: formatClock(new Date(guest.expiresAt)) })}
                    </Text>
                    <MyRequests
                        requests={mine.data?.requests}
                        loading={mine.isPending}
                        insisting={insist.isPending ? insist.variables?.id : undefined}
                        onInsist={request => insist.mutate(request)}
                    />
                </Stack>
            ) : search.isError ? (
                <Text c="red">{t('search.failed')}</Text>
            ) : search.data?.tracks.length === 0 ? (
                <Text c="dimmed">{t('search.nothing')}</Text>
            ) : (
                <Stack gap={0}>
                    {search.data?.tracks.map(track => (
                        <UnstyledButton
                            key={rowKey(track)}
                            onClick={() => setChosen(track)}
                            aria-label={t('row.request', { title: track.title })}
                            py="sm"
                            style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
                        >
                            <Text lineClamp={1}>{track.title}</Text>
                            <Text size="sm" c="dimmed" lineClamp={1}>
                                {track.album === undefined ? track.artist : t('row.detail', { artist: track.artist, detail: track.album })}
                            </Text>
                            {track.sourceName !== undefined && (
                                <Text size="xs" c="dimmed">
                                    {t('row.from', { source: track.sourceName })}
                                </Text>
                            )}
                        </UnstyledButton>
                    ))}
                </Stack>
            )}

            <Drawer
                opened={chosen !== undefined}
                onClose={() => !send.isPending && setChosen(undefined)}
                position="bottom"
                // A sheet the height of what is in it, from the bottom of a phone, as the listener apps
                // draw it. Mantine's bottom drawer is the full height by default, and `size="auto"` does
                // not change its flex basis.
                styles={{ content: { flex: '0 0 auto', width: '100%', height: 'auto', maxHeight: '90dvh' } }}
                title={chosen === undefined ? undefined : t('sheet.title', { title: chosen.title })}
            >
                <Stack gap="md" pb="md">
                    <TextInput label={t('sheet.name')} description={t('sheet.nameHint')} autoComplete="given-name" {...nameField} />
                    <TextInput label={t('sheet.dedicateTo')} {...dedicateField} />
                    <Textarea label={t('sheet.message')} description={t('sheet.messageHint')} autosize minRows={2} maxRows={5} {...messageField} />
                    <Button size="md" loading={send.isPending} onClick={() => chosen !== undefined && send.mutate(chosen)}>
                        {t('sheet.send')}
                    </Button>
                </Stack>
            </Drawer>
        </Stack>
    );
}

interface MyRequestsProps {
    requests: ListenerRequest[] | undefined;
    loading: boolean;
    /** The request being insisted on just now, if any. */
    insisting: string | undefined;
    onInsist: (request: ListenerRequest) => void;
}

function MyRequests({ requests, loading, insisting, onInsist }: MyRequestsProps) {
    const { t } = useTranslation('party');

    return (
        <Stack gap="xs">
            <Divider />
            <Title order={2} size="h5">
                {t('mine.title')}
            </Title>
            {loading ? (
                <Loader size="sm" />
            ) : requests === undefined || requests.length === 0 ? (
                <Text size="sm" c="dimmed">
                    {t('mine.none')}
                </Text>
            ) : (
                requests.map(request => (
                    <Group key={request.id} justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
                        <Stack gap={0} style={{ minWidth: 0 }}>
                            <Text lineClamp={1}>{request.title}</Text>
                            <Text size="sm" c="dimmed" lineClamp={1}>
                                {request.artist}
                            </Text>
                            <Note request={request} />
                            {mayInsist(request) && (
                                <Button
                                    variant="light"
                                    size="compact-sm"
                                    mt={6}
                                    w="fit-content"
                                    aria-label={t('mine.insistLabel', { title: request.title })}
                                    loading={insisting === request.id}
                                    disabled={insisting !== undefined && insisting !== request.id}
                                    onClick={() => onInsist(request)}
                                >
                                    {t('mine.insist')}
                                </Button>
                            )}
                        </Stack>
                        <Text size="sm" fw={600} c={isOpen(request.status) ? undefined : 'dimmed'} style={{ whiteSpace: 'nowrap' }}>
                            {t(`state.${request.status}`)}
                        </Text>
                    </Group>
                ))
            )}
        </Stack>
    );
}

/** One more line where there is something to say: when it played, why it did not, or who it is for. */
function Note({ request }: { request: ListenerRequest }) {
    const { t } = useTranslation('party');
    const words =
        request.status === 'aired' && request.airedAt !== undefined
            ? t('mine.aired', { time: formatClock(request.airedAt.toJSDate()) })
            : (request.status === 'declined' || request.status === 'expired') && request.reason !== undefined
              ? request.reason
              : request.dedicateTo !== undefined
                ? t('mine.for', { name: request.dedicateTo })
                : undefined;
    return words === undefined ? undefined : (
        <Text size="xs" c="dimmed">
            {words}
        </Text>
    );
}
