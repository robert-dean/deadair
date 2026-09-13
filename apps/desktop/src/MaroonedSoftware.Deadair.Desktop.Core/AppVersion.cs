using System.Reflection;

namespace MaroonedSoftware.Deadair.Desktop.Core;

/// <summary>
/// This build's version, read from what the build stamped rather than written down again.
/// </summary>
/// <remarks>
/// <para>
/// The number is decided in a changeset, which bumps <c>apps/desktop/package.json</c>, and
/// <c>pnpm release:version</c> copies it into <c>Directory.Build.props</c>, which stamps every
/// assembly. The User-Agent used to carry a third copy as a literal, which nothing kept in step and
/// which would have gone on naming 0.1.0 to every station's logs after the first release.
/// </para>
/// <para>
/// Read from this assembly rather than the entry one: every project under <c>apps/desktop</c> takes
/// the same <c>Version</c>, so the answer is the same in the app, in Shots and in the tests, and the
/// entry assembly is not always there to ask.
/// </para>
/// </remarks>
public static class AppVersion
{
    /// <summary>What an assembly nobody stamped answers.</summary>
    public const string Unknown = "0.0.0";

    /// <summary>The version as released, for a person or a User-Agent: <c>0.2.0</c>, <c>0.3.0-beta.1</c>.</summary>
    public static string Current { get; } = Read(typeof(AppVersion).Assembly);

    /// <summary>The same, as a number to compare, without any prerelease suffix.</summary>
    public static Version Number { get; } = ToNumber(Current);

    /// <summary>
    /// Takes the build's informational version down to the release's.
    /// </summary>
    /// <remarks>
    /// The .NET SDK appends <c>+</c> and the commit to the informational version whenever it builds
    /// inside a git checkout, which here is always. That belongs to a build rather than a release, and
    /// a User-Agent carrying it would be a different string from every commit. A prerelease suffix is
    /// kept, because it IS part of what was released.
    /// </remarks>
    public static string Strip(string? informational)
    {
        if (string.IsNullOrWhiteSpace(informational))
        {
            return Unknown;
        }

        var plus = informational.IndexOf('+', StringComparison.Ordinal);
        var version = (plus < 0 ? informational : informational[..plus]).Trim();

        return version.Length == 0 ? Unknown : version;
    }

    internal static string Read(Assembly assembly) =>
        Strip(assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion);

    /// <summary>The release number of a version string, <c>0.0.0</c> when there is none to read.</summary>
    public static Version ToNumber(string version)
    {
        ArgumentNullException.ThrowIfNull(version);

        var dash = version.IndexOf('-', StringComparison.Ordinal);
        var release = dash < 0 ? version : version[..dash];

        return Version.TryParse(release, out var number) ? number : new Version(0, 0, 0);
    }
}
