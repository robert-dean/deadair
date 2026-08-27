import { Box, Button, Card, Divider, Group, Stack, Text } from '@mantine/core';
import { Link, type LinkProps } from '@tanstack/react-router';
import type { AttentionItem } from '@deadair/sdk';

import { EmptyState } from '../shared/empty.state';
import { severityColor, type Severity } from '../shared/status';

/**
 * Everything wrong or waiting, worst first.
 *
 * ## Why it is a page rather than a badge on each page
 *
 * Every fact here was already visible somewhere — a benched copy on the catalog, a plugin that will
 * not start on its own card, the silence cause on the transport strip. What none of them could do is
 * tell an operator who has not opened that page. So the list is the one surface that answers "is
 * anything wrong" without knowing where to look, and every row carries the page that can act on it.
 *
 * ## Nothing here is derived
 *
 * The station composes this, orders it and writes the sentences, so what the console decides is how
 * to draw a severity and where a route points. That is deliberate: the silence wording in particular
 * belongs to `silence.diagnosis.ts`, and a second phrasing on the landing page would be a second
 * thing to disagree with the badge and the activity feed.
 *
 * ## An unknown route draws no link rather than a broken one
 *
 * The router's `to` is typed against the registered routes, which is what stops a link pointing at a
 * page that does not exist — the failure this console has already had once. A path from the API is a
 * string, so it is matched against the routes that exist and a row whose destination is not one of
 * them keeps its sentence and loses its link.
 */
export function AttentionList({ items }: { items: readonly AttentionItem[] }) {
    if (items.length === 0) {
        return (
            <EmptyState>
                Nothing needs you. The station is airing, its plugins are up, and every record in front of it can be fetched. Anything that changes
                shows up here.
            </EmptyState>
        );
    }

    return (
        <Card withBorder padding={0}>
            <Stack gap={0}>
                {items.map((item, index) => (
                    <Box key={`${item.code}:${item.route}`}>
                        {index === 0 ? undefined : <Divider />}
                        <Row item={item} />
                    </Box>
                ))}
            </Stack>
        </Card>
    );
}

function Row({ item }: { item: AttentionItem }) {
    const destination = destinationOf(item.route);

    return (
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md" p="md">
            <Group align="flex-start" wrap="nowrap" gap="sm" style={{ minWidth: 0 }}>
                {/* A severity, not a status: this dot says how bad, and `StatusLamp` says what state
                    a thing is in. `status.ts` keeps the two vocabularies apart on purpose, because
                    they disagree about red — red on a lamp means ON AIR. */}
                <Box w={8} h={8} mt={7} bg={`${severityColor[item.severity as Severity]}.6`} style={{ borderRadius: '50%', flexShrink: 0 }} />
                <Stack gap={2} style={{ minWidth: 0 }}>
                    <Text fw={600} size="sm">
                        {item.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                        {item.detail}
                    </Text>
                </Stack>
            </Group>

            {/* The fix, ON the row that reports the problem, which is the whole reason this list is
                worth landing on: a sentence saying spotify will not start, with the page that can
                reconnect it a nav-hunt away, is a sentence an operator reads and then goes looking.
                A button rather than a text link for the same reason — it is the row's action.

                It is deliberately labelled with the DESTINATION rather than with the remedy. The
                station sends a route and no verb, so a button reading "Reconnect Spotify" would be
                this console inventing a claim about what the click does; "Plugin →" is exactly what
                it does. See the note in `desk.page.tsx`. */}
            {destination ? (
                <Button
                    variant="light"
                    size="compact-sm"
                    style={{ flexShrink: 0 }}
                    renderRoot={props =>
                        destination.params ? (
                            <Link to={destination.to} params={destination.params} {...props} />
                        ) : (
                            <Link to={destination.to} {...props} />
                        )
                    }
                >
                    {destination.label} →
                </Button>
            ) : undefined}
        </Group>
    );
}

interface Destination {
    to: LinkProps['to'];
    params?: Record<string, string>;
    /** Where this goes, named as the nav names it. */
    label: string;
}

/** A path the station sent as a route this console actually has, or nothing. */
function destinationOf(route: string): Destination | undefined {
    const plugin = /^\/plugins\/(.+)$/.exec(route);
    if (plugin?.[1]) return { to: '/plugins/$id', params: { id: plugin[1] }, label: 'Plugin' };

    switch (route) {
        // The station still names `/onair` for anything about the broadcast. The desk is where that
        // is answered now, and it is also where this list is drawn — so the row points at the
        // running order further down the same page rather than at a page that is on its way out.
        case '/onair':
            return { to: '/', label: 'Desk' };
        case '/schedule':
            return { to: '/schedule', label: 'Schedule' };
        case '/catalog':
            return { to: '/catalog', label: 'Catalog' };
        case '/plugins':
            return { to: '/plugins', label: 'Plugins' };
        case '/personas':
            return { to: '/personas', label: 'Personas' };
        case '/settings':
            return { to: '/settings', label: 'Settings' };
        default:
            return undefined;
    }
}
