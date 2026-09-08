using System.Text.Json;

namespace MaroonedSoftware.Deadair.Desktop.Core.Settings;

/// <summary>
/// Settings as one JSON file under the per-user application data directory.
/// </summary>
/// <remarks>
/// <para>
/// <c>~/Library/Application Support/deadair/settings.json</c> on macOS, and the platform's
/// equivalent elsewhere. Nothing in it is a secret — the station address, a theme, a preferred
/// format — which is exactly why it is not in the credential store: a keychain prompt to find out
/// which colour scheme somebody likes would be absurd.
/// </para>
/// <para>
/// A file that cannot be read is treated as an install with no preferences rather than as an error.
/// The worst case is somebody retyping a station address; refusing to start would be worse.
/// </para>
/// </remarks>
public sealed class FileSettingsStore : ISettingsStore, IDisposable
{
    private static readonly JsonSerializerOptions Format = new() { WriteIndented = true };

    private readonly string _path;
    private readonly SemaphoreSlim _writing = new(1, 1);

    public FileSettingsStore(string? directory = null)
    {
        var root = directory ?? DefaultDirectory();
        _path = Path.Combine(root, "settings.json");
    }

    public DesktopSettings Current { get; private set; } = new();

    public event Action<DesktopSettings>? Changed;

    public static string DefaultDirectory() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData, Environment.SpecialFolderOption.Create),
        "deadair");

    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            if (!File.Exists(_path))
            {
                return;
            }

            var text = await File.ReadAllTextAsync(_path, cancellationToken).ConfigureAwait(false);
            var settings = JsonSerializer.Deserialize<DesktopSettings>(text);
            if (settings is not null)
            {
                Current = settings;
                Changed?.Invoke(settings);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            // A truncated write, a hand-edit, a file from a newer build. An install with no
            // preferences is a working app; a refusal to start is not.
        }
    }

    public async Task SaveAsync(DesktopSettings settings, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(settings);

        Current = settings;
        Changed?.Invoke(settings);

        await _writing.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);

            // Written beside and moved into place, so an interrupted write leaves the previous
            // settings rather than half of the new ones.
            var temporary = _path + ".tmp";
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(settings, Format), cancellationToken)
                .ConfigureAwait(false);
            File.Move(temporary, _path, overwrite: true);
        }
        finally
        {
            _writing.Release();
        }
    }

    public void Dispose() => _writing.Dispose();
}
