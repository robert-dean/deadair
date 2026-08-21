import { Badge, Group, Menu, Text } from '@mantine/core';

import { useRecastStation } from '../../api/director.queries';
import { usePersonas } from '../../api/personas.queries';
import { apiErrorMessage } from '../../api/sdk.error';

/**
 * Who is presenting the broadcast that is on air, and the one place it can be changed mid-show.
 *
 * ## Why it is here and not on the personas page
 *
 * That page owns the STATION's host, and a broadcast may name its own — from a schedule slot, or
 * from the box beside the brief — in which case it keeps it, deliberately, so the presenter cannot
 * drift back halfway through a show. This is the surface that says otherwise about the show that is
 * running, which is why "The station's host" is an entry rather than an absence: choosing it hands
 * the show back, and that is a thing an operator means rather than a thing they leave blank.
 *
 * ## It is drawn even when the broadcast named nobody
 *
 * The badge it replaced was not, on the argument that repeating the personas page would read as an
 * override nobody set. That was right for a label and wrong for a control: a host who cannot be
 * changed from the page about what is on air is one an operator goes looking for, and the current
 * answer is worth stating whichever way it was arrived at. So the station's own host is named, with
 * the badge saying where the answer came from.
 *
 * ## A menu rather than a Select, and the copy lives inside it
 *
 * It sits in a row of badges describing the broadcast, and a form control there would read as
 * something to fill in rather than as the state of the show. What it costs is said in the dropdown
 * rather than in a tooltip on the badge — partly because that is the moment it is worth reading,
 * and partly because a `Tooltip` inside a `Menu.Target` swallows the click that opens the menu:
 * both components clone their child to attach handlers, and the inner one wins.
 */
export interface HostOnAirProps {
    /** The host this broadcast named, when it named one. Absent means the station's own. */
    personaId?: string;
    /** What that host is called, resolved by the API as the order was read. */
    personaLabel?: string;
}

export function HostOnAir({ personaId, personaLabel }: HostOnAirProps) {
    const personas = usePersonas();
    const recast = useRecastStation();

    const active = personas.data?.personas.find(persona => persona.active);
    // What the show is ACTUALLY presented by, which is the broadcast's own host or the station's
    // behind it — the same precedence `PersonaRepository.presenting` applies, and the reason this
    // can name somebody when `personaLabel` is absent.
    const hosting = personaLabel ?? active?.label;
    const failure = recast.isError ? apiErrorMessage(recast.error, 'The host could not be changed.') : undefined;

    return (
        <Menu position="bottom-start" withinPortal>
            <Menu.Target>
                <Badge
                    size="sm"
                    variant="light"
                    color={failure ? 'red' : 'teal'}
                    tt="none"
                    style={{ cursor: 'pointer' }}
                    role="button"
                    opacity={recast.isPending ? 0.6 : 1}
                >
                    hosted by: {hosting ?? 'nobody'}
                </Badge>
            </Menu.Target>
            {/* Bounded and scrolling, because this list is as long as the operator has made it: a
                station with twenty characters ran the dropdown off the bottom of the page. */}
            <Menu.Dropdown maw={320} mah={420} style={{ overflowY: 'auto' }}>
                <Menu.Label>
                    Who presents this show. Changing it re-writes the breaks already written for it, and one that is not ready when its slot comes
                    round is skipped.
                </Menu.Label>
                {failure ? (
                    <Text size="xs" c="red.4" px="sm" pb="xs">
                        {failure}
                    </Text>
                ) : undefined}
                <Menu.Item disabled={personaId === undefined} onClick={() => recast.mutate({})}>
                    <Group gap="xs" wrap="nowrap">
                        <Text size="sm">The station’s host</Text>
                        {active ? (
                            <Text size="xs" c="dimmed">
                                {active.label}
                            </Text>
                        ) : undefined}
                    </Group>
                </Menu.Item>
                {(personas.data?.personas ?? []).map(persona => (
                    <Menu.Item key={persona.id} disabled={persona.id === personaId} onClick={() => recast.mutate({ personaId: persona.id })}>
                        {persona.label}
                    </Menu.Item>
                ))}
            </Menu.Dropdown>
        </Menu>
    );
}
