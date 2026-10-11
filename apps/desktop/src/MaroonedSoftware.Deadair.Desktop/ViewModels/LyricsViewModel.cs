using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One timed line, and whether it is the one being sung.</summary>
public sealed partial class LyricLineViewModel(string text) : ObservableObject
{
    public string Text { get; } = text;

    [ObservableProperty]
    private bool _isCurrent;
}

/// <summary>
/// The words of the record the listener hears, as the Now playing panel and Studio draw them.
/// </summary>
/// <remarks>
/// <para>
/// A projection of <see cref="LyricsUiState"/> (Core's <c>Lyrics.State</c>), which is where every
/// decision is made: whether there is anything to show, and which line is lit. This only turns that
/// answer into rows a list can bind to, and keeps the rows when only the lit line moved, so the
/// half-second tick re-lights one line rather than redrawing the song.
/// </para>
/// </remarks>
public sealed partial class LyricsViewModel : ObservableObject
{
    private IReadOnlyList<LyricLineDetail>? _shownLines;

    /// <summary>The timed lines, for a record that has them. Empty otherwise.</summary>
    public ObservableCollection<LyricLineViewModel> Lines { get; } = [];

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasLyrics), nameof(IsSynced), nameof(IsPlain), nameof(PlainText), nameof(Credit))]
    private LyricsUiState _state = LyricsUiState.Hidden.Instance;

    /// <summary>The line being sung, or -1 when none is: before the singing, in a gap, or unknown.</summary>
    [ObservableProperty]
    private int _current = -1;

    /// <summary>Whether the panel's Lyrics section is open. Per session, and open to begin with.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ToggleHint))]
    private bool _isOpen = true;

    public string ToggleHint => IsOpen ? "Hide the lyrics" : "Show the lyrics";

    /// <summary>False draws no section and no Studio button.</summary>
    public bool HasLyrics => State is not LyricsUiState.Hidden;

    public bool IsSynced => State is LyricsUiState.Synced;

    public bool IsPlain => State is LyricsUiState.Plain;

    public string? PlainText => (State as LyricsUiState.Plain)?.Text;

    /// <summary>Which source the words came from, under them, as the phone says it.</summary>
    public string? Credit => State switch
    {
        LyricsUiState.Synced { Provider: { } provider } => $"From {provider}",
        LyricsUiState.Plain { Provider: { } provider } => $"From {provider}",
        _ => null,
    };

    [RelayCommand]
    private void ToggleOpen() => IsOpen = !IsOpen;

    /// <summary>Draws <paramref name="state"/>, keeping the rows when they are the same song's.</summary>
    public void Show(LyricsUiState state)
    {
        if (state is LyricsUiState.Synced synced)
        {
            if (!ReferenceEquals(synced.Lines, _shownLines))
            {
                _shownLines = synced.Lines;
                Current = -1;
                Lines.Clear();
                foreach (var line in synced.Lines)
                {
                    Lines.Add(new LyricLineViewModel(line.Text));
                }
            }

            Light(synced.Current ?? -1);
        }
        else
        {
            if (_shownLines is not null)
            {
                _shownLines = null;
                Lines.Clear();
            }

            Current = -1;
        }

        if (!Equals(State, state))
        {
            State = state;
        }
    }

    private void Light(int index)
    {
        if (index == Current)
        {
            return;
        }

        if (Current >= 0 && Current < Lines.Count)
        {
            Lines[Current].IsCurrent = false;
        }

        if (index >= 0 && index < Lines.Count)
        {
            Lines[index].IsCurrent = true;
        }

        Current = index;
    }
}
