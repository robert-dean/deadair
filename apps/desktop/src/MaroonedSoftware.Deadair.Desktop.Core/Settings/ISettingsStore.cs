namespace MaroonedSoftware.Deadair.Desktop.Core.Settings;

/// <summary>Where <see cref="DesktopSettings"/> is kept.</summary>
public interface ISettingsStore
{
    DesktopSettings Current { get; }

    event Action<DesktopSettings>? Changed;

    Task LoadAsync(CancellationToken cancellationToken = default);

    Task SaveAsync(DesktopSettings settings, CancellationToken cancellationToken = default);
}
