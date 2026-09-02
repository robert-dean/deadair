/**
 * One stretch of the station's day: from this time, on these days, the station plays this
 * generated from [ScheduleSlot](file://./../../../../../apps/api/data/contracts/schedule/schedule.types.ck#L8)
 */
export interface ScheduleSlot {
    id: string;
    /** What the operator calls this stretch of the day. Becomes the broadcast's name */
    label: string;
    /** When it starts, as minutes past midnight on the station's clock */
    startsAtMinutes: number;
    /** When it stops, in the same terms. Before the start means the block runs past midnight, which is ordinary for a late show; equal to it means a full twenty-four hours */
    endsAtMinutes: number;
    /** The weekdays it runs on, Sunday 0. Absent or empty means every day */
    days?: number[];
    /** The plugin the records come from. Absent, with no playlist, is a slot the station fills itself */
    sourcePluginId?: string;
    sourcePlaylistId?: string;
    /** Who hosts this stretch of the day. Absent means the station's own active persona */
    personaId?: string;
    /** What this stretch of the day is asked to play, in the operator's own words. The same ceiling `PutOnAirInput.brief` has, because a changeover builds one of those from this and the two boxes are one field set on the console */
    brief?: string;
    /** The earliest release year this stretch of the day plays. Absent means no lower bound, and a record whose year the catalog does not know is played whatever the period */
    eraFrom?: number;
    /** The latest release year, on the same terms. Set with `eraFrom` for a decade; either may stand alone */
    eraTo?: number;
    /** Whether somebody phones in during this stretch of the day. Absent leaves the station's own setting standing, exactly as it does when an operator briefs a broadcast by hand; a `setlist` or a `feature` takes no calls whatever this says */
    callins?: boolean;
    mode: 'rotation' | 'setlist' | 'feature';
    onEnd: 'extend' | 'repeat' | 'stop';
}

export interface ScheduleSlotInput {
    /** What the operator calls this stretch of the day. Becomes the broadcast's name */
    label: string;
    /** When it starts, as minutes past midnight on the station's clock */
    startsAtMinutes: number;
    /** When it stops, in the same terms. Before the start means the block runs past midnight, which is ordinary for a late show; equal to it means a full twenty-four hours */
    endsAtMinutes: number;
    /** The weekdays it runs on, Sunday 0. Absent or empty means every day */
    days?: number[];
    /** The plugin the records come from. Absent, with no playlist, is a slot the station fills itself */
    sourcePluginId?: string;
    sourcePlaylistId?: string;
    /** Who hosts this stretch of the day. Absent means the station's own active persona */
    personaId?: string;
    /** What this stretch of the day is asked to play, in the operator's own words. The same ceiling `PutOnAirInput.brief` has, because a changeover builds one of those from this and the two boxes are one field set on the console */
    brief?: string;
    /** The earliest release year this stretch of the day plays. Absent means no lower bound, and a record whose year the catalog does not know is played whatever the period */
    eraFrom?: number;
    /** The latest release year, on the same terms. Set with `eraFrom` for a decade; either may stand alone */
    eraTo?: number;
    /** Whether somebody phones in during this stretch of the day. Absent leaves the station's own setting standing, exactly as it does when an operator briefs a broadcast by hand; a `setlist` or a `feature` takes no calls whatever this says */
    callins?: boolean;
    mode: 'rotation' | 'setlist' | 'feature';
    onEnd: 'extend' | 'repeat' | 'stop';
}

/**
 * A window of the station's day to draw
 * generated from [ScheduleTimetableQuery](file://./../../../../../apps/api/data/contracts/schedule/schedule.types.ck#L30)
 */
export interface ScheduleTimetableQuery {
    /** The first day to draw, as `YYYY-MM-DD` on the station's own calendar. Absent means the station's today, which is the only way a caller that does not know the station's timezone can anchor */
    from?: string;
    /** How many days from `from`. Defaults to a week */
    days?: number;
}

/**
 * One block: this slot, on this day, between these two times
 * generated from [ScheduleOccurrence](file://./../../../../../apps/api/data/contracts/schedule/schedule.types.ck#L43)
 */
export interface ScheduleOccurrence {
    slotId: string;
    label: string;
    /** `YYYY-MM-DD HH:mm:ss` on the station's own clock, deliberately carrying no timezone offset: it is a reading rather than a moment, so it draws as written wherever the console is running */
    start: string;
    /** The same, exclusive. Every block stays inside one day, so a slot running past midnight arrives as two */
    end: string;
}

/**
 * generated from [ScheduleSlotList](file://./../../../../../apps/api/data/contracts/schedule/schedule.types.ck#L25)
 */
export interface ScheduleSlotList {
    slots: ScheduleSlot[];
}

export interface ScheduleSlotListInput {
    slots: ScheduleSlotInput[];
}

/**
 * The station's day as blocks, ready to draw
 * generated from [ScheduleTimetable](file://./../../../../../apps/api/data/contracts/schedule/schedule.types.ck#L36)
 */
export interface ScheduleTimetable {
    /** The range actually drawn, echoed so a caller steps forward and back by adding days to a string rather than by knowing the station's timezone */
    from: string;
    days: number;
    occurrences: ScheduleOccurrence[];
}

/**
 * Which slot the clock says should be on right now, and what follows it
 * generated from [ScheduleNow](file://./../../../../../apps/api/data/contracts/schedule/schedule.types.ck#L51)
 */
export interface ScheduleNow {
    /** What time it is on the station's own clock, in the same zone-naive `YYYY-MM-DD HH:mm:ss` shape as a block's ends. It is here so a caller can say how much of the block is left without knowing the station's timezone: subtracting two readings taken in one frame is arithmetic, deriving one is not */
    now: string;
    /** The slot in force at this instant. Absent means the station has no schedule */
    slotId?: string;
    /** The slot the running order actually belongs to. Different from the one above while an operator's own choice holds, which it does until the next slot begins */
    airingSlotId?: string;
    /** The block on now, if there is one, and the few that follow it, earliest first. Empty for a station with nothing scheduled from here on. A gap is simply absent, exactly as it is on the timetable: what plays there is the sustaining source rather than a block */
    upcoming: ScheduleOccurrence[];
}
