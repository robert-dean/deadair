import { Button, Card, Code, CopyButton, Group, Progress, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { PlayoutMount, PluginSummary, StationHeartbeat } from '@deadair/sdk';
import type { DateTime } from 'luxon';

import { usePlayoutStatus } from '../../api/playout.queries';
import { pluginsListOptions } from '../../api/plugins.queries';
import { useStationAttention, useStationCheckup } from '../../api/station.queries';
import { useStorage } from '../../api/storage.queries';
import { AttentionList } from './attention.list';
import { EmptyState } from '../shared/empty.state';
import { Eyebrow } from '../shared/eyebrow';
import { formatBytes } from '../shared/format.bytes';
import { formatTimeOfDay } from '../shared/feed.moment';
import { PageHeader } from '../shared/page.header';
import { PhoneCard } from '../shared/phone.card';
import { readSilence } from '../playout/silence.reading';
import { StatusLamp } from '../shared/status.lamp';
import { usePhone } from '../shared/use.phone';

/**
 * Everything an operator would otherwise visit five pages to read.
 *
 * Assembled from readings the console ALREADY makes rather than from a new composition: the silence
 * verdict and the audience come off the transport's own poll, what needs somebody off the nav's,
 * the plugin statuses off the plugins page's, the disk off the settings page's, and only the two
 * signals nothing exposed — the loops and the backlog — come from a route added for this. Five
 * queries rather than one, deliberately: a second server-side composition of facts the console holds
 * would be a second answer that can disagree with the first.
 *
 * Every section fails on its own, which is the same rule the service under it works to and the
 * reason this page is worth having: a page that says what is wrong is the worst possible place for
 * one dead reader to blank the whole screen. So a section that cannot be read says so in its own
 * box and the rest of the page still answers.
 */
export function CheckupPage() {
    const playout = usePlayoutStatus(true);
    const attention = useStationAttention(true);
    const plugins = useQuery(pluginsListOptions);
    const storage = useStorage();
    const checkup = useStationCheckup();

    // The same reading the header's tally draws, so the two surfaces naming one state cannot word it
    // differently — which they did for as long as this page handed the raw cause to a badge.
    const reading = playout.data === undefined ? undefined : readSilence(playout.data.silence);

    // Read here rather than in `Loops`, which mounts only once the reading has arrived: by then
    // the answer must already be settled, or its first paint is a desk-shaped frame the phone
    // replaces a beat later. This page is mounted before any data, where that one corrected frame
    // is the hook's documented, accepted cost.
    const phone = usePhone();

    return (
        <Stack gap="lg">
            <PageHeader
                title="Check-up"
                description={
                    <Text size="sm" c="dimmed">
                        The machinery, in one place. Nothing here probes the station: every figure is a reading it was already keeping, so looking at
                        this page changes nothing about it.
                    </Text>
                }
            />

            <Section title="On air" failed={playout.isError} pending={playout.isPending}>
                {playout.data === undefined || reading === undefined ? undefined : (
                    <Stack gap="xs">
                        <Group gap="sm" wrap="wrap">
                            {/* The station's own verdict rather than a second one worked out here.
                                It composes ten gates in causal order and words the answer, and a
                                sentence of our own would be a thing to disagree with it.

                                Read through `readSilence`, which is the same reading the tally in
                                the header draws from. The chip used to be handed `silence.cause`
                                raw — an enum member, which Mantine's Badge then uppercased into
                                NOAUDIENCE. Two surfaces were naming one state, one of them in
                                English and one in the wire format. */}
                            <StatusLamp tone={reading.tone} label={reading.label} pulse={reading.live} emphasis="chip" />
                            <Text size="sm">{playout.data.silence.detail}</Text>
                        </Group>
                        {playout.data.silence.remedy === undefined ? undefined : (
                            <Text size="xs" c="dimmed">
                                {playout.data.silence.remedy}
                            </Text>
                        )}
                        <Group gap="lg" wrap="wrap">
                            <Fact label="Listeners" value={String(playout.data.listeners)} />
                            <Fact label="Stream" value={playout.data.streamUp ? 'up' : 'unreachable'} />
                            <Fact label="Queued" value={String(playout.data.queuedCount)} />
                        </Group>
                        <Mounts mounts={playout.data.mounts} />
                        {/* A container running config that was replaced is never the CAUSE of a
                            silence, and is the reason the next attempt to go on air will fail. */}
                        {playout.data.staleStreamConfig.map(warning => (
                            <Text key={warning.container} size="xs" c="yellow.4">
                                {warning.container}: {warning.detail}
                            </Text>
                        ))}
                    </Stack>
                )}
            </Section>

            <Section title="Needs you" failed={attention.isError} pending={attention.isPending}>
                {attention.data === undefined ? undefined : attention.data.items.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        Nothing is waiting on anybody.
                    </Text>
                ) : (
                    <AttentionList items={attention.data.items} />
                )}
            </Section>

            <Section title="Loops" failed={checkup.isError} pending={checkup.isPending}>
                {/* Absent rather than empty means the reader failed, which the service distinguishes
                    on purpose: a station with no loops running is not the same as a station that
                    could not be asked. */}
                {checkup.data?.heartbeats === undefined ? (
                    <Text size="sm" c="dimmed">
                        The station could not say what its loops are doing.
                    </Text>
                ) : (
                    <Loops heartbeats={checkup.data.heartbeats} readAt={checkup.data.readAt} phone={phone} />
                )}
            </Section>

            <Section title="Plugins" failed={plugins.isError} pending={plugins.isPending}>
                {plugins.data === undefined ? undefined : <Plugins plugins={plugins.data} />}
            </Section>

            <Section title="Library" failed={checkup.isError} pending={checkup.isPending}>
                {checkup.data?.backlog === undefined ? (
                    <Text size="sm" c="dimmed">
                        The catalog could not be counted.
                    </Text>
                ) : (
                    <Stack gap="xs">
                        <Group gap="lg" wrap="wrap">
                            <Fact label="Records" value={checkup.data.backlog.total.toLocaleString()} />
                            <Fact label="On this machine" value={checkup.data.backlog.cached.toLocaleString()} />
                            <Fact label="Measured" value={checkup.data.backlog.measured.toLocaleString()} />
                        </Group>
                        {/* The sentence the counts exist for. A bar rather than a percentage,
                            because what an operator reads off it is how far along it is. */}
                        <Progress
                            value={checkup.data.backlog.total === 0 ? 0 : (checkup.data.backlog.measured / checkup.data.backlog.total) * 100}
                            size="sm"
                            aria-label="How much of the library is measured"
                        />
                    </Stack>
                )}
            </Section>

            <Section title="Disk" failed={storage.isError} pending={storage.isPending}>
                {storage.data === undefined ? undefined : (
                    <Stack gap="xs">
                        {storage.data.stores.map(store => (
                            <Group key={store.id} gap="lg" wrap="wrap">
                                <Text size="sm" w={160}>
                                    {store.label}
                                </Text>
                                <Text size="sm" c="dimmed" className="da-num">
                                    {formatBytes(store.bytes)}
                                </Text>
                                <Text size="xs" c="dimmed" className="da-num">
                                    {store.files.toLocaleString()} files
                                </Text>
                                {/* Files no row claims, and claims whose file is gone. Reported
                                    rather than reconciled, because the two disagree in different
                                    directions and each means something different. */}
                                {store.orphanFiles === 0 ? undefined : (
                                    <Text size="xs" c="yellow.4" className="da-num">
                                        {store.orphanFiles.toLocaleString()} unclaimed
                                    </Text>
                                )}
                                {store.rowsWithNoFile === 0 ? undefined : (
                                    <Text size="xs" c="yellow.4" className="da-num">
                                        {store.rowsWithNoFile.toLocaleString()} missing
                                    </Text>
                                )}
                            </Group>
                        ))}
                        {/* The store's own reading time, which is on its contract because a disk
                            walk is expensive enough not to be done per request. */}
                        <Text size="xs" c="dimmed">
                            Read at {formatTimeOfDay(storage.data.readAt)}
                        </Text>
                    </Stack>
                )}
            </Section>

            <Section title="Build" failed={checkup.isError} pending={checkup.isPending}>
                <Build revision={checkup.data?.revision} version={checkup.data?.version} />
            </Section>
        </Stack>
    );
}

/**
 * Which commit this station is running.
 *
 * The whole of the point: answering "is it running what I committed" needed a shell on the host and
 * `docker inspect`, and now it is a line on a page the operator can already reach. The image carries
 * the sha as its `org.opencontainers.image.revision` label AND in its environment, and this is the
 * second one read back out.
 *
 * Absent is the ordinary case in development and is NOT drawn as a fault: the section above it uses
 * absence to mean a reader failed, and this one does not, which is why it says what absence means
 * rather than leaving a blank box. A station built by hand was built from a working tree, and there
 * is no honest sha to show for one.
 *
 * The whole value is copied and only the front of it is shown, on the usual reason a sha is written
 * short: seven characters is what an operator compares against `git log` by eye, and the full forty
 * is what they paste back into one.
 */
function Build({ revision, version }: { revision?: string; version?: string }) {
    if (revision === undefined) {
        return (
            <Text size="sm" c="dimmed">
                {version === undefined
                    ? 'This station was not built from a commit, which is what a development tree and a hand-built image both are.'
                    : `This station is ${version}, and nothing recorded which commit it was built from.`}
            </Text>
        );
    }

    return (
        <Group gap="sm" wrap="wrap">
            {/*
             * The version is shown only when there IS one, and it is absent far more often than the
             * revision: `latest` follows main, so an ordinary station is a commit and no release.
             * Saying "no version" would read as a fault on a station that is working exactly as
             * intended, where saying nothing reads as what it is.
             */}
            {version !== undefined && <Code title={`Release ${version}`}>{version}</Code>}
            <Text size="sm">Built from</Text>
            <Code title={revision}>{revision.slice(0, 7)}</Code>
            <CopyButton value={revision}>
                {({ copied, copy }) => (
                    <Button size="compact-xs" variant="subtle" color={copied ? 'green' : undefined} onClick={copy}>
                        {copied ? 'Copied' : 'Copy'}
                    </Button>
                )}
            </CopyButton>
        </Group>
    );
}

/**
 * One part of the reading, in a box that can fail without taking the others.
 *
 * The whole point of the page: a check-up assembled from five sources where any one of them can be
 * the thing that is broken. A section that cannot be read says so where its content would have been,
 * so the page still answers everything else.
 */
function Section({ title, failed, pending, children }: { title: string; failed: boolean; pending: boolean; children?: React.ReactNode }) {
    return (
        <Stack gap="xs">
            <Eyebrow>{title}</Eyebrow>
            <Card padding="md">
                {failed ? (
                    <Text size="sm" c="red.4">
                        This could not be read. The rest of the page is unaffected.
                    </Text>
                ) : pending ? (
                    <Text size="sm" c="dimmed">
                        Reading…
                    </Text>
                ) : (
                    children
                )}
            </Card>
        </Stack>
    );
}

/**
 * The loops, with how long it has been since each came round.
 *
 * The AGE is computed here and no threshold is applied, which is the reader's half of the bargain
 * the contract makes: `Heartbeat` refuses to say what "too long" means because a five-second
 * reconcile and a nightly sweep are both healthy, and a page that painted one red would be picking
 * a number the station deliberately did not.
 */
function Loops({ heartbeats, readAt, phone }: { heartbeats: StationHeartbeat[]; readAt: DateTime; phone: boolean }) {
    if (heartbeats.length === 0) {
        return <EmptyState>Nothing is being watched, which on a running station means the loops have not registered yet.</EmptyState>;
    }

    const taken = readAt.toMillis();

    // The phone gets cards: the same two ages fold into one fact line under the loop's name,
    // rather than holding columns that push the whole section into a sideways scroll.
    if (phone) {
        return (
            <Stack gap="xxs">
                {heartbeats.map(beat => (
                    <PhoneCard
                        key={beat.name}
                        title={
                            <Text size="sm" ff="monospace" truncate>
                                {beat.name}
                            </Text>
                        }
                        subtitle={
                            <Text size="xs" c="dimmed" className="da-num">
                                {beat.lastBeat === undefined ? 'no pass yet' : `last pass ${ago(taken, beat.lastBeat)} ago`}
                                {` · started ${ago(taken, beat.startedAt)} ago`}
                            </Text>
                        }
                    />
                ))}
            </Stack>
        );
    }

    return (
        <Table.ScrollContainer minWidth={500}>
            <Table>
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th>Loop</Table.Th>
                        <Table.Th w={140}>Last pass</Table.Th>
                        <Table.Th w={140}>Started</Table.Th>
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {heartbeats.map(beat => (
                        <Table.Tr key={beat.name}>
                            <Table.Td>
                                <Text size="sm" ff="monospace">
                                    {beat.name}
                                </Text>
                            </Table.Td>
                            <Table.Td>
                                {/* A loop that has never finished a pass says so rather than showing a
                                dash, because the two are different facts and `startedAt` beside it
                                is what tells a slow first pass from a stopped loop. */}
                                <Text size="sm" c="dimmed" className="da-num">
                                    {beat.lastBeat === undefined ? 'not yet' : `${ago(taken, beat.lastBeat)} ago`}
                                </Text>
                            </Table.Td>
                            <Table.Td>
                                <Text size="xs" c="dimmed" className="da-num">
                                    {ago(taken, beat.startedAt)} ago
                                </Text>
                            </Table.Td>
                        </Table.Tr>
                    ))}
                </Table.Tbody>
            </Table>
        </Table.ScrollContainer>
    );
}

/** How long between two moments, in the coarsest unit that still says something. */
function ago(now: number, then: DateTime): string {
    const seconds = Math.max(0, Math.round((now - then.toMillis()) / 1000));
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86_400)}d`;
}

/** The wall-clock hour and minute a scheduled probe is due, in the operator's own zone. */
function clockTime(at: DateTime): string {
    return at.toFormat('HH:mm');
}

/** Which plugins are unhappy, and a count of the ones that are fine. */
function Plugins({ plugins }: { plugins: PluginSummary[] }) {
    const unhappy = plugins.filter(plugin => plugin.enabled && plugin.status !== 'active');

    return (
        <Stack gap="xs">
            <Text size="sm" c="dimmed">
                {plugins.filter(plugin => plugin.status === 'active').length} of {plugins.length} running.
            </Text>
            {/* Only the ones with something wrong get a row. A list of ten healthy plugins is the
                plugins page, and repeating it here would bury the one that is not. */}
            {unhappy.map(plugin => (
                <Stack key={plugin.id} gap={2}>
                    <Group gap="sm">
                        <StatusLamp tone={plugin.status === 'failed' ? 'fault' : 'standby'} label={plugin.status} />
                        <Text size="sm">{plugin.name}</Text>
                    </Group>
                    {plugin.lastError !== undefined && (
                        <Text size="xs" c="dimmed" truncate>
                            {plugin.lastError}
                            {plugin.nextProbeAt !== undefined ? ` · asked again at ${clockTime(plugin.nextProbeAt)}` : ''}
                        </Text>
                    )}
                </Stack>
            ))}
        </Stack>
    );
}

/** One figure, labelled. */
/**
 * Where the station can be listened to, one line per mount.
 *
 * The whole point of the copy button is that it hands over a URL rather than the PATH the status
 * carries. The path is what the app knows — the station is reached through whatever edge served
 * this console, and the app cannot name that edge — but a path is not something an operator can
 * paste into a Sonos or a car stereo, and pasting it somewhere it does not work is the failure
 * this list exists to prevent. `window.location.origin` is the browser answering the one question
 * the server cannot.
 *
 * MP3 is always here and always first, so this is never empty and never needs an empty state.
 */
function Mounts({ mounts }: { mounts: PlayoutMount[] }) {
    return (
        <Stack gap="xxs">
            <Eyebrow>Listen</Eyebrow>
            {mounts.map(mount => (
                <Group key={mount.path} gap="xs">
                    <Text size="xs" fw={600} tt="uppercase" w={38}>
                        {mount.format}
                    </Text>
                    <Code>{mount.path}</Code>
                    {/* FLAC has no bitrate to report, which is a fact about the format rather than
                        a figure nobody filled in, so it says what it is instead of going blank. */}
                    <Text size="xs" c="dimmed">
                        {mount.bitrateKbps === undefined ? 'lossless' : `${mount.bitrateKbps} kbps`}
                    </Text>
                    <CopyButton value={`${window.location.origin}${mount.path}`}>
                        {({ copied, copy }) => (
                            <Button size="compact-xs" variant="subtle" color={copied ? 'green' : undefined} onClick={copy}>
                                {copied ? 'Copied' : 'Copy'}
                            </Button>
                        )}
                    </CopyButton>
                </Group>
            ))}
        </Stack>
    );
}

function Fact({ label, value }: { label: string; value: string }) {
    return (
        <Stack gap={0}>
            <Text size="xs" c="dimmed">
                {label}
            </Text>
            <Text size="sm" className="da-num">
                {value}
            </Text>
        </Stack>
    );
}
