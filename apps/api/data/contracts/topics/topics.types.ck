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
