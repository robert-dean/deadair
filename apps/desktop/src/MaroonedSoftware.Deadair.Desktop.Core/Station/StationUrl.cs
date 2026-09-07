namespace MaroonedSoftware.Deadair.Desktop.Core.Station;

/// <summary>
/// One station's address, and the three things reached at it.
/// </summary>
/// <remarks>
/// <para>
/// The operator types an ORIGIN — <c>https://radio.example.com</c> — and everything else is derived
/// from it, because the station's own answers are paths rather than URLs. The API sits under
/// <c>/api</c>, which the edge strips before the app sees a request; the mounts and the HLS playlist
/// do NOT, and putting them there is the mistake this type exists to make impossible.
/// </para>
/// <para>
/// A path is resolved against the origin that ANSWERED, never against a URL the station composed for
/// itself. The station is reached through whatever edge served it, which may be a tunnel, a LAN
/// address or a hostname the app has never seen.
/// </para>
/// </remarks>
public readonly record struct StationUrl
{
    private StationUrl(Uri origin) => Origin = origin;

    /// <summary>Scheme and authority, with no trailing slash.</summary>
    public Uri Origin { get; }

    /// <summary>Where the SDK is pointed. The trailing segment the edge strips.</summary>
    public string ApiBase => $"{Origin.GetLeftPart(UriPartial.Authority)}/api";

    /// <summary>Resolves a mount path from <c>GET /nowplaying</c>. NOT under <c>/api</c>.</summary>
    public Uri MountUrl(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        return new Uri($"{Origin.GetLeftPart(UriPartial.Authority)}/{path.TrimStart('/')}");
    }

    /// <summary>
    /// Resolves an <c>artworkUrl</c>, which arrives in two shapes.
    /// </summary>
    /// <remarks>
    /// An absolute URL is the provider's own CDN, for art the station has not cached yet, and is used
    /// as it stands. A relative <c>art/&lt;uuid&gt;</c> is the station's own copy and lives under the
    /// API root. Resolving it is the client's job: the API mounts its routers at the root and knows
    /// nothing about the <c>/api</c> prefix the edge adds.
    /// </remarks>
    public Uri? ArtUrl(string? artworkUrl)
    {
        if (string.IsNullOrWhiteSpace(artworkUrl))
        {
            return null;
        }

        if (Uri.TryCreate(artworkUrl, UriKind.Absolute, out var absolute)
            && (absolute.Scheme == Uri.UriSchemeHttp || absolute.Scheme == Uri.UriSchemeHttps))
        {
            return absolute;
        }

        return new Uri($"{ApiBase}/{artworkUrl.TrimStart('/')}");
    }

    /// <summary>
    /// Reads what somebody typed.
    /// </summary>
    /// <remarks>
    /// Forgiving in the two ways an address is usually mistyped: a bare host with no scheme gets
    /// <c>https</c>, and a trailing slash or path is dropped, because only the origin is meaningful.
    /// A host with an explicit <c>http</c> is left alone — a station on a LAN is a real case and
    /// upgrading it silently would leave somebody with an app that cannot connect and no reason why.
    /// </remarks>
    public static bool TryParse(string? text, out StationUrl station)
    {
        station = default;

        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        var trimmed = text.Trim();
        if (!trimmed.Contains("://", StringComparison.Ordinal))
        {
            trimmed = $"https://{trimmed}";
        }

        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var parsed))
        {
            return false;
        }

        if (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps)
        {
            return false;
        }

        if (string.IsNullOrEmpty(parsed.Host))
        {
            return false;
        }

        station = new StationUrl(new Uri(parsed.GetLeftPart(UriPartial.Authority)));
        return true;
    }

    public override string ToString() => Origin.GetLeftPart(UriPartial.Authority);
}
