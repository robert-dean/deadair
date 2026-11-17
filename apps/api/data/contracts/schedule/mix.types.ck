options {
    keys: {
        area: schedule
    }
}

# A show's mix flow: nodes and the wires between them, as the console's canvas draws them. Records enter at the one `picks` node and leave at the one `onAir` node; a record the station proposes is followed down the wires, and the first node that holds it (a `block`, or a limit it would take past its amount) keeps it off the air. `require` nodes add a record when they fall due. A record a listener asked for, and what follows it, is never judged and never counted
contract MixFlow: {
    version: int(min=1, max=1) # The shape of this document. 1
    nodes: array(MixNode, max=64)
    links: array(MixLink, max=128) # The wires
}

# A wire from one node's output to another node's input, by socket number from 0
contract MixLink: {
    from: string(min=1, max=40) # The node the wire leaves
    out: int(min=0, max=9) # Which of its outputs: 0 for every node but a `split`, whose outputs are its branches in order and then "everything else". Each output takes one wire, and every record output has to lead somewhere: a loose one would drop records without a word
    to: string(min=1, max=40) # The node the wire enters
    in: int(min=0, max=9) # Which of its inputs: 0 is records for every node but `merge`, whose four inputs are 0 to 3 and take as many wires as reach them; a `limitShare`'s input 1 takes a number, from a `timeSwitch`, in place of its own `percent`
}

# One node on the canvas. `kind` says what it is and which of the fields beside it count
contract MixNode: {
    id: string(min=1, max=40) # Unique in the flow
    kind: enum(picks, onAir, block, split, limitShare, limitCount, noRepeat, merge, require, timeSwitch) # `picks` is what the station proposes and `onAir` what may air. `block` keeps the named bands off. `split` sends each record down the first branch it matches. `limitShare` and `limitCount` hold records past an amount of what has passed through them. `noRepeat` holds a record when the last record aired also passed through it. `merge` joins wires. `require` adds a record when due. `timeSwitch` is a number that changes at an hour
    bands?: array(string(min=1, max=200), max=50) # `block`: the bands it keeps off, matched by name, ignoring case
    splitBy?: enum(genre, artist, decade, hour, showProgress, lastGenre, judged) # `split`: what it reads. `genre` is the band's main genre, which matches a branch's value or anything that refines it, so "black metal" takes "Norwegian black metal". `hour` and `showProgress` (a percent of the show) match a branch's range. `judged` is the model's stored answer to `question`, yes or no, asked once per record and kept; a record not answered yet is held at the split and waits a refill while the model is asked
    branches?: array(MixBranch, max=8) # `split`: its outputs in order, before the last output, "everything else"
    question?: string(min=1, max=200) # `split` by `judged`: what the model is asked about each record, once
    percent?: number(min=0, max=100) # `limitShare`: at most this percent of the counted records in each `per` may pass through it. A number wired into its input 1 wins over this
    count?: int(min=0, max=1000) # `limitCount`: at most this many records in each `per` may pass through it
    per?: enum(show, hour) # `limitShare` and `limitCount`: what the amount is counted over. Absent is `show`
    requireGenres?: array(string(min=1, max=100), max=4) # `require`: the main genres that satisfy it
    requireMode?: enum(any, each) # `require`: `any` is due until one record of any of `requireGenres` has aired in the show, `each` until one of each has. Absent is `any`
    songs?: array(MixSong, max=20) # `require`: the records it adds, the one aired longest ago first. Absent or empty adds a library record of a required genre
    afterPercent?: number(min=0, max=100) # `require`: not due before this percent of the show has gone. Absent is 0
    fromHour?: int(min=0, max=23) # `timeSwitch`: the hour on the station's clock it changes at
    thenValue?: number(min=0, max=1000) # `timeSwitch`: its value from `fromHour` to the end of the show
    elseValue?: number(min=0, max=1000) # `timeSwitch`: its value before `fromHour`
    fromBrief?: string(max=200) # The phrase of the brief this node was drafted from, shown on the canvas. Nothing reads it
    x?: number # Where the canvas draws it. Nothing else reads it
    y?: number
}

# One output of a `split`
contract MixBranch: {
    values?: array(string(min=1, max=200), max=20) # What it matches, for `genre`, `lastGenre` (a genre or anything refining it), `artist` and `judged` (`yes` or `no`); a decade as `1980`
    min?: number(min=0, max=100) # The lowest it matches, for `hour` and `showProgress`, inclusive
    max?: number(min=0, max=100) # The highest, exclusive
}

# A record a `require` node may add
contract MixSong: {
    title: string(min=1, max=500)
    artist: string(min=1, max=500) # Who made it: a record is found by title and artist together
}

# What a show's mix flow is drafted from: the show's brief as the operator has it now, saved or not, and any answers to the questions an earlier draft asked
contract MixFlowDraftRequest: {
    brief: string(min=1, max=500) # The show's brief, in the operator's own words
    answers?: array(MixDraftAnswer, max=10) # Answers to the questions an earlier draft of the same brief asked, so the next one can settle them
}

# One answer to a question a draft asked
contract MixDraftAnswer: {
    question: string(min=1, max=300) # The question, as the draft asked it
    answer: string(min=1, max=200) # What the operator chose or wrote
}

# A mix flow the station's model drafted from a brief, and what it made of each phrase. Nothing is saved: the operator looks it over on the canvas and saves it with the show as usual
contract MixFlowDraft: {
    flow: MixFlow # The drafted flow, laid out for the canvas. It passes the same check a saved flow does
    readings: array(MixDraftReading, max=40) # Each phrase of the brief the model read, and what became of it
    model?: string # The model that drafted it
}

# One phrase of a brief and what the draft made of it
contract MixDraftReading: {
    quote: string(max=200) # The phrase, as the brief has it
    note: string(max=300) # What it became, in plain words, or why it became nothing
    nodeIds?: array(string(min=1, max=40), max=8) # The nodes drawn from it. Absent for a phrase about taste, which is left to the picks
    question?: string(max=300) # Asked when the phrase could mean more than one thing. The draft made its best guess, and answering redrafts it
    options?: array(string(min=1, max=200), max=6) # Answers to offer for `question`
}
