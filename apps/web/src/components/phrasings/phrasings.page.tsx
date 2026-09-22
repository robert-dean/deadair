import { Stack } from '@mantine/core';

import { SettingsGroupPage } from '../settings/settings.page';
import { PageHeader } from '../shared/page.header';

/**
 * The words the station says around a greeting, a jingle, a change of show, a bulletin, the weather
 * and the date.
 *
 * ## Why they are here and not under Settings
 *
 * They sat at the bottom of Rotation, six boxes of eight rows each among forty-two fields about what
 * the station plays and how often it talks, which made that page the longest in the console and put
 * the words a long way from anything else about the station's voice. They are the `phrasings` group
 * now, which no settings section draws, so they are drawn here and only here.
 *
 * ## What is not here
 *
 * A talk break's phrasings. Those belong to the character saying them and are on its sheet under
 * Characters; the station-wide set was removed once every seeded character carried its own. The
 * welcome box's help says so, since it is the first one an operator reads.
 *
 * The toggles these depend on (whether the station welcomes anybody, whether it interrupts itself at
 * all) are under Settings. The form shows a box whose toggle is on another page rather than
 * hiding it, which is the right way round: a box that vanishes gives no hint where its switch is.
 */
export function PhrasingsPage() {
    return (
        <Stack gap="lg">
            <PageHeader
                title="Phrasings"
                description="What the station says around the things it reads out, whenever no model writes the words. Each box is a set to pick between, one per line. What a character says between records is on its own sheet, under Characters."
            />
            <SettingsGroupPage group="phrasings" label="Phrasings" />
        </Stack>
    );
}
