using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Checkup;

/// <summary>Where a decision's sentence came from.</summary>
public enum DecisionSource
{
    /// <summary>A job this app has words for.</summary>
    Job,

    /// <summary>The console's own page load, which already reads as <c>GET /voices</c>.</summary>
    Request,

    /// <summary>A job added since this table was last brought up to date.</summary>
    Unknown,
}

/// <summary>A decision's kind in the words an operator would use for it.</summary>
/// <param name="ShowsKind">Whether the raw kind is worth drawing under the sentence. Not for a
/// request, whose sentence already is the kind, so it would be the same fact twice.</param>
public sealed record DecisionReading(string Sentence, DecisionSource Source)
{
    public bool ShowsKind => Source is not DecisionSource.Request;
}

/// <summary>One decision in the forest, with how deep under whatever caused it.</summary>
public sealed record PlacedDecision(TraceDecision Decision, int Depth);

/// <summary>
/// What the Cost tab says about what the station spent.
/// </summary>
/// <remarks>
/// Ported from the web console's <c>traces.page.tsx</c> and <c>decision.words.ts</c>, so both
/// surfaces call one decision the same thing and one duration the same length.
/// </remarks>
public static partial class TraceWords
{
    /// <summary>
    /// Every job there is, by hand, against the station's <c>job.mappings.ts</c>. There is no way to
    /// derive the sentence from the key, because the sentence is the whole point: it is what an
    /// operator would call the thing, not what the queue does.
    /// </summary>
    private static readonly Dictionary<string, string> Jobs = new(StringComparer.Ordinal)
    {
        ["catalog.sync"] = "Asked a music source what it still has",
        ["catalog.resolve_placeholders"] = "Matched a placeholder record to a real one",
        ["catalog.enrich"] = "Asked what the providers know about a record",
        ["catalog.extract_facts"] = "Read an article for facts to talk about",
        ["catalog.cache_art"] = "Fetched cover art",
        ["catalog.analyze"] = "Measured a record",
        ["playout.cache_track"] = "Fetched a record's audio",
        ["playout.sweep_track_cache"] = "Threw away cached audio over the cap",
        ["director.extend_lineup"] = "Topped up the running order",
        ["director.replan_lineup"] = "Threw the running order away and planned it again",
        ["director.write_break"] = "Wrote what a host says",
        ["director.produce"] = "Drafted a production",
        ["render.stitch_production"] = "Joined a production into one file",
        ["render.segment"] = "Turned a break into audio",
        ["render.prune_script_history"] = "Forgot old scripts",
        ["personas.distil_notes"] = "Read a persona's recent scripts into notes",
        ["personas.write_stories"] = "Wrote a persona's own stories",
        ["activity.prune_events"] = "Forgot old activity",
        ["schedule.tick"] = "Checked whether the schedule changed",
        ["scrobble.flush"] = "Reported what aired to a scrobble service",
    };

    /// <summary>
    /// A duration where the interesting range spans four orders of magnitude.
    /// </summary>
    /// <remarks>
    /// A record's <c>m:ss</c> is useless here, where the honest answers are "3ms" and "19.2s" on
    /// adjacent rows. Sub-second stays in milliseconds because a call that took 40ms and one that
    /// took 400 are different conversations, and past a second it rounds to a tenth because nobody
    /// reading a nineteen-second generation cares about its last 43ms.
    /// </remarks>
    public static string Spent(long ms) => ms switch
    {
        < 1000 => $"{Math.Max(0, ms)}ms",
        < 60_000 => (ms / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + "s",
        _ => $"{ms / 60_000}m {Math.Round(ms % 60_000 / 1000.0, MidpointRounding.AwayFromZero):0}s",
    };

    /// <summary>What a decision cost, where nought is "—".</summary>
    /// <remarks>
    /// Zero is a decision recorded before the station wrote a span for the job itself, not one that
    /// took no time, and a "0ms" would read as a measurement.
    /// </remarks>
    public static string Cost(long ms) => ms == 0 ? "—" : Spent(ms);

    /// <summary>The sentence a decision's raw kind is worth, and where it came from.</summary>
    /// <remarks>
    /// Always a sentence: a kind this table has not caught up with gets one built from its own
    /// string, dotted by the same <c>module.verb_noun</c> convention every entry follows, because a
    /// blank cell reads as a bug rather than as "no nicer word for it yet".
    /// </remarks>
    public static DecisionReading Describe(string kind)
    {
        ArgumentNullException.ThrowIfNull(kind);

        if (Jobs.TryGetValue(kind, out var sentence))
        {
            return new DecisionReading(sentence, DecisionSource.Job);
        }

        if (Request().IsMatch(kind))
        {
            return new DecisionReading($"Request · {kind}", DecisionSource.Request);
        }

        return new DecisionReading(kind.Replace('.', ' ').Replace('_', ' '), DecisionSource.Unknown);
    }

    /// <summary>
    /// The decisions as a forest: roots newest first, and whatever each one caused indented beneath.
    /// </summary>
    /// <remarks>
    /// A job that enqueues another is two decisions, and read as two unrelated rows an enrichment
    /// that spends two minutes in the extraction it queued is a walk and a mystery. A decision whose
    /// parent has rotated out of the kept window is a root rather than dropped: the edge was real and
    /// the other end is gone. The station's own order is kept at every level.
    /// </remarks>
    public static IReadOnlyList<PlacedDecision> Forest(IReadOnlyList<TraceDecision> decisions)
    {
        ArgumentNullException.ThrowIfNull(decisions);

        var ids = decisions.Select(decision => decision.Id).ToHashSet(StringComparer.Ordinal);
        var children = new Dictionary<string, List<TraceDecision>>(StringComparer.Ordinal);
        foreach (var decision in decisions)
        {
            if (decision.Parent is { } parent && ids.Contains(parent))
            {
                if (!children.TryGetValue(parent, out var list))
                {
                    children[parent] = list = [];
                }

                list.Add(decision);
            }
        }

        var placed = new List<PlacedDecision>(decisions.Count);
        var seen = new HashSet<string>(StringComparer.Ordinal);

        void Walk(TraceDecision decision, int depth)
        {
            // A cycle cannot happen on the station's side, and a guard costs nothing if it ever does.
            if (!seen.Add(decision.Id))
            {
                return;
            }

            placed.Add(new PlacedDecision(decision, depth));
            foreach (var child in children.GetValueOrDefault(decision.Id) ?? [])
            {
                Walk(child, depth + 1);
            }
        }

        foreach (var decision in decisions.Where(decision => decision.Parent is null || !ids.Contains(decision.Parent)))
        {
            Walk(decision, 0);
        }

        return placed;
    }

    /// <summary>
    /// The op-specific half of a call (tokens, a finish reason, the timeout it was given) as it was
    /// recorded, <c>key=value</c> apart.
    /// </summary>
    /// <remarks>
    /// Not given a shape per op: what is worth reading differs per op, and this is not the thing that
    /// should decide which of them matter. The one liberty is that a whole number is grouped, since a
    /// token count is the figure most often here and "12,408" is read at a glance where "12408" is
    /// counted.
    /// </remarks>
    public static string? Detail(IReadOnlyDictionary<string, JsonElement>? detail)
    {
        if (detail is null || detail.Count == 0)
        {
            return null;
        }

        return string.Join("  ", detail.Select(pair => $"{pair.Key}={Value(pair.Value)}"));
    }

    /// <summary>The line under the table, saying how much of the kept window is on screen.</summary>
    public static string Showing(int shown, long total, long spans) =>
        $"Showing {CheckupWords.Count(shown)} of {CheckupWords.Counted(total, "decision", "decisions")}, read from {CheckupWords.Counted(spans, "recorded call", "recorded calls")}.";

    private static string Value(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Number when value.TryGetInt64(out var whole) => CheckupWords.Count(whole),
        JsonValueKind.Number => value.GetDouble().ToString("0.###", CultureInfo.InvariantCulture),
        JsonValueKind.String => value.GetString() ?? string.Empty,
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null => "null",
        _ => value.GetRawText(),
    };

    [GeneratedRegex("^(GET|POST|PUT|PATCH|DELETE) ")]
    private static partial Regex Request();
}
