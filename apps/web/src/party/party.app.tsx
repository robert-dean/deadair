import { useCallback, useState } from 'react';
import { Button, Center, Container, Loader, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { sdkError } from '../api/sdk.error';
import { setGuestToken, partySdk } from './party.client';
import { PartyRequests } from './party.requests';
import { forgetGuest, loadGuest, passFromHash, saveGuest, usableGuest, type StoredGuest } from './party.session';

/** Where the page is: joining, in, or turned away and why. */
type Stage =
    { kind: 'joining' } | { kind: 'in'; guest: StoredGuest } | { kind: 'ended' } | { kind: 'noPass' } | { kind: 'full' } | { kind: 'unreachable' };

/**
 * The guest request page: somebody at a party scanned the station's code and landed here.
 *
 * The pass arrives after `#` in the address, which no server sees and no Referer carries, and is
 * tidied out of the address bar once read, so a screenshot of the page shares nothing. A guest who
 * reloads carries on with the session this browser kept; one who scans a new party's code joins again.
 */
export function PartyApp() {
    const { t } = useTranslation('party');
    // Read once, before the first render: the pass from the address (tidied out of it straight away)
    // and whatever session this browser kept.
    const [arrival] = useState(() => {
        const pass = passFromHash(window.location.hash);
        if (pass !== undefined) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        const kept = usableGuest(loadGuest(), pass, new Date());
        if (kept !== undefined) setGuestToken(kept.accessToken);
        return { pass, kept };
    });
    const [over, setOver] = useState(false);

    // Joining is a query rather than an effect: it runs once for this pass, and the page is drawn from
    // its state, so a retry is a refetch and nothing has to be set from inside an effect.
    const joining = useQuery({
        queryKey: ['party', 'join', arrival.pass],
        queryFn: async (): Promise<StoredGuest> => {
            const session = await partySdk.requests.party.joinParty({ token: arrival.pass! });
            const guest = saveGuest(arrival.pass!, session);
            setGuestToken(guest.accessToken);
            return guest;
        },
        enabled: arrival.kept === undefined && arrival.pass !== undefined,
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnWindowFocus: false,
    });

    /** The party ended under the guest: the station answered 401, and nothing this page holds can fix that. */
    const ended = useCallback(() => {
        forgetGuest();
        setGuestToken(undefined);
        setOver(true);
    }, []);

    const stage = ((): Stage => {
        if (over) return { kind: 'ended' };
        const guest = arrival.kept ?? joining.data;
        if (guest !== undefined) return { kind: 'in', guest };
        if (arrival.pass === undefined) return { kind: 'noPass' };
        if (joining.isError) {
            const status = sdkError(joining.error)?.status;
            return status === 404 ? { kind: 'ended' } : status === 409 ? { kind: 'full' } : { kind: 'unreachable' };
        }
        return { kind: 'joining' };
    })();

    return (
        <Container size={560} px="md" py="lg">
            <Stack gap="lg">
                <Header />
                {stage.kind === 'joining' && (
                    <Center py="xl">
                        <Stack align="center" gap="sm">
                            <Loader />
                            <Text c="dimmed">{t('joining')}</Text>
                        </Stack>
                    </Center>
                )}
                {stage.kind === 'in' && <PartyRequests guest={stage.guest} onEnded={ended} />}
                {stage.kind === 'ended' && <Notice title={t('ended.title')} body={t('ended.body')} />}
                {stage.kind === 'noPass' && <Notice title={t('noPass.title')} body={t('noPass.body')} />}
                {stage.kind === 'full' && <Notice title={t('full.title')} body={t('full.body')} />}
                {stage.kind === 'unreachable' && (
                    <Stack gap="sm">
                        <Text>{t('unreachable')}</Text>
                        <Button variant="light" loading={joining.isFetching} onClick={() => void joining.refetch()}>
                            {t('retry')}
                        </Button>
                    </Stack>
                )}
            </Stack>
        </Container>
    );
}

/** The station's name and what it is playing, from the one route anybody may read. */
function Header() {
    const { t } = useTranslation('party');
    const { data } = useQuery({ queryKey: ['party', 'nowplaying'], queryFn: () => partySdk.nowplaying.getNowPlaying(), refetchInterval: 30_000 });
    const record = data?.track !== undefined && data.track.kind !== 'break' ? data.track : undefined;

    return (
        <Stack gap={4}>
            {data?.station !== undefined && (
                <Text size="sm" c="dimmed" tt="uppercase" fw={600}>
                    {data.station}
                </Text>
            )}
            <Title order={1} size="h2">
                {t('title')}
            </Title>
            {record !== undefined && (
                <Text size="sm" c="dimmed">
                    {t('onAir', { title: record.title, artist: record.artist })}
                </Text>
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
