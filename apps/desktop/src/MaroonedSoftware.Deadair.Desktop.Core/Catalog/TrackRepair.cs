using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Catalog;

/// <summary>What an operator can do about a record that will not play.</summary>
public enum TrackRepair
{
    /// <summary>Throw away the local copies; the station fetches the record again.</summary>
    Audio,

    /// <summary>Forget the cue points and the loudness; the measurement walk comes round again.</summary>
    Analysis,

    /// <summary>Forget every provider's stored answer; the enrichment pass asks again.</summary>
    Enrichment,

    /// <summary>Clear the backoff and un-bench every copy.</summary>
    Retry,

    /// <summary>Put a copy a provider REFUSED back on offer.</summary>
    Offer,
}

/// <summary>How one repair is offered and confirmed.</summary>
/// <param name="Label">The menu entry.</param>
/// <param name="Question">The confirmation's title.</param>
/// <param name="Consequence">What happens next, which is the part of the confirmation worth reading.</param>
/// <param name="Verb">The confirming button.</param>
public sealed record TrackRepairWords(string Label, string Question, string Consequence, string Verb);

/// <summary>
/// The repairs, in the web console's words and order.
/// </summary>
/// <remarks>
/// <para>
/// Every one of these sends the station off to do work again, so each asks first and the question
/// says what work. None of the four clears destroys anything the station cannot rebuild, which is
/// why the words say what will be rebuilt rather than warning about loss. The fifth throws nothing
/// away and is the only one that OVERRIDES the station, contradicting a provider's own answer, and
/// its sentence says so because the operator pressing it is taking that on.
/// </para>
/// <para>
/// The two fault states have a list-wide version (<see cref="ForState"/>): these faults arrive in
/// runs, and the alternative is opening a dozen records to carry out one decision made once.
/// </para>
/// </remarks>
public static class TrackRepairs
{
    public static IReadOnlyList<TrackRepair> All { get; } =
        [TrackRepair.Audio, TrackRepair.Analysis, TrackRepair.Enrichment, TrackRepair.Retry, TrackRepair.Offer];

    public static TrackRepairWords Words(TrackRepair repair) => repair switch
    {
        TrackRepair.Audio => new(
            "Throw away the local copies",
            "Throw away the local copies?",
            "The files come off the station's disk and the rows stay. The station fetches the record again the next time it comes round, which costs one download. Useful when a cached file sounds wrong.",
            "Throw them away"),
        TrackRepair.Analysis => new(
            "Forget the measurement",
            "Forget the measurement?",
            "The cue points and the loudness go, and the measurement walk picks the record up again on its next pass. Until it does, the record still plays: untrimmed, and levelled live rather than before air.",
            "Forget it"),
        TrackRepair.Enrichment => new(
            "Forget what the providers said",
            "Forget what the providers said?",
            "Every provider's stored answer goes and the enrichment pass asks again. The station's own facts, the ones with a source and a quote, are not touched, nor is anything already promoted onto the record, like its year or its cover.",
            "Forget them"),
        TrackRepair.Retry => new(
            "Try the copies again now",
            "Try the copies again now?",
            "Clears the backoff and un-benches every copy, so the station may try each of them straight away rather than waiting. This is what to press once an upstream that was failing is working again. It does not touch a copy the provider refused; that is the next entry.",
            "Try again"),
        TrackRepair.Offer => new(
            "Offer refused copies again",
            "Offer refused copies again?",
            "A refused copy is one the provider answered about: it said it holds no audio for this and never will, so nothing in the station un-refuses it. This overrides that answer for this record, clears its backoff, and lets the station try again the next time the record comes round. If the provider still means it, the copy is refused again.",
            "Offer them again"),
        _ => throw new ArgumentOutOfRangeException(nameof(repair), repair, null),
    };

    /// <summary>The repair a whole page of records in a fault state gets, or null for a state that is not a fault.</summary>
    /// <remarks>
    /// Nothing is offered for the other three. Most of a library is not fetched, and a bulk verb over
    /// that is a button whose worst case is re-fetching a healthy library.
    /// </remarks>
    public static TrackRepair? ForState(TrackState? state) => state switch
    {
        TrackState.Benched => TrackRepair.Offer,
        TrackState.Failing => TrackRepair.Retry,
        _ => null,
    };

    /// <summary>The list-wide button, which names how many records it acts on.</summary>
    public static string BulkLabel(TrackRepair repair, int count) => repair == TrackRepair.Offer
        ? $"Offer these again ({count})"
        : $"Try these again ({count})";

    /// <summary>The list-wide confirmation. It acts on the page showing, and says so.</summary>
    public static TrackRepairWords Bulk(TrackRepair repair, int count)
    {
        var scope = count == 1
            ? "This acts on the 1 record on this page."
            : $"This acts on the {count} records on this page.";

        return repair == TrackRepair.Offer
            ? new(
                BulkLabel(repair, count),
                "Offer these copies again?",
                "Puts back on offer every copy a provider refused, and clears the backoff on the rest. Nothing in the station brings a refused copy back on its own, and this overrides that. " + scope,
                "Offer them again")
            : new(
                BulkLabel(repair, count),
                "Try these records again?",
                "Clears the backoff and un-benches every copy, so the station may try each of them straight away. This is what to press once an upstream that was failing is working again. " + scope,
                "Try again");
    }

    /// <summary>What a list-wide repair did, kept on screen because the counts are the interesting half.</summary>
    public static string Outcome(int done, int refused)
    {
        var records = done == 1 ? "1 record reopened" : $"{done} records reopened";
        return refused == 0 ? $"{records}." : $"{records}, {refused} the station would not act on.";
    }
}
