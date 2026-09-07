using Avalonia.Styling;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;

namespace MaroonedSoftware.Deadair.Desktop.Themes;

/// <summary>
/// The three consoles this console can be.
/// </summary>
/// <remarks>
/// <para>
/// Ported from the web console, and the reason each is a whole palette rather than one palette with a
/// light and a dark setting is written down there: the status hues carry MEANING, and a scheme switch
/// that moved only the surfaces would leave five tuned colours on a background they were tuned
/// against the opposite of. So each variant restates every token.
/// </para>
/// <para>
/// Carbon is what an install with no stored preference gets, and that is the only sense in which it
/// is special. Nothing else in the app knows its name.
/// </para>
/// </remarks>
public static class ConsoleThemes
{
    /// <summary>The studio at night. Phosphor green on carbon.</summary>
    public static ThemeVariant Carbon { get; } = new(nameof(Carbon), ThemeVariant.Dark);

    /// <summary>Daylight and paper. Rules instead of fills.</summary>
    public static ThemeVariant White { get; } = new(nameof(White), ThemeVariant.Light);

    /// <summary>A night-city HUD. Neon yellow on teal-black.</summary>
    public static ThemeVariant Neon { get; } = new(nameof(Neon), ThemeVariant.Dark);

    public static ThemeVariant For(ThemeId id) => id switch
    {
        ThemeId.White => White,
        ThemeId.Neon => Neon,
        _ => Carbon,
    };

    /// <summary>What the Appearance section offers, in order: the console's own look first.</summary>
    public static IReadOnlyList<ThemeChoice> All { get; } =
    [
        new(ThemeId.Carbon, "Carbon", "The studio at night. Phosphor green on carbon.", "Chakra Petch / IBM Plex",
            ["#0c0e0d", "#191d1b", "#2fd98c", "#ff4b4b"]),
        new(ThemeId.White, "Studio White", "Daylight and paper. Rules instead of fills.", "Newsreader / Public Sans",
            ["#f4f1ea", "#ddd6c8", "#0e7247", "#c81f22"]),
        new(ThemeId.Neon, "Neon Transmitter", "Neon yellow on teal-black. Loudest of the three.", "Chakra Petch / Archivo",
            ["#060a0c", "#141c20", "#fcee0a", "#ff1e46"]),
    ];
}

/// <param name="Id">Which theme.</param>
/// <param name="Name">As the Appearance section names it.</param>
/// <param name="Blurb">One line on what it is for, in the console's own voice.</param>
/// <param name="TypeLabel">The type pair, written out.</param>
/// <param name="Swatches">Four bands, so a theme can be recognised before it is chosen: desk, panel, accent, tally.</param>
public sealed record ThemeChoice(
    ThemeId Id,
    string Name,
    string Blurb,
    string TypeLabel,
    IReadOnlyList<string> Swatches)
{
    /// <summary>Whether this is the console currently on screen.</summary>
    /// <remarks>
    /// Settable rather than derived, because the radio buttons are bound to the choices themselves
    /// and a derived value would need every choice to know about the one that is current.
    /// </remarks>
    public bool IsChosen { get; set; }
}
