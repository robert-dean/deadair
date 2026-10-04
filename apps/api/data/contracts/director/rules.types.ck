options {
    keys: {
        area: director
    }
}

# A never-play rule: a KIND of record the station must not play. Absolute, like a dislike, and
# exclude-only: there is no "only these" rule, because one could leave the station nothing to play.
# Every scope is optional and an absent one means "always"
contract BlockRule: {
    id: readonly uuid
    field: enum(genre, tag) # `genre` refuses any record tagged with this genre or a kind of it (`Punk Rock` under `Punk`, never `Pop` under `Pop Punk`, never `Trap` under `Rap`). `tag` refuses a record carrying exactly this tag
    value: string(min=1, max=200) # The genre or tag, as you would write it
    seasonFrom?: string(min=5, max=5) # First day it holds, as `MM-DD`. With `seasonTo`; a season starting after it ends wraps the year end
    seasonTo?: string(min=5, max=5) # Last day it holds, as `MM-DD`
    fromHour?: int(min=0, max=23) # First hour of the station's day it holds. With `untilHour`; a window starting after it ends wraps midnight
    untilHour?: int(min=0, max=24) # The hour it stops holding, exclusive
    modes?: array(enum(rotation, setlist, feature)) # Only while the station is in one of these modes. Absent or empty means every mode
    slotIds?: array(string(min=1, max=100)) # Only during these schedule blocks. Absent or empty means whatever is on
    endsAt?: datetime # When it stops holding. Absent means until it is removed
    inForce: readonly boolean # Whether it holds right now, on the station's clock, for what is on air
}

# Every rule on the station, newest first
contract BlockRuleList: {
    rules: array(BlockRule)
}

# A lean toward some genres for a while. The opposite of a rule: the station favours them when it
# chooses records, and still plays anything else rather than run dry
contract GenreSteer: {
    genres: array(string(min=1, max=100), min=1, max=20) # What to favour, as genres. A record tagged with any of them, or a kind of one, is preferred
    endsAt: datetime # When the station goes back to choosing as it ordinarily does
}

# The lean in force, or none
contract GenreSteerReading: {
    steer?: GenreSteer # Absent when nothing is leaning the station, including once one has run out
}

# Lean the station toward some genres for a number of hours
contract GenreSteerInput: {
    genres: array(string(min=1, max=100), min=1, max=20)
    hours: int(min=1, max=24) # How long it lasts, from now
}
