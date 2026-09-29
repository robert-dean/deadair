using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.Core.Catalog;

/// <summary>A music source's playlists, sorted the way the page shows them.</summary>
/// <param name="Chosen">The ones somebody put in the source themselves: shown.</param>
/// <param name="MadeByProvider">The ones the source made on its own (mixes, radio): folded away.</param>
/// <param name="Hidden">The ones an operator hid: folded away, and left out of every picker.</param>
public sealed record PlaylistGroups(
    IReadOnlyList<CatalogPlaylist> Chosen,
    IReadOnlyList<CatalogPlaylist> MadeByProvider,
    IReadOnlyList<CatalogPlaylist> Hidden);

/// <summary>A source an import reads, or why a chosen file cannot be one.</summary>
public sealed record ImportSource(PlaylistImportInput? Input, string? Problem);

/// <summary>
/// The rules of the Playlists tab, from the web console's playlists pages.
/// </summary>
/// <remarks>
/// A playlist a source will not hand the tracks of cannot be aired or refreshed either, so one
/// permission gates all three, and a playlist that says nothing about permissions is readable: the
/// field is absent on every source that has no notion of sharing.
/// </remarks>
public static class PlaylistRules
{
    public static bool CanReadTracks(CatalogPlaylist playlist)
    {
        ArgumentNullException.ThrowIfNull(playlist);
        return playlist.Permissions?.Contains(PlaylistPermission.Read) ?? true;
    }

    /// <summary>Hidden first, because a hidden playlist made by the provider is hidden before it is anything else.</summary>
    public static PlaylistGroups Group(IEnumerable<CatalogPlaylist> playlists)
    {
        ArgumentNullException.ThrowIfNull(playlists);

        var all = playlists.ToList();
        return new(
            [.. all.Where(each => each.Hidden != true && each.MadeByProvider != true)],
            [.. all.Where(each => each.Hidden != true && each.MadeByProvider == true)],
            [.. all.Where(each => each.Hidden == true)]);
    }

    /// <summary>Who made the folded playlists: "Spotify and YouTube Music".</summary>
    public static string Makers(IEnumerable<CatalogPlaylist> playlists) =>
        string.Join(" and ", playlists.Select(each => each.PluginName).Distinct(StringComparer.Ordinal));

    public static string Availability(int fromSources, int own) => own == 0
        ? $"{fromSources} available"
        : $"{own} of the station's own, {fromSources} from music sources";

    /// <summary>How much of a station playlist the library holds, said only when it is not all of it.</summary>
    public static string Holding(long records, long held)
    {
        var count = records == 1 ? "1 record" : $"{records} records";
        return held == records ? count : $"{count} · {held} in the library";
    }

    /// <summary>What a preview found, in one sentence.</summary>
    public static string Plan(PlaylistImportPlan plan)
    {
        ArgumentNullException.ThrowIfNull(plan);

        var waiting = plan.ToAdd + plan.ToLookUp;
        if (waiting == 0)
        {
            return plan.Matched == 1 ? "1 record is in the library." : $"{plan.Matched} records are in the library.";
        }

        var matched = plan.Matched == 1 ? "1 record is" : $"{plan.Matched} records are";
        return waiting == 1
            ? $"{matched} in the library, and 1 is not: the station looks it up once the playlist is made."
            : $"{matched} in the library, and {waiting} are not: the station looks them up once the playlist is made.";
    }

    /// <summary>
    /// Reads a chosen file as something to import.
    /// </summary>
    /// <remarks>
    /// A JSON file is a playlist another station exported and is sent as the structured file; anything
    /// else (an M3U, a CSV, a list) is sent as text with its name, and the station decides what it is.
    /// A JSON file that does not parse is said here, since sending it as text would only be refused.
    /// </remarks>
    public static ImportSource FromFile(string name, byte[] data)
    {
        ArgumentNullException.ThrowIfNull(name);
        ArgumentNullException.ThrowIfNull(data);

        var text = Encoding.UTF8.GetString(data).TrimStart('﻿');
        if (!name.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
        {
            return new(new PlaylistImportInput { Text = text, FileName = name }, null);
        }

        try
        {
            return JsonSerializer.Deserialize<PlaylistFile>(text, SdkJson.Options) is { } file
                ? new(new PlaylistImportInput { File = file }, null)
                : new(null, Unreadable(name));
        }
        catch (JsonException)
        {
            return new(null, Unreadable(name));
        }
    }

    /// <summary>The name to offer when saving an export: the station's own, from its header, or the playlist's.</summary>
    public static string ExportName(string? contentDisposition, string playlistName)
    {
        if (contentDisposition is not null
            && ContentDispositionHeaderValue.TryParse(contentDisposition, out var header)
            && (header.FileNameStar ?? header.FileName)?.Trim('"') is { Length: > 0 } named)
        {
            return named;
        }

        var safe = new string([.. (playlistName ?? string.Empty).Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '-' : c)]).Trim();
        return string.Create(CultureInfo.InvariantCulture, $"{(safe.Length == 0 ? "playlist" : safe)}.json");
    }

    /// <summary>The file an export writes: the station's playlist file, as the station would read it back.</summary>
    public static byte[] ExportBytes(PlaylistFile file) => JsonSerializer.SerializeToUtf8Bytes(file, Indented);

    private static readonly JsonSerializerOptions Indented = new(SdkJson.Options) { WriteIndented = true };

    private static string Unreadable(string name) =>
        $"“{name}” is not a file this can read. A playlist file is the JSON a station playlist's Export saved.";
}
