using Avalonia.Styling;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;

namespace MaroonedSoftware.Deadair.Desktop.Themes;

/// <summary>
/// Which of Avalonia's variants an <see cref="Appearance"/> asks for.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="ThemeVariant.Default"/> is not a third look. It is the absence of a choice, which
/// Avalonia resolves against the operating system and re-resolves when the operating system changes
/// its mind — so <see cref="Appearance.System"/> costs no watcher here and needs no restart.
/// </para>
/// <para>
/// This replaces the three consoles the app carried over from the web console. The argument is in
/// <c>Themes/Tokens.axaml</c>: a listener who has told macOS they want light has already answered
/// the only appearance question worth asking them.
/// </para>
/// </remarks>
public static class AppearanceVariants
{
    public static ThemeVariant For(Appearance appearance) => appearance switch
    {
        Appearance.Light => ThemeVariant.Light,
        Appearance.Dark => ThemeVariant.Dark,
        _ => ThemeVariant.Default,
    };
}
