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
}

/// <param name="Destination">Where it goes.</param>
/// <param name="Label">What the rail calls it.</param>
/// <param name="Key">The keyboard shortcut, without a modifier.</param>
/// <param name="NeedsOperator">
/// Whether it is drawn only for the operator. Listening is accountless, so the pages a listener can
/// use are shown to everybody and the rest appear when somebody signs in.
/// </param>
public sealed record NavigationEntry(Destination Destination, string Label, string Key, bool NeedsOperator);

/// <summary>The rail, as one list, so the shortcuts and the buttons cannot disagree.</summary>
public static class Destinations
{
    public static IReadOnlyList<NavigationEntry> All { get; } =
    [
        new(new Destination.Desk(), "Desk", "D", NeedsOperator: false),
        new(new Destination.Programme(), "Programme", "P", NeedsOperator: true),
        new(new Destination.Library(), "Library", "L", NeedsOperator: true),
        new(new Destination.History(), "History", "H", NeedsOperator: false),
    ];
}
