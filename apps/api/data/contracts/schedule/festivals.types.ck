options {
    keys: {
        area: schedule
    }
}

# A music festival the station can build a show around: its dates, where it is, and who is on the bill. What a presenter says about it is read from here, so its dates are the ones an operator typed or checked
contract Festival: {
    id: readonly uuid
    name: string(min=1, max=120) # Said on air as written: `Shaky Knees`, `the Newport Folk Festival`
    startsOn: string(regex=/^\d{4}-\d{2}-\d{2}$/) # The first day, as `YYYY-MM-DD` on the festival's own calendar
    endsOn: string(regex=/^\d{4}-\d{2}-\d{2}$/) # The last day, inclusive. The same as `startsOn` for a one-day festival
    place?: string(min=1, max=200) # Where it is, as a presenter would say it: `Piedmont Park, Atlanta`. Absent says nothing about where
    url?: string(min=1, max=2000) # The festival's own page. Kept as where the facts came from, and never read out
    acts: array(FestivalAct, max=300) # Who is on the bill, in the order they should be listed. A name given twice is kept once
    state: readonly enum(upcoming, on, over) # Where the festival stands on the station's calendar today: still to come, on now, or finished. A finished festival is never talked about
    sourcePluginId?: string(min=1, max=200) # The plugin a festival was imported from, from `GET /festivals/lookup`. Absent for one an operator typed. Kept as it was when a festival is changed, whatever is sent
    sourceEventId?: writeonly string(min=1, max=200) # That plugin's own id for the listing, sent with `sourcePluginId` when adding an imported festival
}

# One act on a festival's bill
contract FestivalAct: {
    artist: string(min=1, max=200) # As the station credits them, which is the name said on air and the name the station looks their records up by
    day?: string(regex=/^\d{4}-\d{2}-\d{2}$/) # The day they play, as `YYYY-MM-DD`, when the bill says. Inside the festival's dates
    headliner?: boolean # Whether they top the bill. Absent is no
}

# Every festival on the station, soonest first
contract FestivalList: {
    festivals: array(Festival)
}

# A festival as a ticket service lists it, for an operator to check and then add. Nothing here is said on air until it is saved as a festival
contract FestivalListing: {
    pluginId: string # The plugin that listed it, to send back as `sourcePluginId`
    eventId: string # Its own id for the listing, to send back as `sourceEventId`
    name: string
    startsOn: string(regex=/^\d{4}-\d{2}-\d{2}$/)
    endsOn: string(regex=/^\d{4}-\d{2}-\d{2}$/)
    place?: string # The venue and the town, as the service gives them
    url?: string
    acts: array(string) # Who the service lists as performing, in its order
}

# What looking a festival up found, soonest first
contract FestivalLookup: {
    listings: array(FestivalListing)
    unanswered?: array(string) # The plugins that were asked and could not answer, so an empty list is not read as nothing being on
}
