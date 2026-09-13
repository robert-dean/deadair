namespace MaroonedSoftware.Deadair.Desktop.Core.Settings;

/// <summary>A settings file that exists and could not be read, and so is not being written.</summary>
/// <param name="Path">The file, so whoever reads the notice knows which one to open.</param>
/// <param name="Reason">What the reader said about it.</param>
public sealed record SettingsFileProblem(string Path, string Reason);

/// <summary>Where <see cref="DesktopSettings"/> is kept.</summary>
public interface ISettingsStore
{
    DesktopSettings Current { get; }

    /// <summary>Why the file on disk is being left alone this session, or null while it is written.</summary>
    /// <remarks>
    /// Set by a load that found a file it could not read. Changes still apply for the rest of the
    /// session; they are simply not written, because the only thing a write could put there is the
    /// defaults the app fell back to, over whatever the file actually said.
    /// </remarks>
    SettingsFileProblem? Problem { get; }

    event Action<DesktopSettings>? Changed;

    Task LoadAsync(CancellationToken cancellationToken = default);

    Task SaveAsync(DesktopSettings settings, CancellationToken cancellationToken = default);

    /// <summary>
    /// Changes part of the settings without losing a change somebody else made at the same moment.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Prefer this to reading <see cref="Current"/> and calling <see cref="SaveAsync"/>.</b> That
    /// pair is a read, a modify and a write with nothing held across them, and it was safe only for
    /// as long as every caller happened to be on the UI thread. A plugin saving its configuration
    /// from a background thread is a writer that does not, and the failure it produces is a volume
    /// change or an appearance quietly reverting for no reason anybody could reproduce.
    /// </para>
    /// <para>
    /// The change is applied INSIDE the lock, so it sees whatever the last write left rather than
    /// whatever was current when the caller decided to write.
    /// </para>
    /// </remarks>
    /// <param name="change">Takes the current settings and answers the new ones.</param>
    /// <returns>What was written.</returns>
    Task<DesktopSettings> UpdateAsync(Func<DesktopSettings, DesktopSettings> change, CancellationToken cancellationToken = default);
}
