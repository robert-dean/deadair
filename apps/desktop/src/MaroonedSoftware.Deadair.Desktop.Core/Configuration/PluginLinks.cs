using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Configuration;

/// <summary>
/// The addresses and names a station plugin's page hands somebody: where a provider sends them back
/// to, what a downloaded log is called, and how the track fetcher's authorization stands.
/// </summary>
public static class PluginLinks
{
    /// <summary>
    /// Where a provider sends somebody back to after they approve a plugin: the CONSOLE's page, on the
    /// station's own origin.
    /// </summary>
    /// <remarks>
    /// This app has no page a browser can land on, and it does not need one: the console's callback
    /// page finishes the exchange for any plugin, and this app watches the plugin until it reports
    /// itself connected. So the address registered with the provider is the same one the console
    /// shows, which means a plugin connected from either works from both.
    /// </remarks>
    public static Uri OAuthCallback(StationUrl station, string pluginId)
    {
        ArgumentNullException.ThrowIfNull(pluginId);
        return new Uri($"{station.Origin.GetLeftPart(UriPartial.Authority)}/plugins/{Uri.EscapeDataString(pluginId)}/oauth/callback");
    }

    /// <summary>The file name a download asked to be saved as, or the fallback when it did not say.</summary>
    /// <remarks>
    /// Reads both the plain <c>filename=</c> and the RFC 5987 <c>filename*=UTF-8''…</c> form, the
    /// second winning as it is the one that can carry more than ASCII. Anything that looks like a path
    /// is cut to its last part, because a name is all a save panel should be offered.
    /// </remarks>
    public static string FileName(string? contentDisposition, string fallback)
    {
        if (string.IsNullOrWhiteSpace(contentDisposition))
        {
            return fallback;
        }

        string? plain = null;
        string? extended = null;

        foreach (var part in contentDisposition.Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            if (part.StartsWith("filename*=", StringComparison.OrdinalIgnoreCase))
            {
                var value = part["filename*=".Length..];
                var quote = value.IndexOf("''", StringComparison.Ordinal);
                extended = Uri.UnescapeDataString(quote >= 0 ? value[(quote + 2)..] : value);
            }
            else if (part.StartsWith("filename=", StringComparison.OrdinalIgnoreCase))
            {
                plain = part["filename=".Length..].Trim('"');
            }
        }

        var name = Path.GetFileName((extended ?? plain ?? string.Empty).Replace('\\', '/'));
        return name.Length > 0 ? name : fallback;
    }

    /// <summary>How the track fetcher's authorization stands, as a word and a tone.</summary>
    public static (string Label, StatusTone Tone) Fetcher(FetcherAuthorization state)
    {
        ArgumentNullException.ThrowIfNull(state);

        if (!state.Configured)
        {
            return ("Not set up", StatusTone.Off);
        }

        if (!state.Reachable)
        {
            return ("Not answering", StatusTone.Standby);
        }

        return state.Authorized ? ("Authorized", StatusTone.Ok) : ("Not authorized", StatusTone.Fault);
    }
}
