options {
    keys: {
        area: director
    }
}

# A kind of break you write yourself: a brief in prose, and what the presenter is shown while writing one
contract BreakKind: {
    id: readonly string(min=1, max=100)
    key: string(min=1, max=60, regex=/^[a-z0-9]+(-[a-z0-9]+)*$/) # The kind, as a band on the format clock names it: lowercase words joined by hyphens. Fixed once the kind is created, because every band and every break it ever planted carries it
    name: string(min=1, max=200) # What the console calls it. Never read out
    brief: string(min=1, max=4000) # What this kind of break is for and when to say nothing, written as an instruction to the presenter. The station's own rules for every break still apply on top of it
    rules: array(string(min=1, max=500), max=20) # Anything this kind owes beyond the rules every break owes, one per entry. Added to those rules, never in place of them
    showsPrevious: boolean # Whether the presenter is shown the record that has just finished
    showsPlayed: boolean # Whether the presenter is shown the rest of this broadcast's records, to refer back to
    showsFacts: boolean # Whether the records shown carry the notes the station holds about them
    showsNotebook: boolean # Whether the presenter is shown their own notebook
    enabled: boolean # Whether the station writes this kind at all. A new or imported kind is off until you switch it on
    position: int(min=0) # Your own order, for the list
}

contract BreakKindList: {
    kinds: array(BreakKind)
}

# Kinds of break as a file, to move between stations. No id, no place in a list and no switch: a kind arrives switched off wherever it lands, so it is read back before it airs
contract BreakKindFile: {
    format: string(min=1, max=50) # What shape this is, so a file from a later build says so rather than being read wrongly
    takenAt: string(min=1, max=40) # When it was exported, ISO-8601
    station?: string(max=100) # The station it was taken from. Provenance only
    kinds: array(BreakKindFileKind, max=200)
}

# One kind of break in a file: everything that says what it is, and nothing about how this station has it set
contract BreakKindFileKind: {
    key: string(min=1, max=60, regex=/^[a-z0-9]+(-[a-z0-9]+)*$/) # What identifies the kind across two stations, and what a band on the format clock names
    name: string(min=1, max=200)
    brief: string(min=1, max=4000)
    rules: array(string(min=1, max=500), max=20)
    showsPrevious: boolean
    showsPlayed: boolean
    showsFacts: boolean
    showsNotebook: boolean
}

# What importing a file WOULD do here, worked out by the same code the import runs and written nowhere
contract BreakKindImportPlan: {
    format: readonly string(min=1, max=50) # What the file said it was
    station?: readonly string(max=100) # The station it was taken from, when it said
    takenAt?: readonly string(max=40) # When it was taken, when it said
    notices: readonly array(BreakKindImportNotice) # About the file rather than any one kind in it
    kinds: readonly array(BreakKindImportEntry)
}

# One kind in a file, and what would become of it here
contract BreakKindImportEntry: {
    key: readonly string(min=1, max=60)
    name: readonly string(min=1, max=200)
    outcome: readonly enum(create, update, skip, refuse) # New here; already here and named in `replace`, so rewritten; already here and left alone; or a key this station uses for a break of its own, which no file can take
    notices: readonly array(BreakKindImportNotice)
}

# Something to know before pressing Import
contract BreakKindImportNotice: {
    kind: readonly enum(format, duplicate, switched-off, refused) # Which sort, so a console can group by it rather than parsing the sentence
    message: readonly string(min=1, max=500) # The whole of it, in the station's own words
}

# What importing did, with the plan it did it from. All or nothing
contract BreakKindImportResult: {
    plan: readonly BreakKindImportPlan
    created: readonly int(min=0)
    updated: readonly int(min=0) # Kinds rewritten from the file, and switched off until read back
    skipped: readonly int(min=0) # Kinds this station already held and was not asked to replace, or could not take
    kinds: readonly array(BreakKind) # The list as it now stands
}
