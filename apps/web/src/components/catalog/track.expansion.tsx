import { useState } from 'react';
import { ActionIcon, Collapse, Table } from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';

import { catalogTrackEnrichmentOptions } from '../../api/catalog.queries';
import { EnrichmentPanel } from './enrichment.panel';

/**
 * Which track's enrichment is open, at most one at a time.
 *
 * One at a time rather than a set, because each open row is a request and a screenful: an operator
 * scanning a page of fifty has no use for six of them expanded at once, and the state is then a
 * single id rather than a collection to keep pruned as the page changes.
 */
export function useTrackExpansion() {
    const [openTrackId, setOpenTrackId] = useState<string>();

    return {
        openTrackId,
        isOpen: (trackId: string) => openTrackId === trackId,
        toggle: (trackId: string) => {
            setOpenTrackId(current => (current === trackId ? undefined : trackId));
        },
    };
}

export interface TrackExpandButtonProps {
    open: boolean;
    title: string;
    onToggle: () => void;
    /** A bigger target where the pointer is a thumb; the phone card asks for the desk's 44px. */
    size?: number;
}

/** The control that opens a row. */
export function TrackExpandButton({ open, title, onToggle, size }: TrackExpandButtonProps) {
    return (
        <ActionIcon
            variant="subtle"
            color="gray"
            w={size}
            h={size}
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} what is known about ${title}`}
            onClick={onToggle}
        >
            {open ? <IconChevronDown size={15} stroke={1.8} /> : <IconChevronRight size={15} stroke={1.8} />}
        </ActionIcon>
    );
}

export interface TrackEnrichmentRowProps {
    trackId: string;
    open: boolean;
    /** Columns in the table this sits in, so the panel spans the whole row. */
    colSpan: number;
}

/** A second row under a track, holding what the providers said about it. */
export function TrackEnrichmentRow({ trackId, open, colSpan }: TrackEnrichmentRowProps) {
    return (
        <Table.Tr>
            <Table.Td colSpan={colSpan} p={open ? undefined : 0} bd="none">
                <TrackEnrichmentCollapse trackId={trackId} open={open} />
            </Table.Td>
        </Table.Tr>
    );
}

/**
 * The collapse itself, without the table row around it, so the phone card can hold the same thing.
 *
 * The query lives inside the collapsed content and the content is only mounted while open, so a
 * page of fifty tracks costs one request for the list and nothing else until an operator asks
 * about a particular one. That is also why this is a component rather than a hook the table calls:
 * a hook would run for every row.
 */
export function TrackEnrichmentCollapse({ trackId, open }: { trackId: string; open: boolean }) {
    return <Collapse expanded={open}>{open ? <TrackEnrichment trackId={trackId} /> : undefined}</Collapse>;
}

function TrackEnrichment({ trackId }: { trackId: string }) {
    const enrichment = useQuery(catalogTrackEnrichmentOptions(trackId));

    return (
        <EnrichmentPanel
            merged={enrichment.data?.merged}
            sources={enrichment.data?.sources}
            claims={enrichment.data?.claims}
            isPending={enrichment.isPending}
            error={enrichment.error}
            emptyMessage="No provider has been asked about this track yet. The enrichment pass picks up what it has not seen, oldest first."
        />
    );
}
