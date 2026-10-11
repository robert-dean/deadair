import { useEffect, useRef, useState } from 'react';
import { Anchor, Box, Button, Center, Group, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';

import { sdk } from '../../api/client';
import { partyLink, useParty } from '../../api/party.queries';
import { formatClock } from '../../i18n/format.locale';

/** The code's own units, against which the mark in its middle is measured. */
const POSTER_CODE_SIZE = 512;
/** The mark, a little over a fifth of the code's width. */
const POSTER_MARK_SIZE = 112;

/**
 * The party's code, as big as the screen allows, for a TV across the room.
 *
 * A page in the console rather than anything cast by the station, so it gets to a TV with whatever
 * the operator already has: Chrome's Cast tab, AirPlay mirroring, or a browser on the TV signed in to
 * the console. It stays behind sign-in, because it shows a live pass. Full screen is the browser's own,
 * and a wake lock keeps a laptop driving the TV from sleeping while the poster is up. Drawn without
 * the console's shell (`BARE_PATHS` in `__root.tsx`), white whatever the theme, since a TV in a lit
 * room reads a white poster and a scanner reads contrast.
 */
export function PartyPoster() {
    const { t } = useTranslation('requests');
    const party = useParty();
    const live = party.data?.party;
    const nowPlaying = useQuery({ queryKey: ['poster', 'nowplaying'], queryFn: () => sdk.nowplaying.getNowPlaying(), refetchInterval: 15_000 });
    const record = nowPlaying.data?.track !== undefined && nowPlaying.data.track.kind !== 'break' ? nowPlaying.data.track : undefined;
    const poster = useRef<HTMLDivElement>(null);
    const [full, setFull] = useState(false);

    useEffect(() => {
        const follow = () => setFull(document.fullscreenElement !== null);
        document.addEventListener('fullscreenchange', follow);
        return () => document.removeEventListener('fullscreenchange', follow);
    }, []);

    useEffect(() => {
        // Best effort: a browser without the API, or one that refuses it, leaves the screen to its own
        // sleep settings, which is what it would have done anyway.
        let lock: WakeLockSentinel | undefined;
        let cancelled = false;
        void navigator.wakeLock
            ?.request('screen')
            .then(held => {
                if (cancelled) void held.release();
                else lock = held;
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
            void lock?.release().catch(() => undefined);
        };
    }, []);

    return (
        <Box ref={poster} bg="#ffffff" c="#111111" mih="100dvh" p="xl" style={{ display: 'flex', flexDirection: 'column' }}>
            {full ? undefined : (
                <Group justify="space-between">
                    <Anchor c="#555555" size="sm" renderRoot={(props: object) => <Link to="/schedule" search={{ tab: 'requests' }} {...props} />}>
                        {t('poster.back')}
                    </Anchor>
                    {live !== undefined ? (
                        <Button variant="default" onClick={() => void poster.current?.requestFullscreen().catch(() => undefined)}>
                            {t('poster.fullScreen')}
                        </Button>
                    ) : undefined}
                </Group>
            )}
            <Center style={{ flex: 1 }}>
                {live === undefined ? (
                    <Text size="xl">{party.isPending ? undefined : t('poster.none')}</Text>
                ) : (
                    <Stack align="center" gap="lg">
                        {nowPlaying.data?.station !== undefined ? (
                            <Text size="lg" tt="uppercase" fw={600} c="#555555" style={{ letterSpacing: '0.12em' }}>
                                {nowPlaying.data.station}
                            </Text>
                        ) : undefined}
                        <Title order={1} c="#111111" ta="center" style={{ fontSize: 'clamp(2rem, 5vw, 4.5rem)' }}>
                            {t('poster.scan')}
                        </Title>
                        <QRCodeSVG
                            value={partyLink(live.token)}
                            // The station's mark in the middle, on the modules it clears. Level H is
                            // what pays for that: it recovers up to 30% of the code, and the mark
                            // covers about 4% of it, so a phone at an angle across the room still
                            // reads it. `size` is the unit the mark is measured against; the style
                            // below decides how big it is drawn.
                            size={POSTER_CODE_SIZE}
                            level="H"
                            imageSettings={{ src: '/logo-mark.png', width: POSTER_MARK_SIZE, height: POSTER_MARK_SIZE, excavate: true }}
                            marginSize={2}
                            bgColor="#ffffff"
                            fgColor="#000000"
                            title={t('party.qrTitle')}
                            style={{ width: 'min(60vh, 70vw)', height: 'min(60vh, 70vw)' }}
                        />
                        {record !== undefined ? (
                            <Text size="xl" c="#333333" ta="center">
                                {t('poster.onAir', { title: record.title, artist: record.artist })}
                            </Text>
                        ) : undefined}
                        <Text size="md" c="#666666" className="da-num">
                            {t('poster.until', { time: formatClock(live.expiresAt.toJSDate()) })}
                        </Text>
                    </Stack>
                )}
            </Center>
        </Box>
    );
}
