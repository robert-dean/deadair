import { Button } from '@mantine/core';
import { IconArrowUpCircle } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';

import { useStationReleasesPoll } from '../../api/station.queries';

/**
 * A quiet note in the header when a newer release is out, which opens What's new.
 *
 * Quiet on purpose. An update is not a fault, and the attention list is kept to faults so an operator
 * never learns to skim it, which is why this is its own small control rather than a row there. It
 * draws nothing at all when there is nothing newer, when the check is off, or while the answer has not
 * arrived: an absent notice has only one reading, and it is the ordinary one.
 *
 * Only the newest release is named. Two releases out is still one upgrade, and What's new lists them
 * all.
 */
export function UpdateNotice({ enabled }: { enabled: boolean }) {
    const releases = useStationReleasesPoll(enabled);
    const newest = releases.data?.available[0];
    if (newest === undefined) return undefined;

    return (
        <Button
            variant="light"
            size="compact-sm"
            fw={500}
            // Not on a phone: the header's corner has room for two controls there, and a phone
            // reaches What's new from Check-up like everything else it cannot fit up here.
            visibleFrom="sm"
            leftSection={<IconArrowUpCircle size={16} stroke={1.8} />}
            renderRoot={(props: object) => <Link to="/releases" {...props} />}
            title={`deadair ${newest.version} is out. See what changed.`}
        >
            <span className="da-num">{newest.version}</span>&nbsp;is out
        </Button>
    );
}
