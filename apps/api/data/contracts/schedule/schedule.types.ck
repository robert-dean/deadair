options {
    keys: {
        area: schedule
    }
}

# One stretch of the station's day: from this time, on these days, the station plays this
contract ScheduleSlot: {
    id: readonly string(min=1, max=100)
    label: string(max=200) # What the operator calls this stretch of the day. Becomes the broadcast's name
    startsAtMinutes: int(min=0, max=1439) # When it starts, as minutes past midnight on the station's clock
    endsAtMinutes: int(min=0, max=1439) # When it stops, in the same terms. Before the start means the block runs past midnight, which is ordinary for a late show; equal to it means a full twenty-four hours
    days?: array(int(min=0, max=6)) # The weekdays it runs on, Sunday 0. Absent or empty means every day
    sourcePluginId?: string(max=200) # The plugin the records come from. Absent, with no playlist, is a slot the station fills itself
    sourcePlaylistId?: string(max=500)
    sourceChartId?: string(max=400) # A published chart to play instead, as `pluginId:chartId`. An ALTERNATIVE to the playlist pair rather than a companion, and it wins if both are sent: a playlist names copies the station can already fetch and a chart names records it has to look up
    sourceChartOrder?: enum(countdown, ranked, unordered) # Which way round that chart is played. Absent is `countdown`, which ends on number one. Ignored without `sourceChartId`
    sourceStationPlaylistId?: uuid # A playlist the station owns to play instead, read from the station's own library when the block starts rather than from a provider. An ALTERNATIVE to the playlist pair, which it wins over, and to `sourceChartId`, which wins over it
    personaId?: string(max=100) # Who hosts this stretch of the day. Absent means the station's own active persona
    brief?: string(max=500) # What this stretch of the day is asked to play, in the operator's own words. The same ceiling `PutOnAirInput.brief` has, because a changeover builds one of those from this and the two boxes are one field set on the console
    eraFrom?: int(min=1900, max=2100) # The earliest release year this stretch of the day plays. Absent means no lower bound, and a record whose year the catalog does not know is played whatever the period
    eraTo?: int(min=1900, max=2100) # The latest release year, on the same terms. Set with `eraFrom` for a decade; either may stand alone
    mood?: enum(love, happiness, comfort, sadness, loneliness, anger, fear) # The mood this stretch of the day leans into. Records a model has judged to be in it are a little more likely to be picked; nothing is ever kept off the air for it. Absent is no lean
    callins?: boolean # Whether somebody phones in during this stretch of the day. Absent is no calls, exactly as it is when an operator puts a broadcast on air by hand; a `setlist` or a `feature` takes no calls whatever this says
    mixInSimilar?: boolean # Whether records that sound like this slot's playlist are mixed in among its records, one every `rotation.mixInEvery` records. Absent leaves the station's own setting standing, exactly as it does when an operator airs a playlist by hand; a slot with no playlist, or a `setlist` or a `feature`, never mixes whatever this says
    chartPositions?: boolean # Whether the host says where the chart placed each record it named: "number seven on the Hot 100". Absent is yes, exactly as it is when an operator puts a chart on air by hand. Set it false to air this slot's chart without its positions read out
    startsOn?: string(regex=/^\d{4}-\d{2}-\d{2}$/) # The first date this slot runs on, as `YYYY-MM-DD`, which makes it a SPECIAL rather than a weekly slot. On its dates a special takes over from the weekly schedule for its hours, and the weekly show resumes when it ends. Sent with `endsOn` or not at all
    endsOn?: string(regex=/^\d{4}-\d{2}-\d{2}$/) # The last date it runs on, inclusive. `days` still applies in between, so the Fridays in December are a range and a mask
    guestHosts?: array(SlotGuestHost, max=8) # Hosts who sit in for this slot's own host on some nights, in precedence order: the first whose night it is takes it. A guest on fixed nights wins over one at random. Absent or empty is a slot its own host presents every time
    yearly?: boolean # Whether the special repeats every year on the same month and day, such as Halloween. Absent is a one-off. A yearly range may run past New Year and must be shorter than a year
    mode: enum(rotation, setlist, feature)
    onEnd: enum(extend, repeat, stop)
}

# A host who sits in on a slot on some nights, saying whose show it usually is
contract SlotGuestHost: {
    personaId: string(min=1, max=100) # Who sits in. A host; a caller or a guest who drops by can never present a show
    days?: array(int(min=0, max=6)) # The nights they present, by the weekday the night begins on, Sunday 0. Send this or `everyN`, not both
    everyN?: int(min=2, max=366) # Or at random: about one of this slot's nights in this many, on nights nobody can predict. 7 is about one in seven
    cooldownDays?: int(min=0, max=366) # With `everyN`, the fewest days between two of their nights. Absent is half of `everyN`, so even one in seven never lands two nights running
}

contract ScheduleSlotList: {
    slots: array(ScheduleSlot)
}

# A window of the station's day to draw
contract ScheduleTimetableQuery: {
    from?: string(min=10, max=10) # The first day to draw, as `YYYY-MM-DD` on the station's own calendar. Absent means the station's today, which is the only way a caller that does not know the station's timezone can anchor
    days?: int(min=1, max=31) # How many days from `from`. Defaults to a week
}

# The station's day as blocks, ready to draw
contract ScheduleTimetable: {
    from: string(min=10, max=10) # The range actually drawn, echoed so a caller steps forward and back by adding days to a string rather than by knowing the station's timezone
    days: int(min=1, max=31)
    occurrences: array(ScheduleOccurrence)
}

# One block: this slot, on this day, between these two times
contract ScheduleOccurrence: {
    slotId: string(min=1, max=100)
    label: string(max=200)
    start: string(min=19, max=19) # `YYYY-MM-DD HH:mm:ss` on the station's own clock, deliberately carrying no timezone offset: it is a reading rather than a moment, so it draws as written wherever the console is running
    end: string(min=19, max=19) # The same, exclusive. Every block stays inside one day, so a slot running past midnight arrives as two
}

# Which slot the clock says should be on right now, and what follows it
contract ScheduleNow: {
    now: string(min=19, max=19) # What time it is on the station's own clock, in the same zone-naive `YYYY-MM-DD HH:mm:ss` shape as a block's ends. It is here so a caller can say how much of the block is left without knowing the station's timezone: subtracting two readings taken in one frame is arithmetic, deriving one is not
    timezone?: string(min=1, max=100) # The IANA zone the station reads its clock in: `station.timezone`, or the machine's own when that is empty. Optional because a station from before it existed does not send it. For a console showing the station's time beside an operator's own when the two differ, which a zone-naive reading cannot tell it
    slotId?: string(max=100) # The slot in force at this instant. Absent means the station has no schedule
    hostPersonaId?: string(max=100) # Who presents tonight's night of the slot in force: a guest sitting in, or the slot's own host. Absent when it names nobody, which is the station's own host. Only the night that is ON is answered, so a guest who comes at random stays a surprise until their night begins
    regularPersonaId?: string(max=100) # Whose show it usually is, while a guest sits in on the slot in force. Absent on an ordinary night, and while the station's own host would be the regular one
    airingSlotId?: string(max=100) # The slot the running order actually belongs to. Different from the one above while an operator's own choice holds, which it does until the next slot begins
    upcoming: array(ScheduleOccurrence) # The block on now, if there is one, and the few that follow it, earliest first. Empty for a station with nothing scheduled from here on. A gap is simply absent, exactly as it is on the timetable: what plays there is the sustaining source rather than a block
}
