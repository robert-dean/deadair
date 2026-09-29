using MaroonedSoftware.Deadair.Desktop.Core.Configuration;

namespace MaroonedSoftware.Deadair.Desktop.Core.Ui;

/// <summary>Which rail page a jump lands on.</summary>
public enum JumpPlace
{
    Desk,
    History,
    Programme,
    Library,
    Voice,
    Checkup,
    Settings,
}

/// <summary>One place the palette offers before anything is typed.</summary>
/// <param name="Place">The rail page.</param>
/// <param name="Tab">
/// The tab or section on it, as the member name of that page's own enum (<c>LibraryTab</c>,
/// <c>SettingsSectionId</c>…), or empty for the page itself. A name rather than the enum because the
/// tab enums belong to the app, and a test holds every name here to one that is really there.
/// </param>
/// <param name="Label">What the tab strip calls it.</param>
/// <param name="Group">The page it is on, which is what the palette files it under.</param>
public sealed record JumpPage(JumpPlace Place, string Tab, string Label, string Group);

/// <summary>
/// Every place the app has, behind one box, and the records, acts and characters once somebody types.
/// </summary>
/// <remarks>
/// <para>
/// The web console's jump-to, for the same reason: the rail is four destinations, which is the right
/// shape for arriving and the wrong one for going somewhere specific. Somebody who wants the
/// pronunciations table should not have to know it is a tab on Voice.
/// </para>
/// <para>
/// The pages are known here and offered at once. The records, acts and characters are asked for only
/// once the query is <see cref="MinQuery"/> characters long and has settled for <see cref="Settle"/>,
/// as the web does: a single letter matches most of a library, and the station rate-limits.
/// </para>
/// </remarks>
public static class JumpTo
{
    /// <summary>Below this many characters a search asks the station nothing.</summary>
    public const int MinQuery = 2;

    /// <summary>How many of each kind of result are asked for.</summary>
    public const int ResultLimit = 6;

    /// <summary>How long typing has to pause before the station is asked.</summary>
    public static TimeSpan Settle { get; } = TimeSpan.FromMilliseconds(250);

    public static IReadOnlyList<JumpPage> Pages { get; } =
    [
        new(JumpPlace.Desk, string.Empty, "Desk", "Places"),
        new(JumpPlace.History, string.Empty, "History", "Places"),

        new(JumpPlace.Programme, "Today", "Today", "Programme"),
        new(JumpPlace.Programme, "Timetable", "Timetable", "Programme"),
        new(JumpPlace.Programme, "Sustaining", "Sustaining", "Programme"),
        new(JumpPlace.Programme, "Requests", "Requests", "Programme"),

        new(JumpPlace.Library, "Tracks", "Records", "Library"),
        new(JumpPlace.Library, "Artists", "Acts", "Library"),
        new(JumpPlace.Library, "Albums", "Releases", "Library"),
        new(JumpPlace.Library, "Playlists", "Playlists", "Library"),
        new(JumpPlace.Library, "Charts", "Charts", "Library"),
        new(JumpPlace.Library, "News", "News", "Library"),
        new(JumpPlace.Library, "Podcasts", "Podcasts", "Library"),
        new(JumpPlace.Library, "Narrations", "Readings", "Library"),

        new(JumpPlace.Voice, "Characters", "Characters", "Voice"),
        new(JumpPlace.Voice, "Auditions", "Auditions", "Voice"),
        new(JumpPlace.Voice, "Voices", "Voices", "Voice"),
        new(JumpPlace.Voice, "Segments", "Segments", "Voice"),
        new(JumpPlace.Voice, "Pronunciations", "Pronunciations", "Voice"),
        new(JumpPlace.Voice, "Soundboard", "Soundboard", "Voice"),
        new(JumpPlace.Voice, "Phrasings", "Phrasings", "Voice"),
        new(JumpPlace.Voice, "Subjects", "Subjects", "Voice"),
        new(JumpPlace.Voice, "Productions", "Productions", "Voice"),
        new(JumpPlace.Voice, "Said", "What it said", "Voice"),

        new(JumpPlace.Checkup, "Machinery", "Machinery", "Check-up"),
        new(JumpPlace.Checkup, "History", "History", "Check-up"),
        new(JumpPlace.Checkup, "Cost", "Cost", "Check-up"),
        new(JumpPlace.Checkup, "Logs", "Logs", "Check-up"),
        new(JumpPlace.Checkup, "Releases", "What's new", "Check-up"),

        // Settings' sections are its own table's, so a section added there is here with nobody
        // remembering this file.
        .. SettingsSections.All.Select(section => new JumpPage(JumpPlace.Settings, section.Id.ToString(), section.Label, "Settings")),
    ];

    /// <summary>Whether a query is long enough to ask the station for records, acts and characters.</summary>
    public static bool Searches(string? query) => (query?.Trim().Length ?? 0) >= MinQuery;

    /// <summary>
    /// The places whose name or page holds what is typed, all of them for nothing typed.
    /// </summary>
    /// <remarks>
    /// The page's own name counts, so "voice" offers every Voice tab: somebody typing the page's name
    /// is looking for somewhere on it.
    /// </remarks>
    public static IReadOnlyList<JumpPage> Filter(IEnumerable<JumpPage> pages, string? query)
    {
        ArgumentNullException.ThrowIfNull(pages);

        var typed = query?.Trim() ?? string.Empty;
        return typed.Length == 0
            ? [.. pages]
            : [.. pages.Where(page =>
                page.Label.Contains(typed, StringComparison.OrdinalIgnoreCase)
                || page.Group.Contains(typed, StringComparison.OrdinalIgnoreCase))];
    }
}
