options {
    keys: {
        area: topics
    }
}

# What a break can be about: a news category, and later a weather location. The operator's own vocabulary, per sort of break
contract Topic: {
    id: readonly string(min=1, max=100)
    kind: string(min=1, max=100) # Which sort of break this is a subject for, as `segments.kind` spells it
    key: string(min=1, max=100) # A stable slug, unique within its kind. What the format clock points a band at and what a seeded topic is recognised by
    label: string(min=1, max=200) # What a break calls it out loud, so it is the phrasing you would want to hear
    config: record(string, unknown) # This sort of break's own settings for this subject, in the fields its kind declares. Nothing generic reads them
    position: int(min=0) # Your own order, for the list. Two subjects never contest anything, so it means nothing else
}

contract TopicList: {
    topics: array(Topic)
}

# A sort of break that has subjects at all, and how one of its subjects is edited. `ConfigFieldDescriptor` is the plugins area's, shared for the reason a station setting shares it: one form component renders them all
contract TopicKindDescriptor: {
    kind: string(min=1, max=100)
    nounOne: string(min=1, max=100) # What to call one of these: a news subject is a category and a weather subject is a location
    nounMany: string(min=1, max=100)
    description: string(max=2000)
    fields: array(ConfigFieldDescriptor)
}

contract TopicKindList: {
    kinds: array(TopicKindDescriptor)
}

contract TopicQuery: {
    kind?: string(max=100) # One sort of break, or absent for every subject this station has named
}

# One subject in a file. Nothing about the station it came from: no id, and no place in a list
contract TopicPackRow: {
    kind: string(min=1, max=100) # Which sort of break this is a subject for
    key: string(min=1, max=100) # What identifies it within its kind, here and on the station it came from
    label: string(min=1, max=200) # What a break calls it out loud
    config?: record(string, unknown) # This sort of break's own settings for this subject
}

# A station's subjects as one file, to hand to another station. Each entry is read as a `TopicPackRow`
# when it is imported, so one a station cannot use is reported rather than refusing the file
contract TopicPack: {
    format: literal("deadair.topics") # Says the file is a topics file
    version: int(min=1) # The version of the document's shape. This station reads version 1
    name: string(min=1, max=100) # What the file is, as whoever made it would describe it
    topics: array(record(string, unknown), max=1000)
}

# An entry in a file that importing it would leave out, and why
contract PackImportDropped: {
    entry: readonly int(min=1) # Which entry in the file, counting from 1
    words?: readonly string # What the entry calls itself, when it does
    reason: readonly string # Why the station cannot use it
}

# Something to know about a file that does not stop it being imported, in the station's own sentence
contract PackImportNotice: {
    kind: readonly string # What sort of notice, for a caller that treats one differently
    message: readonly string
}

# What importing a file would do. The preview and the import reach it the same way, so what an operator was shown is what happens
contract PackImportPlan: {
    name: readonly string # What the file says it is
    adding: readonly array(string) # What it would add, in the words a list would show
    skipped: readonly array(string) # What this station already has, which it would leave alone
    dropped: readonly array(PackImportDropped) # What it cannot use
    notices: readonly array(PackImportNotice)
}

# What an import did, and the subjects as they now stand
contract TopicImportResult: {
    plan: readonly PackImportPlan
    list: readonly TopicList
}
