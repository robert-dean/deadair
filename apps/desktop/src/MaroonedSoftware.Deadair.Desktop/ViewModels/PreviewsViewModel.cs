using CommunityToolkit.Mvvm.ComponentModel;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// The one preview playing anywhere in the app, and how a page starts or stops one.
/// </summary>
/// <remarks>
/// One for the whole app rather than one per page, so a voice sample on one tab and a pad on another
/// cannot play over each other. A page asks by a key of its own choosing and redraws its rows from
/// <see cref="Playing"/>.
/// </remarks>
public sealed partial class PreviewsViewModel : ObservableObject, IAsyncDisposable
{
    private readonly ClipPlayer _clips;

    public PreviewsViewModel(ClipPlayer clips, IUiDispatcher dispatcher)
    {
        ArgumentNullException.ThrowIfNull(clips);
        ArgumentNullException.ThrowIfNull(dispatcher);

        _clips = clips;

        // The player reports from its own thread when a clip ends.
        _clips.Changed += () => dispatcher.Post(() => Playing = _clips.Playing);
    }

    /// <summary>The key of what is playing, or null.</summary>
    [ObservableProperty]
    private string? _playing;

    /// <summary>
    /// Plays a clip, or stops it if it is the one already playing.
    /// </summary>
    /// <param name="key">Whatever identifies it to the page asking.</param>
    /// <param name="fetch">Reads the bytes, answering null when the station refused.</param>
    public async Task ToggleAsync(string key, Func<CancellationToken, Task<Clip?>> fetch, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(fetch);

        if (Playing == key)
        {
            await _clips.StopAsync(cancellationToken).ConfigureAwait(true);
            Playing = null;
            return;
        }

        var clip = await fetch(cancellationToken).ConfigureAwait(true);
        if (clip is null)
        {
            return;
        }

        await _clips.PlayAsync(key, clip, cancellationToken).ConfigureAwait(true);
        Playing = _clips.Playing;
    }

    public Task StopAsync() => _clips.StopAsync();

    public ValueTask DisposeAsync() => _clips.DisposeAsync();
}
