using MaroonedSoftware.Deadair.Desktop.PluginSdk;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs;

/// <summary>What the operator has told this plugin.</summary>
/// <param name="Discover">Whether to look for players on the network.</param>
/// <param name="Players">Addresses to use whether or not anything was found.</param>
/// <param name="Caption">
/// The first line to put on a player's display, or null to leave whatever the stream supplies.
/// </param>
/// <param name="Logo">An image for the same display, or null.</param>
public sealed record BluOsSettings(
    bool Discover,
    IReadOnlyList<BluOsEndpoint> Players,
    string? Caption,
    Uri? Logo);

/// <summary>
/// Reads this plugin's settings, which arrive as text and must be treated as text.
/// </summary>
/// <remarks>
/// <para>
/// Every layer of this station's configuration is a string, so an on/off setting is the WORD and a
/// number is its digits. The reading side matters as much as the writing: <c>true</c>, <c>1</c>,
/// <c>yes</c> and <c>on</c> are all on, and anything unreadable takes the declared default rather
/// than falling to off, because a value nobody can read is a value nobody set.
/// </para>
/// <para>
/// Nothing here throws. A mistyped address is one address the operator does not have, and it should
/// cost them that address rather than the whole plugin.
/// </para>
/// </remarks>
public static class BluOsConfig
{
    public const string DiscoverKey = "discover";
    public const string PlayersKey = "players";
    public const string CaptionKey = "caption";
    public const string LogoKey = "logo";

    public static BluOsSettings Read(IReadOnlyDictionary<string, string> values, IPluginLogger? logger = null)
    {
        ArgumentNullException.ThrowIfNull(values);

        return new BluOsSettings(
            IsOn(values, DiscoverKey, whenUnreadable: true),
            Players(values, logger),
            Text(values, CaptionKey),
            Address(values, LogoKey, logger));
    }

    /// <summary>The station's own rule for reading an on/off setting out of text.</summary>
    private static bool IsOn(IReadOnlyDictionary<string, string> values, string key, bool whenUnreadable)
    {
        if (!values.TryGetValue(key, out var text))
        {
            return whenUnreadable;
        }

        return text.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" => true,
            "false" or "0" or "no" or "off" => false,
            _ => whenUnreadable,
        };
    }

    private static string? Text(IReadOnlyDictionary<string, string> values, string key) =>
        values.TryGetValue(key, out var text) && !string.IsNullOrWhiteSpace(text) ? text.Trim() : null;

    private static Uri? Address(IReadOnlyDictionary<string, string> values, string key, IPluginLogger? logger)
    {
        if (Text(values, key) is not { } text)
        {
            return null;
        }

        // http or https specifically, rather than any absolute address. A player fetches this over
        // the network and can do nothing with anything else — and on a Unix host a bare path like
        // "/logo.png" parses happily as an absolute file address, which would be sent to a speaker
        // that has no such file.
        if (Uri.TryCreate(text, UriKind.Absolute, out var address)
            && (address.Scheme == Uri.UriSchemeHttp || address.Scheme == Uri.UriSchemeHttps))
        {
            return address;
        }

        logger?.Warn($"""ignoring the {key} setting: "{text}" is not an http or https address a player could fetch.""");
        return null;
    }

    /// <summary>
    /// One address per line, or per comma. Both, because a text box invites lines and a habit of
    /// commas, and neither is worth correcting somebody about.
    /// </summary>
    private static List<BluOsEndpoint> Players(IReadOnlyDictionary<string, string> values, IPluginLogger? logger)
    {
        if (Text(values, PlayersKey) is not { } text)
        {
            return [];
        }


        var players = new List<BluOsEndpoint>();

        foreach (var entry in text.Split(['\n', '\r', ','], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (BluOsEndpoint.TryParse(entry, out var endpoint) && endpoint is not null)
            {
                if (!players.Contains(endpoint))
                {
                    players.Add(endpoint);
                }
            }
            else
            {
                // One line the operator will not get a player from, said once, rather than a plugin
                // that refuses to start over a typo in the third of four addresses.
                logger?.Warn($"""ignoring "{entry}": it is not a host, or a host and a port.""");
            }
        }

        return players;
    }
}
