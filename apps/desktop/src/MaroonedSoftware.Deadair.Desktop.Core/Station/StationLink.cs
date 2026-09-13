namespace MaroonedSoftware.Deadair.Desktop.Core.Station;

/// <summary>
/// A <c>deadair://</c> link, which names a station for the app to be pointed at.
/// </summary>
/// <remarks>
/// <para>
/// Two forms. <c>deadair://connect?station=&lt;origin&gt;</c> carries the whole origin, escaped, and is
/// what the console writes: it is the only form that can name a plain-http station on a home network,
/// which is where most of these run. <c>deadair://radio.example.com</c> is shorthand for an https
/// station, for somebody typing one by hand. Anything else is refused rather than guessed at.
/// </para>
/// <para>
/// A link only ever PROPOSES a station. The app shows its setup screen with the address filled in and
/// connects when somebody presses Connect, so a link in an email cannot quietly repoint an app.
/// </para>
/// </remarks>
public static class StationLink
{
    public const string Scheme = "deadair";

    private const string ConnectHost = "connect";

    public static bool TryParse(string? text, out StationUrl station)
    {
        station = default;
        return Uri.TryCreate(text, UriKind.Absolute, out var link) && TryParse(link, out station);
    }

    public static bool TryParse(Uri? link, out StationUrl station)
    {
        station = default;

        if (link is null || !link.IsAbsoluteUri || !string.Equals(link.Scheme, Scheme, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (string.Equals(link.Host, ConnectHost, StringComparison.OrdinalIgnoreCase))
        {
            return Query(link, "station") is { Length: > 0 } origin && StationUrl.TryParse(origin, out station);
        }

        // The shorthand: a host and nothing else. A path or a query on it is not something this
        // app writes, so it is not something to interpret.
        if (link.Host.Length == 0 || link.Query.Length > 0 || link.AbsolutePath is not ("" or "/"))
        {
            return false;
        }

        return StationUrl.TryParse("https://" + link.Authority, out station);
    }

    private static string? Query(Uri link, string name)
    {
        foreach (var pair in link.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var equals = pair.IndexOf('=', StringComparison.Ordinal);
            var key = equals < 0 ? pair : pair[..equals];

            if (string.Equals(Uri.UnescapeDataString(key), name, StringComparison.Ordinal))
            {
                return equals < 0 ? string.Empty : Uri.UnescapeDataString(pair[(equals + 1)..].Replace('+', ' '));
            }
        }

        return null;
    }
}
