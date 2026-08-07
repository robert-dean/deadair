import { useState } from 'react';
import { ActionIcon, Collapse, Table } from '@mantine/core';
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
}

/** The control that opens a row. A chevron, since no icon set is installed. */
export function TrackExpandButton({ open, title, onToggle }: TrackExpandButtonProps) {
    return (
        <ActionIcon
            variant="subtle"
            color="gray"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} what is known about ${title}`}
            onClick={onToggle}
        >
            {open ? '▾' : '▸'}
        </ActionIcon>
    );
}

export interface TrackEnrichmentRowProps {
    trackId: string;
    open: boolean;
    /** Columns in the table this sits in, so the panel spans the whole row. */
    colSpan: number;
}

/**
 * A second row under a track, holding what the providers said about it.
 *
 * The query lives inside the collapsed content and the content is only mounted while open, so a
 * page of fifty tracks costs one request for the list and nothing else until an operator asks
 * about a particular one. That is also why this is a component rather than a hook the table calls:
 * a hook would run for every row.
 */
export function TrackEnrichmentRow({ trackId, open, colSpan }: TrackEnrichmentRowProps) {
    return (
        <Table.Tr>
            <Table.Td colSpan={colSpan} p={open ? undefined : 0} bd="none">
                <Collapse expanded={open}>{open ? <TrackEnrichment trackId={trackId} /> : undefined}</Collapse>
            </Table.Td>
        </Table.Tr>
    );
}

function TrackEnrichment({ trackId }: { trackId: string }) {
    const enrichment = useQuery(catalogTrackEnrichmentOptions(trackId));

    return (
        <EnrichmentPanel
            merged={enrichment.data?.merged}
            sources={enrichment.data?.sources}
            isPending={enrichment.isPending}
            error={enrichment.error}
            emptyMessage="No provider has been asked about this track yet. The enrichment pass picks up what it has not seen, oldest first."
        />
    );
}
