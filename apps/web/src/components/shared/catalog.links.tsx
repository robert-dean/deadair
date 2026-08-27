import { Anchor, Text, type TextProps } from '@mantine/core';
import { Link } from '@tanstack/react-router';

/**
 * What every one of these takes: the id to go to, the words to draw, and whatever shaping the row
 * around them already applies.
 *
 * The id is OPTIONAL and that is the whole point of the file. A running order can hold a record the
 * catalog has never seen, a track can have been ingested outside any release, and a feed line can
 * be about neither — so an absent id draws the label as plain text rather than as a link that
 * answers 404. Nothing calling these has to restate that rule.
 */
export interface CatalogLinkProps extends TextProps {
    /** Absent draws the label as text. */
    id?: string;
    children: React.ReactNode;
}

/**
 * The shaping a link inherits from the row it sits in.
 *
 * `Anchor` is a `Text` underneath, so `size`, `c`, `truncate`, `fw` and `className` all mean what
 * they mean elsewhere: a truncating title in the running order stays a truncating title once it
 * becomes a link, and a dimmed credit stays dimmed. Without this the two spellings of a row — with
 * an id and without — would not line up.
 */
function Plain({ children, ...props }: Omit<CatalogLinkProps, 'id'>) {
    return <Text {...props}>{children}</Text>;
}

/**
 * A record, linked to everything it has accumulated.
 *
 * `renderRoot` rather than `component={Link}` throughout this file: the polymorphic form erases the
 * router's own typing, and with it the check that `params` matches the path. That is not a style
 * rule — it hid a link to a route that never existed.
 */
export function TrackLink({ id, children, ...props }: CatalogLinkProps) {
    if (id === undefined) return <Plain {...props}>{children}</Plain>;

    return (
        <Anchor renderRoot={anchor => <Link to="/catalog/tracks/$trackId" params={{ trackId: id }} {...anchor} />} {...props}>
            {children}
        </Anchor>
    );
}

/** An artist, linked to their albums and what the station thinks of them. */
export function ArtistLink({ id, children, ...props }: CatalogLinkProps) {
    if (id === undefined) return <Plain {...props}>{children}</Plain>;

    return (
        <Anchor renderRoot={anchor => <Link to="/catalog/artists/$artistId" params={{ artistId: id }} {...anchor} />} {...props}>
            {children}
        </Anchor>
    );
}

/**
 * What the station said, linked to every attempt at saying it.
 *
 * A break rather than a record, so it lands on `/scripts` narrowed to one segment. Same absent-id
 * rule and one more reason for it: an order can hold a segment the library no longer has, and there
 * is nothing to read for one that was never written.
 */
export function ScriptLink({ id, children, ...props }: CatalogLinkProps) {
    if (id === undefined) return <Plain {...props}>{children}</Plain>;

    return (
        <Anchor renderRoot={anchor => <Link to="/voice" search={{ tab: 'said', segment: id }} {...anchor} />} {...props}>
            {children}
        </Anchor>
    );
}

/** A release, linked to its tracks. */
export function AlbumLink({ id, children, ...props }: CatalogLinkProps) {
    if (id === undefined) return <Plain {...props}>{children}</Plain>;

    return (
        <Anchor renderRoot={anchor => <Link to="/catalog/albums/$albumId" params={{ albumId: id }} {...anchor} />} {...props}>
            {children}
        </Anchor>
    );
}
