using System.Globalization;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Director;

/// <summary>Whether a plan keeps the show on air or starts another.</summary>
public enum PlanScope
{
    /// <summary>Same broadcast, host and period; everything still to come is programmed again.</summary>
    Keep,

    /// <summary>A new broadcast. What is playing stops.</summary>
    New,
}

/// <summary>What the plan dialog holds, as text where the operator typed text.</summary>
/// <param name="CurrentBrief">What the broadcast on air was asked for, which a replan compares against.</param>
/// <param name="EraFrom">A year as typed, or empty for no bound.</param>
/// <param name="EraTo">A year as typed, or empty for no bound.</param>
public sealed record PlanForm(
    PlanScope Scope,
    string Brief,
    string? CurrentBrief,
    string? PersonaId,
    string EraFrom,
    string EraTo,
    bool Callins,
    StationMode Mode,
    StationOnEnd OnEnd);

/// <summary>
/// What planning the station sends, and what stops it being sent.
/// </summary>
/// <remarks>
/// <para>
/// One question rather than two forms, as the web console arrived at: <c>ReplanStationInput</c> is a
/// strict subset of <c>PutOnAirInput</c>, so the only real difference is whether this stays the same
/// show. Keeping it sends a brief and nothing else, because the host, the period and the shape are
/// bound to the broadcast and the call that could change them is the one that ends it.
/// </para>
/// <para>
/// Every "absent" here is deliberate. An absent brief on a replan keeps the one the broadcast carries
/// and an empty one CLEARS it, so a box handed back untouched must send nothing; an absent
/// <c>callins</c> is no calls, since nothing station-wide stands behind it.
/// </para>
/// </remarks>
public static class PlanRequest
{
    /// <summary>The contract's ceiling on a brief, so the box cannot promise more than the station takes.</summary>
    public const int BriefMax = 500;

    private const int EarliestYear = 1900;
    private const int LatestYear = 2100;

    /// <summary>The first thing stopping the form being sent, or null when it can be.</summary>
    public static string? Problem(PlanForm form)
    {
        ArgumentNullException.ThrowIfNull(form);

        if (form.Brief.Trim().Length > BriefMax)
        {
            return $"A brief is at most {BriefMax} characters.";
        }

        if (form.Scope == PlanScope.Keep)
        {
            return null;
        }

        // A new show is programmed against these words and named after them, so it needs some.
        if (form.Brief.Trim().Length == 0)
        {
            return "Say what the station should play.";
        }

        if (!TryYear(form.EraFrom, out var from) || !TryYear(form.EraTo, out var to))
        {
            return $"A year is four digits, between {EarliestYear} and {LatestYear}.";
        }

        if (from is { } start && to is { } end && start > end)
        {
            return "The period ends before it starts.";
        }

        return null;
    }

    /// <summary>
    /// The replan, which carries the brief only when it differs from the one on air.
    /// </summary>
    /// <remarks>
    /// Sent unchanged, the same words would be a rewrite of the same words: the station treats a
    /// brief it is handed as a new instruction.
    /// </remarks>
    public static ReplanStationInput Replan(PlanForm form)
    {
        ArgumentNullException.ThrowIfNull(form);

        var asked = form.Brief.Trim();
        return string.Equals(asked, (form.CurrentBrief ?? string.Empty).Trim(), StringComparison.Ordinal)
            ? new ReplanStationInput()
            : new ReplanStationInput { Brief = asked };
    }

    /// <summary>
    /// A new broadcast, named after what it was asked for.
    /// </summary>
    /// <remarks>
    /// The brief doubles as the name: an operator who asked for heavy metal hits should see that on
    /// the desk rather than "The station". Call this only once <see cref="Problem"/> answers null.
    /// </remarks>
    public static PutOnAirInput PutOnAir(PlanForm form)
    {
        ArgumentNullException.ThrowIfNull(form);

        var asked = form.Brief.Trim();
        TryYear(form.EraFrom, out var from);
        TryYear(form.EraTo, out var to);

        return new PutOnAirInput
        {
            Brief = asked,
            Name = asked,
            PersonaId = string.IsNullOrEmpty(form.PersonaId) ? null : form.PersonaId,
            EraFrom = from,
            EraTo = to,
            Callins = form.Callins ? true : null,
            Mode = form.Mode,
            OnEnd = form.OnEnd,
        };
    }

    /// <summary>A year as typed: empty is no bound, and anything else must be a year in range.</summary>
    public static bool TryYear(string text, out long? year)
    {
        year = null;
        var trimmed = (text ?? string.Empty).Trim();

        if (trimmed.Length == 0)
        {
            return true;
        }

        if (!long.TryParse(trimmed, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed)
            || parsed is < EarliestYear or > LatestYear)
        {
            return false;
        }

        year = parsed;
        return true;
    }
}
