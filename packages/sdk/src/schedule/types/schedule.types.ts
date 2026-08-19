/**
 * One stretch of the station's day: from this time, on these days, the station plays this
 * generated from [ScheduleSlot](file://./../../../../../apps/api/data/contracts/schedule/schedule.types.ck#L8)
 */
export interface ScheduleSlot {
    id: string;
    /** What the operator calls this stretch of the day. Becomes the broadcast's name */
    label: string;
    /** When it starts, as minutes past midnight on the station's clock. Only a start: a slot runs until the next one begins, and the last of the week wraps round */
    startsAtMinutes: number;
    /** The weekdays it runs on, Sunday 0. Absent or empty means every day */
    days?: number[];
    /** The plugin the records come from. Absent, with no playlist, is a slot the station fills itself */
    sourcePluginId?: string;
    sourcePlaylistId?: string;
    /** Who hosts this stretch of the day. Absent means the station's own active persona */
    personaId?: string;
    /** What this stretch of the day is asked to play, in the operator's own words */
    brief?: string;
    mode: 'rotation' | 'setlist' | 'feature';
    onEnd: 'extend' | 'repeat' | 'stop';
}

export interface ScheduleSlotInput {
    /** What the operator calls this stretch of the day. Becomes the broadcast's name */
    label: string;
    /** When it starts, as minutes past midnight on the station's clock. Only a start: a slot runs until the next one begins, and the last of the week wraps round */
    startsAtMinutes: number;
    /** The weekdays it runs on, Sunday 0. Absent or empty means every day */
    days?: number[];
    /** The plugin the records come from. Absent, with no playlist, is a slot the station fills itself */
    sourcePluginId?: string;
    sourcePlaylistId?: string;
    /** Who hosts this stretch of the day. Absent means the station's own active persona */
    personaId?: string;
    /** What this stretch of the day is asked to play, in the operator's own words */
    brief?: string;
    mode: 'rotation' | 'setlist' | 'feature';
    onEnd: 'extend' | 'repeat' | 'stop';
}

/**
 * generated from [ScheduleSlotList](file://./../../../../../apps/api/data/contracts/schedule/schedule.types.ck#L21)
 */
export interface ScheduleSlotList {
    slots: ScheduleSlot[];
}

export interface ScheduleSlotListInput {
    slots: ScheduleSlotInput[];
}
