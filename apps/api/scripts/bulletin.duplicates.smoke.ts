/**
 * Which stories in the news window a bulletin would treat as one, against a station's real feeds.
 *
 * `story.signature.ts` is tested with headline pairs written down, which pins the rule and says
 * nothing about where its bar sits against a real day's news. This prints both sides of the bar:
 * every pair the rule joins, and every pair that came within one word of being joined, so a wrong
 * match and a margin too thin to trust are both visible before anything airs on the strength of it.
 *
 * It reads. It asks a running station's API for its feeds and their stories, or reads a saved
 * answer, and writes nothing anywhere.
 *
 * Run from `apps/api`, against a station:
 *   DEADAIR_API_URL=https://… DEADAIR_API_KEY=… node --import @swc-node/register/esm-register ./scripts/bulletin.duplicates.smoke.ts
 * or against a saved `GET /news` answer (`{ "stories": [...] }`):
 *   node --import @swc-node/register/esm-register ./scripts/bulletin.duplicates.smoke.ts ./window.json
 *
 * `HOURS` sets the window (24 by default) and `PER_FEED` how many stories each feed is asked for (15).
 */
import { readFile } from 'node:fs/promises';

import {
    joins,
    NAMES_ALONE,
    signatureOf,
    storyOverlap,
    StoryRarity,
    WORDS_WITH_A_NAME,
    type StorySignature,
} from '../src/modules/director/story.signature.js';

interface Story {
    feedId: string;
    title: string;
    summary?: string;
    content?: string;
}

const hours = Number(process.env.HOURS ?? 24);
const perFeed = Number(process.env.PER_FEED ?? 15);

async function fromStation(): Promise<Story[]> {
    const base = process.env.DEADAIR_API_URL;
    const key = process.env.DEADAIR_API_KEY;
    if (base === undefined || key === undefined) {
        console.log('set DEADAIR_API_URL and DEADAIR_API_KEY, or pass a saved window as the first argument');
        process.exit(1);
    }

    const get = async <T>(path: string): Promise<T> => {
        const response = await fetch(`${base}/api${path}`, { headers: { authorization: `Bearer ${key}` } });
        if (!response.ok) throw new Error(`${path} answered ${response.status}`);
        return (await response.json()) as T;
    };

    const { feeds } = await get<{ feeds: { id: string }[] }>('/news/feeds');
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();
    console.log(`reading ${feeds.length} feed(s), the last ${hours} hours…`);
    // One feed at a time, as a bulletin's roster is asked: the story pages share one bucket.
    const stories: Story[] = [];
    for (const feed of feeds) {
        const query = new URLSearchParams({ feedId: feed.id, limit: String(perFeed), since });
        stories.push(...(await get<{ stories: Story[] }>(`/news?${query.toString()}`)).stories);
    }
    return stories;
}

const saved = process.argv[2];
const read = saved === undefined ? await fromStation() : ((JSON.parse(await readFile(saved, 'utf8')) as { stories: Story[] }).stories ?? []);

// One headline is one story already (`ReadLog` and `distinct` catch that), so the window here is what
// is left for the signature to decide.
const byHeadline = new Map<string, Story>();
for (const story of read) {
    const key = story.title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
    if (!byHeadline.has(key)) byHeadline.set(key, story);
}
const stories = [...byHeadline.values()];
const signatures: StorySignature[] = stories.map(story =>
    signatureOf({ headline: story.title, ...(story.summary ? { summary: story.summary } : {}), ...(story.content ? { body: story.content } : {}) }),
);
const rarity = new StoryRarity(signatures);

const joined: string[] = [];
const close: string[] = [];
const label = (story: Story): string => `${story.title}  [${story.feedId.split(':').pop()}]`;

for (let i = 0; i < stories.length; i += 1) {
    for (let j = i + 1; j < stories.length; j += 1) {
        const a = signatures[i] as StorySignature;
        const b = signatures[j] as StorySignature;
        const overlap = storyOverlap(a, b, rarity);
        const pair = `  ${label(stories[i] as Story)}\n  ${label(stories[j] as Story)}`;
        const evidence = `    ids ${overlap.ids.join(', ') || '-'} · names ${overlap.names.join(', ') || '-'} · words ${overlap.words.join(', ') || '-'}`;
        if (joins(overlap)) {
            joined.push(`${pair}\n${evidence}`);
            continue;
        }

        // One short of the bar, on either branch of it, so the margin can be read.
        const names = overlap.names.length;
        const words = overlap.words.length;
        if (names === NAMES_ALONE - 1 && words >= WORDS_WITH_A_NAME - 1) close.push(`${pair}\n${evidence}`);
    }
}

const withText = stories.filter(story => (story.content ?? '').length > 0).length;
console.log(`\n${read.length} stories, ${stories.length} distinct headlines, ${withText} with the story's own text\n`);
console.log(`JOINED (${joined.length}): a bulletin would read one of each pair\n`);
for (const line of joined) console.log(`${line}\n`);
console.log(`ONE WORD SHORT (${close.length}): kept apart, but only just\n`);
for (const line of close) console.log(`${line}\n`);
