using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;

namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>A short piece of audio the station sent whole: a voice sample, a segment, a pad.</summary>
/// <param name="Data">The bytes, already fetched through the station's one client.</param>
/// <param name="Extension">What kind of file they are, with its dot, so the player can tell.</param>
public sealed record Clip(byte[] Data, string Extension);

/// <summary>
/// Plays one clip at a time, beside the station rather than instead of it.
/// </summary>
/// <remarks>
/// <para>
/// A second <see cref="IStationPlayer"/> over a file rather than a second kind of player: the
/// platform's player already plays a <c>file://</c> address, so a preview is written to a temporary
/// file and played from there. That keeps the bytes' fetch on the station's ONE client — the preview
/// endpoints want the operator's bearer token, which only that client carries — and keeps this class
/// free of anything platform-specific, so it is tested with a fake player.
/// </para>
/// <para>
/// One at a time: starting a clip stops the last one, and its file goes with it. The station's stream
/// is left alone — a preview is something an operator listens to OVER the station, and a clip that
/// stopped the broadcast in their ears would be a preview nobody could judge against it.
/// </para>
/// </remarks>
public sealed class ClipPlayer(Func<IStationPlayer> create, string? directory = null) : IAsyncDisposable
{
    private readonly string _directory = directory ?? Path.Combine(Path.GetTempPath(), "deadair-clips");
    private IStationPlayer? _player;
    private string? _file;

    /// <summary>What is playing, as whatever key the caller gave it, or null.</summary>
    public string? Playing { get; private set; }

    /// <summary>Raised when a clip starts or stops, from whichever thread the player reported on.</summary>
    public event Action? Changed;

    public async Task PlayAsync(string key, Clip clip, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(key);
        ArgumentNullException.ThrowIfNull(clip);

        await StopAsync(cancellationToken).ConfigureAwait(true);

        Directory.CreateDirectory(_directory);
        var file = Path.Combine(_directory, $"clip-{Guid.NewGuid():N}{clip.Extension}");
        await File.WriteAllBytesAsync(file, clip.Data, cancellationToken).ConfigureAwait(true);

        var player = create();
        player.StatusChanged += status =>
        {
            // A clip that finishes, or that the player could not open, is a clip that has stopped.
            if (status.Phase is PlayerPhase.Ended or PlayerPhase.Failed && ReferenceEquals(_player, player))
            {
                _ = StopAsync(CancellationToken.None);
            }
        };

        _player = player;
        _file = file;
        Playing = key;
        Changed?.Invoke();

        await player.PlayAsync(new Uri(file), cancellationToken).ConfigureAwait(true);
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        var player = _player;
        var file = _file;
        _player = null;
        _file = null;

        if (player is null)
        {
            return;
        }

        Playing = null;
        await player.StopAsync(cancellationToken).ConfigureAwait(true);
        await player.DisposeAsync().ConfigureAwait(true);

        if (file is not null)
        {
            try
            {
                File.Delete(file);
            }
            catch (IOException)
            {
                // Left for the system's own tidying of its temporary folder.
            }
        }

        Changed?.Invoke();
    }

    public ValueTask DisposeAsync() => new(StopAsync());
}
