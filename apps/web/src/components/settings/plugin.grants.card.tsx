import { Card, Group, SegmentedControl, Stack, Table, Text, Title } from '@mantine/core';
import type { PluginGrant, GrantDecision } from '@deadair/sdk';

import { useDecidePluginGrant, usePluginGrants } from '../../api/plugins.queries';
import { ErrorAlert } from '../shared/error.alert';
import { StatusLamp } from '../shared/status.lamp';
import type { StatusTone } from '../shared/status';

/**
 * What each plugin has asked the station for, and what the station said.
 *
 * On the settings page rather than a page of its own, and for `StorageCard`'s reason: it is a
 * decision about the station rather than about any one plugin, and a plugin's own page is where its
 * configuration lives. It is also the page an operator lands on when something is not working, and
 * "this plugin is waiting for an answer" belongs where they will look.
 *
 * ## Three states, and the third is why this is a table
 *
 * `undecided` is drawn as its own thing rather than as a shade of denied. To the host they are the
 * same — both refuse — but to a person they are opposite facts: one is a question nobody has
 * answered and the other is an answer. A control with two positions and no third state would make
 * every fresh install look like a set of deliberate refusals.
 *
 * ## The ask is the plugin's, the description is the station's
 *
 * Two sentences per row, from two different authors, and they are not interchangeable. The plugin
 * says why it wants this and can say anything it likes; the host says what allowing it actually
 * does, in words the plugin does not get to choose. An operator weighing a request needs both, and
 * needs to know which is which.
 */
export function PluginGrantsCard() {
    const grants = usePluginGrants();

    // Nothing has asked for anything, which is the ordinary state of a station: almost every plugin
    // does its whole job inside what it declares. A heading over an empty table would invite the
    // operator to go looking for something that is not missing.
    if (!grants.error && (grants.data?.grants.length ?? 0) === 0) return undefined;

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap={4}>
                    <Title order={2} size="h4">
                        What plugins have asked for
                    </Title>
                    <Text size="sm" c="dimmed">
                        A plugin reaches only what its manifest names and what you gave it. These are the things one has asked for on top of that.
                        Nothing here is allowed until you say so, and a decision takes effect on the plugin&rsquo;s next request.
                    </Text>
                </Stack>

                {grants.error ? (
                    <ErrorAlert
                        title="Requests unavailable"
                        error={grants.error}
                        fallback="The station could not read what its plugins have asked for."
                    />
                ) : undefined}

                {grants.data ? (
                    <Table verticalSpacing="sm" horizontalSpacing="sm" layout="fixed">
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th w="34%">Plugin</Table.Th>
                                <Table.Th>Asked for</Table.Th>
                                <Table.Th w={200} ta="right">
                                    Answer
                                </Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {grants.data.grants.map(grant => (
                                <GrantRow key={`${grant.pluginId}:${grant.capability}`} grant={grant} />
                            ))}
                        </Table.Tbody>
                    </Table>
                ) : undefined}
            </Stack>
        </Card>
    );
}

/**
 * The tone each answer is drawn in.
 *
 * `fault` for undecided is deliberate and is the same call the silence badge makes: a plugin
 * waiting on an answer is not broken, but it is the reason something is not working, and that is
 * what an operator scanning this page is looking for. Denied is `off` because it is a settled
 * decision rather than an outstanding one.
 */
const tones: Record<GrantDecision, StatusTone> = { allowed: 'ok', denied: 'off', undecided: 'fault' };
const words: Record<GrantDecision, string> = { allowed: 'Allowed', denied: 'Denied', undecided: 'Waiting on you' };

function GrantRow({ grant }: { grant: PluginGrant }) {
    const decide = useDecidePluginGrant();

    return (
        <Table.Tr>
            <Table.Td>
                <Stack gap={2}>
                    <Text size="sm" fw={500}>
                        {grant.pluginName}
                    </Text>
                    <StatusLamp tone={tones[grant.decision]} label={words[grant.decision]} />
                </Stack>
            </Table.Td>
            <Table.Td>
                <Stack gap={2}>
                    <Group gap="xs">
                        <Text size="sm" fw={500}>
                            {grant.label}
                        </Text>
                    </Group>
                    {/* The plugin's own sentence, marked as a quotation because it is one: this is
                        the only text on the settings page that the station did not write. */}
                    <Text size="sm" c="dimmed">
                        &ldquo;{grant.reason}&rdquo;
                    </Text>
                    <Text size="xs" c="dimmed">
                        {grant.describes}
                    </Text>
                </Stack>
            </Table.Td>
            <Table.Td>
                <Stack gap={4} align="flex-end">
                    <SegmentedControl
                        size="xs"
                        value={grant.decision}
                        disabled={decide.isPending}
                        onChange={value => decide.mutate({ id: grant.pluginId, capability: grant.capability, decision: value as GrantDecision })}
                        data={[
                            { value: 'allowed', label: 'Allow' },
                            { value: 'denied', label: 'Deny' },
                            // Answering is not required, and taking an answer back should not mean
                            // leaving a refusal on the record.
                            { value: 'undecided', label: 'Ask later' },
                        ]}
                    />
                    {decide.error ? (
                        <Text size="xs" c="red">
                            That could not be saved.
                        </Text>
                    ) : undefined}
                </Stack>
            </Table.Td>
        </Table.Tr>
    );
}
