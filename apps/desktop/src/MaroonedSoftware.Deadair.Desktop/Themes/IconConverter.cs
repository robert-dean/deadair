using System.Globalization;
using Avalonia.Data.Converters;
using Avalonia.Media;

namespace MaroonedSoftware.Deadair.Desktop.Themes;

/// <summary>
/// An icon's resource key as the geometry it names.
/// </summary>
/// <remarks>
/// The alternative was resolving the geometry when a navigation entry is built, which would tie a
/// list that exists before any window does to whether the application's resources happen to be
/// loaded yet. A converter asks at draw time, when the answer is certainly there, and it is the same
/// shape as <see cref="ToneBrushConverter"/> — the one other place this app turns a name into
/// something drawable.
///
/// A key that names nothing draws nothing rather than throwing. A missing icon is a gap in a row; a
/// throw is a window that will not open, which is a worse answer to a typo. `NavigationTests` is
/// what stops the typo happening at all.
/// </remarks>
public sealed class IconConverter : IValueConverter
{
    public static IconConverter Instance { get; } = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is not string key || Avalonia.Application.Current is not { } application)
        {
            return null;
        }

        return application.Resources.TryGetResource(key, application.ActualThemeVariant, out var geometry)
            ? geometry as Geometry
            : null;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
