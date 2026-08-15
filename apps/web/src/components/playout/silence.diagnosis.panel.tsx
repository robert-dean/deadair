import { Alert, Badge, Button, Code, CopyButton, Group, List, Stack, Text } from '@mantine/core';
import type { SilenceCause, SilenceCheck, StationSilence } from '@deadair/sdk';

export interface SilenceDiagnosisProps {
    silence: StationSilence;
}

/**
 * Why the station cannot be heard, in full.
 *
 * The counterpart to the tally light in the transport strip, on the same split as
 * `StaleConfigBadge` / `StaleConfigAlert`: **one reading, two renderings**. The
 * strip has room for two words and a tooltip, and this has room for the reason,
 * the remedy, and — the part that makes it worth opening — everything the station
 * RULED OUT. "It is not the stream, it is not the running order, it is Icecast"
 * is a different and much more useful sentence than "it is Icecast".
 *
 * Nothing here decides anything. Every state, every sentence and the ordering all
 * come from the API, because the console guessing at this is precisely the
 * problem the field was added to fix.
 */
export function SilenceDiagnosisPanel({ silence }: SilenceDiagnosisProps) {
    const blocking = silence.checks.find(check => check.code === silence.cause);
    // Faults the station is not blaming: `configNotAdopted` is the only one today, and
    // it is deliberately never a cause, because a station can air perfectly well to
    // somebody who connected before the config was replaced. It still wants saying.
    const otherFaults = silence.checks.filter(check => check.state === 'fault' && check.code !== silence.cause);

    if (silence.audible && otherFaults.length === 0) {
        return (
            <Alert color="green" variant="light" title="The station is on air">
                <Text size="sm">{silence.detail}</Text>
                <RuledOut checks={silence.checks} />
            </Alert>
        );
    }

    return (
        <Stack gap="sm">
            {blocking ? (
                <Alert color={blocking.state === 'waiting' ? 'blue' : 'yellow'} variant="light" title={TITLES[silence.cause]}>
                    <Stack gap="xs">
                        <Text size="sm">{silence.detail}</Text>
                        {silence.remedy ? <Remedy remedy={silence.remedy} /> : undefined}
                        <RuledOut checks={silence.checks} />
                    </Stack>
                </Alert>
            ) : undefined}

            {otherFaults.map(fault => (
                <Alert key={fault.code} color="red" variant="light" title={TITLES[fault.code]}>
                    <Stack gap="xs">
                        <Text size="xs">{fault.detail}</Text>
                        {fault.remedy ? <Remedy remedy={fault.remedy} /> : undefined}
                    </Stack>
                </Alert>
            ))}
        </Stack>
    );
}

/**
 * What the station checked and was happy with.
 *
 * The reason this panel exists rather than a bigger tooltip. An operator chasing
 * silence is deciding where to look next, and a list of places they do not have
 * to look is most of that decision.
 */
function RuledOut({ checks }: { checks: SilenceCheck[] }) {
    const ok = checks.filter(check => check.state === 'ok');
    if (ok.length === 0) return undefined;

    return (
        <Stack gap={4}>
            <Text size="xs" c="dimmed">
                Ruled out
            </Text>
            <List size="xs" spacing={2}>
                {ok.map(check => (
                    <List.Item key={check.code}>
                        <Group gap={6} wrap="nowrap">
                            <Badge size="xs" variant="light" color="gray" tt="none">
                                {TITLES[check.code]}
                            </Badge>
                            <Text size="xs" c="dimmed">
                                {check.detail}
                            </Text>
                        </Group>
                    </List.Item>
                ))}
            </List>
        </Stack>
    );
}

/**
 * What would clear it.
 *
 * A shell command gets a copy button and nothing else, on the same argument
 * `StaleConfigAlert` makes: the app cannot restart a sibling container, and a
 * button that pretended otherwise would be a lie about what this console can do.
 * Anything that is not a command is a sentence.
 */
function Remedy({ remedy }: { remedy: string }) {
    if (!remedy.startsWith('docker ')) {
        return (
            <Text size="xs" c="dimmed">
                {remedy}
            </Text>
        );
    }

    return (
        <Group gap="xs" wrap="nowrap">
            <Code>{remedy}</Code>
            <CopyButton value={remedy}>
                {({ copied, copy }) => (
                    <Button size="compact-xs" variant="subtle" color={copied ? 'green' : undefined} onClick={copy}>
                        {copied ? 'Copied' : 'Copy'}
                    </Button>
                )}
            </CopyButton>
        </Group>
    );
}

/** A heading per gate. The station supplies the sentence; this is only what to call it. */
const TITLES: Record<SilenceCause, string> = {
    airing: 'On air',
    transportStalled: 'The transport loop has stopped',
    controlDenied: 'The stream is refusing the bridge secret',
    streamUnreachable: 'The stream is not reachable',
    configNotAdopted: 'A container is running config that was replaced',
    stoodDown: 'The station was stood down',
    noProgramme: 'There is nothing left to air',
    waitingOnAudio: 'The records are not here yet',
    noAudience: 'Waiting for a listener',
    notDriving: 'The mount is not being held',
    starved: 'The mount is airing the local bed',
};
