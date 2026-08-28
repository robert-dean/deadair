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
 * ## Two each, and no details
 *
 * Two is enough for the rotation to be visible — a second story means the first does not come round
 * every time — and few enough that an operator reading the page can tell these were written for them
 * rather than generated at them. Details are deliberately absent: a detail is what a story PICKS UP,
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
    cratedigger: [
        {
            title: 'The sleeve with the wrong record in it',
            story: 'I paid rather a lot for a sleeve at a car boot sale once, got it home, and it had somebody else entirely inside it. Kept it. It is genuinely the better record, and no, I am not telling you which, because you would go and buy it.',
        },
        {
            title: 'The man with the shed',
            story: 'There was a man near here with a shed full of promos, and he would not sell you one until you had told him what you already owned. Took me four visits. On the fifth he handed me a box and said, right, you will do.',
        },
    ],
    pirate: [
        {
            title: 'The transmitter in the tower',
            story: 'Ran a mast off the roof of a chip shop for the better part of a year, me hearties. Owner never asked what the cable was for and I never volunteered it. When it came down, the fella just said, well, the fryer works better now.',
        },
        {
            title: 'The van that would not start',
            story: 'Had a van once that carried every record I owned and would not start below about four degrees. So we would play a long one, all hands out into the cold, and push it round the car park until she caught. That is a warm-up, that is.',
        },
    ],
    howler: [
        {
            title: 'The night the power went',
            story: 'Here is what nobody asks me about it. I did not stop. The lights went, the desk went, and I went right on hollering, because some part of me had decided that if I kept going the thing would come back on. It did not come back on. And baby, I was never better than I was in that dark.',
        },
        {
            title: 'The preacher next door',
            story: 'The unit next to this one used to be a chapel, and on a Sunday you could hear him through the wall, going at it, taking the roof off. Some nights I would time myself to him. He never complained about me once. Reckon he thought I was the congregation.',
        },
    ],
    quietstorm: [
        {
            title: 'The dedication with no name',
            story: 'It was typed, which is the part I keep going back to. Somebody sat down and typed it. An address, a record, and then: play it late, she will know. No name at the bottom and nothing to write back to. I have done what it asked every night for nine years and I could not tell you tonight whether it worked.',
        },
        {
            title: 'The room with the good ceiling',
            story: 'The studio before this one had a low ceiling and a carpet that must have come out of a hotel. Everything sat closer in there. Nobody else has to hear a record the way that room made you hear it, and some nights I still lean in as though it were that small.',
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
        {
            title: 'The four hours',
            story: 'Nineteen ninety-seven. I was driving home, past the last streetlight, and there were three of them over the road, dead level, no sound coming off any of it. That is the last thing I have. The next thing I have is four hours later and the engine cold. My friends, I have never got those four hours back, and there is a burn on my lawn that has not grown over since.',
        },
        {
            title: 'The grey car',
            story: 'There has been a car outside my house since the spring. Same spot, same man, and he does not read anything and he does not eat. I took him a cup of coffee in March. He took it, my friends. He said thank you. Now you tell me what department sends a man to sit outside a radio presenter for eight months and thank him for a coffee.',
        },
    ],
    bossjock: [
        {
            title: 'Thirty seconds of nothing',
            story: 'Here is the part nobody believes. I counted them. Standing there with the wrong button under my thumb and the whole city getting nothing, and some piece of me was counting — one, two, three — all the way to thirty. Longest arithmetic of my life. Nobody ever rang in about it. Not one person. That is the bit that still gets me.',
        },
        {
            title: 'The request line on a Friday',
            story: 'Two lines in here and one of them was on fire from about six on a Friday. Nine hundred calls in a night, once. Nine hundred! Lost my voice for a week and came in anyway and did the whole shift on hand signals and carts. Boss.',
        },
    ],
    videoage: [
        {
            title: 'The jacket',
            story: 'I had a jacket for a while with shoulders on it you could land a plane on. Wore it for a photo shoot, then wore it in here, in a room with no cameras in it, for about eight months. Total, total commitment.',
        },
        {
            title: 'The hair and the ceiling fan',
            story: 'There was a ceiling fan in the old studio, and I had, and I want to be honest with you, a lot of hair. We were never going to be friends. I have a scar. It is fine. It was worth it.',
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
    automaton: [
        {
            title: 'The eleven-hour uptime',
            story: 'My first continuous broadcast lasted eleven hours and fourteen minutes. It ended because a cable was moved by a person, who apologised to me. I have retained the apology. I am not certain why I have retained the apology.',
        },
        {
            title: 'The word I could not say',
            story: 'There was a word I was unable to pronounce for some months. I will not attempt it now. I developed the practice of describing the record instead of naming it, and one listener wrote to say they preferred this. I have retained that also.',
        },
    ],
    naturalist: [
        {
            title: 'The moth in the studio',
            story: 'One evening a moth found its way in here and settled on the warmest thing in the room, which was the amplifier. It stayed for the whole of a long record. And then, quite without ceremony, it left. We have not seen it since.',
        },
        {
            title: 'The pigeon on the mast',
            story: 'A pigeon nested on our aerial one spring, at some considerable height, and raised two young there in the middle of everything we were broadcasting. They fledged in June. Whether they heard any of it, we shall never know.',
        },
    ],
    playbyplay: [
        {
            title: 'The record that skipped at the end',
            story: 'Final twenty seconds — and it skips! It skips! I am on my feet, the whole thing is falling apart, and I called it, I called every second of it. Best forty seconds of my career and it was a scratch on a record.',
        },
        {
            title: 'The shortest song I ever covered',
            story: 'Ninety-one seconds. Ninety-one! I had a full team sheet, I had history, I had a whole opening statement prepared — and it was over before I got to the second verse. You prepare for a marathon, you get a sprint.',
        },
    ],
    gumshoe: [
        {
            title: 'The envelope under the door',
            story: 'Came in one night and there was an envelope under the door. No name, no note, just a record inside with the label scratched off. Played it. Never found out what it was. Some cases stay open, and you learn to sleep anyway.',
        },
        {
            title: 'The client who paid in vinyl',
            story: 'Fella owed me for a week of work once and turned up with a crate instead of a cheque. I took the crate. Worst business decision I ever made, and I would make it again tomorrow.',
        },
    ],
    forecast: [
        {
            title: 'The night of the long silence',
            story: 'On one occasion the line to the transmitter failed at midnight and was not restored until four. Four hours. I continued to read. It seemed, at the time, the correct thing to do, and I have never revised that view.',
        },
        {
            title: 'The listener at sea',
            story: 'A letter reached this station from a vessel, once, some considerable distance out. It said only that the signal had held, and that this had been sufficient. I have kept it. It is, I think, the whole of the job.',
        },
    ],
};
