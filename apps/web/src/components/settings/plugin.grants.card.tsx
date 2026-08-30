import { Card, Stack, Table, Text, Title } from '@mantine/core';
import type { PluginGrant } from '@deadair/sdk';

import { usePluginGrants } from '../../api/plugins.queries';
import { GRANT_TONES, GRANT_WORDS, GrantAnswer, GrantDescription } from '../plugins/plugin.grants';
import { ErrorAlert } from '../shared/error.alert';
import { StatusLamp } from '../shared/status.lamp';

/**
 * What each plugin has asked the station for, and what the station said.
 *
 * On the settings page rather than a page of its own, and for `StorageCard`'s reason: it is a
 * decision about the station rather than about any one plugin, and a plugin's own page is where its
 * configuration lives. It is also the page an operator lands on when something is not working, and
 * "this plugin is waiting for an answer" belongs where they will look.
 *
 * ## Denied is where everything starts
 *
 * A request nobody has answered is drawn exactly as a refusal, because that is what it is: nothing
 * is granted until somebody says so. There is deliberately no "waiting on you" state — a console
 * able to tell an unanswered request from a settled refusal would have to flag both, and a
 * permission surface that nags about decisions already made is one nobody reads.
 *
 * ## Every plugin's requests, where the plugin's own page shows only its own
 *
 * The same rows, the same control, drawn through `plugins/plugin.grants.tsx` so the two cannot
 * disagree about what an answer means. This is the surface for "is anything waiting on me"; the
 * plugin's page is the one for "why is this plugin not working".
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
                <Stack gap="xxs">
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
                    <Table.ScrollContainer minWidth={550}>
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
                    </Table.ScrollContainer>
                ) : undefined}
            </Stack>
        </Card>
    );
}

function GrantRow({ grant }: { grant: PluginGrant }) {
    return (
        <Table.Tr>
            <Table.Td>
                <Stack gap="xxxs">
                    <Text size="sm" fw={500}>
                        {grant.pluginName}
                    </Text>
                    <StatusLamp tone={GRANT_TONES[grant.decision]} label={GRANT_WORDS[grant.decision]} />
                </Stack>
            </Table.Td>
            <Table.Td>
                <GrantDescription grant={grant} />
            </Table.Td>
            <Table.Td>
                <GrantAnswer grant={grant} />
            </Table.Td>
        </Table.Tr>
    );
}
