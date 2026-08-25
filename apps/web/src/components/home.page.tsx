import { Group, Image, Stack, Text, Title } from '@mantine/core';

import { usePlayoutStatus } from '../api/playout.queries';
import { useStationAttention } from '../api/station.queries';
import { OnAirBadge } from './playout/on.air.badge';
import { AttentionList } from './station/attention.list';
import { ErrorAlert } from './shared/error.alert';
import { Eyebrow } from './shared/eyebrow';
import { PageSkeleton } from './shared/page.skeleton';
import { StatusLamp } from './shared/status.lamp';

/**
 * Where the console opens, and the one question it answers: does anything need you.
 *
 * It was the lockup, the name and a tally light — true, and nothing an operator could act on. Every
 * fact that would have been worth landing on lived on the page that owned it, so a station with a
 * plugin down and four hundred unfetchable records looked exactly like a station with nothing wrong
 * until somebody happened to open the right page. The list under the masthead is that, composed by
 * the station itself.
 *
 * The masthead stays. It is the only place the full lockup appears, and a console that opened on a
 * bare list of faults would be a console that only ever has bad news on its first screen.
 */
export function HomePage() {
    // Shares the poll the shell is already running: same query key, same cache, no
    // second request. Enabled unconditionally because this page only renders behind
    // the router's auth gate.
    const playout = usePlayoutStatus(true);
    const attention = useStationAttention(true);

    return (
        <Stack gap="lg">
            <Group align="flex-start" gap="xl" wrap="nowrap">
                {/* The full lockup, and the only place it appears: everywhere else in the console the
                    arched type is too small to read and the skull alone does the job. Hidden from
                    assistive technology because the heading beside it already says the name. */}
                <Image src="/logo.png" alt="" aria-hidden w={132} h={132} visibleFrom="xs" style={{ flexShrink: 0 }} />
                <Stack gap="xs" maw={560}>
                    <Eyebrow>Station</Eyebrow>
                    <Group gap="sm" align="center">
                        <Title order={1}>deadair</Title>
                        {playout.data ? (
                            <OnAirBadge silence={playout.data.silence} />
                        ) : (
                            // Not "off air": nothing has been heard from the station yet, and
                            // guessing either way is the one thing a tally light must not do.
                            <StatusLamp tone="off" label="…" emphasis="chip" />
                        )}
                    </Group>
                    <Text c="dimmed">
                        A self-driving internet radio station. deadair holds the mount on a lease it renews only while it has something to play, so
                        what you hear is always something the station chose.
                    </Text>
                </Stack>
            </Group>

            <Stack gap="xs">
                <Eyebrow>Needs you</Eyebrow>

                {attention.isPending ? <PageSkeleton variant="card" /> : undefined}

                {/* The list failing is not the station failing, and saying which is the difference
                    between a console an operator trusts and one they second-guess. */}
                {attention.error ? (
                    <ErrorAlert
                        title="The station could not be asked what needs you"
                        error={attention.error}
                        fallback="Nothing is known to be wrong; this list is what is unavailable."
                    />
                ) : undefined}

                {attention.data ? <AttentionList items={attention.data.items} /> : undefined}
            </Stack>
        </Stack>
    );
}
