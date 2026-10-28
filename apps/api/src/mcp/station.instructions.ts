import { MCP_DEFAULT_HELP_TOOL_NAME, McpHelpToolHandler, type McpToolHandlerMap } from '@maroonedsoftware/mcp';

/**
 * What a connected model is told about the station: the MCP `instructions` sent at `initialize`, and
 * the overview the `help` tool opens with.
 *
 * One text for both, because a client may ignore `instructions` (it is a hint, not a contract) and
 * every client exposes tools, so `help` is the copy that always arrives. It is in context for every
 * conversation the connector is attached to, so it says what the tools are for and where each part
 * of the station is, and leaves the detail to each operation's own description, which `search_api`
 * answers by name. It names operations rather than describing their arguments for the same reason:
 * the schema is one search away and is always the current one.
 *
 * It grants nothing. Every operation enforces its own policy, and the catalog only offers what the
 * caller's role and grant allow, so naming an operation a view grant cannot use costs that caller a
 * refusal it can read, never an action. Keep it short, keep it free of anything about one station,
 * and when an operation is renamed, `tests/mcp/station.instructions.test.ts` fails on the stale name.
 */
export const STATION_INSTRUCTIONS = `deadair is a radio station this person runs themselves: one running order that every listener hears at once, records from their own music providers, and a presenter (a character) who talks between them. You act as this person, with what their grant allows.

How the tools fit together:
- The listed tools answer what people ask most: get_now_playing, get_playout_status (on air or not, why it is quiet, and the live input), read_timetable and read_current_slot, search_requestable_records then create_request, skip_the_current_item, and whoami (their role, and the station's time zone and local time: call it before anything that depends on the time).
- Everything else is one search away. Call search_api with a few words, or with an operation name below to get its arguments, then run it with call_api.
- Before anything that deletes, removes, stops the station or cuts a presenter off, say what it will do and wait for a yes.
- Settings can be read (get_settings) but not changed here. When the answer is a setting, tell them where it is in the console: Settings, then its group.

Where things are:
- The running order: get_the_running_order, add_a_record_to_the_running_order, move_a_running_order_item, remove_a_running_order_item, skip_to_a_running_order_item. write_a_running_order_break_again rewrites one break that has not aired yet. request_a_break asks for the news, the weather or a word from the host now.
- Quiet for a while: keep_the_station_quiet stops the station's own breaks for a number of records; end_the_quiet_spell ends it.
- Opinion of a record: rate_track, rate_album, rate_artist. suspend_track, suspend_album and suspend_artist keep one off the air for a while without disliking it; lift_track_suspension and the others bring it back.
- Requests: create_request asks as a listener would, with who is asking and a dedication. list_requests, grant_request and decline_request are for when an operator decides.
- The timetable: create_schedule_slot adds a weekly block, or a special on dates. A special with live set books a live show. apply_schedule_slot_to_air applies an edited slot to the show on air without starting it again.
- The format clock (what is said inside the hour): list_clock_bands, create_clock_band, update_clock_band. A band has a sort of break, a time, optional days (Sunday 0, none means every day) and an optional subject from list_topics.
- News: list_feeds, read_news. A scheduled news edition is one of the station's own shows (list_own_shows, create_own_show) named by a topic of kind podcast (create_topic) on a podcast band; request_own_show_episode makes one now. Breaking news feeds are a setting: Settings, Bulletins.
- Kinds of break the operator writes: list_break_kinds, create_break_kind (a key the clock names, a brief, its own rules, what the presenter may see; it starts switched off), then a clock band whose sort is that key. They need a model writing the breaks. export_break_kinds, preview_break_kind_import and import_break_kinds move them between stations.
- Going live: arm_the_live_input lets a person present from their own encoder; they are on air after a short countdown once it hears sound. disarm_the_live_input cancels, or hands a presenter on air back to the station at once.
- Recordings of what aired: list_recordings, delete_recording (it cannot be undone). What is recorded is a setting: Settings, Stream.
- How a name is said: list_pronunciations, create_pronunciation.
- What it did and why: read_activity, read_script_history (every break written, and the ones declined).`;

/** The `help` tool's name: the package's own, so a client that knows the convention finds it. */
export const HELP_TOOL = MCP_DEFAULT_HELP_TOOL_NAME;

/**
 * The `help` tool: `STATION_INSTRUCTIONS`, then every listed tool with its description.
 *
 * Built here rather than inline in the module because the package's handler declares no annotations,
 * and a tool without `readOnlyHint` is one a client treats as a write and may ask the person to approve
 * before every call. It only reads, so it says so. Pass the map it is registered in: it lists that map's
 * tools on its first call, once the module has finished filling it.
 */
export function stationHelpTool(tools: McpToolHandlerMap): McpHelpToolHandler {
    const help = new McpHelpToolHandler({
        tools,
        overview: STATION_INSTRUCTIONS,
        name: HELP_TOOL,
        description:
            'What this station is, how its tools fit together, and which operation does what: the running order, requests, the timetable and format clock, news, kinds of break, going live, recordings and the rest. Call it when the person asks what you can do, or before reaching for search_api on a task you have not done here before.',
    });
    Object.assign(help.definition, {
        title: 'Help',
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    });
    return help;
}
