using System.Globalization;
using Avalonia.Data;
using Avalonia.Data.Converters;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;

namespace MaroonedSoftware.Deadair.Desktop.Themes;

/// <summary>
/// One radio button's worth of a three-way choice.
/// </summary>
/// <remarks>
/// A radio button is a boolean and the setting is not, so something has to turn "which one" into
/// three "is it this one". Doing it with three converters rather than a `ConverterParameter` keeps
/// the answer a compile-time member: a mistyped parameter string is a button that never lights up
/// and never says why.
///
/// The unchecked direction answers <see cref="BindingOperations.DoNothing"/> rather than a value:
/// checking one button unchecks its neighbours, and a converter that wrote on the way down would
/// have the loser overwrite the winner.
/// </remarks>
public sealed class AppearanceConverter(Appearance appearance) : IValueConverter
{
    public static AppearanceConverter System { get; } = new(Appearance.System);

    public static AppearanceConverter Light { get; } = new(Appearance.Light);

    public static AppearanceConverter Dark { get; } = new(Appearance.Dark);

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is Appearance current && current == appearance;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is true ? appearance : BindingOperations.DoNothing;
}
