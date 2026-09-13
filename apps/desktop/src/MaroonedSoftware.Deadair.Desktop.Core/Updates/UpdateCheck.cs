using System.Globalization;
using System.Text.Json;

namespace MaroonedSoftware.Deadair.Desktop.Core.Updates;

/// <summary>A newer desktop release, and the page that describes it.</summary>
public sealed record UpdateAvailable(Version Version, Uri Page);

/// <summary>
/// Which desktop release is newest, read from the repository's tags.
/// </summary>
/// <remarks>
/// <para>
/// From the TAGS and not the releases, and the reason is the station. Its own releases live in the
/// same repository and ship several a day (eight in the two days before this was written), so a
/// page of releases stops reaching the newest desktop one within a week or two, and
/// <c>releases/latest</c> answers the station's. <c>git/matching-refs/tags/desktop-v</c> answers every
/// desktop tag in one request however busy the station is. The desktop release workflow is the only
/// thing that makes one, and a draft has no tag until it is published (not measured here: no desktop
/// release existed when this was written).
/// </para>
/// <para>
/// A notice and a link, never an install. The app is not notarised, so an update is a download
/// somebody has to open past Gatekeeper anyway, and the page carries the notes that say how.
/// </para>
/// </remarks>
public static class UpdateCheck
{
    public const string TagPrefix = "desktop-v";

    private const string RefPrefix = "refs/tags/" + TagPrefix;

    public static readonly Uri Endpoint = new("https://api.github.com/repos/robert-dean/deadair/git/matching-refs/tags/" + TagPrefix);

    private const string ReleasePage = "https://github.com/robert-dean/deadair/releases/tag/";

    /// <summary>The newest desktop release that is newer than <paramref name="current"/>, or null.</summary>
    /// <remarks>
    /// A tag with anything after the version (<c>desktop-v0.3.0-rc.1</c>) does not parse as one and is
    /// skipped, which is right: a prerelease is not something to tell a listener to go and get.
    /// </remarks>
    /// <exception cref="JsonException">When the answer is not JSON at all.</exception>
    public static UpdateAvailable? Newest(Version current, string refsJson)
    {
        ArgumentNullException.ThrowIfNull(current);
        ArgumentNullException.ThrowIfNull(refsJson);

        using var document = JsonDocument.Parse(refsJson);

        if (document.RootElement.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        Version? newest = null;
        string? newestTag = null;

        foreach (var item in document.RootElement.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object
                || !item.TryGetProperty("ref", out var reference)
                || reference.GetString() is not { } name
                || !name.StartsWith(RefPrefix, StringComparison.Ordinal))
            {
                continue;
            }

            var text = name[RefPrefix.Length..];

            if (!Version.TryParse(text, out var version) || text.Contains('-', StringComparison.Ordinal))
            {
                continue;
            }

            if (newest is null || version > newest)
            {
                newest = version;
                newestTag = TagPrefix + text;
            }
        }

        return newest is not null && newestTag is not null && Normalise(newest) > Normalise(current)
            ? new UpdateAvailable(newest, new Uri(ReleasePage + Uri.EscapeDataString(newestTag)))
            : null;
    }

    /// <summary>0.2 and 0.2.0 are the same release; <see cref="Version"/> alone thinks 0.2.0 is newer.</summary>
    private static Version Normalise(Version version) => new(
        version.Major,
        Math.Max(version.Minor, 0),
        Math.Max(version.Build, 0),
        Math.Max(version.Revision, 0));

    /// <summary>The notice's own words, kept here so the sidebar and a test agree.</summary>
    public static string Describe(UpdateAvailable update)
    {
        ArgumentNullException.ThrowIfNull(update);
        return string.Create(CultureInfo.InvariantCulture, $"deadair {update.Version} is available");
    }
}
