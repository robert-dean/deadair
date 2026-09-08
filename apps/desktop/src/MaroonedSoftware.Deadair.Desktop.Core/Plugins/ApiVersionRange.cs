using System.Globalization;

namespace MaroonedSoftware.Deadair.Desktop.Core.Plugins;

/// <summary>
/// Which contract versions a plugin says it can work with.
/// </summary>
/// <remarks>
/// <para>
/// A small hand-written subset of the npm range grammar, because the station's own plugins declare
/// ranges in that shape and a plugin author who has written one there should not have to learn a
/// second syntax. Four forms and no more: <c>^1.2.0</c>, an exact <c>1.2.0</c>, <c>&gt;=1.2.0</c>
/// (optionally with a <c>&lt;2.0.0</c> after it), and <c>*</c>.
/// </para>
/// <para>
/// <b>Anything else is refused rather than guessed at.</b> A range nobody can parse is a plugin
/// nobody can decide about, and loading it anyway would mean the compatibility check passed for the
/// one plugin whose compatibility is least known. The message names the text so it can be fixed.
/// </para>
/// <para>
/// The caret follows npm on the part everyone gets wrong: below 1.0.0 the MINOR is the breaking
/// digit, so <c>^0.3.0</c> accepts 0.3.9 and refuses 0.4.0. Pre-1.0 contracts move under people.
/// </para>
/// </remarks>
public sealed class ApiVersionRange
{
    private readonly Version _low;
    private readonly Version? _highExclusive;
    private readonly bool _any;

    private ApiVersionRange(Version low, Version? highExclusive, bool any)
    {
        _low = low;
        _highExclusive = highExclusive;
        _any = any;
    }

    /// <summary>The range as written, for a message.</summary>
    public required string Text { get; init; }

    /// <summary>
    /// Reads a range, or answers why it could not.
    /// </summary>
    /// <param name="text">The manifest's <c>apiVersion</c>.</param>
    /// <param name="range">The range, when it parsed.</param>
    /// <returns>Null when it parsed; otherwise a sentence for the operator.</returns>
    public static string? TryParse(string? text, out ApiVersionRange? range)
    {
        range = null;

        var trimmed = text?.Trim();

        if (string.IsNullOrEmpty(trimmed))
        {
            return "apiVersion is missing";
        }

        if (trimmed == "*")
        {
            range = new ApiVersionRange(new Version(0, 0, 0), null, any: true) { Text = trimmed };
            return null;
        }

        if (trimmed.StartsWith('^'))
        {
            if (!TryVersion(trimmed[1..], out var low))
            {
                return Unsupported(trimmed);
            }

            // Below 1.0.0 the minor is what breaks, which is npm's rule and the one worth keeping:
            // a 0.x contract is one whose author is still moving things.
            var ceiling = low.Major > 0
                ? new Version(low.Major + 1, 0, 0)
                : new Version(0, low.Minor + 1, 0);

            range = new ApiVersionRange(low, ceiling, any: false) { Text = trimmed };
            return null;
        }

        if (trimmed.StartsWith(">=", StringComparison.Ordinal))
        {
            var parts = trimmed.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            if (parts.Length is not (1 or 2) || !TryVersion(parts[0][2..], out var low))
            {
                return Unsupported(trimmed);
            }

            Version? ceiling = null;

            if (parts.Length == 2)
            {
                if (!parts[1].StartsWith('<') || !TryVersion(parts[1][1..], out var high))
                {
                    return Unsupported(trimmed);
                }

                ceiling = high;
            }

            range = new ApiVersionRange(low, ceiling, any: false) { Text = trimmed };
            return null;
        }

        if (TryVersion(trimmed, out var exact))
        {
            range = new ApiVersionRange(exact, NextPatch(exact), any: false) { Text = trimmed };
            return null;
        }

        return Unsupported(trimmed);
    }

    /// <summary>Whether the app's own contract version is in the range.</summary>
    public bool Allows(string version) => TryVersion(version, out var parsed) && Allows(parsed);

    public bool Allows(Version version)
    {
        ArgumentNullException.ThrowIfNull(version);

        if (_any)
        {
            return true;
        }

        return version >= _low && (_highExclusive is null || version < _highExclusive);
    }

    private static string Unsupported(string text) =>
        string.Create(CultureInfo.InvariantCulture, $"""apiVersion "{text}" is not a range this app can read: use "^1.0.0", "1.0.0", ">=1.0.0" or "*".""");

    private static Version NextPatch(Version version) =>
        new(version.Major, version.Minor, version.Build + 1);

    /// <summary>
    /// A numeric triple and nothing else. <see cref="Version"/> itself accepts two parts and four,
    /// which would let <c>1.0</c> through with a Build of -1 and make every comparison below subtly
    /// wrong.
    /// </summary>
    private static bool TryVersion(string text, out Version version)
    {
        version = new Version(0, 0, 0);

        var parts = text.Trim().Split('.');

        if (parts.Length != 3)
        {
            return false;
        }

        Span<int> numbers = stackalloc int[3];

        for (var index = 0; index < 3; index++)
        {
            if (!int.TryParse(parts[index], NumberStyles.None, CultureInfo.InvariantCulture, out numbers[index]))
            {
                return false;
            }
        }

        version = new Version(numbers[0], numbers[1], numbers[2]);
        return true;
    }
}
