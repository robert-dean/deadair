options {
    keys: {
        area: schedule
    }
}

# One stretch of the station's day: from this time, on these days, the station plays this
contract ScheduleSlot: {
    id: readonly string(min=1, max=100)
    label: string(max=200) # What the operator calls this stretch of the day. Becomes the broadcast's name
    startsAtMinutes: int(min=0, max=1439) # When it starts, as minutes past midnight on the station's clock. Only a start: a slot runs until the next one begins, and the last of the week wraps round
    days?: array(int(min=0, max=6)) # The weekdays it runs on, Sunday 0. Absent or empty means every day
    sourcePluginId?: string(max=200) # The plugin the records come from. Absent, with no playlist, is a slot the station fills itself
    sourcePlaylistId?: string(max=500)
    personaId?: string(max=100) # Who hosts this stretch of the day. Absent means the station's own active persona
    brief?: string(max=2000) # What this stretch of the day is asked to play, in the operator's own words
    mode: enum(rotation, setlist, feature)
    onEnd: enum(extend, repeat, stop)
}

contract ScheduleSlotList: {
    slots: array(ScheduleSlot)
}
