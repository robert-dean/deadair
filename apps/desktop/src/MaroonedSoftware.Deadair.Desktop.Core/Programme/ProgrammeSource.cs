using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Programme;

/// <summary>
/// Where a block's records come from: a provider's playlist, a published chart, or a playlist the
/// station owns.
/// </summary>
/// <remarks>
/// A closed set of alternatives rather than optional fields, because the station takes exactly one
/// of them and can make no sense of two. A shape that could hold several would push the choice of
/// which wins into every caller.
/// </remarks>
public abstract record ProgrammeSource
{
    private ProgrammeSource()
    {
    }

    /// <summary>One of a plugin's playlists, read from the provider when the block starts.</summary>
    public sealed record Playlist(string PluginId, string PlaylistId) : ProgrammeSource;

    /// <summary>A published chart, qualified as <c>plugin:chart</c>. Its records are looked up and fetched.</summary>
    public sealed record Chart(string ChartId) : ProgrammeSource;

    /// <summary>A playlist the station keeps, read from its own library, so it starts on time however long it is.</summary>
    public sealed record Station(Guid PlaylistId) : ProgrammeSource;

    /// <summary>What a stored slot plays from, in the station's own precedence: a chart, then its own playlist, then a provider's.</summary>
    public static ProgrammeSource? Of(ScheduleSlot slot)
    {
        ArgumentNullException.ThrowIfNull(slot);

        if (slot.SourceChartId is { Length: > 0 } chart)
        {
            return new Chart(chart);
        }

        if (slot.SourceStationPlaylistId is { } owned)
        {
            return new Station(owned);
        }

        return slot.SourcePluginId is { Length: > 0 } plugin && slot.SourcePlaylistId is { Length: > 0 } playlist
            ? new Playlist(plugin, playlist)
            : null;
    }

    /// <summary>Whether records that sound like this one can be mixed in: a playlist of either kind, and nothing else.</summary>
    public static bool MixesInto(ProgrammeSource? source) => source is Playlist or Station;
}

/// <summary>One entry in the "Playing from" picker.</summary>
/// <param name="Source">What choosing it plays from, or null for a block the station fills itself.</param>
/// <param name="Group">Which kind of thing it is, drawn beside it: the picker has no headings.</param>
public sealed record SourceChoice(string Label, string Group, ProgrammeSource? Source);

/// <summary>
/// The picker's entries, from what the station and its plugins offer.
/// </summary>
/// <remarks>
/// <para>
/// A playlist is offered only when it is not hidden and its source will hand over its tracks:
/// offering one it refuses moves the failure to air time, where nobody is looking. Absent permissions
/// mean the source did not say, which stays usable, because most never populate the field.
/// </para>
/// <para>
/// What the slot already plays from is ALWAYS offered, whatever it is. A slot saved before its playlist
/// was hidden still plays from it, and a picker whose value is missing from its entries draws as
/// empty, which would tell the operator the slot plays nothing at all. When the catalog cannot name
/// it (a plugin that did not answer) it is offered under its id rather than dropped.
/// </para>
/// </remarks>
public static class SourceChoices
{
    public const string Nothing = "Nothing: the station fills it itself";

    public static IReadOnlyList<SourceChoice> Build(
        IEnumerable<StationPlaylist> owned,
        IEnumerable<CatalogPlaylist> playlists,
        IEnumerable<StationChart> charts,
        ProgrammeSource? chosen,
        bool includeOwned = true)
    {
        ArgumentNullException.ThrowIfNull(owned);
        ArgumentNullException.ThrowIfNull(playlists);
        ArgumentNullException.ThrowIfNull(charts);

        var choices = new List<SourceChoice> { new(Nothing, string.Empty, null) };

        if (includeOwned)
        {
            foreach (var playlist in owned)
            {
                if (Guid.TryParse(playlist.Id, out var id))
                {
                    choices.Add(new SourceChoice(playlist.Name, "The station's", new ProgrammeSource.Station(id)));
                }
            }
        }

        foreach (var playlist in playlists)
        {
            var source = new ProgrammeSource.Playlist(playlist.PluginId, playlist.Id);
            if ((playlist.Hidden != true && CanReadTracks(playlist)) || source == chosen)
            {
                choices.Add(new SourceChoice(playlist.Name, playlist.PluginName, source));
            }
        }

        foreach (var chart in charts)
        {
            choices.Add(new SourceChoice(chart.Name, $"Chart · {chart.PluginId}", new ProgrammeSource.Chart(chart.Id)));
        }

        if (chosen is not null && choices.All(choice => choice.Source != chosen))
        {
            choices.Add(new SourceChoice(Describe(chosen), "Not listed now", chosen));
        }

        return choices;
    }

    /// <summary>Only an explicit list that leaves out <c>read</c> is a refusal.</summary>
    public static bool CanReadTracks(CatalogPlaylist playlist)
    {
        ArgumentNullException.ThrowIfNull(playlist);
        return playlist.Permissions is not { } permissions || permissions.Contains(PlaylistPermission.Read);
    }

    private static string Describe(ProgrammeSource source) => source switch
    {
        ProgrammeSource.Playlist playlist => playlist.PlaylistId,
        ProgrammeSource.Chart chart => chart.ChartId,
        ProgrammeSource.Station station => station.PlaylistId.ToString(),
        _ => string.Empty,
    };
}
