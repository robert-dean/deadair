using System.Globalization;

namespace MaroonedSoftware.Deadair.Desktop.Core.Text;

/// <summary>
/// How many people are listening, as a sentence rather than a figure.
/// </summary>
/// <remarks>
/// Zero gets words rather than a "0", because on an audience-gated station zero is the ordinary
/// resting state and a numeral there reads as a failed reading. One gets the singular, which is the
/// count an operator sees most often while they are the only one listening to their own station.
/// </remarks>
public static class ListenerCount
{
    public static string Label(long listeners) => listeners switch
    {
        <= 0 => "Nobody listening",
        1 => "1 listening",
        _ => string.Create(CultureInfo.CurrentCulture, $"{listeners} listening"),
    };
}
