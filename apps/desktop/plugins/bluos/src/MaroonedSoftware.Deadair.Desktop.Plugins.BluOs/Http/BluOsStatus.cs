namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Http;

/// <summary>
/// One reading of what a player is doing.
/// </summary>
/// <remarks>
/// A few of the elements the player sends. The spec says undocumented ones should be ignored, and
/// this ignores documented ones it has no use for as well: what is here is what decides a phase, a
/// volume, and whether the thing playing is ours.
/// </remarks>
/// <param name="Etag">Hand back on the next request to be told when something changes.</param>
/// <param name="State">
/// <c>play</c>, <c>stream</c>, <c>pause</c>, <c>stop</c>, <c>connecting</c>, and the spec's own
/// "etc." — an open list, which is why nothing here refuses a word it does not know.
/// </param>
/// <param name="Secs">
/// How far in. Deliberately NOT part of the etag, so a long-poll does not return just because time
/// passed; it is also how "connected" is told from "actually playing".
/// </param>
/// <param name="Volume">0 to 100, or -1 for a player whose volume is fixed.</param>
/// <param name="StreamUrl">
/// What it is playing. The spec says to treat this as opaque and only check whether it is there;
/// this plugin compares it anyway, because it is the only way to tell a player that is playing OUR
/// station from one somebody switched to the radio.
/// </param>
/// <param name="Service">Which service the player thinks this is. For a log line, never a decision.</param>
/// <param name="Title1">The display's first line, usually the station's name.</param>
/// <param name="Title2">The second, which is the flattened ICY line and changes per record.</param>
public sealed record BluOsStatus(
    string? Etag,
    string? State,
    int? Secs,
    int? Volume,
    string? StreamUrl,
    string? Service,
    string? Title1,
    string? Title2);

/// <summary>
/// What a player says it is.
/// </summary>
/// <param name="Name">What its owner called it, which is what a picker should draw.</param>
/// <param name="Brand">Bluesound, NAD, Dali.</param>
/// <param name="Model">The model code, like <c>N130</c>.</param>
/// <param name="ModelName">The model in words, like <c>M10 V2</c>. Better to show than the code.</param>
/// <param name="Mac">
/// Its hardware address, which is the one thing about a player that does not change. Used as the
/// device's stable id, since an address is a DHCP lease and a name is whatever somebody typed.
/// </param>
/// <param name="Volume">0 to 100, or -1 when fixed.</param>
public sealed record BluOsSyncStatus(
    string? Name,
    string? Brand,
    string? Model,
    string? ModelName,
    string? Mac,
    int? Volume);
