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
    /** What it matches, for `genre`, `artist`, `mood`, `lastGenre` (a genre or anything refining it) and `judged` (`yes` or `no`); a decade as `1980` */
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
    artist?: string;
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
    splitBy?: 'genre' | 'artist' | 'decade' | 'mood' | 'hour' | 'showProgress' | 'lastGenre' | 'judged';
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
    /** `require`: the records it adds, freshest first. Absent or empty adds a library record of a required genre */
    songs?: MixSong[];
    /** `require`: not due before this percent of the show has gone. Absent is 0 */
    afterPercent?: number;
    /** `timeSwitch`: the hour on the station's clock it changes at */
    fromHour?: number;
    /** `timeSwitch`: its value from `fromHour` to the end of the show */
    thenValue?: number;
    /** `timeSwitch`: its value before `fromHour` */
    elseValue?: number;
    /** The phrase of the brief this node was drafted from, shown on the canvas. Nothing reads it */
    fromBrief?: string;
    /** Where the canvas draws it. Nothing else reads it */
    x?: number;
    y?: number;
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
