using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Configuration;

/// <summary>
/// The single reading of a station plugin's status: its word, its tone and the sentence under it.
/// </summary>
/// <remarks>
/// The console's <c>plugin.status.tsx</c>, ported with its words, so a row and a detail page cannot
/// disagree about what <c>misconfigured</c> means. <c>failed</c> wears the LIVE tone rather than a
/// fault's, as it does there: two states share the word (would not start, and quarantined for failing
/// its calls), and both are urgent in a way a setting left incomplete is not.
/// </remarks>
public static class PluginStatusWords
{
    public static string Label(PluginStatus status) => status switch
    {
        PluginStatus.Active => "Active",
        PluginStatus.Disabled => "Disabled",
        PluginStatus.Misconfigured => "Misconfigured",
        PluginStatus.Failed => "Failed",
        _ => "Discovered",
    };

    public static StatusTone Tone(PluginStatus status) => status switch
    {
        PluginStatus.Active => StatusTone.Ok,
        PluginStatus.Disabled => StatusTone.Off,
        PluginStatus.Misconfigured => StatusTone.Fault,
        PluginStatus.Failed => StatusTone.Live,
        _ => StatusTone.Standby,
    };

    public static string Description(PluginStatus status) => status switch
    {
        PluginStatus.Active => "Running and available to the station.",
        PluginStatus.Disabled => "Switched off. Its configuration is kept.",
        PluginStatus.Misconfigured => "Installed, but its settings are incomplete or rejected.",
        PluginStatus.Failed => "It would not start, or it failed too many calls in a row. See the error below.",
        _ => "Found on disk and not yet started.",
    };
}
