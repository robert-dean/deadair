using System.Globalization;
using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Forms;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Programme;

/// <summary>
/// What the station plays in the hours no block claims: a slot with the when-half taken off.
/// </summary>
/// <remarks>
/// <para>
/// Stored as station settings (the keys are the station's own <c>SUSTAINING_KEYS</c>) and drawn by the
/// web console's sustaining panel rather than the Settings page. The words, the period and the calls
/// are ordinary declared fields and go through the shared form; the source is NOT, because the plugin
/// and the playlist are one choice over what the plugins actually offer, and two hand-typed id boxes is
/// how an id comes to be written in a form nothing can read.
/// </para>
/// <para>
/// A chart is read first, which is the precedence the station reads them with; saying it the other way
/// round here would show a playlist the station is not actually sustaining from.
/// </para>
/// </remarks>
public static class Sustaining
{
    public const string PluginKey = "schedule.sustainingPluginId";
    public const string PlaylistKey = "schedule.sustainingPlaylistId";
    public const string ChartKey = "schedule.sustainingChartId";
    public const string ChartOrderKey = "schedule.sustainingChartOrder";
    public const string BriefKey = "schedule.sustainingBrief";
    public const string EraFromKey = "schedule.sustainingEraFrom";
    public const string EraToKey = "schedule.sustainingEraTo";
    public const string CallinsKey = "schedule.sustainingCallins";

    /// <summary>The keys the shared form draws, in the web console's order. The source is drawn apart.</summary>
    public static IReadOnlyList<string> FormKeys { get; } = [BriefKey, EraFromKey, EraToKey, CallinsKey];

    /// <summary>What the stored settings sustain from, or null for nothing.</summary>
    public static ProgrammeSource? Source(IReadOnlyDictionary<string, JsonElement> values)
    {
        ArgumentNullException.ThrowIfNull(values);

        if (Text(values, ChartKey) is { } chart)
        {
            return new ProgrammeSource.Chart(chart);
        }

        return Text(values, PluginKey) is { } plugin && Text(values, PlaylistKey) is { } playlist
            ? new ProgrammeSource.Playlist(plugin, playlist)
            : null;
    }

    /// <summary>Which way round a stored chart plays. Anything unreadable is a countdown, as the station reads it.</summary>
    public static ScheduleSlotSourceChartOrder ChartOrder(IReadOnlyDictionary<string, JsonElement> values) =>
        Text(values, ChartOrderKey) switch
        {
            "ranked" => ScheduleSlotSourceChartOrder.Ranked,
            "unordered" => ScheduleSlotSourceChartOrder.Unordered,
            _ => ScheduleSlotSourceChartOrder.Countdown,
        };

    /// <summary>
    /// The four writes a change of source is: every half of every arm, with the arm not chosen
    /// CLEARED rather than left.
    /// </summary>
    /// <remarks>
    /// A stale chart id beside a fresh playlist is a source that would win over it, so choosing a
    /// playlist has to remove the chart. JSON null deletes the row, which is how a setting goes back to
    /// unset rather than being pinned to an empty string. Values are strings, as every layer of the
    /// station's configuration holds text.
    /// </remarks>
    public static Dictionary<string, JsonElement> Writes(ProgrammeSource? source, ScheduleSlotSourceChartOrder order)
    {
        var playlist = source as ProgrammeSource.Playlist;
        var chart = source as ProgrammeSource.Chart;

        return new Dictionary<string, JsonElement>(StringComparer.Ordinal)
        {
            [PluginKey] = Value(playlist?.PluginId),
            [PlaylistKey] = Value(playlist?.PlaylistId),
            [ChartKey] = Value(chart?.ChartId),
            [ChartOrderKey] = Value(chart is null ? null : OrderWord(order)),
        };
    }

    /// <summary>
    /// What plays between blocks, as one line.
    /// </summary>
    /// <remarks>
    /// A playlist is named by its own name where the plugins answered and by its id where they did not,
    /// rather than the line waiting on an unrelated read. With nothing set it says what the station
    /// does, which is keep what was on: a working station, not a fault. Calls are mentioned only beside
    /// something that plays, since the station treats a calls switch on its own as no source.
    /// </remarks>
    public static string Summary(
        IReadOnlyDictionary<string, JsonElement> values,
        IEnumerable<CatalogPlaylist> playlists,
        IEnumerable<StationChart> charts)
    {
        ArgumentNullException.ThrowIfNull(values);
        ArgumentNullException.ThrowIfNull(playlists);
        ArgumentNullException.ThrowIfNull(charts);

        var parts = new List<string>();

        switch (Source(values))
        {
            case ProgrammeSource.Chart chart:
                var name = charts.FirstOrDefault(entry => entry.Id == chart.ChartId)?.Name ?? chart.ChartId;
                parts.Add(ChartOrder(values) == ScheduleSlotSourceChartOrder.Countdown ? $"{name}, counting down" : name);
                break;
            case ProgrammeSource.Playlist playlist:
                var known = playlists.FirstOrDefault(entry => entry.PluginId == playlist.PluginId && entry.Id == playlist.PlaylistId);
                parts.Add(known is null ? playlist.PlaylistId : $"{known.Name} from {known.PluginName}");
                break;
        }

        if (Text(values, BriefKey) is { } brief)
        {
            parts.Add($"“{brief}”");
        }

        if (Period(Year(values, EraFromKey), Year(values, EraToKey)) is { } period)
        {
            parts.Add(period);
        }

        if (parts.Count == 0)
        {
            return "Nothing is set to play between blocks, so a gap keeps whatever the last block left on.";
        }

        if (FormValues.IsOn(Text(values, CallinsKey), null))
        {
            parts.Add("taking calls");
        }

        return $"Between blocks: {string.Join(" · ", parts)}";
    }

    private static string? Period(long? from, long? to) => (from, to) switch
    {
        ({ } start, { } end) => string.Create(CultureInfo.InvariantCulture, $"{start}–{end}"),
        ({ } start, null) => string.Create(CultureInfo.InvariantCulture, $"{start} onwards"),
        (null, { } end) => string.Create(CultureInfo.InvariantCulture, $"up to {end}"),
        _ => null,
    };

    private static string OrderWord(ScheduleSlotSourceChartOrder order) => order switch
    {
        ScheduleSlotSourceChartOrder.Ranked => "ranked",
        ScheduleSlotSourceChartOrder.Unordered => "unordered",
        _ => "countdown",
    };

    private static JsonElement Value(string? text) => text is null ? FormValues.Clear : JsonSerializer.SerializeToElement(text);

    /// <summary>A stored setting as text, where absent and empty are the same thing.</summary>
    private static string? Text(IReadOnlyDictionary<string, JsonElement> values, string key) =>
        values.TryGetValue(key, out var value) && FormValues.Read(value)?.Trim() is { Length: > 0 } text ? text : null;

    private static long? Year(IReadOnlyDictionary<string, JsonElement> values, string key) =>
        long.TryParse(Text(values, key), NumberStyles.Integer, CultureInfo.InvariantCulture, out var year) ? year : null;
}
