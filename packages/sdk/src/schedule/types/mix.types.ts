/**
 * A wire from one node's output to another node's input, by socket number from 0
 * generated from [MixLink](../../../../../apps/api/data/contracts/schedule/mix.types.ck)
 */
export interface MixLink {
    /** The node the wire leaves */
    from: string;
    /** Which of its outputs: 0 for every node but a `split`, whose outputs are its branches in order and then "everything else". Each output takes one wire, and every record output has to lead somewhere: a loose one would drop records without a word */
    out: number;
    /** The node the wire enters */
    to: string;
    /** Which of its inputs: 0 is records for every node but `merge`, whose four inputs are 0 to 3 and take as many wires as reach them; a `limitShare`'s input 1 takes a number, from a `timeSwitch`, in place of its own `percent` */
    in: number;
}

/**
 * One output of a `split`
 * generated from [MixBranch](../../../../../apps/api/data/contracts/schedule/mix.types.ck)
 */
export interface MixBranch {
    /** What it matches, for `genre`, `lastGenre` (a genre or anything refining it), `artist` and `judged` (`yes` or `no`); a decade as `1980` */
    values?: string[];
    /** The lowest it matches, for `hour` and `showProgress`, inclusive */
    min?: number;
    /** The highest, exclusive */
    max?: number;
}

/**
 * A record a `require` node may add
 * generated from [MixSong](../../../../../apps/api/data/contracts/schedule/mix.types.ck)
 */
export interface MixSong {
    title: string;
    /** Who made it: a record is found by title and artist together */
    artist: string;
}

/**
 * One answer to a question a draft asked
 * generated from [MixDraftAnswer](../../../../../apps/api/data/contracts/schedule/mix.types.ck)
 */
export interface MixDraftAnswer {
    /** The question, as the draft asked it */
    question: string;
    /** What the operator chose or wrote */
    answer: string;
}

/**
 * One phrase of a brief and what the draft made of it
 * generated from [MixDraftReading](../../../../../apps/api/data/contracts/schedule/mix.types.ck)
 */
export interface MixDraftReading {
    /** The phrase, as the brief has it */
    quote: string;
    /** What it became, in plain words, or why it became nothing */
    note: string;
    /** The nodes drawn from it. Absent for a phrase about taste, which is left to the picks */
    nodeIds?: string[];
    /** Asked when the phrase could mean more than one thing. The draft made its best guess, and answering redrafts it */
    question?: string;
    /** Answers to offer for `question` */
    options?: string[];
}

/**
 * One node on the canvas. `kind` says what it is and which of the fields beside it count
 * generated from [MixNode](../../../../../apps/api/data/contracts/schedule/mix.types.ck)
 */
export interface MixNode {
    /** Unique in the flow */
    id: string;
    /** `picks` is what the station proposes and `onAir` what may air. `block` keeps the named bands off. `split` sends each record down the first branch it matches. `limitShare` and `limitCount` hold records past an amount of what has passed through them. `noRepeat` holds a record when the last record aired also passed through it. `merge` joins wires. `require` adds a record when due. `timeSwitch` is a number that changes at an hour */
    kind: 'picks' | 'onAir' | 'block' | 'split' | 'limitShare' | 'limitCount' | 'noRepeat' | 'merge' | 'require' | 'timeSwitch';
    /** `block`: the bands it keeps off, matched by name, ignoring case */
    bands?: string[];
    /** `split`: what it reads. `genre` is the band's main genre, which matches a branch's value or anything that refines it, so "black metal" takes "Norwegian black metal". `hour` and `showProgress` (a percent of the show) match a branch's range. `judged` is the model's stored answer to `question`, yes or no, asked once per record and kept; a record not answered yet is held at the split and waits a refill while the model is asked */
    splitBy?: 'genre' | 'artist' | 'decade' | 'hour' | 'showProgress' | 'lastGenre' | 'judged';
    /** `split`: its outputs in order, before the last output, "everything else" */
    branches?: MixBranch[];
    /** `split` by `judged`: what the model is asked about each record, once */
    question?: string;
    /** `limitShare`: at most this percent of the counted records in each `per` may pass through it. A number wired into its input 1 wins over this */
    percent?: number;
    /** `limitCount`: at most this many records in each `per` may pass through it */
    count?: number;
    /** `limitShare` and `limitCount`: what the amount is counted over. Absent is `show` */
    per?: 'show' | 'hour';
    /** `require`: the main genres that satisfy it */
    requireGenres?: string[];
    /** `require`: `any` is due until one record of any of `requireGenres` has aired in the show, `each` until one of each has. Absent is `any` */
    requireMode?: 'any' | 'each';
    /** `require`: the records it adds, the one aired longest ago first. Absent or empty adds a library record of a required genre */
    songs?: MixSong[];
    /** `require`: not due before this percent of the show has gone. Absent is 0 */
    afterPercent?: number;
    /** `timeSwitch`: the hour on the station's clock it changes at */
    fromHour?: number;
    /** `timeSwitch`: its value from `fromHour` to the end of the show */
    thenValue?: number;
    /** `timeSwitch`: its value before `fromHour` */
    elseValue?: number;
    /** Switched off without being taken out: it judges nothing, counts nothing and tells the model nothing, and its wires still have to be whole. A Block, a limit or No two in a row lets every record through, a Split sends every record down "everything else", a Require never falls due and a Time switch leaves its limit on its own `percent`. Picks, On air and Merge cannot be bypassed. Absent is no */
    bypassed?: boolean;
    /** The phrase of the brief this node was drafted from, shown on the canvas. Nothing reads it */
    fromBrief?: string;
    /** Where the canvas draws it. Nothing else reads it */
    x?: number;
    y?: number;
}

/**
 * What a show's mix flow is drafted from: the show's brief as the operator has it now, saved or not, and any answers to the questions an earlier draft asked
 * generated from [MixFlowDraftRequest](../../../../../apps/api/data/contracts/schedule/mix.types.ck)
 */
export interface MixFlowDraftRequest {
    /** The show's brief, in the operator's own words */
    brief: string;
    /** Answers to the questions an earlier draft of the same brief asked, so the next one can settle them */
    answers?: MixDraftAnswer[];
}

/**
 * A show's mix flow: nodes and the wires between them, as the console's canvas draws them. Records enter at the one `picks` node and leave at the one `onAir` node; a record the station proposes is followed down the wires, and the first node that holds it (a `block`, or a limit it would take past its amount) keeps it off the air. `require` nodes add a record when they fall due. A record a listener asked for, and what follows it, is never judged and never counted
 * generated from [MixFlow](../../../../../apps/api/data/contracts/schedule/mix.types.ck)
 */
export interface MixFlow {
    /** The shape of this document. 1 */
    version: number;
    nodes: MixNode[];
    /** The wires */
    links: MixLink[];
}

/**
 * A mix flow the station's model drafted from a brief, and what it made of each phrase. Nothing is saved: the operator looks it over on the canvas and saves it with the show as usual
 * generated from [MixFlowDraft](../../../../../apps/api/data/contracts/schedule/mix.types.ck)
 */
export interface MixFlowDraft {
    /** The drafted flow, laid out for the canvas. It passes the same check a saved flow does */
    flow: MixFlow;
    /** Each phrase of the brief the model read, and what became of it */
    readings: MixDraftReading[];
    /** The model that drafted it */
    model?: string;
}
