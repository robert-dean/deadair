using System.Globalization;
using Avalonia.Data;
using Avalonia.Data.Converters;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;

namespace MaroonedSoftware.Deadair.Desktop.Themes;

/// <summary>One radio button's worth of Keep the display awake, for the reasons <see cref="AppearanceConverter"/> gives.</summary>
public sealed class KeepAwakeConverter(KeepAwake keepAwake) : IValueConverter
{
    public static KeepAwakeConverter Never { get; } = new(KeepAwake.Never);

    public static KeepAwakeConverter WhileCharging { get; } = new(KeepAwake.WhileCharging);

    public static KeepAwakeConverter Always { get; } = new(KeepAwake.Always);

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is KeepAwake current && current == keepAwake;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is true ? keepAwake : BindingOperations.DoNothing;
}
