/**
 * One act on a festival's bill
 * generated from [FestivalAct](../../../../../apps/api/data/contracts/schedule/festivals.types.ck)
 */
export interface FestivalAct {
    /** As the station credits them, which is the name said on air and the name the station looks their records up by */
    artist: string;
    /** The day they play, as `YYYY-MM-DD`, when the bill says. Inside the festival's dates */
    day?: string;
    /** Whether they top the bill. Absent is no */
    headliner?: boolean;
}

/**
 * A music festival the station can build a show around: its dates, where it is, and who is on the bill. What a presenter says about it is read from here, so its dates are the ones an operator typed or checked
 * generated from [Festival](../../../../../apps/api/data/contracts/schedule/festivals.types.ck)
 */
export interface Festival {
    id: string;
    /** Said on air as written: `Shaky Knees`, `the Newport Folk Festival` */
    name: string;
    /** The first day, as `YYYY-MM-DD` on the festival's own calendar */
    startsOn: string;
    /** The last day, inclusive. The same as `startsOn` for a one-day festival */
    endsOn: string;
    /** Where it is, as a presenter would say it: `Piedmont Park, Atlanta`. Absent says nothing about where */
    place?: string;
    /** The festival's own page. Kept as where the facts came from, and never read out */
    url?: string;
    /** Who is on the bill, in the order they should be listed. A name given twice is kept once */
    acts: FestivalAct[];
    /** Where the festival stands on the station's calendar today: still to come, on now, or finished. A finished festival is never talked about */
    state: 'upcoming' | 'on' | 'over';
    /** The plugin a festival was imported from. Absent for one an operator typed */
    sourcePluginId?: string;
}

export interface FestivalInput {
    /** Said on air as written: `Shaky Knees`, `the Newport Folk Festival` */
    name: string;
    /** The first day, as `YYYY-MM-DD` on the festival's own calendar */
    startsOn: string;
    /** The last day, inclusive. The same as `startsOn` for a one-day festival */
    endsOn: string;
    /** Where it is, as a presenter would say it: `Piedmont Park, Atlanta`. Absent says nothing about where */
    place?: string;
    /** The festival's own page. Kept as where the facts came from, and never read out */
    url?: string;
    /** Who is on the bill, in the order they should be listed. A name given twice is kept once */
    acts: FestivalAct[];
}

/**
 * Every festival on the station, soonest first
 * generated from [FestivalList](../../../../../apps/api/data/contracts/schedule/festivals.types.ck)
 */
export interface FestivalList {
    festivals: Festival[];
}

export interface FestivalListInput {
    festivals: FestivalInput[];
}
