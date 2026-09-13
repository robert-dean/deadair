using System.Text.Json.Serialization;

namespace MaroonedSoftware.Deadair.Desktop.Core.Settings;

/// <summary>
/// Where the window was and how big, so it opens there again.
/// </summary>
/// <remarks>
/// <para>
/// Position in desktop coordinates, because that is what a window's position is; size in
/// device-independent units, because that is what a window's width and height are. Mixing them is
/// deliberate and <see cref="LandsOn"/> is where the two meet.
/// </para>
/// <para>
/// Only ever the frame of a NORMAL window. A maximised one is remembered as the frame it had before
/// plus <see cref="Maximized"/>, so un-maximising after a relaunch goes back to something sensible
/// rather than to a frame the size of the screen.
/// </para>
/// </remarks>
public sealed record WindowMemory
{
    [JsonPropertyName("x")]
    public int X { get; init; }

    [JsonPropertyName("y")]
    public int Y { get; init; }

    [JsonPropertyName("width")]
    public double Width { get; init; }

    [JsonPropertyName("height")]
    public double Height { get; init; }

    [JsonPropertyName("maximized")]
    public bool Maximized { get; init; }

    /// <summary>One connected display's usable area, in the same desktop coordinates as a window's position.</summary>
    public readonly record struct ScreenArea(int X, int Y, int Width, int Height);

    /// <summary>
    /// Whether a remembered frame would open somewhere somebody can see it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The test is the frame's CENTRE on a connected screen's working area. A corner is too lenient:
    /// a window with one corner on screen is a window whose title bar may be under the menu bar or off
    /// the edge, which is the one part needed to drag it back. The whole frame is too strict: a window
    /// half across two displays is a perfectly ordinary thing to leave.
    /// </para>
    /// <para>
    /// The position and the screens are desktop coordinates and the size is device-independent units,
    /// so the size is multiplied by <paramref name="desktopScaling"/>, which is the window's own
    /// <c>DesktopScaling</c>. On macOS that is 1, because desktop coordinates there are points: the
    /// saved position was measured to match what System Events reports for the window. It is NOT each
    /// screen's render scaling, which would have put the centre of a window on a Retina display half
    /// a window further right than it is and refused one sitting on the right of a laptop's screen.
    /// </para>
    /// <para>
    /// Nothing connected means nothing to land on: a laptop that was closed on an external display
    /// should open on its own.
    /// </para>
    /// </remarks>
    public static bool LandsOn(WindowMemory frame, IReadOnlyList<ScreenArea> screens, double desktopScaling = 1)
    {
        ArgumentNullException.ThrowIfNull(frame);
        ArgumentNullException.ThrowIfNull(screens);

        if (!double.IsFinite(frame.Width) || !double.IsFinite(frame.Height) || frame.Width <= 0 || frame.Height <= 0)
        {
            return false;
        }

        var scaling = double.IsFinite(desktopScaling) && desktopScaling > 0 ? desktopScaling : 1;
        var centreX = frame.X + (frame.Width * scaling / 2);
        var centreY = frame.Y + (frame.Height * scaling / 2);

        foreach (var screen in screens)
        {
            if (centreX >= screen.X && centreX < screen.X + screen.Width
                && centreY >= screen.Y && centreY < screen.Y + screen.Height)
            {
                return true;
            }
        }

        return false;
    }
}
