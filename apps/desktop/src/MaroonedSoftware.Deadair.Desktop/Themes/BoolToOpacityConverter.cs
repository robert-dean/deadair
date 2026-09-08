using System.Globalization;
using Avalonia.Data.Converters;

namespace MaroonedSoftware.Deadair.Desktop.Themes;

/// <summary>
/// Shows or hides something without letting it change the size of anything.
/// </summary>
/// <remarks>
/// Every row in this app is its own grid, so a column that collapses when its content is hidden
/// sizes to that row alone and the rows stop lining up. Moving the ink rather than the layout is the
/// rule the hover-revealed actions already follow.
/// </remarks>
public sealed class BoolToOpacity : IValueConverter
{
    public static BoolToOpacity Instance { get; } = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is true ? 1.0 : 0.0;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>
/// Room for a few lines, when a field is the kind that holds a few.
/// </summary>
/// <remarks>
/// A converter rather than two templates: a box that accepts the return key and is one line tall
/// invites somebody to type a list they cannot see.
/// </remarks>
public sealed class BoolToLines : IValueConverter
{
    public static BoolToLines Instance { get; } = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is true ? 72.0 : 0.0;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
