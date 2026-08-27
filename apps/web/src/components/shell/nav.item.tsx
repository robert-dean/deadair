import { Badge, NavLink, Text } from '@mantine/core';
import { Link, type LinkProps } from '@tanstack/react-router';

import { severityColor, type Severity } from '../shared/status';
import classes from './side.nav.module.css';

export interface NavItemProps {
    /**
     * Typed against the registered router, which is the entire point of this prop's type.
     *
     * The header used to spell its links `<Anchor component={Link} to="...">`, and Mantine's
     * polymorphic `component` erases the router's typing — so `/lineups` sat in the nav pointing
     * at a route that did not exist, compiling cleanly, for as long as the header did. Anything
     * this narrow is a build error the moment a route is renamed or removed.
     */
    to: LinkProps['to'];
    label: string;
    /**
     * The key that reaches this destination, drawn in the gutter as the design puts it there.
     *
     * Decoration for a screen reader and a real binding for everybody else: the letter is only ever
     * drawn beside a destination the shell has actually bound in `useHotkeys`, and a hint for a key
     * that does nothing is worse than no hint at all.
     */
    hint?: string;
    /** Closes the drawer on a phone, where following a link should not leave the nav over the page. */
    onNavigate?: () => void;
    /** How many things on this page need somebody, and the worst of them. Absent means nothing does. */
    attention?: { count: number; severity: Severity };
}

/**
 * One destination in the side nav.
 *
 * The badge is how a page says it has something waiting without being open. A blocked draft, a
 * plugin that will not start and a record nothing can fetch were all invisible unless an operator
 * happened to already be on the page that showed them, which is the same problem the home page's
 * list solves one level up — and it reads the same answer, so the two cannot disagree.
 *
 * The badge is `aria-hidden` and the link says the same thing in words instead. Mantine folds a
 * `rightSection` into the accessible name, so left alone the badge renames "Catalog" to "Catalog 4",
 * which is a label with a number stuck on the end of it rather than a sentence. Hiding it and saying
 * nothing was the first answer and was half of one: it left the shortcut sighted operators get with
 * no equivalent at all, on the argument that the count is available as a sentence on the page this
 * links to — which is true, and is a page you have to already be on.
 *
 * So the label is written out only when there IS attention, and a link with nothing waiting keeps
 * its plain name rather than announcing that nothing is wrong with it.
 */
export function NavItem({ to, label, hint, onNavigate, attention }: NavItemProps) {
    return (
        <NavLink
            classNames={{ root: classes.item, label: classes.label }}
            label={label}
            // `aria-hidden` for the same reason the badge is: a section left visible is folded into
            // the link's accessible name, and "D Desk" is a label with a keycap stuck on the front
            // of it rather than a destination. Sighted operators lose nothing — the letter IS the
            // shortcut, and a screen reader user reaching this link is already on it.
            leftSection={
                hint === undefined ? undefined : (
                    <Text aria-hidden component="span" ff="monospace" size="xs" c="var(--da-text-dimmed)" w={12} ta="center">
                        {hint}
                    </Text>
                )
            }
            aria-label={
                attention === undefined
                    ? undefined
                    : `${label}, ${attention.count} ${attention.count === 1 ? 'thing needs' : 'things need'} attention`
            }
            rightSection={
                attention === undefined ? undefined : (
                    <Badge aria-hidden size="sm" circle variant="filled" color={severityColor[attention.severity]}>
                        {attention.count}
                    </Badge>
                )
            }
            // `onClick` is pulled out of the spread rather than set beside it: the props Mantine
            // hands back land last, so an `onClick` written before them is silently discarded.
            renderRoot={({ onClick, ...props }) => (
                <Link
                    to={to}
                    onClick={event => {
                        onClick?.(event);
                        onNavigate?.();
                    }}
                    {...props}
                />
            )}
        />
    );
}
