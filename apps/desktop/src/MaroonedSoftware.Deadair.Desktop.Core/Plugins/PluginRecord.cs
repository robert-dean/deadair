using MaroonedSoftware.Deadair.Desktop.PluginSdk;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Manifest;

namespace MaroonedSoftware.Deadair.Desktop.Core.Plugins;

/// <summary>
/// Where a plugin got to.
/// </summary>
/// <remarks>
/// The station's own vocabulary, because it is the same set of answers to the same question and the
/// console and this app should not describe one situation with two words.
/// </remarks>
public enum PluginStatus
{
    /// <summary>Found and readable. Nobody has said whether to run it.</summary>
    Discovered,

    /// <summary>Switched off. Still listed, still configurable; its code has never been loaded.</summary>
    Disabled,

    /// <summary>Wants something it has not been given. Its own fault to fix, and the page says which.</summary>
    Misconfigured,

    /// <summary>Loaded, started, and answering.</summary>
    Active,

    /// <summary>
    /// Quarantined. Something about it could not be read, loaded or started, and
    /// <see cref="PluginRecord.Error"/> says what.
    /// </summary>
    Failed,
}

/// <summary>
/// One plugin candidate and everything the app knows about it.
/// </summary>
/// <remarks>
/// A record rather than an exception path, because every way a plugin can be wrong ends the same
/// way: a row on the settings page saying what happened. Discovery of twelve plugins where the
/// fourth has a typo must still answer with twelve.
/// </remarks>
public sealed record PluginRecord
{
    /// <summary>
    /// The manifest's id, or the directory's name when no manifest could be read.
    /// </summary>
    /// <remarks>
    /// A quarantined plugin still needs something to be listed under, and the folder name is the
    /// only thing left when the file inside it is the problem.
    /// </remarks>
    public required string Id { get; init; }

    /// <summary>Where it is, so somebody can go and look at it.</summary>
    public required string Directory { get; init; }

    public required PluginOrigin Origin { get; init; }

    public required PluginStatus Status { get; init; }

    /// <summary>Absent exactly when the manifest could not be read.</summary>
    public PluginManifest? Manifest { get; init; }

    /// <summary>
    /// What went wrong, in words for whoever has to fix it. Set whenever the status is
    /// <see cref="PluginStatus.Failed"/> or <see cref="PluginStatus.Misconfigured"/>.
    /// </summary>
    public string? Error { get; init; }

    /// <summary>The live instance, while there is one.</summary>
    public IDeadairPlugin? Instance { get; init; }

    /// <summary>What the settings page calls it: its own name, or the folder when it has none.</summary>
    public string DisplayName => Manifest?.Name ?? Id;

    /// <summary>Whether it declared a capability, whatever this app makes of the word.</summary>
    public bool Declares(string capability) =>
        Manifest is not null && Manifest.Capabilities.Contains(capability, StringComparer.Ordinal);
}
