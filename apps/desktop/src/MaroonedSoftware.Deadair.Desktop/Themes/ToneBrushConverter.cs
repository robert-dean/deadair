using System.Globalization;
using Avalonia.Data.Converters;
using Avalonia.Media;
using Avalonia.Styling;
using MaroonedSoftware.Deadair.Desktop.Core.Text;

namespace MaroonedSoftware.Deadair.Desktop.Themes;

/// <summary>
/// The one place a status becomes a colour.
/// </summary>
/// <remarks>
/// Nothing else in the app may name a colour for a state. The failure this closes off is a screen
/// deciding for itself that "misconfigured" is a bit red — and in a studio red means ON AIR, so a
/// view that reached for it to mean "broken" would be saying the opposite of what it meant.
/// </remarks>
public sealed class ToneBrushConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var key = value is StatusTone tone
            ? tone switch
            {
                StatusTone.Live => "DaToneLiveBrush",
                StatusTone.Ok => "DaToneOkBrush",
                StatusTone.Standby => "DaToneStandbyBrush",
                StatusTone.Fault => "DaToneFaultBrush",
                _ => "DaToneOffBrush",
            }
            : "DaToneOffBrush";

        var application = Avalonia.Application.Current;
        if (application is not null
            && application.Resources.TryGetResource(key, application.ActualThemeVariant, out var brush))
        {
            return brush;
        }

        return Brushes.Gray;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>What the one transport button says.</summary>
/// <remarks>
/// "Stop" rather than "Pause", and the word is the honest one: there is no pause on a live mount,
/// because a held connection is still an audience to the station's gate.
/// </remarks>
public sealed class PlayLabelConverter : IValueConverter
{
    public static PlayLabelConverter Instance { get; } = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is true ? "Stop" : "Listen";

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}


/// <summary>What the one transport button shows.</summary>
/// <remarks>
/// The glyph beside <see cref="PlayLabelConverter"/>, which answers the same question in words for
/// the system's own now-playing widget. Stop is a square rather than two bars: pausing is not what
/// this button does, and a pause glyph would promise that it is.
/// </remarks>
public sealed class PlayIconConverter : IValueConverter
{
    public static PlayIconConverter Instance { get; } = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var key = value is true ? "DaIconStop" : "DaIconPlay";
        var application = Avalonia.Application.Current;

        return application is not null
            && application.Resources.TryGetResource(key, application.ActualThemeVariant, out var geometry)
                ? geometry as Geometry
                : null;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}


/// <summary>
/// Draws the "runs dry at" line in a warning colour only once it is close.
/// </summary>
/// <remarks>
/// A separate converter rather than a tone, because this is not the state of a THING: the running
/// order is fine, and the sentence is about how much of it is left.
/// </remarks>
public sealed class ShortOrderBrushConverter : IValueConverter
{
    public static ShortOrderBrushConverter Instance { get; } = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var key = value is true ? "DaToneFaultBrush" : "DaTextDimmedBrush";
        var application = Avalonia.Application.Current;

        if (application is not null
            && application.Resources.TryGetResource(key, application.ActualThemeVariant, out var brush))
        {
            return brush;
        }

        return Brushes.Gray;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}


/// <summary>
/// A severity as a colour, which is a different question from a status tone.
/// </summary>
/// <remarks>
/// The two vocabularies cannot be one because they disagree about red: a lamp's red means ON AIR,
/// while a failure's red means the hard failure. `notice` is the arm that is not a failure at all —
/// something nobody has set up yet — and it exists because a list that draws "you have not done this"
/// in the same colour as "this broke" is one people learn to skim.
/// </remarks>
public sealed class SeverityBrushConverter : IValueConverter
{
    public static SeverityBrushConverter Instance { get; } = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var key = value is Severity severity
            ? severity switch
            {
                Severity.Failure => "DaSeverityFailureBrush",
                Severity.Warning => "DaSeverityWarningBrush",
                _ => "DaSeverityNoticeBrush",
            }
            : "DaTextDimmedBrush";

        var application = Avalonia.Application.Current;
        if (application is not null
            && application.Resources.TryGetResource(key, application.ActualThemeVariant, out var brush))
        {
            return brush;
        }

        return Brushes.Gray;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}


/// <summary>Whether a running-order row's move buttons are drawn at all.</summary>
/// <remarks>
/// Opacity rather than visibility. Every row in a list is its own Grid, so a column that collapses
/// when its content is hidden sizes to that row alone, and the durations march about down the page
/// depending on which rows happen to be movable. The column stays; only the ink goes.
/// </remarks>
public sealed class MovableOpacityConverter : IValueConverter
{
    public static MovableOpacityConverter Instance { get; } = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is true ? 1d : 0d;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
