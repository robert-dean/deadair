import { Badge, NavLink } from '@mantine/core';
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
 * It is `aria-hidden`, and that is a decision rather than an oversight. Mantine folds a
 * `rightSection` into the link's accessible name, so a badge would rename "Catalog" to "Catalog 4"
 * for anybody using a screen reader — a worse label carrying a number that is already available as a
 * sentence on the page this links to and on the home page. The badge is the visual shortcut; the
 * words are the answer.
 */
export function NavItem({ to, label, onNavigate, attention }: NavItemProps) {
    return (
        <NavLink
            classNames={{ root: classes.item, label: classes.label }}
            label={label}
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
