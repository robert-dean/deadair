/**
 * What a date means where this station is: a name the presenters can say, and a mood to lean into on a
 * day the show on air names none. `ruleKind` says when it falls, and which of the fields beside it count
 * generated from [Occasion](../../../../../apps/api/data/contracts/schedule/occasions.types.ck)
 */
export interface Occasion {
    id: string;
    /** Said on air as written: `Halloween`, `the first day of Hanukkah` */
    words: string;
    /** `fixed` is the same date every year, from `month` and `day`. `weekday` is the nth of a weekday in a month, from `month`, `ordinal` and `weekday`. `easter` is a number of days from Western Easter Sunday, from `offsetDays`. `calendar` is a date in the Hebrew or Islamic calendar, from `calendar`, `calendarMonth` and `day`. `dates` is the dates themselves, from `dates`, for what no rule can work out */
    ruleKind: 'fixed' | 'weekday' | 'easter' | 'calendar' | 'dates';
    month?: number;
    /** The day of the month, in the rule's own calendar */
    day?: number;
    /** Which of that weekday in the month: 1 to 5, or -1 for the last. The fourth Thursday of November is `4` */
    ordinal?: number;
    /** 0 is Sunday */
    weekday?: number;
    /** Days from Easter Sunday: 0 is the day itself and -2 is Good Friday */
    offsetDays?: number;
    /** `islamic-umalqura` is calculated, so a community going by the sighted moon may keep the day a day either side of it */
    calendar?: 'hebrew' | 'islamic-umalqura';
    /** The month in that calendar, as `calendars` lists it */
    calendarMonth?: string;
    /** As `YYYY-MM-DD`. These run out, so a list needs refreshing */
    dates?: string[];
    /** What this day leans into, when the show on air names no mood of its own. Records a model has judged to be in it are a little more likely to be picked, and nothing is ever kept off the air for it. Absent leans nothing */
    mood?: 'love' | 'happiness' | 'comfort' | 'sadness' | 'loneliness' | 'anger' | 'fear';
    /** Whether the station knows about it. Off, it is never said and never leans anything */
    enabled: boolean;
    /** Where it comes in the list. When two fall on one date the first wins */
    position: number;
    /** When it next falls, as `YYYY-MM-DD` on the station's calendar, counting today. Absent when it does not fall again, as a list of dates that has run out */
    nextDate?: string;
}

export interface OccasionInput {
    /** Said on air as written: `Halloween`, `the first day of Hanukkah` */
    words: string;
    /** `fixed` is the same date every year, from `month` and `day`. `weekday` is the nth of a weekday in a month, from `month`, `ordinal` and `weekday`. `easter` is a number of days from Western Easter Sunday, from `offsetDays`. `calendar` is a date in the Hebrew or Islamic calendar, from `calendar`, `calendarMonth` and `day`. `dates` is the dates themselves, from `dates`, for what no rule can work out */
    ruleKind: 'fixed' | 'weekday' | 'easter' | 'calendar' | 'dates';
    month?: number;
    /** The day of the month, in the rule's own calendar */
    day?: number;
    /** Which of that weekday in the month: 1 to 5, or -1 for the last. The fourth Thursday of November is `4` */
    ordinal?: number;
    /** 0 is Sunday */
    weekday?: number;
    /** Days from Easter Sunday: 0 is the day itself and -2 is Good Friday */
    offsetDays?: number;
    /** `islamic-umalqura` is calculated, so a community going by the sighted moon may keep the day a day either side of it */
    calendar?: 'hebrew' | 'islamic-umalqura';
    /** The month in that calendar, as `calendars` lists it */
    calendarMonth?: string;
    /** As `YYYY-MM-DD`. These run out, so a list needs refreshing */
    dates?: string[];
    /** What this day leans into, when the show on air names no mood of its own. Records a model has judged to be in it are a little more likely to be picked, and nothing is ever kept off the air for it. Absent leans nothing */
    mood?: 'love' | 'happiness' | 'comfort' | 'sadness' | 'loneliness' | 'anger' | 'fear';
    /** Whether the station knows about it. Off, it is never said and never leans anything */
    enabled: boolean;
}

/**
 * The months of a calendar an occasion can be set in, in the order they come
 * generated from [OccasionCalendarMonths](../../../../../apps/api/data/contracts/schedule/occasions.types.ck)
 */
export interface OccasionCalendarMonths {
    calendar: 'hebrew' | 'islamic-umalqura';
    months: string[];
}

/**
 * A new order for the list
 * generated from [OccasionOrder](../../../../../apps/api/data/contracts/schedule/occasions.types.ck)
 */
export interface OccasionOrder {
    /** Occasions in the order they should be matched. Any left out stay behind these, in their current order */
    ids: string[];
}

/**
 * Every occasion on the station, in the order a date is matched against them
 * generated from [OccasionList](../../../../../apps/api/data/contracts/schedule/occasions.types.ck)
 */
export interface OccasionList {
    occasions: Occasion[];
    calendars: OccasionCalendarMonths[];
}

export interface OccasionListInput {
    occasions: OccasionInput[];
    calendars: OccasionCalendarMonths[];
}
