using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Voicing;

/// <summary>
/// An audition run as the Auditions tab draws it, and the one rule that decides whether it polls.
/// </summary>
/// <remarks>
/// A run fills in over minutes, each break waiting for the model behind everything the station does
/// for itself, so the tab polls while a run is still going and not a moment after. A cancelled run is
/// drawn off rather than as a fault: somebody chose it, and what it wrote is still worth reading.
/// </remarks>
public static class AuditionText
{
    /// <summary>What a Start with nobody thinking about it asks for: about an hour of radio.</summary>
    public const int DefaultBreaks = 10;

    public const int MostBreaks = 50;

    /// <summary>Whether a run can still change, which is the only reason to ask again.</summary>
    public static bool Unsettled(PersonaAuditionSummaryState state) =>
        state is PersonaAuditionSummaryState.Queued or PersonaAuditionSummaryState.Running;

    public static StatusTone Tone(PersonaAuditionSummaryState state) => state switch
    {
        PersonaAuditionSummaryState.Running => StatusTone.Live,
        PersonaAuditionSummaryState.Done => StatusTone.Ok,
        PersonaAuditionSummaryState.Failed => StatusTone.Fault,
        PersonaAuditionSummaryState.Cancelled => StatusTone.Off,
        _ => StatusTone.Standby,
    };

    public static string Label(PersonaAuditionSummaryState state) => state switch
    {
        PersonaAuditionSummaryState.Queued => "Waiting for the model",
        PersonaAuditionSummaryState.Running => "Writing",
        PersonaAuditionSummaryState.Done => "Finished",
        PersonaAuditionSummaryState.Failed => "Stopped by a fault",
        _ => "Stopped",
    };

    /// <summary>
    /// The run in one line: how often the model wrote, and how often the floor covered. It is counted
    /// from the breaks rather than stored, so it is said only once they have been read.
    /// </summary>
    public static string? Tally(IReadOnlyList<PersonaAuditionBreak> breaks)
    {
        ArgumentNullException.ThrowIfNull(breaks);

        if (breaks.Count == 0)
        {
            return null;
        }

        var model = breaks.Count(written => written.Writer == "model");
        var declined = breaks.Count(written => written.Attempts.Any(attempt => attempt.Outcome == "declined"));
        var failed = breaks.Count(written => written.Attempts.Any(attempt => attempt.Outcome == "failed"));

        var parts = new List<string> { $"{model} by the model" };
        if (declined > 0)
        {
            parts.Add($"{declined} declined");
        }

        if (failed > 0)
        {
            parts.Add($"{failed} failed");
        }

        return string.Join(" · ", parts);
    }

    /// <summary>
    /// Where a run's records came from, in one line. Exactly one kind of id is present, so which one
    /// says what the source was, and the id stands in for a caption the run was never given.
    /// </summary>
    public static string Describe(PersonaAuditionSource source)
    {
        ArgumentNullException.ThrowIfNull(source);

        if (source.StationPlaylistId is { } owned)
        {
            return $"{source.Name ?? owned.ToString()} · a station playlist";
        }

        if (source.ChartId is { } chart)
        {
            return $"{source.Name ?? chart} · a chart";
        }

        return $"{source.Name ?? source.PlaylistId} · {source.PluginId}";
    }

    /// <summary>
    /// Whether a playlist can be auditioned: one that is not hidden and whose tracks can be read. A
    /// playlist that says nothing about permissions can be read, as the console reads it.
    /// </summary>
    public static bool Offerable(CatalogPlaylist playlist)
    {
        ArgumentNullException.ThrowIfNull(playlist);
        return playlist.Hidden != true && (playlist.Permissions?.Contains(PlaylistPermission.Read) ?? true);
    }
}
