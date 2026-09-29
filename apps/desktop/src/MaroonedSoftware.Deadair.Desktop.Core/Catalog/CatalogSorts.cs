using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Catalog;

/// <summary>One ordering a list can be asked for, and what the choice says.</summary>
public sealed record SortChoice<T>(T Key, string Label)
    where T : struct, Enum
{
    public override string ToString() => Label;
}

/// <summary>
/// The orderings the station's catalog lists take, as the console offers them.
/// </summary>
/// <remarks>
/// A choice rather than clickable column headings, which is the console's own answer on a phone: a
/// list here has no heading row, and a sort is one gesture that starts the list again at its first
/// page. A state is not among them, and the contract says why: it is three independent facts, so no
/// order of it is one an operator would agree with.
/// </remarks>
public static class CatalogSorts
{
    public static IReadOnlyList<SortChoice<TrackSort>> Tracks { get; } =
    [
        new(TrackSort.Title, "Title"),
        new(TrackSort.Artist, "Artist"),
        new(TrackSort.Album, "Album"),
        new(TrackSort.Year, "Year"),
        new(TrackSort.Duration, "Duration"),
        new(TrackSort.Rating, "Rating"),
    ];

    /// <summary>An act's orderings. Year belongs to a release, so an act has none.</summary>
    public static IReadOnlyList<SortChoice<CatalogSort>> Artists { get; } =
    [
        new(CatalogSort.Name, "Name"),
        new(CatalogSort.Albums, "Releases"),
        new(CatalogSort.Tracks, "Records"),
        new(CatalogSort.Rating, "Rating"),
    ];

    /// <summary>A release's orderings.</summary>
    public static IReadOnlyList<SortChoice<CatalogSort>> Albums { get; } =
    [
        new(CatalogSort.Name, "Name"),
        new(CatalogSort.Year, "Year"),
        new(CatalogSort.Tracks, "Records"),
        new(CatalogSort.Rating, "Rating"),
    ];
}
