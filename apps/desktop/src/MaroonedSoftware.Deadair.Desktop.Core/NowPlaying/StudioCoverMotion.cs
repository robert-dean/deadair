namespace MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;

/// <summary>One turning disc of the cover in Studio's cover backdrop.</summary>
/// <param name="X">Its pivot across, as a fraction of the backdrop's longer side from the centre.</param>
/// <param name="Y">Its pivot down, as a fraction of the backdrop's longer side from the centre.</param>
/// <param name="Angle">How far the cover inside it has turned, in radians.</param>
/// <param name="Weight">How much of it is laid over what is under it, 0 to 1.</param>
public readonly record struct CoverDisc(double X, double Y, double Angle, double Weight);

/// <summary>
/// Where the moving parts of Studio's cover backdrop are at a point in its loop, and how dark the
/// cover is drawn so white type reads over it.
/// </summary>
/// <remarks>
/// <para>
/// The prototype that samples the cover itself, blurred, rather than a few of its colours
/// (<see cref="StudioDrift"/>). The control owns the clock and the shader; everything with a number in
/// it is here, so the motion and the darkening are unit tests rather than something watched.
/// </para>
/// <para>
/// The phase is the same loop <see cref="StudioDrift"/> runs, and every frequency in it is a whole
/// number, so phase 1 is exactly phase 0 and the loop has no seam.
/// </para>
/// </remarks>
public static class StudioCoverMotion
{
    /// <summary>The zoom the base layer breathes about. Over 1, so its edges never come into view.</summary>
    public const double BaseZoom = 1.15;

    /// <summary>How far either way the zoom breathes.</summary>
    public const double ZoomSwing = 0.05;

    /// <summary>How many breaths in one loop.</summary>
    private const int Breaths = 2;

    /// <summary>The two discs' pivots, near opposite corners, and their weights.</summary>
    private static readonly (double X, double Y, int Turns, double Weight)[] Pivots =
    [
        (-0.22, -0.14, 1, 0.55),
        (0.22, 0.14, -1, 0.45),
    ];

    /// <summary>The base layer's zoom at <paramref name="phase"/>, which wraps.</summary>
    public static double Zoom(double phase) => BaseZoom + ZoomSwing * Math.Sin(Breaths * Turn(phase));

    /// <summary>Both discs at <paramref name="phase"/>: the same pivots, turning opposite ways.</summary>
    public static IReadOnlyList<CoverDisc> Discs(double phase)
    {
        var turn = Turn(phase);
        return Pivots.Select(pivot => new CoverDisc(pivot.X, pivot.Y, pivot.Turns * turn, pivot.Weight)).ToList();
    }

    /// <summary>
    /// How much of the new cover shows, from how far its fade has got: eased at both ends, so the
    /// change starts and finishes without a visible step.
    /// </summary>
    public static double FadeWeight(double progress)
    {
        var t = Math.Clamp(progress, 0, 1);
        return t * t * (3 - 2 * t);
    }

    /// <summary>
    /// What a blurred cover's pixels are multiplied by so white type reads over the brightest part of
    /// it: 0 to <paramref name="ceiling"/>, 1 being the cover as it is.
    /// </summary>
    /// <remarks>
    /// The walk <see cref="CoverColours.Backdrop"/> does for a colour, done for a picture: start at the
    /// ceiling and step darker until white is what reads on the bright end of the cover, taken as the
    /// pixel nine tenths of the way up by luminance, so one stray highlight does not darken a whole
    /// dark cover. A cover with no pixels answers the ceiling.
    /// </remarks>
    public static double Dim(ReadOnlySpan<uint> pixels, double ceiling = 0.6)
    {
        if (pixels.IsEmpty)
        {
            return ceiling;
        }

        var ranked = pixels.ToArray();
        Array.Sort(ranked, (a, b) => Luminance(a).CompareTo(Luminance(b)));
        var bright = ranked[(int)Math.Floor((ranked.Length - 1) * 0.9)];

        var level = ceiling;
        while (level > 0 && CoverColours.ReadableOn(Scale(bright, level)) != 0xFFFFFFFF)
        {
            level = Math.Max(level - 0.02, 0);
        }

        return level;
    }

    /// <summary>An opaque colour with every channel multiplied by <paramref name="factor"/>.</summary>
    public static uint Scale(uint argb, double factor)
    {
        var f = Math.Clamp(factor, 0, 1);
        uint Channel(int shift) => (uint)Math.Round(((argb >> shift) & 0xFF) * f) << shift;
        return 0xFF000000 | Channel(16) | Channel(8) | Channel(0);
    }

    private static double Turn(double phase) => (phase - Math.Floor(phase)) * 2 * Math.PI;

    private static double Luminance(uint argb)
    {
        static double Linear(uint v)
        {
            var c = v / 255.0;
            return c <= 0.03928 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4);
        }

        return 0.2126 * Linear(argb >> 16 & 0xFF) + 0.7152 * Linear(argb >> 8 & 0xFF) + 0.0722 * Linear(argb & 0xFF);
    }
}
