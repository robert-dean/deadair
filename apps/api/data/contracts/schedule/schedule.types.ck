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
    personaId?: string(max=100) # Who hosts this stretch of the day. Absent means the station's own active persona
    brief?: string(max=2000) # What this stretch of the day is asked to play, in the operator's own words
    eraFrom?: int(min=1900, max=2100) # The earliest release year this stretch of the day plays. Absent means no lower bound, and a record whose year the catalog does not know is played whatever the period
    eraTo?: int(min=1900, max=2100) # The latest release year, on the same terms. Set with `eraFrom` for a decade; either may stand alone
    mode: enum(rotation, setlist, feature)
    onEnd: enum(extend, repeat, stop)
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
    slotId?: string(max=100) # The slot in force at this instant. Absent means the station has no schedule
    airingSlotId?: string(max=100) # The slot the running order actually belongs to. Different from the one above while an operator's own choice holds, which it does until the next slot begins
    upcoming: array(ScheduleOccurrence) # The block on now, if there is one, and the few that follow it, earliest first. Empty for a station with nothing scheduled from here on. A gap is simply absent, exactly as it is on the timetable: what plays there is the sustaining source rather than a block
}
