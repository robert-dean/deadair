using System.Globalization;
using Avalonia.Data;
using Avalonia.Data.Converters;

namespace MaroonedSoftware.Deadair.Desktop.Themes;

/// <summary>
/// One radio button's worth of the sleep timer's choice, in minutes, with nought for off.
/// </summary>
/// <remarks>
/// The same shape as <see cref="AppearanceConverter"/>, and for its reasons: one converter per button
/// keeps each choice a compile-time member, and the unchecked direction does nothing so that the
/// button losing its check cannot overwrite the one gaining it.
/// </remarks>
public sealed class SleepMinutesConverter(int minutes) : IValueConverter
{
    public static SleepMinutesConverter Off { get; } = new(0);

    public static SleepMinutesConverter Fifteen { get; } = new(15);

    public static SleepMinutesConverter Thirty { get; } = new(30);

    public static SleepMinutesConverter FortyFive { get; } = new(45);

    public static SleepMinutesConverter Sixty { get; } = new(60);

    public static SleepMinutesConverter Ninety { get; } = new(90);

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is int current && current == minutes;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is true ? minutes : BindingOperations.DoNothing;
}
