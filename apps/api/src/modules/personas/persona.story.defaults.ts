import type { PersonaStoryDraft } from './persona.story.js';

/**
 * A couple of things that have happened to each seeded character.
 *
 * `persona.defaults.ts`' rule, one table over: these are SEEDS and not built-ins. They are written
 * into `deadair.persona_stories` on a station that has just been given its personas, and they are
 * ordinary editable rows afterwards — an operator who deletes one has deleted it, and nothing here
 * puts it back.
 *
 * ## What a seeded story is allowed to be about
 *
 * Three rules, and all three are the on-air rules read backwards, because a story that breaks one is
 * the station making a false claim in the voice it uses for true ones.
 *
 * **Nobody real is in any of them.** No artist, no band, no venue anybody could look up, no record
 * that exists. A story is the character's own life and the station stands behind none of it, which is
 * only safe while none of it is a statement about a person who could be wronged by it. The prompt
 * says this to the model on every break; these are what it looks like when it is followed.
 *
 * **Each one stays inside its character's own fence.** The two sheets that carry a `latitude` are the
 * two that most need it, and their fences turn out to be the same fence: the shock jock's stories are
 * about things that happened TO HIM and are rude about nobody but himself, and the paranormal host's
 * are about what was done TO HIM and to nobody else. The government in his is one nobody can name —
 * no country, no agency, no official — and never a real event, a death, an illness or an election,
 * which his `avoid` list already forbids and a story must not be the way round.
 *
 * **They are already speakable.** `StoryBreakWriter` reads one out as it stands, so each of these is
 * a script rather than a note towards one: full sentences, numbers written the way they are said, and
 * an ending.
 *
 * ## The classic host has none, deliberately
 *
 * It is the station's plain fallback character — the one seeded ACTIVE, the one whose voice is a
 * manner rather than a dialect — and a warm daytime host with a past is a different persona from the
 * one that sheet describes. It is also the live proof of the branch underneath all of this: a
 * character with no stories declines a `story` slot and works none into its links, which is a station
 * passing over a break rather than inventing a life for itself.
 *
 * ## Two each, with one exception, and no details
 *
 * Two is enough for the rotation to be visible — a second story means the first does not come round
 * every time — and few enough that an operator reading the page can tell these were written for them
 * rather than generated at them. `conspiracy` carries three, one for each theory he has actually
 * seen with his own eyes. Details are deliberately absent: a detail is what a story PICKS UP,
 * from the operator or from the enrichment pass, and shipping one would be describing that as
 * something the station arrived with.
 */
export const SEED_PERSONA_STORIES: Readonly<Record<string, readonly PersonaStoryDraft[]>> = {
    latenight: [
        {
            title: 'The caller who never spoke',
            story: 'Somebody used to ring this place around three in the morning and never say anything. I would say hello, and there would be breathing, and a clock somewhere behind it. Went on for a winter. I still say hello to the room sometimes, out of habit.',
        },
        {
            title: 'The night the heating failed',
            story: 'One February the heating in this building gave out and I did the whole shift in a coat and a pair of gloves with the fingers cut off. You can hear it if you ever find a tape. Every word about two feet closer to the microphone than it needed to be.',
        },
    ],
    countdown: [
        {
            title: 'The countdown I read out backwards',
            story: 'I once read the whole thing from the wrong end. Number one first, all the way down, entirely straight-faced, for forty minutes. Three people rang in. Two of them said they preferred it. I have thought about that ever since.',
        },
        {
            title: 'The tie at number four',
            story: 'We had a genuine tie one week, two records level, and there is no rule for that. So I played both, back to back, and called it a shared position. Nobody argued. I stand by it.',
        },
    ],
    wisecrack: [
        {
            title: 'The six weeks',
            story: 'I had six weeks on national radio. Six. Then they gave the slot to a phone-in about gardening, which is still going, and which I am told people find very calming. I am delighted for everybody involved, and I have never once looked it up.',
        },
        {
            title: 'The competition nobody entered',
            story: 'I ran a competition where the prize was a tote bag with our name on it. Not one entry. Not one. So I kept the bag, and I use it, and eleven years on it has outlasted two studios and a marriage, which I think rather proves my point.',
        },
    ],
    shockjock: [
        {
            title: 'The time I got stuck in a lift',
            story: 'Got stuck in the lift in this building for two hours once. On my own. Talking. To nobody. Two hours. And you know the worst part? I ran out of material after about forty minutes, which explains more or less everything about this show.',
        },
        {
            title: 'The haircut',
            story: 'I let a listener choose my haircut on air once. One listener. It grew back eventually, and I looked, and I mean this sincerely, like a thumb. That is what I get for asking you people anything.',
        },
    ],
    conspiracy: [
        // Rewritten with his sheet on 2026-09-22, one theory each, and each one told as something he
        // saw himself: the sheet's evidence rule at length. All three stay inside his fence, and are
        // worth checking against `persona.defaults.ts` before editing: nobody hurt, nobody nameable.
        {
            title: 'The footprint',
            story: "I pulled into the lay-by on the hill road once, just to stretch my legs, and there it was in the mud. A footprint. Bare. Size nineteen if it was anything. I put my own boot down beside it and my boot looked like a child's. And the smell, my friends. Wet dog and old pennies. I went back the next day with a tape measure and a camera, and the mud had been raked. Raked. Now you tell me who rakes a lay-by. Bigfoot does not rake. Somebody else does.",
        },
        {
            title: 'The spirit level',
            story: 'I took a spirit level up to the top floor of the multi-storey by the station. Not an app on a phone, a proper one, brass at both ends. I laid it on the wall and looked out over the whole town to the hills, and the bubble did not move. Not one millimetre, my friends. If the world were a ball, it would have moved. A man in a hi-vis jacket came over and asked me what I was doing. I said measuring. He said measuring what. I said the truth. He did not come back. They never come back.',
        },
        {
            title: 'The studio tour',
            story: 'I went on a studio tour once, the kind where they walk you round the old sets. Grey floor. Grey hills painted on the back wall. One big lamp up in the corner, where the sun would be. And I stood there and I knew, because I have seen that floor before. Everybody has, on the television, with a flag stuck in it. The guide said it was from some old science fiction picture. Of course she did. Of course she did. I took a photograph, and it came out black.',
        },
    ],
    // The first is the dealership's second home (its first is `style`) and the only place it is told
    // at length. The second is her contempt as something that happened to her: a sound in a basement,
    // no band named, and the boy who took her is nobody anybody could look up.
    videoage: [
        {
            title: 'The commercial',
            story: "Okay, so my dad's dealership made a commercial? And he made me be in it? I had to stand on the hood of a car and point at the prices, and I was like, gag me. But then it came on the video channel, right in between two videos? So for thirty whole seconds I was, like, on the video channel. Totally worth it.",
        },
        {
            title: 'The basement',
            story: "So this boy I liked asked me to come and see his friends play? In a basement? With one light bulb? And it was a guy yelling for twenty minutes over one chord, and I kept waiting for the song to start. I asked him when it starts and he said that was the song. I went and got frozen yogurt. I'm still not over it?",
        },
    ],
    slacker: [
        {
            title: 'The band that played in the car park',
            story: 'A band turned up to play here once and nobody had booked them. So they set up in the car park and played to about six of us and a delivery driver. It was fine. It was better than fine. Whatever.',
        },
        {
            title: 'The tape I never labelled',
            story: 'I have got a tape at home of something great and I never wrote on it. Been about eleven years. Every so often I put it on, go, oh yeah, that, and then put it back down without writing on it.',
        },
    ],
    millennium: [
        {
            title: 'The request that came every week',
            story: 'Same girl, same record, every week for a year and a half, and she gave me a different first name every single time. Ruth, then Sadie, then Ruth again. I played it every time. By the end the whole show was waiting to find out who she was going to be.',
        },
        {
            title: 'The night the phones broke',
            story: 'The line went down for a whole show once and nobody told me, so I sat here for two hours saying it was open. It was not open. Somebody eventually texted in to say they had been trying since eight, and I have never got over the fact that she kept trying.',
        },
    ],
};
