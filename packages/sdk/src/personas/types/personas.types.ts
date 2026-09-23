/**
 * Who the station is when it opens its mouth: the character a model writes in, the phrasings underneath it, the voice that says them, and what it plays
 * generated from [Persona](../../../../../apps/api/data/contracts/personas/personas.types.ck#L8)
 */
export interface Persona {
    id: string;
    /** A stable slug, unique per station. What a log line names and what a seeded persona is recognised by */
    key: string;
    /** What this character is FOR. `host` is the station's own voice; a `caller` phones in to a production, is cast per programme, and can never be put on air. Absent means `host`, so a form written before callers existed still means what it meant */
    kind?: 'host' | 'caller';
    label: string;
    /** Completes "You are …". Who they ARE; the sheet below carries how they talk */
    style: string;
    /** The name this character goes by on air, overriding the station's own while it is active */
    djName?: string;
    /** The station voice that speaks this persona, as the id a speech plugin maps. Empty means that plugin's default */
    voice?: string;
    /** The soundboard this character has to hand, as the name of a board in the pad library. Empty for a presenter who works without one. What reaches a model is the names of the pads on that board, never this word */
    soundboard?: string;
    /** The dialect: grammar and substitutions that apply to every sentence rather than to a subject */
    diction?: string[];
    /** Words whose presence proves the dialect survived. What a model's answer is checked against */
    dictionMarkers?: string[];
    /** What they always and never do on air */
    quirks?: string[];
    /** The standing subjects they keep coming back to. Exactly ONE reaches any one break, chosen by rotation, which is what makes a character sound like it has things on its mind rather than one thing */
    preoccupations?: string[];
    /** Signature phrases, asked for sparingly */
    catchphrases?: string[];
    /** Wording that breaks the character */
    avoid?: string[];
    /** Subjects this character takes one at a time. Each entry is ONE subject, written as the comma-separated words that mean it ("bigfoot, sasquatch, yeti"), and a break that brings up words from two of them is refused and written again. A word inside a record's title does not count */
    exclusiveSubjects?: string[];
    /** A couple of grounded facts they may self-reference */
    background?: string;
    /** How much this character says. Absent for the station's ordinary length; the rung above it is `latitude`, which is a different kind of thing rather than a longer one */
    brevity?: 'short' | 'one-line';
    /** How much room this character is given, above the station's ordinary discipline: a bigger word ceiling, a licence to follow the thought instead of making one point, and at `unleashed` no restraint on how it says it. Offered only by the ordinary talk break, always outranked by the station's content policy, and it switches off no refusal */
    latitude?: 'loose' | 'unleashed';
    /** How often this character talks, as a scale on the station's own interval between breaks. Absent is `ordinary`, which is that interval unchanged. The quietest rung is half as often and never silence: turning the station's breaks off is a station setting, and two switches for one thing can disagree */
    chattiness?: 'reserved' | 'sparing' | 'ordinary' | 'chatty' | 'relentless';
    /** How readily this character works one of its own stories into an ordinary talk break. Absent is `occasionally`, which offers one only where the station knows nothing about the records either side. The stories themselves are their own list, and a `story` band on the clock outranks this whatever it says */
    storytelling?: 'never' | 'occasionally' | 'often';
    /** Whether the nightly passes may write this character new material outright, or only ever propose it for you to accept. Absent is `proposes`, which is what every character does until somebody says otherwise. It reaches no prompt: the character is never told which it is */
    growth?: 'proposes' | 'self-directed';
    /** How much this character leans on what the station knows about a record. Absent is the station's ordinary break, where the notes are optional and two at most. At `keen` each record brings up to four, one each about the recording, its album and its artist before a second about any, and the break is built out of them with the room to tell one. Offered only by the ordinary talk break, and the grounding rules do not move: it may still say only what a note says */
    trivia?: 'keen';
    /** Lines in their own voice, used as examples and as a console preview */
    samples?: string[];
    /** This character's own break phrasings, one per line. Empty means the station's own five */
    templates?: string;
    /** The station's own host: who presents when the broadcast on air names nobody. At most one per station. Was `active` until it was renamed, because a reader who had not read `PersonaRepository.presenting` reasonably took that to mean "on air", which it is not during a show that named its own host */
    defaultHost: boolean;
    /** Whether this character is the one writing breaks right now. Derived per request from the running order, falling back to `defaultHost`, through the one place that precedence lives (`PersonaRepository.presenting`). Never stored, so it cannot drift from what the director is actually doing */
    presenting: boolean;
}

export interface PersonaInput {
    /** A stable slug, unique per station. What a log line names and what a seeded persona is recognised by */
    key: string;
    /** What this character is FOR. `host` is the station's own voice; a `caller` phones in to a production, is cast per programme, and can never be put on air. Absent means `host`, so a form written before callers existed still means what it meant */
    kind?: 'host' | 'caller';
    label: string;
    /** Completes "You are …". Who they ARE; the sheet below carries how they talk */
    style: string;
    /** The name this character goes by on air, overriding the station's own while it is active */
    djName?: string;
    /** The station voice that speaks this persona, as the id a speech plugin maps. Empty means that plugin's default */
    voice?: string;
    /** The soundboard this character has to hand, as the name of a board in the pad library. Empty for a presenter who works without one. What reaches a model is the names of the pads on that board, never this word */
    soundboard?: string;
    /** The dialect: grammar and substitutions that apply to every sentence rather than to a subject */
    diction?: string[];
    /** Words whose presence proves the dialect survived. What a model's answer is checked against */
    dictionMarkers?: string[];
    /** What they always and never do on air */
    quirks?: string[];
    /** The standing subjects they keep coming back to. Exactly ONE reaches any one break, chosen by rotation, which is what makes a character sound like it has things on its mind rather than one thing */
    preoccupations?: string[];
    /** Signature phrases, asked for sparingly */
    catchphrases?: string[];
    /** Wording that breaks the character */
    avoid?: string[];
    /** Subjects this character takes one at a time. Each entry is ONE subject, written as the comma-separated words that mean it ("bigfoot, sasquatch, yeti"), and a break that brings up words from two of them is refused and written again. A word inside a record's title does not count */
    exclusiveSubjects?: string[];
    /** A couple of grounded facts they may self-reference */
    background?: string;
    /** How much this character says. Absent for the station's ordinary length; the rung above it is `latitude`, which is a different kind of thing rather than a longer one */
    brevity?: 'short' | 'one-line';
    /** How much room this character is given, above the station's ordinary discipline: a bigger word ceiling, a licence to follow the thought instead of making one point, and at `unleashed` no restraint on how it says it. Offered only by the ordinary talk break, always outranked by the station's content policy, and it switches off no refusal */
    latitude?: 'loose' | 'unleashed';
    /** How often this character talks, as a scale on the station's own interval between breaks. Absent is `ordinary`, which is that interval unchanged. The quietest rung is half as often and never silence: turning the station's breaks off is a station setting, and two switches for one thing can disagree */
    chattiness?: 'reserved' | 'sparing' | 'ordinary' | 'chatty' | 'relentless';
    /** How readily this character works one of its own stories into an ordinary talk break. Absent is `occasionally`, which offers one only where the station knows nothing about the records either side. The stories themselves are their own list, and a `story` band on the clock outranks this whatever it says */
    storytelling?: 'never' | 'occasionally' | 'often';
    /** Whether the nightly passes may write this character new material outright, or only ever propose it for you to accept. Absent is `proposes`, which is what every character does until somebody says otherwise. It reaches no prompt: the character is never told which it is */
    growth?: 'proposes' | 'self-directed';
    /** How much this character leans on what the station knows about a record. Absent is the station's ordinary break, where the notes are optional and two at most. At `keen` each record brings up to four, one each about the recording, its album and its artist before a second about any, and the break is built out of them with the room to tell one. Offered only by the ordinary talk break, and the grounding rules do not move: it may still say only what a note says */
    trivia?: 'keen';
    /** Lines in their own voice, used as examples and as a console preview */
    samples?: string[];
    /** This character's own break phrasings, one per line. Empty means the station's own five */
    templates?: string;
}

/**
 * A description of a character, in the operator's own words
 * generated from [PersonaRequest](../../../../../apps/api/data/contracts/personas/personas.types.ck#L42)
 */
export interface PersonaRequest {
    description: string;
}

/**
 * A persona as a form's contents rather than a row: no id and not on air, because nothing has been
 * saved. The console opens this in the editor and the operator saves it through POST /personas, which
 * is what keeps generating a way of filling in the form rather than a second writer of the table
 * generated from [PersonaDraftView](../../../../../apps/api/data/contracts/personas/personas.types.ck#L49)
 */
export interface PersonaDraftView {
    key: string;
    label: string;
    style: string;
    djName?: string;
    voice?: string;
    soundboard?: string;
    diction?: string[];
    dictionMarkers?: string[];
    quirks?: string[];
    preoccupations?: string[];
    catchphrases?: string[];
    avoid?: string[];
    exclusiveSubjects?: string[];
    background?: string;
    brevity?: 'short' | 'one-line';
    latitude?: 'loose' | 'unleashed';
    chattiness?: 'reserved' | 'sparing' | 'ordinary' | 'chatty' | 'relentless';
    storytelling?: 'never' | 'occasionally' | 'often';
    trivia?: 'keen';
    samples?: string[];
    templates?: string;
}

/**
 * One thing this character has accumulated that its sheet does not hold. Two kinds and they are two
 * different claims: `said` records something it actually put on air and carries the script as its
 * evidence, so it is a record and goes straight into use; `trait` infers who the character is
 * becoming, which nothing can verify, so a model's arrives `suggested` and the operator is the check
 * generated from [PersonaNote](../../../../../apps/api/data/contracts/personas/personas.types.ck#L85)
 */
export interface PersonaNote {
    id: string;
    /** `said` is what this character did, rendered beside the show's memory. `trait` is who it has become, rendered beside the sheet */
    kind: 'said' | 'trait';
    /** One sentence, because it shares a system turn with the grounding rules */
    note: string;
    /** `active` is carried into breaks. `rejected` outlives the pass that proposed it, or the same scripts propose it again forever */
    state: 'active' | 'suggested' | 'rejected';
    /** Who says so. `model` is the distil pass reading this character's own history back */
    origin: 'operator' | 'model';
    /** The attempt this was drawn from, while that row still exists. The nightly sweep takes it and the quote below stays */
    sourceScriptId?: string;
    /** The words that support it, as the station said them. What an operator actually accepts or rejects on, and required of anything a model wrote */
    sourceQuote?: string;
    /** When it was last carried into a break. Absent means never, which is what puts it at the front of the rotation */
    lastUsedAt?: string;
    createdAt: string;
}

export interface PersonaNoteInput {
    /** `said` is what this character did, rendered beside the show's memory. `trait` is who it has become, rendered beside the sheet */
    kind: 'said' | 'trait';
    /** One sentence, because it shares a system turn with the grounding rules */
    note: string;
}

/**
 * A note an operator is writing by hand. Always active and always theirs; a proposal is something only the distil pass creates
 * generated from [PersonaNoteWrite](../../../../../apps/api/data/contracts/personas/personas.types.ck#L102)
 */
export interface PersonaNoteWrite {
    kind: 'said' | 'trait';
    note: string;
}

/**
 * Accepting a proposal, turning one down, or taking a note out of use without losing it
 * generated from [PersonaNoteState](../../../../../apps/api/data/contracts/personas/personas.types.ck#L107)
 */
export interface PersonaNoteState {
    state: 'active' | 'suggested' | 'rejected';
}

/**
 * One thing a story has picked up since it was written. A row rather than a rewrite, so an invented clause can be turned down without losing the story
 * generated from [PersonaStoryDetail](../../../../../apps/api/data/contracts/personas/personas.types.ck#L130)
 */
export interface PersonaStoryDetail {
    id: string;
    detail: string;
    state: 'active' | 'suggested' | 'rejected';
    origin: 'operator' | 'model';
    source?: string;
    createdAt: string;
}

export interface PersonaStoryDetailInput {
    detail: string;
}

/**
 * A story an operator is writing by hand. Always active and always theirs; a proposal is something only the enrichment pass creates
 * generated from [PersonaStoryWrite](../../../../../apps/api/data/contracts/personas/personas.types.ck#L144)
 */
export interface PersonaStoryWrite {
    title: string;
    story: string;
    /** What sort of thing this is. Absent means `anecdote`, which is what every story written before arcs existed is */
    kind?: 'anecdote' | 'arc' | 'bit';
}

/**
 * One part of an arc, in the order it is told. A SCRIPT rather than a summary, because the floor speaks it as it stands
 * generated from [PersonaStoryBeat](../../../../../apps/api/data/contracts/personas/personas.types.ck#L150)
 */
export interface PersonaStoryBeat {
    id: string;
    storyId: string;
    /** Where it comes in the telling. Gaps are legal: inserting a part between two others must not mean renumbering the rest */
    ordinal: number;
    beat: string;
    state: 'active' | 'suggested' | 'rejected';
    origin: 'operator' | 'model';
    /** Where a proposal came from. Not evidence; see the note on a story's own source */
    source?: string;
    createdAt: string;
}

export interface PersonaStoryBeatInput {
    /** Where it comes in the telling. Gaps are legal: inserting a part between two others must not mean renumbering the rest */
    ordinal: number;
    beat: string;
}

/**
 * A part to add to an arc, or an edit to one
 * generated from [PersonaStoryBeatWrite](../../../../../apps/api/data/contracts/personas/personas.types.ck#L161)
 */
export interface PersonaStoryBeatWrite {
    ordinal: number;
    beat: string;
}

/**
 * One thing to add to a story that already exists
 * generated from [PersonaStoryDetailWrite](../../../../../apps/api/data/contracts/personas/personas.types.ck#L166)
 */
export interface PersonaStoryDetailWrite {
    detail: string;
}

/**
 * Accepting a proposal, turning one down, or taking a story out of the rotation without losing it
 * generated from [PersonaStoryState](../../../../../apps/api/data/contracts/personas/personas.types.ck#L170)
 */
export interface PersonaStoryState {
    state: 'active' | 'suggested' | 'rejected';
}

/**
 * One part of an arc, as a file carries it. No `origin` and no `source`, for the story's own reason
 * generated from [PersonaFileStoryBeat](../../../../../apps/api/data/contracts/personas/personas.types.ck#L206)
 */
export interface PersonaFileStoryBeat {
    ordinal: number;
    beat: string;
    /** Absent means `active`, exactly as a story's does */
    state?: 'active' | 'rejected';
}

/**
 * One thing a story picked up after it was written, carried the same way and for the same reasons
 * generated from [PersonaFileStoryDetail](../../../../../apps/api/data/contracts/personas/personas.types.ck#L212)
 */
export interface PersonaFileStoryDetail {
    detail: string;
    state?: 'active' | 'rejected';
}

/**
 * Something to know before pressing Import. Not a refusal: every one of these describes a state the
 * station can be in perfectly well, and the point of saying it is that each one is otherwise
 * discovered by putting the character on air
 * generated from [PersonaImportNotice](../../../../../apps/api/data/contracts/personas/personas.types.ck#L260)
 */
export interface PersonaImportNotice {
    /** Which sort, so a console can group or ignore by it rather than parsing the sentence */
    kind: 'format' | 'duplicate' | 'on-air' | 'clears' | 'voice' | 'soundboard' | 'phrasing' | 'markers';
    /** The whole of it, in the station's own words, because its destination is a person */
    message: string;
}

export interface PersonaImportNoticeInput {}

/**
 * One writer's turn at a rehearsal. Every writer asked is reported and not only the one that won: a
 * model that declined and a floor that covered for it are two facts, and the second on its own reads
 * as a station that never had a model configured
 * generated from [PersonaRehearsalAttempt](../../../../../apps/api/data/contracts/personas/personas.types.ck#L277)
 */
export interface PersonaRehearsalAttempt {
    /** Which binding was asked, as `segments.writer` would record it */
    writer: string;
    /** written, declined or failed. Declined is the station working; failed is something to go and fix */
    outcome: string;
    /** Kept for every writer rather than only a slow one: "the model got slower" can only be asked of numbers gathered before anybody suspected it */
    durationMs: number;
    /** What it produced, when it produced anything usable */
    script?: string;
    /** Why it did not, when it did not. A sentence, because its destination is a person */
    reason?: string;
}

/**
 * What an operator asks for when they put a character through a playlist. The playlist is READ at the
 * moment of asking and its records are stored on the run, so a list edited at the provider afterwards
 * does not change what was measured
 * generated from [PersonaAuditionRequest](../../../../../apps/api/data/contracts/personas/personas.types.ck#L299)
 */
export interface PersonaAuditionRequest {
    /** Which catalog plugin the playlist belongs to */
    pluginId: string;
    playlistId: string;
    /** What the playlist is called, kept as a caption for the run. The console already holds it, and a run whose playlist is later renamed or deleted stays readable */
    name?: string;
    /** How many breaks to write. One more record than this is taken off the playlist, since a break sits between two */
    limit?: number;
}

/**
 * Where the records came from. A snapshot of the name rather than a reference, so a playlist renamed
 * or deleted at the provider leaves a finished audition readable
 * generated from [PersonaAuditionSource](../../../../../apps/api/data/contracts/personas/personas.types.ck#L308)
 */
export interface PersonaAuditionSource {
    pluginId: string;
    playlistId: string;
    name?: string;
}

/**
 * One record, exactly as the writers were shown it
 * generated from [PersonaAuditionRecord](../../../../../apps/api/data/contracts/personas/personas.types.ck#L315)
 */
export interface PersonaAuditionRecord {
    title: string;
    /** The lead, as it should be read */
    artist: string;
    /** The catalog row, when the station holds this copy. Absent for a record it has never seen */
    trackId?: string;
    year?: number;
    album?: string;
    durationMs?: number;
}

/**
 * One time a character actually told one of its own stories. What the timeline lists, and what a
 * rollback is chosen from: the moment on each row is the exact string the station compares against,
 * not a rounding of it
 * generated from [PersonaTelling](../../../../../apps/api/data/contracts/personas/personas.types.ck#L365)
 */
export interface PersonaTelling {
    id: string;
    storyId: string;
    /** The handle of the story this told, so a timeline reads as something rather than as ids */
    title: string;
    /** What wrote it. `backfill` is the rows migration 0034 reconstructed from the two columns it replaced */
    source: 'break' | 'production' | 'backfill';
    /** Whether the story was handed over as something the writer MAY use, or as the thing the break was for */
    mode: 'offered' | 'told';
    /** Whether it actually went out, as the WRITER read its own answer back. An offered story may simply be ignored */
    told: boolean;
    /** The words that carried it, kept here because the script history they came from is swept nightly */
    said?: string;
    /** The break that carried it, while that row still exists */
    segmentId?: string;
    /** When a listener could first have heard it. Absent means written but not yet aired, or never aired at all */
    airedAt?: string;
    /** When it was written. Hand this back as `to` to roll back to just before it */
    at: string;
}

export interface PersonaTellingInput {}

/**
 * What a rollback would undo, or did. Counted with the same predicates the delete uses, so a preview
 * cannot promise one thing and do another
 * generated from [PersonaMemoryChange](../../../../../apps/api/data/contracts/personas/personas.types.ck#L385)
 */
export interface PersonaMemoryChange {
    /** Tellings forgotten. Every one, whatever wrote it: a telling is a record of something the station did rather than a claim somebody made */
    tellings: number;
    /** Notes the distil pass wrote. Nothing an operator typed is ever counted here or deleted */
    notes: number;
    /** Stories the enrichment pass proposed */
    stories: number;
    /** Details it proposed. A floor rather than a total: a story that is itself going takes every detail hung on it */
    details: number;
    /** How many of the above were proposals somebody turned down. Deleting one lets the nightly pass offer it again */
    rejected: number;
    /** How many the operator had since accepted or edited. They still go, and this is the one loss they did not cause */
    touched: number;
}

/**
 * Undo what this character accumulated on its own
 * generated from [PersonaMemoryRollback](../../../../../apps/api/data/contracts/personas/personas.types.ck#L394)
 */
export interface PersonaMemoryRollback {
    /** The moment to go back to, as a timeline row reports it. Absent means all of it, which is a reset */
    to?: string;
    /** Also drag the distil pass's watermark back, so it reads that window again. Right for testing and wrong for undoing a character that drifted, so it is asked for rather than assumed */
    relearn?: boolean;
}

/**
 * generated from [PersonaList](../../../../../apps/api/data/contracts/personas/personas.types.ck#L37)
 */
export interface PersonaList {
    personas: Persona[];
}

export interface PersonaListInput {
    personas: PersonaInput[];
}

/**
 * One character's whole notebook, oldest first, in every state
 * generated from [PersonaNoteList](../../../../../apps/api/data/contracts/personas/personas.types.ck#L97)
 */
export interface PersonaNoteList {
    personaId: string;
    notes: PersonaNote[];
}

export interface PersonaNoteListInput {
    personaId: string;
    notes: PersonaNoteInput[];
}

/**
 * What a model wrote, and what had to be dropped to make it usable
 * generated from [GeneratedPersona](../../../../../apps/api/data/contracts/personas/personas.types.ck#L74)
 */
export interface GeneratedPersona {
    persona: PersonaDraftView;
    /** A couple of things that have happened to this character. Beside the form rather than in it, because they are their own table: the console saves the persona and then writes these through the stories route, so they go through the same validation an operator's own typing does */
    stories: PersonaStoryWrite[];
    /** Words the model called markers that its own sample lines never used. Dropped, because the samples are the evidence and the marker list is the claim — a marker nothing says declines every break and looks exactly like a model that is switched off */
    droppedMarkers: string[];
    /** Phrasings naming a value the vocabulary does not have. Dropped by the LINE, since five good phrasings and one broken one is five phrasings */
    droppedTemplates: string[];
}

/**
 * Something that happened to this character, in its own telling. Not a claim about the world and never
 * checked as one: `source` says where a proposal came from, for the operator reading it, and nothing
 * downstream reads it as evidence — see `persona.story.ts` for why that is the load-bearing difference
 * from a fact
 * generated from [PersonaStory](../../../../../apps/api/data/contracts/personas/personas.types.ck#L115)
 */
export interface PersonaStory {
    id: string;
    /** A short handle. Never spoken; what this list is read by and what a proposal names */
    title: string;
    /** The telling itself, in the character's voice. Already speakable, because the floor reads it as it stands */
    story: string;
    /** `active` can be told. `rejected` outlives the pass that proposed it, or the same catalogue proposes it forever */
    state: 'active' | 'suggested' | 'rejected';
    /** Who says so. `model` is the enrichment pass writing from what the station already holds */
    origin: 'operator' | 'model';
    /** Where a proposal came from, in the station's own words. Absent for anything an operator wrote */
    source?: string;
    /** An `anecdote` is told whole, an `arc` a part at a time, a `bit` is a running joke with no end */
    kind: 'anecdote' | 'arc' | 'bit';
    /** What it has picked up since, in every state */
    details: PersonaStoryDetail[];
    /** The parts an arc is told in, in order and in every state. Empty for the other two kinds */
    beats: PersonaStoryBeat[];
    /** Absent means never told, which is what puts it at the front of the rotation */
    lastToldAt?: string;
    /** How often it has gone out, which changes how the model is asked to tell it */
    timesTold: number;
    createdAt: string;
}

export interface PersonaStoryInput {
    /** A short handle. Never spoken; what this list is read by and what a proposal names */
    title: string;
    /** The telling itself, in the character's voice. Already speakable, because the floor reads it as it stands */
    story: string;
}

/**
 * Something that happened to this character, as a file carries it. No `origin` and no `source`,
 * unlike the stored row: whoever exported this stood behind every story in it, so on the far side
 * they are the receiving operator's own, and a sentence about where a proposal came from names a
 * catalogue that station does not have
 * generated from [PersonaFileStory](../../../../../apps/api/data/contracts/personas/personas.types.ck#L196)
 */
export interface PersonaFileStory {
    title: string;
    story: string;
    /** Absent means `anecdote`. What sort of thing this is travels because it is part of what the story IS, not part of what this station has done with it */
    kind?: 'anecdote' | 'arc' | 'bit';
    /** Absent means `active`. A turned-down story travels so the enrichment pass does not propose it again on the far side; an undecided one does not travel at all, because nobody has decided it yet */
    state?: 'active' | 'rejected';
    details: PersonaFileStoryDetail[];
    /** The parts an arc is told in, in order. Empty for the other two kinds */
    beats: PersonaFileStoryBeat[];
}

/**
 * One character in a file, and what would become of it here
 * generated from [PersonaImportEntry](../../../../../apps/api/data/contracts/personas/personas.types.ck#L231)
 */
export interface PersonaImportEntry {
    /** What identifies this character across two installs */
    key: string;
    label: string;
    kind?: 'host' | 'caller';
    /** Whether this station holds a character under this key already. An update rewrites the sheet and adds stories; it never deletes one the operator here wrote */
    outcome: 'create' | 'update';
    storiesNew: number;
    /** Already here under the same handle, so importing would skip them */
    storiesHeld: number;
    detailsNew: number;
    detailsHeld: number;
    notices: PersonaImportNotice[];
}

export interface PersonaImportEntryInput {}

/**
 * What a persona says when it is asked for a break it will never air
 * generated from [PersonaRehearsal](../../../../../apps/api/data/contracts/personas/personas.types.ck#L286)
 */
export interface PersonaRehearsal {
    personaId: string;
    /** The invented record the break follows. Fixed, so two readings of the same sheet can be compared */
    previous: string;
    /** The invented record it leads into */
    next: string;
    attempts: PersonaRehearsalAttempt[];
    /** The words a listener would have heard, from whichever writer answered first */
    script?: string;
    /** Which one that was. Present exactly when `script` is */
    writer?: string;
    /** Why there are no words, when every writer had nothing. Not a fault: a break nothing could write is one the station does not take */
    reason?: string;
}

/**
 * A run of one character over one playlist, without its breaks: what a list draws
 * generated from [PersonaAuditionSummary](../../../../../apps/api/data/contracts/personas/personas.types.ck#L339)
 */
export interface PersonaAuditionSummary {
    id: string;
    personaId: string;
    /** The character's own key, as `script_history` records it */
    personaKey: string;
    source: PersonaAuditionSource;
    /** `cancelled` keeps whatever breaks were already written */
    state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
    /** How many breaks this run writes in total */
    transitions: number;
    /** How many it has written so far, which is how far along it is */
    written: number;
    /** Why writing it stopped, when it did */
    error?: string;
    /** ISO-8601 */
    cancelledAt?: string;
    /** ISO-8601, whichever way the run ended */
    finishedAt?: string;
    /** ISO-8601 */
    createdAt: string;
}

/**
 * One transition, and everything the writers said about it. Every writer asked is reported and not
 * only the one that won, on the rehearsal's own argument: a model that declined and a floor that
 * covered for it are two facts
 * generated from [PersonaAuditionBreak](../../../../../apps/api/data/contracts/personas/personas.types.ck#L327)
 */
export interface PersonaAuditionBreak {
    /** Which transition, from 0 */
    ordinal: number;
    /** The record this break follows */
    previous: PersonaAuditionRecord;
    /** The one it leads into */
    next: PersonaAuditionRecord;
    attempts: PersonaRehearsalAttempt[];
    /** The words a listener would have heard, from whichever writer answered first */
    script?: string;
    /** Which one that was. Present exactly when `script` is */
    writer?: string;
    /** Why there are none, when every writer had nothing. On air this break is skipped */
    reason?: string;
    /** Whether the writer's read-back found the story this break was handed. Absent means it carried none, which is most of them. On air this is what decides whether a story in parts owes the next one, so a run is how you check the reading is right before trusting an arc to it */
    told?: boolean;
}

/**
 * What one character has told, newest first
 * generated from [PersonaMemoryTimeline](../../../../../apps/api/data/contracts/personas/personas.types.ck#L378)
 */
export interface PersonaMemoryTimeline {
    personaId: string;
    tellings: PersonaTelling[];
}

export interface PersonaMemoryTimelineInput {
    personaId: string;
    tellings: PersonaTellingInput[];
}

/**
 * What was undone, and where the timeline stands now
 * generated from [PersonaMemory](../../../../../apps/api/data/contracts/personas/personas.types.ck#L399)
 */
export interface PersonaMemory {
    personaId: string;
    undone: PersonaMemoryChange;
    tellings: PersonaTelling[];
}

export interface PersonaMemoryInput {
    personaId: string;
    undone: PersonaMemoryChange;
    tellings: PersonaTellingInput[];
}

/**
 * Every story one character holds, oldest first, in every state
 * generated from [PersonaStoryList](../../../../../apps/api/data/contracts/personas/personas.types.ck#L139)
 */
export interface PersonaStoryList {
    personaId: string;
    stories: PersonaStory[];
}

export interface PersonaStoryListInput {
    personaId: string;
    stories: PersonaStoryInput[];
}

/**
 * One character in a file. `PersonaDraftView` is the sheet with no id and not on air, which is
 * exactly what travels, plus the two fields a model is deliberately not asked for and a real install
 * always knows: what the character is FOR, and which rack it has to hand
 * generated from [PersonaFilePersona](../../../../../apps/api/data/contracts/personas/personas.types.ck#L186)
 */
export interface PersonaFilePersona extends Omit<PersonaDraftView, 'soundboard'> {
    /** Absent means `host`, as everywhere else */
    kind?: 'host' | 'caller';
    /** The board this character reaches for. Carried even though the receiving station may not hold it: a persona naming a rack that does not exist and one with no rack are the same state, and the import says which it got */
    soundboard?: string;
    stories: PersonaFileStory[];
}

/**
 * What importing a file WOULD do, worked out against this station and written nowhere.
 *
 * The same code the import itself runs, so what this reports is what will happen rather than a second
 * opinion about it. It answers two questions an operator cannot get from the file alone: which
 * characters are new here and which would be rewritten, and what this station cannot honour about them
 * generated from [PersonaImportPlan](../../../../../apps/api/data/contracts/personas/personas.types.ck#L222)
 */
export interface PersonaImportPlan {
    /** What the file said it was. Reported rather than enforced: this repo edits migrations in place, so a version stamp cannot promise a shape, and the shapes are what was actually validated */
    format: string;
    /** The station it was taken from, when it said */
    station?: string;
    /** When it was taken, when it said */
    takenAt?: string;
    /** About the FILE rather than any one character in it */
    notices: PersonaImportNotice[];
    personas: PersonaImportEntry[];
}

export interface PersonaImportPlanInput {}

/**
 * generated from [PersonaAuditionList](../../../../../apps/api/data/contracts/personas/personas.types.ck#L358)
 */
export interface PersonaAuditionList {
    auditions: PersonaAuditionSummary[];
}

/**
 * The same run with every break it has written so far, in order
 * generated from [PersonaAudition](../../../../../apps/api/data/contracts/personas/personas.types.ck#L354)
 */
export interface PersonaAudition extends PersonaAuditionSummary {
    breaks: PersonaAuditionBreak[];
}

/**
 * A character as a file: everything somebody would have to send to put this presenter on another
 * station, and nothing that belongs to the station it came from
 * generated from [PersonaFile](../../../../../apps/api/data/contracts/personas/personas.types.ck#L176)
 */
export interface PersonaFile {
    /** What shape this is, so a file from a later build says so rather than being read wrongly. The shapes below are what an import actually validates; this is for the human reading the failure */
    format: string;
    /** When it was exported, ISO-8601 */
    takenAt: string;
    /** The station it was taken from. Provenance only: an import writes into whichever station it is running as, and the two need not match */
    station?: string;
    personas: PersonaFilePersona[];
}

/**
 * What importing actually did, with the plan it did it from.
 *
 * All or nothing: a file whose import failed part-way leaves the station exactly as it was, on
 * `PUT /settings`' own rule. The preview is what stands between an operator and a surprise, so a
 * partial landing would be the one outcome nothing had described
 * generated from [PersonaImportResult](../../../../../apps/api/data/contracts/personas/personas.types.ck#L248)
 */
export interface PersonaImportResult {
    /** What it decided to do, notices and all, so the answer carries its own explanation */
    plan: PersonaImportPlan;
    created: number;
    /** Characters whose sheet was rewritten. An update replaces the sheet and ADDS stories; it never deletes one the operator here wrote */
    updated: number;
    storiesWritten: number;
    detailsWritten: number;
    /** The roster as it now stands, on this file's own rule: every mutation answers the whole list, because more than the named row can change */
    personas: PersonaList;
}

export interface PersonaImportResultInput {}
