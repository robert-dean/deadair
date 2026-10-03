namespace MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;

/// <summary>The colour taken from a cover, and the colour that reads on it. Both ARGB.</summary>
public readonly record struct CoverAccent(uint Accent, uint OnAccent);

/// <summary>
/// Which of a cover's colours the app wears, as rules over plain ARGB values.
/// </summary>
/// <remarks>
/// <para>
/// Ported from the Android app's <c>CoverAccent.kt</c>, whose tests came with it, and pure for the
/// same reason: the view reads a cover's colours off the bitmap and hands them in, so the rule is a
/// unit test rather than a screenshot. <see cref="Accent"/> and <see cref="ReadableOn"/> are that
/// file's, decision for decision.
/// </para>
/// <para>
/// <see cref="HeaderTint"/> is this app's own. A web player heads its page in the cover's colour,
/// dimmed so white text reads over it; that wants the cover's most colourful colour at a lightness
/// a page can sit under, which is a different band from the one a button needs.
/// </para>
/// </remarks>
public static class CoverColours
{
    /// <summary>Below this a colour is a grey, as far as a button is concerned.</summary>
    private const float MinChroma = 0.12f;

    private const uint Black = 0xFF000000;
    private const uint White = 0xFFFFFFFF;

    /// <summary>
    /// The colour a control wears from a cover, or null to keep the theme's.
    /// </summary>
    /// <remarks>
    /// The MOST COLOURFUL candidate wins rather than the most common one, because a cover is mostly
    /// its background and the colour worth carrying is the one that stands out of it. A cover with no
    /// colour worth the name answers null, since a grey button is a disabled-looking one. The
    /// winner's lightness is pulled into a band that reads on the page, keeping its hue and
    /// saturation.
    /// </remarks>
    public static CoverAccent? Accent(IReadOnlyList<uint> candidates, bool darkPage)
    {
        ArgumentNullException.ThrowIfNull(candidates);

        if (MostColourful(candidates) is not { } best || Chroma(best) < MinChroma)
        {
            return null;
        }

        var (hue, saturation, lightness) = Hsl(best);
        var (low, high) = darkPage ? (0.58f, 0.78f) : (0.28f, 0.45f);
        var accent = FromHsl(hue, saturation, Math.Clamp(lightness, low, high));
        return new CoverAccent(accent, ReadableOn(accent));
    }

    /// <summary>
    /// The colour a page's header is washed in, from a cover's colours, or null for none.
    /// </summary>
    /// <remarks>
    /// The most colourful candidate again, but greys are kept rather than refused: a header is a
    /// cover's mood rather than a control, so a black-and-white cover gets a grey wash, which is right
    /// for it. The lightness goes into a band a page can sit under: dim on a dark page, so white type
    /// reads over it, and pale on a light one, so dark type does.
    /// </remarks>
    public static uint? HeaderTint(IReadOnlyList<uint> candidates, bool darkPage)
    {
        ArgumentNullException.ThrowIfNull(candidates);

        if (MostColourful(candidates) is not { } best)
        {
            return null;
        }

        var (hue, saturation, lightness) = Hsl(best);
        var (low, high) = darkPage ? (0.2f, 0.34f) : (0.78f, 0.9f);
        var placed = Math.Clamp(lightness, low, high);

        // The band is lightness, and lightness is not how bright a colour LOOKS: a yellow at a third
        // lightness is still brighter than a blue at a half, and black read better on it than white.
        // So it is walked further from the page's text until the text is the one that reads.
        var ink = darkPage ? White : Black;
        var step = darkPage ? -0.02f : 0.02f;
        var tint = FromHsl(hue, saturation, placed);
        while (ReadableOn(tint) != ink && placed is > 0f and < 1f)
        {
            placed = Math.Clamp(placed + step, 0f, 1f);
            tint = FromHsl(hue, saturation, placed);
        }

        return tint;
    }

    /// <summary>
    /// The colours Studio's backdrop drifts in, from a cover's colours: up to <paramref name="count"/>,
    /// most colourful first. Empty for no cover.
    /// </summary>
    /// <remarks>
    /// Studio is always dark, with white type over it, so every colour is placed in a dim band and then
    /// walked darker until white is what reads on it, for the reason <see cref="HeaderTint"/> walks:
    /// lightness is not brightness. Greys are kept, as they are for a header, because a backdrop is a
    /// cover's mood. Two candidates that come out the same are kept as one, so a two-colour cover
    /// drifts in two colours rather than in a third copy of the first.
    /// </remarks>
    public static IReadOnlyList<uint> Backdrop(IReadOnlyList<uint> candidates, int count = 3)
    {
        ArgumentNullException.ThrowIfNull(candidates);

        var placed = new List<uint>();
        foreach (var candidate in candidates.OrderByDescending(Chroma))
        {
            var (hue, saturation, lightness) = Hsl(candidate);
            var level = Math.Clamp(lightness, 0.12f, 0.3f);
            var colour = FromHsl(hue, saturation, level);
            while (ReadableOn(colour) != White && level > 0f)
            {
                level = Math.Max(level - 0.02f, 0f);
                colour = FromHsl(hue, saturation, level);
            }

            if (!placed.Contains(colour))
            {
                placed.Add(colour);
            }

            if (placed.Count == count)
            {
                break;
            }
        }

        return placed;
    }

    /// <summary>Black or white, whichever contrasts more with <paramref name="background"/>.</summary>
    public static uint ReadableOn(uint background)
    {
        var luminance = Luminance(background);
        var againstBlack = (luminance + 0.05) / 0.05;
        var againstWhite = 1.05 / (luminance + 0.05);
        return againstBlack >= againstWhite ? Black : White;
    }

    /// <summary>
    /// The handful of colours a cover is made of, most common first, from its pixels.
    /// </summary>
    /// <remarks>
    /// Each pixel goes into a bucket at four bits a channel, and the fullest buckets answer with the
    /// average of what fell in them. Averaged rather than the bucket's own centre, so a cover's
    /// colours come back as the cover had them rather than snapped to a grid. Transparent pixels are
    /// left out: they are not the cover.
    /// </remarks>
    public static IReadOnlyList<uint> Candidates(ReadOnlySpan<uint> pixels, int count = 5)
    {
        var buckets = new Dictionary<uint, (long R, long G, long B, int N)>();

        foreach (var pixel in pixels)
        {
            if (pixel >> 24 < 0x80)
            {
                continue;
            }

            var (r, g, b) = (pixel >> 16 & 0xFF, pixel >> 8 & 0xFF, pixel & 0xFF);
            var key = (r >> 4) << 8 | (g >> 4) << 4 | b >> 4;
            var sum = buckets.GetValueOrDefault(key);
            buckets[key] = (sum.R + r, sum.G + g, sum.B + b, sum.N + 1);
        }

        return buckets.Values
            .OrderByDescending(bucket => bucket.N)
            .Take(count)
            .Select(bucket => 0xFF000000
                | (uint)(bucket.R / bucket.N) << 16
                | (uint)(bucket.G / bucket.N) << 8
                | (uint)(bucket.B / bucket.N))
            .ToList();
    }

    private static uint? MostColourful(IReadOnlyList<uint> candidates) =>
        candidates.Count == 0 ? null : candidates.MaxBy(Chroma);

    private static (float R, float G, float B) Channels(uint argb) =>
        ((argb >> 16 & 0xFF) / 255f, (argb >> 8 & 0xFF) / 255f, (argb & 0xFF) / 255f);

    /// <summary>How far a colour is from grey: the spread between its strongest and weakest channel.</summary>
    private static float Chroma(uint argb)
    {
        var (r, g, b) = Channels(argb);
        return Math.Max(r, Math.Max(g, b)) - Math.Min(r, Math.Min(g, b));
    }

    private static (float Hue, float Saturation, float Lightness) Hsl(uint argb)
    {
        var (r, g, b) = Channels(argb);
        var high = Math.Max(r, Math.Max(g, b));
        var low = Math.Min(r, Math.Min(g, b));
        var lightness = (high + low) / 2f;
        var delta = high - low;

        if (delta == 0f)
        {
            return (0f, 0f, lightness);
        }

        var saturation = delta / (1f - Math.Abs(2f * lightness - 1f));
        var hue = high == r
            ? 60f * Mod((g - b) / delta, 6f)
            : high == g
                ? 60f * ((b - r) / delta + 2f)
                : 60f * ((r - g) / delta + 4f);

        return (hue, Math.Clamp(saturation, 0f, 1f), lightness);
    }

    private static uint FromHsl(float hue, float saturation, float lightness)
    {
        var c = (1f - Math.Abs(2f * lightness - 1f)) * saturation;
        var x = c * (1f - Math.Abs(Mod(hue / 60f, 2f) - 1f));
        var m = lightness - c / 2f;
        var (r, g, b) = hue switch
        {
            < 60f => (c, x, 0f),
            < 120f => (x, c, 0f),
            < 180f => (0f, c, x),
            < 240f => (0f, x, c),
            < 300f => (x, 0f, c),
            _ => (c, 0f, x),
        };

        return 0xFF000000 | Byte(r, m) << 16 | Byte(g, m) << 8 | Byte(b, m);
    }

    private static uint Byte(float value, float m) => (uint)Math.Clamp((int)((value + m) * 255f), 0, 255);

    /// <summary>A modulo that is never negative, as Kotlin's <c>mod</c> is and C#'s <c>%</c> is not.</summary>
    private static float Mod(float value, float divisor) => ((value % divisor) + divisor) % divisor;

    /// <summary>WCAG relative luminance.</summary>
    private static double Luminance(uint argb)
    {
        var (r, g, b) = Channels(argb);
        static double Linear(float v) => v <= 0.03928f ? v / 12.92 : Math.Pow((v + 0.055) / 1.055, 2.4);
        return 0.2126 * Linear(r) + 0.7152 * Linear(g) + 0.0722 * Linear(b);
    }
}
