using Avalonia;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;

namespace MaroonedSoftware.Deadair.Desktop.Themes;

/// <summary>
/// Which console this console is, applied and remembered for the run.
/// </summary>
/// <remarks>
/// An object rather than a static, because the choice is restored at startup, changed from a page and
/// read back by whatever wants to show it — three callers that must not each know how a variant is
/// set on the application.
/// </remarks>
public sealed class ThemeManager
{
    public ThemeId Current { get; private set; } = ThemeId.Carbon;

    public void Apply(ThemeId theme)
    {
        Current = theme;

        if (Application.Current is { } application)
        {
            application.RequestedThemeVariant = ConsoleThemes.For(theme);
        }
    }
}
