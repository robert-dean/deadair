using System.Globalization;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Catalog;

/// <summary>One of the states the records list can be narrowed to, and how it reads.</summary>
/// <param name="State">What is sent as the filter.</param>
/// <param name="Label">What the chip says after its count.</param>
/// <param name="Help">What the chip means, for its tooltip.</param>
public sealed record TrackStateFilter(TrackState State, string Label, string Help);

/// <summary>
/// How much of the library is in each state, in the words the web console uses for it.
/// </summary>
/// <remarks>
/// <para>
/// The order is the order an operator reads them: what can air and what the measurement walk has
/// reached first, because those are the two distributions somebody comes looking for, and the two
/// fault states last, where a zero is the good answer.
/// </para>
/// <para>
/// Two of the counts are the COMPLEMENT of what the station sends. It reports what is cached and
/// measured, because those read as N of M, and the filters worth offering are the ones that are not.
/// </para>
/// <para>
/// "Held" where the console says "on this machine": in this app, this machine is the operator's Mac,
/// and the audio is on the station's.
/// </para>
/// </remarks>
public static class TrackStates
{
    public static IReadOnlyList<TrackStateFilter> All { get; } =
    [
        new(TrackState.Cached, "Held", "The station has the audio on its own disk, so these can be committed to the running order now."),
        new(TrackState.Uncached, "Not fetched", "The station has not needed these yet. Ordinary for most of a library rather than a problem."),
        new(TrackState.Unmeasured, "Unmeasured", "No trustworthy measurement, so no cue points and no level decided before air. They still play."),
        new(TrackState.Failing, "Failing", "A fetch has failed and is backing off. Four in a row writes the copy off."),
        new(
            TrackState.Benched,
            "Benched",
            "Every copy written off. A sync brings back the ones the provider still lists; one it refused stays off until you offer it again."),
    ];

    /// <summary>How many records a chip stands for.</summary>
    public static long Count(TrackState state, TrackStateCounts counts)
    {
        ArgumentNullException.ThrowIfNull(counts);

        return state switch
        {
            TrackState.Cached => counts.Cached,
            TrackState.Uncached => Math.Max(0, counts.Total - counts.Cached),
            TrackState.Unmeasured => Math.Max(0, counts.Total - counts.Measured),
            TrackState.Failing => counts.Failing,
            TrackState.Benched => counts.Benched,
            _ => 0,
        };
    }

    /// <summary>
    /// The sentence an operator came for: how much of the library can go out right now.
    /// </summary>
    /// <remarks>
    /// Five chips each holding a number made the reader do the division. The question is never how
    /// many are cached, it is how much of the library is ready.
    /// </remarks>
    public static string Ready(TrackStateCounts counts)
    {
        ArgumentNullException.ThrowIfNull(counts);

        var cached = counts.Cached.ToString("N0", CultureInfo.CurrentCulture);
        var total = counts.Total.ToString("N0", CultureInfo.CurrentCulture);
        return counts.Total == 1
            ? $"{cached} of {total} record is ready to air right now."
            : $"{cached} of {total} records are ready to air right now.";
    }

    /// <summary>
    /// Why a list has nothing in it, which is three different facts and only one of them a problem.
    /// </summary>
    /// <remarks>
    /// The search is asked FIRST, and that order is load-bearing: the counts honour the search, so a
    /// term nothing matches answers a total of zero over a full library and would otherwise read as
    /// an empty catalog. They do not honour the state, which is why the total can be trusted as the
    /// library's size by the time the state is asked about. A fault filter that matches nothing is
    /// the answer an operator was hoping for, and must not read as "the catalog is empty".
    /// </remarks>
    public static string NothingHere(string? search, TrackState? state, long total)
    {
        if (!string.IsNullOrWhiteSpace(search))
        {
            return $"Nothing matches “{search.Trim()}”. Try a shorter term, or part of the title rather than all of it.";
        }

        if (total == 0)
        {
            return "The catalog is empty. It fills as enabled plugins are scanned, and nothing has been ingested yet.";
        }

        return state switch
        {
            TrackState.Cached => "The station holds no audio yet. It fetches a record a few boundaries before its slot.",
            TrackState.Uncached => "The station already holds the audio for every record.",
            TrackState.Unmeasured => "Every record has been measured, so the station has cue points and a level for all of them.",
            TrackState.Failing => "No fetch is failing.",
            TrackState.Benched => "No record has had all its copies written off.",

            // Unreachable in practice: an unfiltered list of a non-empty catalog has rows. Answered
            // rather than left blank, because a page drawing nothing at all reads as broken.
            _ => "This page of the catalog has no records on it.",
        };
    }
}
