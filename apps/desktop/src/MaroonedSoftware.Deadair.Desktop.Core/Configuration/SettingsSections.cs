using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Configuration;

/// <summary>Every section the Settings page can show.</summary>
/// <remarks>
/// A closed set rather than strings, for the reason <c>Destination</c> is one: a section named in a
/// switch that does not exist is a compile error rather than a blank page.
/// </remarks>
public enum SettingsSectionId
{
    /// <summary>This install's own card: appearance, station, format, sleep, updates, the log, extensions.</summary>
    App,

    Station,

    Stream,

    Housekeeping,

    Mail,

    Languages,

    Security,

    Rotation,

    Breaks,

    Bulletins,

    Playout,

    Render,

    Llm,

    Analysis,

    Artwork,

    Storage,

    Providers,

    Grants,

    Plugins,
}

/// <summary>One section of Settings: what it is called, the line under that, and where its contents come from.</summary>
/// <param name="Id">Which section.</param>
/// <param name="Label">What the list calls it.</param>
/// <param name="Hint">What it holds, which is the half a bare label leaves out.</param>
/// <param name="Group">The declared group of station settings it draws, for the ones that draw one.</param>
/// <param name="Blurb">The sentence under the heading, for a section that draws a group (and Providers).</param>
public sealed record SettingsSection(
    SettingsSectionId Id,
    string Label,
    string Hint,
    SettingGroup? Group = null,
    string? Blurb = null)
{
    /// <summary>Whether it belongs to the station, and so needs an operator. Only this app's own card does not.</summary>
    public bool NeedsOperator => Id != SettingsSectionId.App;
}

/// <summary>
/// The sections, in the order an operator should meet them: the web console's <c>SETTINGS_SECTIONS</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>This is the only list</b>, as it is on the web: the page draws what this names, so a group
/// nobody names simply never appears here. Four declared groups are deliberately absent, for the
/// console's own reasons: <c>schedule</c> is edited beside the timetable that makes sense of it,
/// <c>personas</c> above the roster whose names override it, <c>phrasings</c> beside everything else
/// the station says, and <c>providers</c> is drawn by the Providers section as a choice between plugins
/// rather than as text fields holding plugin ids.
/// </para>
/// <para>
/// The console's Appearance and Languages sections are about the CONSOLE, a web page. This app's own
/// card stands where Appearance stands, and says what is this install's rather than the station's.
/// </para>
/// <para>
/// The words are the console's English catalog, copied rather than invented, so an operator who uses
/// both reads one set of names.
/// </para>
/// </remarks>
public static class SettingsSections
{
    public static IReadOnlyList<SettingsSection> All { get; } =
    [
        new(SettingsSectionId.App, "This app", "How this app looks and listens, on this Mac"),

        new(SettingsSectionId.Station, "Station", "Its name, where it is and its clock", SettingGroup.Station,
            "What the station is called, where it is, and the clock it tells the time by. Icecast reads the name from a file rendered on save, so a new one reaches the stream on its next restart."),
        new(SettingsSectionId.Stream, "Stream", "What puts it on air, in what formats", SettingGroup.Stream,
            "The mounts the station publishes to: their formats and bitrates, HLS, how Icecast describes the station to players and directories, and the Icecast connection they all go through. Icecast and Liquidsoap read these from files rendered on save, so a change reaches them on their next restart."),
        new(SettingsSectionId.Housekeeping, "Housekeeping", "How long it keeps its own history", SettingGroup.Housekeeping,
            "How long the station keeps its own history, and how much of a library sync it will trust before it refuses rather than throwing the rest away."),

        // Ahead of Sign-in and security because it is what makes that section's email step work.
        new(SettingsSectionId.Mail, "Mail", "Where it sends sign-in codes from", SettingGroup.Mail,
            "The mail server the station signs people in through. Without one it cannot send a code or a sign-in link, and it says so rather than failing quietly."),
        // The web CONSOLE's languages, beside the question about how it looks as it is there. Never
        // the language the station broadcasts in, which is a Stream setting.
        new(SettingsSectionId.Languages, "Languages", "What the web console can be shown in"),
        new(SettingsSectionId.Security, "Sign-in and security", "How you sign in, and how everybody else may", SettingGroup.Signin,
            "The identity providers the sign-in page offers beside a password, such as Authelia, Authentik, Keycloak or Google, and the addresses allowed to create an account through one. Anyone who already has an account can sign in through a provider linked to it whatever the list says. Below them, whether apps such as a Claude connector may connect to the station as whoever approves them."),

        new(SettingsSectionId.Rotation, "Rotation", "What it plays, and how often it repeats", SettingGroup.Rotation,
            "How the station programmes itself when nothing more specific is asked for: how soon a record or an artist may come back, how long a record may be, and where each batch comes from. A lineup can override the spacing rules for itself, and a setlist or a feature ignores all of them."),
        new(SettingsSectionId.Breaks, "Breaks", "How often it talks, and for how long", SettingGroup.Breaks,
            "How often the station talks between records and how long it may go on: breaks, jingles, calls, the welcome for a new listener and the word when the show changes. A lineup can override whether it talks and how often, and a setlist or a feature switches all of it off. What it says is under Voice."),
        new(SettingsSectionId.Bulletins, "Bulletins", "What it reads of the news, the weather and the date", SettingGroup.Bulletins,
            "What goes into a news bulletin, a weather report and a reading of the date, and whether the presenter may bring the weather or the date up between records. When a bulletin airs is the format clock, under Programme; the words around it are under Voice."),
        new(SettingsSectionId.Playout, "Playout", "What puts it on air", SettingGroup.Playout, "What puts the station on air."),
        new(SettingsSectionId.Render, "Voice and audio", "How it speaks, and how a programme is assembled", SettingGroup.Render,
            "How the station speaks, and how a programme written in parts is put together."),
        new(SettingsSectionId.Llm, "Words", "What it writes, and which model writes it", SettingGroup.Llm,
            "What the station writes for itself and which model writes each of them. WHICH plugin it asks is under Providers; with none set up it still writes its own breaks, from what is either side of them in the running order."),
        new(SettingsSectionId.Analysis, "Measurement", "How much of the library it measures at once", SettingGroup.Analysis,
            "How widely the station measures its records, so it can trim the dead air off each one and know how long it may talk over an intro. WHICH plugin measures them is under Providers; with none set up every track still plays, unmeasured."),

        new(SettingsSectionId.Artwork, "Artwork", "The pictures a listener's player shows"),
        new(SettingsSectionId.Storage, "Storage", "What the caches are holding"),

        // Immediately before the plugin sections, because it is the question they raise.
        new(SettingsSectionId.Providers, "Providers", "Who does what, and who is asked first", Blurb:
            "The jobs more than one of your plugins can do, and which of them the station uses. Nothing here switches a plugin on or off: that is the Plugins section, and this decides what the station does with the ones that are running."),
        new(SettingsSectionId.Grants, "Waiting on you", "What plugins have asked for"),
        new(SettingsSectionId.Plugins, "Plugins", "What the station runs, and what they have asked for"),
    ];

    /// <summary>The declared fields a group section draws, in the order the station declared them.</summary>
    public static IReadOnlyList<StationSettingDescriptor> Fields(StationSettings settings, SettingGroup group)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return [.. settings.Descriptors.Where(descriptor => descriptor.Group == group)];
    }
}
