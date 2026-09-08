using Avalonia;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;

namespace MaroonedSoftware.Deadair.Desktop.Themes;

/// <summary>
/// Whether this install follows the system, and applying that choice.
/// </summary>
/// <remarks>
/// An object rather than a static, because the choice is restored at startup, changed from a page and
/// read back by whatever wants to show it — three callers that must not each know how a variant is
/// set on the application.
/// </remarks>
public sealed class ThemeManager
{
    public Appearance Current { get; private set; } = Appearance.System;

    public void Apply(Appearance appearance)
    {
        Current = appearance;

        if (Application.Current is { } application)
        {
            application.RequestedThemeVariant = AppearanceVariants.For(appearance);
        }
    }
}
