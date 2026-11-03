options {
    keys: {
        area: schedule
    }
}

# What a date means where this station is: a name the presenters can say, and a mood to lean into on a
# day the show on air names none. `ruleKind` says when it falls, and which of the fields beside it count
contract Occasion: {
    id: readonly uuid
    words: string(min=1, max=80) # Said on air as written: `Halloween`, `the first day of Hanukkah`
    ruleKind: enum(fixed, weekday, easter, calendar, dates) # `fixed` is the same date every year, from `month` and `day`. `weekday` is the nth of a weekday in a month, from `month`, `ordinal` and `weekday`. `easter` is a number of days from Western Easter Sunday, from `offsetDays`. `calendar` is a date in the Hebrew or Islamic calendar, from `calendar`, `calendarMonth` and `day`. `dates` is the dates themselves, from `dates`, for what no rule can work out
    month?: int(min=1, max=12)
    day?: int(min=1, max=31) # The day of the month, in the rule's own calendar
    ordinal?: int(min=-1, max=5) # Which of that weekday in the month: 1 to 5, or -1 for the last. The fourth Thursday of November is `4`
    weekday?: int(min=0, max=6) # 0 is Sunday
    offsetDays?: int(min=-60, max=60) # Days from Easter Sunday: 0 is the day itself and -2 is Good Friday
    calendar?: enum(hebrew, islamic-umalqura) # `islamic-umalqura` is calculated, so a community going by the sighted moon may keep the day a day either side of it
    calendarMonth?: string(min=1, max=40) # The month in that calendar, as `calendars` lists it
    dates?: array(string(min=10, max=10), max=200) # As `YYYY-MM-DD`. These run out, so a list needs refreshing
    mood?: enum(love, happiness, comfort, sadness, loneliness, anger, fear) # What this day leans into, when the show on air names no mood of its own. Records a model has judged to be in it are a little more likely to be picked, and nothing is ever kept off the air for it. Absent leans nothing
    enabled: boolean # Whether the station knows about it. Off, it is never said and never leans anything
    position: readonly int # Where it comes in the list. When two fall on one date the first wins
    nextDate?: readonly string(min=10, max=10) # When it next falls, as `YYYY-MM-DD` on the station's calendar, counting today. Absent when it does not fall again, as a list of dates that has run out
}

# The months of a calendar an occasion can be set in, in the order they come
contract OccasionCalendarMonths: {
    calendar: enum(hebrew, islamic-umalqura)
    months: array(string)
}

# Every occasion on the station, in the order a date is matched against them
contract OccasionList: {
    occasions: array(Occasion)
    calendars: array(OccasionCalendarMonths)
}

# A new order for the list
contract OccasionOrder: {
    ids: array(uuid, min=1, max=500) # Occasions in the order they should be matched. Any left out stay behind these, in their current order
}

# One occasion in a file: what it says, when it falls and what it leans into, and nothing that belongs
# to the station it came from
contract OccasionPackRow: {
    words: string(min=1, max=80) # Said on air as written
    ruleKind: enum(fixed, weekday, easter, calendar, dates) # When it falls, and which of the fields beside it count, as on an occasion
    month?: int(min=1, max=12)
    day?: int(min=1, max=31)
    ordinal?: int(min=-1, max=5)
    weekday?: int(min=0, max=6)
    offsetDays?: int(min=-60, max=60)
    calendar?: enum(hebrew, islamic-umalqura)
    calendarMonth?: string(min=1, max=40)
    dates?: array(string(min=10, max=10), max=200)
    mood?: enum(love, happiness, comfort, sadness, loneliness, anger, fear)
}

# A set of occasions as one file, to hand to another station. Each entry is read as an `OccasionPackRow`
# when it is imported, so one a station cannot use is reported rather than refusing the file
contract OccasionPack: {
    format: literal("deadair.occasions") # Says the file is an occasion pack
    version: int(min=1) # The version of the document's shape. This station reads version 1
    name: string(min=1, max=100) # What the pack is, as whoever made it would describe it: `Canadian holidays`
    occasions: array(record(string, unknown), max=500)
}

# An entry in a file that importing it would leave out, and why
contract OccasionPackDropped: {
    entry: readonly int(min=1) # Which entry in the file, counting from 1
    words?: readonly string # What it says, when it says
    reason: readonly string # Why the station cannot use it
}

# What importing a file would do. Everything it adds starts switched off
contract OccasionImportPlan: {
    name: readonly string # What the file says it is
    adding: readonly array(string) # The occasions it would add, by their words
    skipped: readonly array(string) # The ones this station already has, with the same words and the same rule, which it would leave alone
    dropped: readonly array(OccasionPackDropped) # The ones it cannot use
}

# What an import did, and the list as it now stands
contract OccasionImportResult: {
    plan: readonly OccasionImportPlan
    list: readonly OccasionList
}
