import { useState } from 'react';
import { Alert, Badge, Button, Code, Collapse, CopyButton, Group, List, Stack, Text } from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
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
            <Alert color="green" title="The station is on air">
                <Text size="sm">{silence.detail}</Text>
                {/* Shut, and only here. Every gate reporting `ok` is eleven lines answering a
                    question nobody asked while the station is audible, and on this page it pushed
                    the running order — the thing the page is FOR — off the bottom of the screen.
                    It is one click away rather than gone, because the moment it is worth reading
                    is the moment the branch below draws it open. */}
                <RuledOut checks={silence.checks} collapsible />
            </Alert>
        );
    }

    return (
        <Stack gap="sm">
            {blocking ? (
                <Alert color={blocking.state === 'waiting' ? 'blue' : 'yellow'} title={TITLES[silence.cause]}>
                    <Stack gap="xs">
                        <Text size="sm">{silence.detail}</Text>
                        {silence.remedy ? <Remedy remedy={silence.remedy} /> : undefined}
                        <RuledOut checks={silence.checks} />
                    </Stack>
                </Alert>
            ) : undefined}

            {otherFaults.map(fault => (
                <Alert key={fault.code} color="red" title={TITLES[fault.code]}>
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
function RuledOut({ checks, collapsible = false }: { checks: SilenceCheck[]; collapsible?: boolean }) {
    const [open, setOpen] = useState(false);
    const ok = checks.filter(check => check.state === 'ok');
    if (ok.length === 0) return undefined;

    return (
        <Stack gap="xxs">
            {collapsible ? (
                <Button
                    variant="subtle"
                    color="gray"
                    size="compact-xs"
                    w="fit-content"
                    px={0}
                    rightSection={open ? <IconChevronUp size={13} stroke={1.8} /> : <IconChevronDown size={13} stroke={1.8} />}
                    onClick={() => setOpen(shown => !shown)}
                >
                    Ruled out ({ok.length})
                </Button>
            ) : (
                <Text size="xs" c="dimmed">
                    Ruled out
                </Text>
            )}
            <Collapse expanded={open || !collapsible}>
                <List size="xs" spacing={2}>
                    {ok.map(check => (
                        <List.Item key={check.code}>
                            <Group gap="xxs" wrap="nowrap">
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
            </Collapse>
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
    warmingUp: 'The station is fetching its first records',
    waitingOnAudio: 'The records are not here, and nothing is fetching them',
    noAudience: 'Waiting for a listener',
    notDriving: 'The mount is not being held',
    starved: 'The mount is airing the local bed',
};
