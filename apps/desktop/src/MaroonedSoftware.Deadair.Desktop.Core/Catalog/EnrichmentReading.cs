using System.Globalization;
using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Catalog;

/// <summary>One labelled figure: "Label", "Sub Pop".</summary>
public sealed record EnrichmentPair(string Label, string Value);

/// <summary>A link an upstream gave, already narrowed to http(s) by the station.</summary>
public sealed record EnrichmentLinkRow(string Label, Uri Url);

/// <summary>One thing the station believes, and the words it read that say so.</summary>
/// <param name="Category">What kind of fact, in words.</param>
/// <param name="Quoted">Whether it is an article's own lead copied verbatim rather than a model's reading of one.</param>
public sealed record ClaimRow(string Category, string Claim, string Quote, Uri? Source, bool Quoted);

/// <summary>Who answered, when, and whether they had anything.</summary>
public sealed record SourceRow(string Text, StatusTone Tone);

/// <summary>
/// What the enrichment providers said about one act, release or record, ready to draw.
/// </summary>
/// <remarks>
/// <para>
/// One reading for the three kinds, because the differences are absences: an act has no tempo, a
/// release has no ISRC, and every field on all three is optional. A panel that branched on which one
/// it was drawing would be three panels drifting apart. Ported from the console's
/// <c>enrichment.panel.tsx</c>.
/// </para>
/// <para>
/// The sources are not decoration. Everything above them is somebody else's claim, and an operator
/// looking at a wrong genre needs to know which source to correct and how old the answer is. A source
/// that was asked and had nothing is listed too, and it is a different state from one that could not
/// be reached: the first is settled, the second is the walk still owing an answer.
/// </para>
/// </remarks>
public sealed record EnrichmentReading(
    IReadOnlyList<string> Tags,
    IReadOnlyList<EnrichmentPair> Pairs,
    IReadOnlyList<ClaimRow> Claims,
    IReadOnlyList<string> Facts,
    string? Biography,
    IReadOnlyList<EnrichmentLinkRow> Links,
    string? ExternalIds,
    string? Unmapped,
    IReadOnlyList<SourceRow> Sources)
{
    /// <summary>Whether anybody has been asked at all. Nothing here is a sentence of its own, not an empty card.</summary>
    public bool IsEmpty => Sources.Count == 0 && Claims.Count == 0;

    // Each section says whether it has anything, so an empty one takes no room: a card whose absent
    // sections each kept their spacing drew a hole between the genres and the biography.
    public bool HasTags => Tags.Count > 0;

    public bool HasPairs => Pairs.Count > 0;

    public bool HasClaims => Claims.Count > 0;

    public bool HasFacts => Facts.Count > 0;

    public bool HasLinks => Links.Count > 0;

    public static EnrichmentReading From(TrackEnrichmentDetail detail, CultureInfo? culture = null)
    {
        ArgumentNullException.ThrowIfNull(detail);
        var merged = detail.Merged;
        return Build(
            [.. merged.Genres ?? [], .. merged.Moods ?? []],
            PairsOf(merged.ReleaseDate, merged.Year, merged.Label, merged.Bpm, merged.MusicalKey, merged.Isrc, culture),
            detail.Claims,
            merged.Facts,
            merged.Biography,
            merged.Links,
            merged.ExternalIds,
            merged.Extra,
            detail.Sources.Select(source => Source(source.Provider, source.FetchedAt, source.Stale, source.Found, source.Failed, culture)));
    }

    public static EnrichmentReading From(ArtistEnrichmentDetail detail, CultureInfo? culture = null)
    {
        ArgumentNullException.ThrowIfNull(detail);
        var merged = detail.Merged;
        return Build(
            [.. merged.Genres ?? []],
            [],
            detail.Claims,
            merged.Facts,
            merged.Biography,
            merged.Links,
            merged.ExternalIds,
            merged.Extra,
            detail.Sources.Select(source => Source(source.Provider, source.FetchedAt, source.Stale, source.Found, source.Failed, culture)));
    }

    public static EnrichmentReading From(AlbumEnrichmentDetail detail, CultureInfo? culture = null)
    {
        ArgumentNullException.ThrowIfNull(detail);
        var merged = detail.Merged;
        return Build(
            [.. merged.Genres ?? []],
            PairsOf(merged.ReleaseDate, merged.Year, merged.Label, null, null, null, culture),
            detail.Claims,
            merged.Facts,
            null,
            merged.Links,
            merged.ExternalIds,
            merged.Extra,
            detail.Sources.Select(source => Source(source.Provider, source.FetchedAt, source.Stale, source.Found, source.Failed, culture)));
    }

    /// <summary>
    /// The scalar fields in the order they are worth reading, dropping what nobody resolved. A full
    /// release date wins over a bare year, which is what a four-character date already is.
    /// </summary>
    public static IReadOnlyList<EnrichmentPair> PairsOf(
        string? releaseDate,
        long? year,
        string? label,
        double? bpm,
        string? key,
        string? isrc,
        CultureInfo? culture = null)
    {
        var format = culture ?? CultureInfo.CurrentCulture;
        var pairs = new List<EnrichmentPair>();

        void Add(string name, string? value)
        {
            if (!string.IsNullOrEmpty(value))
            {
                pairs.Add(new(name, value));
            }
        }

        Add("Providers say released", releaseDate is { Length: > 4 } ? releaseDate : year?.ToString(CultureInfo.InvariantCulture));
        Add("Label", label);
        Add("BPM", bpm?.ToString("0.#", format));
        Add("Key", key);
        Add("ISRC", isrc);
        return pairs;
    }

    /// <summary>What one provider's line says, which is three states rather than two.</summary>
    public static SourceRow Source(string provider, DateTimeOffset fetched, bool stale, bool found, bool failed, CultureInfo? culture = null)
    {
        var date = fetched.ToLocalTime().ToString("d MMM yyyy", culture ?? CultureInfo.CurrentCulture);
        var (state, tone) = (failed, found) switch
        {
            (true, true) => ($"{date}, could not re-ask", StatusTone.Standby),
            (true, false) => ("could not ask", StatusTone.Standby),
            (false, true) => (date, StatusTone.Ok),
            (false, false) => ("nothing found", StatusTone.Off),
        };

        return new($"{provider} · {state}{(stale ? " · due again" : string.Empty)}", tone);
    }

    private static EnrichmentReading Build(
        IReadOnlyList<string> tags,
        IReadOnlyList<EnrichmentPair> pairs,
        IEnumerable<FactClaim> claims,
        IEnumerable<string>? facts,
        string? biography,
        IEnumerable<EnrichmentLink>? links,
        IEnumerable<EnrichmentExternalId>? ids,
        Dictionary<string, JsonElement>? extra,
        IEnumerable<SourceRow> sources) => new(
            tags,
            pairs,
            [.. claims.Select(claim => new ClaimRow(
                claim.Category.Replace('_', ' '),
                claim.Claim,
                claim.SourceQuote,
                Uri.TryCreate(claim.SourceUrl, UriKind.Absolute, out var url) ? url : null,
                claim.Source == "lead"))],
            [.. facts ?? []],
            string.IsNullOrWhiteSpace(biography) ? null : biography,
            [.. (links ?? []).Select(link => Uri.TryCreate(link.Url, UriKind.Absolute, out var url) && url.Scheme is "http" or "https"
                    ? new EnrichmentLinkRow(link.Label, url)
                    : null)
                .OfType<EnrichmentLinkRow>()],
            ids is null || !ids.Any() ? null : string.Join("   ", ids.Select(id => $"{id.Source}: {id.Id}")),

            // Shown as what they are, raw JSON, rather than drawn as though this app knew what the
            // keys meant. It cannot: a plugin can add to the bag without an SDK release.
            extra is { Count: > 0 } ? JsonSerializer.Serialize(extra, Indented) : null,
            [.. sources]);

    private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };
}
