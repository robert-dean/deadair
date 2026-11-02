import { Fragment } from 'react';

import { Eyebrow } from '../shared/eyebrow';
import type { AttentionCount } from './attention.destination';
import type { NavSection } from './destinations';
import { NavItem } from './nav.item';

import classes from './side.nav.module.css';

/**
 * A destination's rows in the rail, under a heading wherever their group changes.
 *
 * The heading is worked out from the row before it rather than by nesting the table, so `attention`
 * keeps lining up with `sections` by index and the phone's flat list reads the same table.
 */
export function NavSections({ sections, attention }: { sections: readonly NavSection[]; attention: readonly (AttentionCount | undefined)[] }) {
    return sections.map((section, index) => (
        <Fragment key={section.label}>
            {section.group !== undefined && section.group !== sections[index - 1]?.group ? (
                <div className={classes.groupLabel}>
                    <Eyebrow>{section.group}</Eyebrow>
                </div>
            ) : undefined}
            <NavItem
                to={section.to}
                search={section.search}
                label={section.label}
                hintText={section.hintText}
                exact={section.exact}
                nested
                attention={attention[index]}
            />
        </Fragment>
    ));
}
