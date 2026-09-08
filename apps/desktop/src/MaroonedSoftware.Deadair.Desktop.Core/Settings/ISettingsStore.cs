namespace MaroonedSoftware.Deadair.Desktop.Core.Settings;

/// <summary>Where <see cref="DesktopSettings"/> is kept.</summary>
public interface ISettingsStore
{
    DesktopSettings Current { get; }

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
