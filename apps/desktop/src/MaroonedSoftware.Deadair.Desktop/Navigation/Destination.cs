namespace MaroonedSoftware.Deadair.Desktop.Navigation;

/// <summary>
/// Somewhere the app can be.
/// </summary>
/// <remarks>
/// A closed hierarchy rather than strings, so a link to a page that does not exist is a compile
/// error. The web console arrived at the same rule the hard way: an untyped link shipped pointing at
/// a route that had never existed, and a second one sent every talk break to the whole history.
/// </remarks>
public abstract record Destination
{
    private Destination()
    {
    }

    /// <summary>What is on air, the transport, and the running order.</summary>
    public sealed record Desk : Destination;

    /// <summary>What the station is scheduled to do.</summary>
    public sealed record Programme : Destination;

    /// <summary>The records the station can draw on.</summary>
    public sealed record Library : Destination;

    /// <summary>What has already played.</summary>
    public sealed record History : Destination;

    /// <summary>How the station itself is doing.</summary>
    public sealed record Checkup : Destination;

    /// <summary>Who the station is, and what it has said.</summary>
    public sealed record Voice : Destination;

    /// <summary>The station's configuration, and this app's own.</summary>
    public sealed record Settings : Destination;
}

/// <summary>
/// Which heading a destination sits under in the sidebar.
/// </summary>
/// <remarks>
/// The three are a sentence about what this app is: you can <see cref="Listen"/> without an account,
/// the <see cref="Desk"/> is what an account buys, and <see cref="App"/> is this install's own. So a
/// section is not decoration — it is the same account rule the rail already enforces, said out loud
/// where somebody can read it rather than inferred from which entries have gone missing.
/// </remarks>
public enum NavSection
{
    Listen,

    Desk,

    App,
}

/// <param name="Destination">Where it goes.</param>
/// <param name="Label">What the sidebar calls it.</param>
/// <param name="Key">The keyboard shortcut, without a modifier.</param>
/// <param name="NeedsOperator">
/// Whether it is drawn only for the operator. Listening is accountless, so the pages a listener can
/// use are shown to everybody and the rest appear when somebody signs in.
/// </param>
/// <param name="Section">The heading it sits under.</param>
/// <param name="Icon">
/// The key of a `StreamGeometry` in `Themes/Icons.axaml`. A key rather than the geometry because
/// this list is built before any Avalonia application exists, and a test asserts every entry names
/// one that is really there.
/// </param>
public sealed record NavigationEntry(
    Destination Destination,
    string Label,
    string Key,
    bool NeedsOperator,
    NavSection Section,
    string Icon);

/// <summary>The rail, as one list, so the shortcuts and the buttons cannot disagree.</summary>
public static class Destinations
{
    public static IReadOnlyList<NavigationEntry> All { get; } =
    [
        new(new Destination.Desk(), "Desk", "D", NeedsOperator: false, NavSection.Listen, "DaIconDesk"),
        new(new Destination.History(), "History", "H", NeedsOperator: false, NavSection.Listen, "DaIconHistory"),

        new(new Destination.Programme(), "Programme", "P", NeedsOperator: true, NavSection.Desk, "DaIconProgramme"),
        new(new Destination.Library(), "Library", "L", NeedsOperator: true, NavSection.Desk, "DaIconLibrary"),
        new(new Destination.Voice(), "Voice", "V", NeedsOperator: true, NavSection.Desk, "DaIconVoice"),
        new(new Destination.Checkup(), "Check-up", "C", NeedsOperator: true, NavSection.Desk, "DaIconCheckup"),

        // Reachable with no account, because Appearance is this install's own and somebody who only
        // listens should still be able to say whether they are looking at a light app or a dark one.
        new(new Destination.Settings(), "Settings", "S", NeedsOperator: false, NavSection.App, "DaIconSettings"),
    ];
}
