// The stories the station ships with. Every mistake available in one of these is silent on air: a
// story naming a real band is the station stating something false about a real person in the voice
// it uses for true things, and a story that is a note towards a story rather than a script is read
// out as it stands by the floor.

import { describe, expect, it } from 'vitest';

import { SEED_PERSONAS } from '../../../src/modules/personas/persona.defaults.js';
import { SEED_PERSONA_STORIES } from '../../../src/modules/personas/persona.story.defaults.js';

const seeded = Object.entries(SEED_PERSONA_STORIES);
const everyStory = seeded.flatMap(([key, stories]) => stories.map(story => ({ key, ...story })));

describe('the seeded persona stories', () => {
    it('belong to characters this station actually seeds', () => {
        const keys = new Set(SEED_PERSONAS.map(persona => persona.key));

        for (const [key] of seeded) expect(keys.has(key), `${key} is not a seeded persona`).toBe(true);
    });

    // The plain fallback character, and the live proof of the branch underneath all of this: a
    // character with no stories declines a `story` slot rather than inventing a past for itself.
    it('leave the classic host with none', () => {
        expect(SEED_PERSONA_STORIES.classic).toBeUndefined();
    });

    it('give every other seeded character more than one, so the rotation is visible', () => {
        for (const persona of SEED_PERSONAS) {
            if (persona.key === 'classic') continue;

            expect((SEED_PERSONA_STORIES[persona.key] ?? []).length, `${persona.key} has fewer than two stories`).toBeGreaterThan(1);
        }
    });

    it('have a handle nobody duplicated within a character, since the store keeps them unique', () => {
        for (const [key, stories] of seeded) {
            const titles = stories.map(story => story.title.toLowerCase());

            expect(new Set(titles).size, `${key} repeats a title`).toBe(titles.length);
        }
    });

    // `StoryBreakWriter` reads one out as it stands, so each of these is a script rather than a note
    // towards one.
    it('are already speakable: whole sentences, with an ending', () => {
        for (const story of everyStory) {
            expect(story.story.length, `${story.key}/${story.title} is too short to be a story`).toBeGreaterThan(80);
            expect(story.story.trim(), `${story.key}/${story.title} does not finish a sentence`).toMatch(/[.!?]$/);
        }
    });

    // The one rule that is a correctness rule rather than a taste one. A story is the character's own
    // life and the station stands behind none of it, which is only safe while none of it is a
    // statement about somebody who could be wronged by it. Nothing here can catch every proper noun,
    // so this catches the shape the failure would actually take: a seeded story reaching for a real
    // record or a real act by name.
    it('name nobody real, which is the rule the prompt states on every break', () => {
        // Written as the words that would appear if somebody hung one of these off an actual record.
        // Deliberately narrow: "by the" was in this list for one run and caught "you could set your
        // watch by the fact", which is the shape of every over-broad rule about prose.
        const claims = /\b(?:album|LP|EP|his band|her band|their band|the single)\b/i;

        for (const story of everyStory) {
            expect(claims.test(story.story), `${story.key}/${story.title} sounds like a claim about a real record`).toBe(false);
        }
    });

    // A detail is what a story PICKS UP, from the operator or from the enrichment pass. Shipping one
    // would describe that as something the station arrived with.
    it('ship no details', () => {
        for (const story of everyStory) expect('details' in story).toBe(false);
    });

    // The two sheets that carry a `latitude` are the two whose fence `persona.defaults.ts` argues at
    // length, and a story must not be the way round it.
    it('keep the conspiracy host pointed at what he saw and the records, never at anything real', () => {
        const forbidden = /\b(?:election|government|died|death|illness|vaccine|virus|war|assassinat)/i;

        for (const story of SEED_PERSONA_STORIES.conspiracy ?? []) {
            expect(forbidden.test(story.story), `${story.title} crosses the fence on the conspiracy sheet`).toBe(false);
        }
    });
});
