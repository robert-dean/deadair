namespace MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;

/// <summary>One soft patch of colour in Studio's backdrop, in fractions of the backdrop.</summary>
/// <param name="X">Its centre across, 0 to 1.</param>
/// <param name="Y">Its centre down, 0 to 1.</param>
/// <param name="Radius">How far it reaches, as a fraction of the backdrop's longer side.</param>
public readonly record struct DriftPatch(double X, double Y, double Radius);

/// <summary>
/// Where Studio's patches of colour are at a point in their loop, and how one cover's colours give
/// way to the next.
/// </summary>
/// <remarks>
/// <para>
/// Pure so the motion is a unit test rather than something watched: the control owns the clock and
/// asks this where everything is. Each patch runs a closed path whose frequencies are whole numbers,
/// so phase 1 is exactly phase 0 and the loop has no seam to jump at.
/// </para>
/// <para>
/// There is no shader. A few radial gradients drifting under the cover is most of the effect for
/// almost none of the cost, and nothing here was taken from anybody else's.
/// </para>
/// </remarks>
public static class StudioDrift
{
    /// <summary>The most patches there are, and so the most of a cover's colours Studio uses.</summary>
    public const int Patches = 3;

    /// <summary>What is under the patches when there is no cover to take a colour from.</summary>
    public const uint NoCover = 0xFF0E0F10;

    private const uint Black = 0xFF000000;

    // Where each patch sits, how far it wanders each way, how often it goes round in each direction
    // per loop, where in its own path it starts, and how far it reaches. Kept inside the backdrop so a
    // patch never spends half the loop off screen.
    private static readonly (double X, double Y, double Dx, double Dy, int Fx, int Fy, double Start, double Radius)[] Paths =
    [
        (0.28, 0.32, 0.16, 0.12, 1, 2, 0.0, 0.72),
        (0.74, 0.66, 0.13, 0.16, 2, 1, 0.33, 0.66),
        (0.56, 0.22, 0.20, 0.10, 1, 1, 0.66, 0.58),
    ];

    /// <summary>Where every patch is at <paramref name="phase"/>, which wraps: 1.25 is 0.25.</summary>
    public static IReadOnlyList<DriftPatch> At(double phase)
    {
        var turn = Wrap(phase) * 2 * Math.PI;

        return Paths
            .Select(path =>
            {
                var start = path.Start * 2 * Math.PI;
                return new DriftPatch(
                    path.X + path.Dx * Math.Sin(path.Fx * turn + start),
                    path.Y + path.Dy * Math.Cos(path.Fy * turn + start),
                    path.Radius);
            })
            .ToList();
    }

    /// <summary>The phase after <paramref name="elapsed"/>, going round once every <paramref name="period"/>.</summary>
    public static double Advance(double phase, TimeSpan elapsed, TimeSpan period) =>
        period <= TimeSpan.Zero ? Wrap(phase) : Wrap(phase + elapsed / period);

    /// <summary>
    /// A speed moved toward <paramref name="target"/> by the share of <paramref name="ramp"/> that has
    /// passed, so it closes most of the gap in a ramp or two and never overshoots.
    /// </summary>
    /// <remarks>
    /// Pressing Stop slows the drift rather than freezing it, and the change is eased so the
    /// backdrop does not visibly lurch.
    /// </remarks>
    public static double Ease(double speed, double target, TimeSpan elapsed, TimeSpan ramp)
    {
        if (ramp <= TimeSpan.Zero || elapsed >= ramp)
        {
            return target;
        }

        return speed + (target - speed) * Math.Max(elapsed / ramp, 0);
    }

    /// <summary>The colour under the patches: the cover's main colour, darker still, or <see cref="NoCover"/>.</summary>
    public static uint Ground(IReadOnlyList<uint> colours) =>
        colours.Count == 0 ? NoCover : Mix(Black, colours[0], 0.45);

    /// <summary>
    /// The colour of each patch part-way from one cover's colours to the next.
    /// </summary>
    /// <remarks>
    /// Always <see cref="Patches"/> long. A cover with fewer colours fills its spare patches with its
    /// ground, so they fade out into the backdrop rather than being drawn in a colour the cover has not
    /// got, and a patch that a new cover does not need fades away rather than vanishing.
    /// </remarks>
    public static IReadOnlyList<uint> Blend(IReadOnlyList<uint> from, IReadOnlyList<uint> to, double progress)
    {
        var (fromGround, toGround) = (Ground(from), Ground(to));
        var blended = new uint[Patches];

        for (var index = 0; index < Patches; index++)
        {
            var start = index < from.Count ? from[index] : fromGround;
            var end = index < to.Count ? to[index] : toGround;
            blended[index] = Mix(start, end, progress);
        }

        return blended;
    }

    /// <summary>Part-way from one opaque colour to another, 0 being all <paramref name="from"/>.</summary>
    public static uint Mix(uint from, uint to, double progress)
    {
        var t = Math.Clamp(progress, 0, 1);

        uint Channel(int shift)
        {
            var a = (from >> shift) & 0xFF;
            var b = (to >> shift) & 0xFF;
            return (uint)Math.Round(a + (b - (double)a) * t) << shift;
        }

        return 0xFF000000 | Channel(16) | Channel(8) | Channel(0);
    }

    private static double Wrap(double phase) => phase - Math.Floor(phase);
}
