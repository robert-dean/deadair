using System.Text.Json;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Configuration;

/// <summary>One entry of a provider pick: the value stored and what it is called.</summary>
public sealed record ProviderOption(string Value, string Label);

/// <summary>
/// Which plugin does a job, and in what order they are asked: the console's <c>provider.pick.tsx</c>
/// and <c>provider.ranking.tsx</c>, with their rules.
/// </summary>
/// <remarks>
/// <para>
/// Both are saved through SETTINGS, under the key the station names for the job, because that is
/// where the choice lives: a pick stores a plugin id (empty for Automatic), an order stores a JSON
/// array of <c>{ source }</c> rows, and going back to the default clears the row with JSON null rather
/// than storing an empty list. An empty list would mean the same thing today and reads as a decision
/// rather than the absence of one.
/// </para>
/// <para>
/// A plugin that is named and cannot answer is still the stored value, so it has to be among the
/// choices or the box would draw as if nothing were set, which is the one thing that state must not
/// look like.
/// </para>
/// </remarks>
public static class ProviderChoices
{
    /// <summary>What a pick stores for Automatic.</summary>
    public const string Automatic = "";

    /// <summary>The choices for a job only one plugin does at a time.</summary>
    public static IReadOnlyList<ProviderOption> PickOptions(ProviderCapabilityState state)
    {
        ArgumentNullException.ThrowIfNull(state);

        var active = state.Candidates.Where(candidate => candidate.Position is not null).ToList();
        var idle = state.Candidates.Where(candidate => candidate.Position is null).ToList();
        var inUse = active.FirstOrDefault(candidate => candidate.InUse);
        var named = state.Configured.Trim();

        var options = new List<ProviderOption>
        {
            new(Automatic, inUse is not null && named.Length == 0 ? $"Automatic (currently {inUse.Name})" : "Automatic"),
        };

        options.AddRange(active.Select(candidate => new ProviderOption(candidate.PluginId, candidate.Name)));
        options.AddRange(idle
            .Where(candidate => candidate.PluginId == named)
            .Select(candidate => new ProviderOption(candidate.PluginId, $"{candidate.Name} (not running)")));

        if (named.Length > 0 && state.Stale.Contains(named) && idle.All(candidate => candidate.PluginId != named))
        {
            options.Add(new ProviderOption(named, $"{named} (not installed)"));
        }

        return options;
    }

    /// <summary>The plugins in the order they are asked now: only the ones that can answer have a place.</summary>
    public static IReadOnlyList<ProviderCandidate> Asked(ProviderCapabilityState state)
    {
        ArgumentNullException.ThrowIfNull(state);
        return [.. state.Candidates.Where(candidate => candidate.Position is not null).OrderBy(candidate => candidate.Position)];
    }

    /// <summary>The plugins that could do the job and are not asked: switched off, or not answering.</summary>
    public static IReadOnlyList<ProviderCandidate> Idle(ProviderCapabilityState state)
    {
        ArgumentNullException.ThrowIfNull(state);
        return [.. state.Candidates.Where(candidate => candidate.Position is null)];
    }

    /// <summary>The order with one entry moved a place, or null when there is nowhere for it to go.</summary>
    public static IReadOnlyList<string>? Move(IReadOnlyList<string> order, int index, int by)
    {
        ArgumentNullException.ThrowIfNull(order);

        var target = index + by;
        if (index < 0 || index >= order.Count || target < 0 || target >= order.Count || by == 0)
        {
            return null;
        }

        var next = order.ToList();
        (next[index], next[target]) = (next[target], next[index]);
        return next;
    }

    /// <summary>An order as the setting stores it: text holding a JSON array of <c>{ source }</c> rows.</summary>
    public static JsonElement Order(IEnumerable<string> pluginIds) =>
        JsonSerializer.SerializeToElement(JsonSerializer.Serialize(pluginIds.Select(source => new { source })));

    /// <summary>A pick as the setting stores it: the plugin id as text, empty for Automatic.</summary>
    public static JsonElement Pick(string pluginId) => JsonSerializer.SerializeToElement(pluginId);

    /// <summary>What a job is called, the sentence saying what choosing changes, and the line for a job only one plugin does.</summary>
    /// <remarks>
    /// The station's vocabulary rather than the SDK's: an operator came here to decide who speaks,
    /// not to configure the <c>speech</c> capability. A capability this list does not know is drawn by
    /// its own name with a generic sentence, so a new one still appears.
    /// </remarks>
    public static (string Title, string Meaning, string Only) Words(string capability, string onlyName) => capability switch
    {
        "speech" => ("Speaking", "The voice the station talks in. One plugin does it: two engines rendering one break would be two breaks.",
            $"Only {onlyName} can speak, so there is nothing to choose."),
        "llm" => ("Writing", "Which plugin the station asks for words. One plugin does it, since two models writing one line is one wasted generation.",
            $"Only {onlyName} can write, so there is nothing to choose."),
        "mixer" => ("Joining audio", "Which plugin makes one piece of audio out of several. Its own choice, so a station can measure with one engine and join with another.",
            $"Only {onlyName} can join audio, so there is nothing to choose."),
        "transcode" => ("Making copies to share", "Which plugin makes the small copy of a talk break a listener sends on by text message. Its own choice, so a station can join with one engine and make copies with another.",
            $"Only {onlyName} can make copies to share, so there is nothing to choose."),
        "analysis" => ("Measuring records", "Which plugin measures records, so the station can trim the dead air off each one and know how long it may talk over an intro.",
            $"Only {onlyName} can measure records, so there is nothing to choose."),
        "similarity" => ("Who sounds like whom", "Every source is asked who resembles an artist and the answers are pooled. What to play by an artist, and what sounds like a particular record, take the first usable answer, so this order decides whose judgement airs.",
            $"Only {onlyName} can say who sounds like whom, so there is nothing to order."),
        "weather" => ("The weather", "The station asks in this order and reads out the first forecast it gets, because two services asked about one sky are two readings of the same thing rather than two facts.",
            $"Only {onlyName} can report the weather, so there is nothing to order."),
        "charts" => ("Charts", "Every service's charts stay on the menu whatever this says. This sets the order they appear in, and decides outright which service answers when a chart is asked for by style.",
            $"Only {onlyName} publishes charts, so there is nothing to order."),
        "enrichment" => ("What the station believes about a record", "Every source is asked about a record and the answers are merged field by field, so this decides who wins where two of them disagree about a year, a label or a running time.",
            $"Only {onlyName} fills in details about records, so there is nothing to order."),
        _ => (capability, "Which plugin the station uses for this.", $"Only {onlyName} can do this, so there is nothing to choose."),
    };
}
