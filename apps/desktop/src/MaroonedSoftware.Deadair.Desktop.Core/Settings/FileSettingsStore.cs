using System.Diagnostics;
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
/// <para>
/// <b>And a file that cannot be read is never written over.</b> Starting clean used to be half of
/// that, and the other half was the first write of the session: a volume change, a plugin's saved
/// configuration, anything at all, wrote the defaults the app had fallen back to over the file it
/// could not understand, and the station address and every plugin's settings went with them. A file
/// from a newer build did exactly this on a downgrade. So a load that fails sets
/// <see cref="Problem"/>, changes keep applying in memory, and the disk is left alone until somebody
/// fixes or removes the file. It is not renamed aside either: the next launch would then start clean
/// and write defaults, which is the same loss one launch later beside a file nobody will find.
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

    public SettingsFileProblem? Problem { get; private set; }

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
        catch (Exception exception)
        {
            // A hand-edit or a file from a newer build (the write below cannot leave a truncated one).
            // An install with no preferences is a working app; a refusal to start is not. What it
            // must not become is an install that saves those empty preferences over the file.
            Problem = new SettingsFileProblem(_path, exception.Message);
            Trace.WriteLine($"settings: could not read {_path}, and nothing will be saved to it this session: {exception.Message}");
        }
    }

    public Task SaveAsync(DesktopSettings settings, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(settings);

        return UpdateAsync(_ => settings, cancellationToken);
    }

    public async Task<DesktopSettings> UpdateAsync(Func<DesktopSettings, DesktopSettings> change, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(change);

        // The lock is taken BEFORE the change is applied, not just around the write. Applying it
        // outside would make this a read-modify-write with a gap in the middle, which is the very
        // thing this method exists to close: two writers would each build their new settings from
        // the same old ones and the second would land on top of the first, silently.
        await _writing.WaitAsync(cancellationToken).ConfigureAwait(false);
        DesktopSettings settings;
        try
        {
            settings = change(Current) ?? throw new InvalidOperationException("a settings change answered null");
            Current = settings;

            // Applied, and not written: see the class remarks. Everything subscribed still hears
            // about it below, so the session behaves exactly as it would with a good file.
            if (Problem is null)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_path)!);

                // Written beside and moved into place, so an interrupted write leaves the previous
                // settings rather than half of the new ones.
                var temporary = _path + ".tmp";
                await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(settings, Format), cancellationToken)
                    .ConfigureAwait(false);
                File.Move(temporary, _path, overwrite: true);
            }
        }
        finally
        {
            _writing.Release();
        }

        // Raised outside the lock. A subscriber that wrote settings back from its handler would
        // otherwise deadlock against a semaphore this same call is still holding.
        Changed?.Invoke(settings);
        return settings;
    }

    public void Dispose() => _writing.Dispose();
}
