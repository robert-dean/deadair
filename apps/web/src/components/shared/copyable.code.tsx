import { Code, Group, type GroupProps } from '@mantine/core';

import { CopyButton } from './copy.button';

export interface CopyableCodeProps extends Omit<GroupProps, 'children'> {
    /** The text shown and copied, which is the same text. */
    value: string;
}

/**
 * A value an operator has to take somewhere else, shown whole beside the button that copies it: a
 * token shown once, a client id, an invitation link.
 *
 * Wrapped anywhere rather than truncated, because the value is the thing being handed over and a
 * cut-off token cannot be checked against what was pasted. Six places wrote this row out by hand.
 * The row's own spacing and alignment pass through as `Group` props, so a caller lining it up under a
 * label keeps doing so.
 */
export function CopyableCode({ value, ...group }: CopyableCodeProps) {
    return (
        <Group gap="xs" wrap="nowrap" {...group}>
            <Code style={{ overflowWrap: 'anywhere', flex: 1 }}>{value}</Code>
            <CopyButton value={value} />
        </Group>
    );
}
