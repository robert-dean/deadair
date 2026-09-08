using System.Globalization;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Http;

/// <summary>
/// The requests this plugin makes, built.
/// </summary>
/// <remarks>
/// Every one is a GET with its arguments in the query string; that is the whole shape of the BluOS
/// Custom Integration API. They are built here rather than at each call site so the escaping is
/// written once: the mount address is a URL inside a URL, and a colon or a slash left raw is a
/// player that plays nothing with no explanation.
/// </remarks>
public static class BluOsUrls
{
    /// <summary>
    /// Start playing something the player fetches itself.
    /// </summary>
    /// <param name="player">Where to send it.</param>
    /// <param name="mount">The station's mount, absolute and reachable from the player.</param>
    /// <param name="title1">
    /// The display's first line. UNDOCUMENTED: the spec lists only seek, id, url, inputIndex and
    /// inputTypeIndex, and this was measured working on 4.16.6 rather than promised. It is also
    /// one-shot, so it must say something that stays true.
    /// </param>
    /// <param name="image">An image for the same display, on the same footing as the caption.</param>
    public static Uri Play(BluOsEndpoint player, Uri mount, string? title1 = null, Uri? image = null)
    {
        ArgumentNullException.ThrowIfNull(player);
        ArgumentNullException.ThrowIfNull(mount);

        var query = new List<string> { "url=" + Uri.EscapeDataString(mount.ToString()) };

        if (!string.IsNullOrWhiteSpace(title1))
        {
            query.Add("title1=" + Uri.EscapeDataString(title1));
        }

        if (image is not null)
        {
            query.Add("image=" + Uri.EscapeDataString(image.ToString()));
        }

        return At(player, "Play", query);
    }

    /// <summary>
    /// Stop, and mean it.
    /// </summary>
    /// <remarks>
    /// Never <c>/Pause</c>. A paused player holds its connection to the mount open, which is still
    /// an audience to the station's gate, so pausing would leave an audience-gated station
    /// broadcasting to a room where somebody pressed stop.
    /// </remarks>
    public static Uri Stop(BluOsEndpoint player) => At(player, "Stop", []);

    /// <summary>
    /// What the player is doing.
    /// </summary>
    /// <param name="etag">
    /// The last reading's tag. With a timeout, the player holds the request open and answers early
    /// when something changes, which is how a track boundary arrives without polling for it.
    /// </param>
    /// <param name="timeoutSeconds">
    /// How long the player may hold it. The spec asks for no faster than ten seconds and around
    /// sixty at most.
    /// </param>
    public static Uri Status(BluOsEndpoint player, string? etag = null, int? timeoutSeconds = null)
    {
        var query = new List<string>();

        if (!string.IsNullOrEmpty(etag))
        {
            query.Add("etag=" + Uri.EscapeDataString(etag));
        }

        if (timeoutSeconds is { } seconds)
        {
            query.Add("timeout=" + seconds.ToString(CultureInfo.InvariantCulture));
        }

        return At(player, "Status", query);
    }

    /// <summary>What the player calls itself, and what it is.</summary>
    public static Uri SyncStatus(BluOsEndpoint player) => At(player, "SyncStatus", []);

    /// <summary>Reads the volume, or sets it. 0 to 100; the player answers -1 when it is fixed.</summary>
    public static Uri Volume(BluOsEndpoint player, int? level = null) =>
        At(player, "Volume", level is { } value ? ["level=" + value.ToString(CultureInfo.InvariantCulture)] : []);

    private static Uri At(BluOsEndpoint player, string path, List<string> query)
    {
        ArgumentNullException.ThrowIfNull(player);

        var suffix = query.Count == 0 ? string.Empty : "?" + string.Join('&', query);

        return new Uri(player.BaseAddress, path + suffix);
    }
}
