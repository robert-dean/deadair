/**
 * Suggestions for a persona's on-air name.
 *
 * Deliberately not a generic name faker: an air name is a stage name rather than a legal one, so
 * the banks below are radio-flavoured — a handle, a nickname with a surname, "The something" — and
 * the first names lean retro the way real air names do. All local, so nothing reaches the bundle
 * beyond these lists and nothing reaches the network at all.
 *
 * **One bank of first names rather than two.** The station this came from asked the caller for a
 * gender and picked a list from it. Nothing in this console's persona has a gender — not the
 * editor, not the SDK's `Persona`, not the sheet the model is given — so there would be nothing to
 * pass, and inventing the question in order to answer it would be this button asserting something
 * about a character the operator never said. Pooling the names also widens every shape below.
 */

const FIRST = [
    'Mabel',
    'Ruby',
    'Roxy',
    'Stella',
    'Vera',
    'Nadine',
    'Marla',
    'Peggy',
    'Josie',
    'Delia',
    'Wanda',
    'Lorna',
    'Birdie',
    'Cleo',
    'Sadie',
    'Gloria',
    'Rita',
    'Bebe',
    'Sunny',
    'Kitty',
    'June',
    'Nova',
    'Simone',
    'Lola',
    'Trixie',
    'Etta',
    'Bonnie',
    'Maxine',
    'Coco',
    'Angie',
    'Jack',
    'Ray',
    'Buddy',
    'Duke',
    'Hank',
    'Sal',
    'Vince',
    'Rocco',
    'Gus',
    'Marty',
    'Clyde',
    'Otis',
    'Rudy',
    'Cash',
    'Dean',
    'Sonny',
    'Rex',
    'Curtis',
    'Lenny',
    'Cliff',
    'Tex',
    'Ace',
    'Wes',
    'Roscoe',
    'Milo',
    'Baxter',
    'Reggie',
    'Deke',
    'Hutch',
    'Moe',
];

const LAST = [
    'Vaughn',
    'Sparks',
    'Rivers',
    'Knox',
    'Steele',
    'Malone',
    'Wilder',
    'Fox',
    'Cassidy',
    'Monroe',
    'Hale',
    'Reyes',
    'Quinn',
    'Crane',
    'Bishop',
    'Harlow',
    'Sinclair',
    'Voss',
    'Mercer',
    'Winters',
    'Stone',
    'Kane',
    'Larue',
    'Sharp',
    'Ryder',
    'Delgado',
    'Ash',
];

/** Goes in front of a first name: "Midnight Mabel", "Downtown Duke". */
const PREFIX = [
    'Midnight',
    'Velvet',
    'Neon',
    'Cosmic',
    'Downtown',
    'Uptown',
    'Lonesome',
    'Electric',
    'Wild',
    'Sweet',
    'Blue',
    'Diamond',
    'Shortwave',
    'Graveyard',
    'Sundown',
    'Hurricane',
    'Boogie',
    'Dizzy',
    'Slick',
    'Big',
];

/** Stands alone after a name, or behind "The": "Sonny Static", "The Nightbird". */
const HANDLE = [
    'Static',
    'Nightbird',
    'Nightowl',
    'Wolf',
    'Needle',
    'Groove',
    'Signal',
    'Deluxe',
    'Fever',
    'Thunder',
    'Reverb',
    'Echo',
    'Tempo',
    'Vinyl',
    'Wavelength',
    'Dial',
];

/** The shapes an air name takes. The repeats ARE the weighting: first-and-last is the common one. */
const SHAPES = ['first-last', 'first-last', 'first-last', 'prefix-first', 'prefix-first', 'first-handle', 'the-handle', 'dj-handle'] as const;

function pick<T>(items: readonly T[]): T {
    return items[Math.floor(Math.random() * items.length)]!;
}

function compose(): string {
    const first = pick(FIRST);
    switch (pick(SHAPES)) {
        case 'prefix-first':
            return `${pick(PREFIX)} ${first}`;
        case 'first-handle':
            return `${first} ${pick(HANDLE)}`;
        case 'the-handle':
            return `The ${pick(HANDLE)}`;
        case 'dj-handle':
            return `DJ ${pick(HANDLE)}`;
        default:
            return `${first} ${pick(LAST)}`;
    }
}

/**
 * A suggested on-air name.
 *
 * `exclude` is whatever is already in the field, so pressing the button again always visibly
 * changes something. A bounded number of retries rather than a loop: the banks are large enough
 * that a collision is rare, and a generator that cannot fail is worth more than one that is
 * guaranteed to differ.
 */
export function suggestAirName(exclude?: string): string {
    const taken = exclude?.trim().toLowerCase();
    let name = compose();
    for (let attempt = 0; taken && name.toLowerCase() === taken && attempt < 8; attempt += 1) {
        name = compose();
    }
    return name;
}
