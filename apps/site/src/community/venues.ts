/**
 * Where the people running stations talk, and where each kind of conversation goes.
 *
 * Everything is on the deadair repository's Discussions, beside the Ideas and the roadmap that the
 * README and CONTRIBUTING already point at, so there is one place to search and one to moderate. The
 * catalogue's own repository takes submissions through its issue forms and nothing else.
 */

export const repository = 'https://github.com/robert-dean/deadair';

const discussions = `${repository}/discussions`;

/** One place to talk, as the community page lists it. */
export interface Venue {
    /** The eyebrow over the card. */
    label: string;
    /** What goes there, in a sentence. */
    body: string;
    href: string;
    /** The link's own words. */
    cta: string;
}

export const venues: Venue[] = [
    {
        label: 'Q&A',
        body: 'Running a station, choosing a voice or a model, a plugin that will not load, or writing one of your own. Anything that is not a bug.',
        href: `${discussions}/categories/q-a`,
        cta: 'Ask a question',
    },
    {
        label: 'Show and tell',
        body: 'Your station, the character presenting it, the clock you settled on, the plugin you built. Post the address and people will tune in.',
        href: `${discussions}/categories/show-and-tell`,
        cta: 'Show yours',
    },
    {
        label: 'Ideas',
        body: 'Work designed against the real code and then deliberately deferred, labelled by the part of the station it touches. Read them before proposing a feature: the call may already have been made.',
        href: `${discussions}/categories/ideas`,
        cta: 'Read the ideas',
    },
    {
        label: 'Bugs',
        body: 'Something the station does that it should not, with what it logged. Security problems go through a private advisory instead, never an issue.',
        href: `${repository}/issues`,
        cta: 'Open an issue',
    },
];

export const contributing = `${repository}/blob/main/CONTRIBUTING.md`;
export const codeOfConduct = `${repository}/blob/main/CODE_OF_CONDUCT.md`;
export const allDiscussions = discussions;
