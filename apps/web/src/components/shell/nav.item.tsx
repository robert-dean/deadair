import { useId } from 'react';
import { Badge, NavLink, Text, Tooltip } from '@mantine/core';
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
    /**
     * The search this row asks for, where the section it points at is a `?tab=` rather than a route.
     *
     * Voice and Programme keep their sections on one route each, so a rail row for What it said is
     * `/voice` plus a search — and the router's own active check compares the search too, which is
     * what lights exactly one of the eight. Typed off `LinkProps` for the reason `to` is: a
     * `Record<string, string>` here would type-check a tab name against a destination that has none.
     */
    search?: LinkProps['search'];
    label: string;
    /**
     * The key that reaches this destination, drawn in the gutter as the design puts it there.
     *
     * Decoration for a screen reader and a real binding for everybody else: the letter is only ever
     * drawn beside a destination the shell has actually bound in `useHotkeys`, and a hint for a key
     * that does nothing is worse than no hint at all.
     */
    hint?: string;
    /** How many things on this page need somebody, and the worst of them. Absent means nothing does. */
    attention?: { count: number; severity: Severity };
    /**
     * What is behind this link, drawn under the label.
     *
     * Not {@link NavItemProps.hint}, which is a keycap: this is a sentence, and the two are only
     * neighbours in name. Settings' sections carry one because several of them name a subject rather
     * than a setting — "Words" and "Measurement" say nothing about what an operator would find
     * there — and the rail is the first navigator this console has had with room for it.
     *
     * Drawn as a TOOLTIP on a nested row rather than as a second line. Ten Settings rows with a
     * sentence each already ran past the bottom of a 783px window; the rail now carries every
     * destination's sections, so Voice's eight would have done it again. A row is one line high and
     * says what it is when you rest on it.
     */
    hintText?: string;
    /**
     * Whether this sits under another entry rather than beside it.
     *
     * Inset and quieter, but the SAME type size. The console's type is Mantine's own scale and stays
     * that way: it was stepped down once to buy density, which reads as the browser zoomed out and
     * costs legibility rather than earning rows. Depth is spacing's job.
     */
    nested?: boolean;
    /**
     * Whether this link is active only on its own route, rather than on everything beneath it.
     *
     * The router's default is a prefix match, which is right for a destination whose sub-pages are
     * tabs — `/voice` should stay lit on every tab of Voice. It is wrong for an entry whose children
     * are drawn beneath it, where the parent would light up beside whichever child is open and the
     * rail would say the operator is in two places at once.
     */
    exact?: boolean;
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
export function NavItem({ to, search, label, hint, hintText, attention, nested = false, exact = false }: NavItemProps) {
    // For `aria-describedby`. Mantine gives its description element no id of its own, so the id goes
    // on a span inside it, which is what the attribute can then point at.
    const describedBy = useId();

    const row = (
        <NavLink
            classNames={{ root: nested ? `${classes.item} ${classes.nested}` : classes.item, label: classes.label, description: classes.description }}
            label={label}
            // A DESCRIPTION rather than a second line of label, and the difference is the whole
            // reason the two attributes below exist: Mantine folds this into the link's accessible
            // name exactly as it folds the badge, so left alone "Station" is announced as "Station
            // Name, mount and where it publishes" — the same fault this file already fixes twice.
            description={hintText === undefined || nested ? undefined : <span id={describedBy}>{hintText}</span>}
            aria-describedby={hintText === undefined || nested ? undefined : describedBy}
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
                attention !== undefined
                    ? `${label}, ${attention.count} ${attention.count === 1 ? 'thing needs' : 'things need'} attention`
                    : // A nested row's sentence has nowhere else to go: it is a tooltip, which a
                      // screen reader does not reach, so the name carries it.
                      nested && hintText !== undefined
                      ? `${label}. ${hintText}`
                      : // Named explicitly only where there is something to override. A link with
                        // neither a description nor attention keeps the name Mantine gives it, which
                        // is its label and is already right.
                        hintText === undefined || nested
                        ? undefined
                        : label
            }
            rightSection={
                attention === undefined ? undefined : (
                    <Badge aria-hidden size="sm" circle variant="filled" color={severityColor[attention.severity]}>
                        {attention.count}
                    </Badge>
                )
            }
            // Annotated for the reason every `renderRoot` in this console is: Mantine hands back
            // `any`, and spreading an `any` into a `Link` switches off the check that `to` is a
            // route that exists. This is the nav, so that check is the one worth having most.
            // `activeOptions` only where it is actually wanted. Passing `{ exact: false }` on every
            // link would read as the same thing and is not: it replaces the router's whole default,
            // `includeSearch` and all, on links that were relying on it.
            renderRoot={(props: object) => <Link to={to} search={search} activeOptions={exact ? { exact: true } : undefined} {...props} />}
        />
    );

    // The sentence is a tooltip on a nested row and a second line on a parent, and the difference is
    // height: the rail draws every destination's sections now, so a nested row has to be one line.
    // `aria-label` carries it either way, which is why the tooltip needs no describedby of its own.
    return hintText === undefined || !nested ? (
        row
    ) : (
        <Tooltip label={hintText} position="right" openDelay={400} maw={280} multiline>
            {row}
        </Tooltip>
    );
}
