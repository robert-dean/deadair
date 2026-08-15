import { NavLink } from '@mantine/core';
import { Link, type LinkProps } from '@tanstack/react-router';

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
}

/** One destination in the side nav. */
export function NavItem({ to, label, onNavigate }: NavItemProps) {
    return (
        <NavLink
            classNames={{ root: classes.item, label: classes.label }}
            label={label}
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
