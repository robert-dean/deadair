import { Alert, Badge, Button, Code, CopyButton, Group, Stack, Text, Tooltip } from '@mantine/core';
import type { StreamConfigWarning } from '@deadair/sdk';

export interface StaleConfigProps {
    warnings: StreamConfigWarning[];
}

/**
 * A stream container running config the app has since replaced.
 *
 * The fault this draws has no other symptom a console can show. Icecast and
 * Liquidsoap read their rendered config once, at startup, and nothing restarts
 * them when it changes — so after a reseed the transport looks entirely healthy
 * (the stream is up, the running order is full, the station says it is driving)
 * while every listener is refused at the door or there is no mount at all. An
 * operator reading this console would have no reason to suspect a config file,
 * because nothing else here is red.
 *
 * The app cannot fix it: restarting a sibling container needs a Docker socket it
 * does not have, and both restarts are audible to whoever is connected. So the
 * command is the deliverable, in full and copyable, rather than a button that
 * would only ever be a lie about what the console can do.
 */

/** The compact form, for the strip that sits under every page. */
export function StaleConfigBadge({ warnings }: StaleConfigProps) {
    if (warnings.length === 0) return undefined;

    return (
        <Tooltip
            multiline
            w={340}
            label={`${warnings.map(warning => warning.container).join(' and ')} ${
                warnings.length > 1 ? 'are' : 'is'
            } running config that has been replaced. Open the transport for the restart command.`}
        >
            <Badge variant="filled" color="red">
                config not adopted
            </Badge>
        </Tooltip>
    );
}

/** The full form, with the sentence and the command, for the expanded panel. */
export function StaleConfigAlert({ warnings }: StaleConfigProps) {
    if (warnings.length === 0) return undefined;

    return (
        <Alert color="red" variant="light" title="A stream container is running config that has been replaced">
            <Stack gap="xs">
                {warnings.map(warning => (
                    <Stack gap={4} key={warning.container}>
                        <Text size="xs">{warning.detail}</Text>
                        <Group gap="xs" wrap="nowrap">
                            <Code>{warning.restart}</Code>
                            <CopyButton value={warning.restart}>
                                {({ copied, copy }) => (
                                    <Button size="compact-xs" variant="subtle" color={copied ? 'green' : undefined} onClick={copy}>
                                        {copied ? 'Copied' : 'Copy'}
                                    </Button>
                                )}
                            </CopyButton>
                        </Group>
                    </Stack>
                ))}
            </Stack>
        </Alert>
    );
}
