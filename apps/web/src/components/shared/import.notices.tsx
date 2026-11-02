import { List, Text } from '@mantine/core';

import { toneColor } from './status';

/**
 * The things to know about a file, in the station's own sentences.
 *
 * Dimmed rather than coloured, because none of these refuses an import and most describe a state the
 * station can be in perfectly well, so painting them as faults would teach an operator to fear a file
 * that is fine. `alarming` picks out the exceptions, for an import that has one.
 */
export function ImportNotices<TNotice extends { kind: string; message: string }>({
    notices,
    alarming,
}: {
    notices: readonly TNotice[];
    alarming?: (notice: TNotice) => boolean;
}) {
    return (
        <List size="xs" spacing={2}>
            {notices.map((notice, index) => (
                <List.Item key={`${notice.kind}-${index}`}>
                    <Text size="xs" c={alarming?.(notice) ? toneColor.fault : 'dimmed'} span>
                        {notice.message}
                    </Text>
                </List.Item>
            ))}
        </List>
    );
}
