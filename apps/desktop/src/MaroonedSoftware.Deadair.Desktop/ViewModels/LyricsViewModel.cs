using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One timed line, whether it is the one being sung, and how much of it has been.</summary>
/// <remarks>
/// The row draws <see cref="Sung"/> then <see cref="Rest"/>, which together are always
/// <see cref="Text"/>: a line that is not being sung, or whose source did not time its words, has
/// nothing sung and is drawn exactly as a plain line was.
/// </remarks>
public sealed partial class LyricLineViewModel(string text) : ObservableObject
{
    public string Text { get; } = text;

    [ObservableProperty]
    private bool _isCurrent;

    /// <summary>The part of the line already sung, lit in the accent. Empty when nothing is.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Rest), nameof(IsSinging))]
    private string _sung = string.Empty;

    /// <summary>The rest of the line, after <see cref="Sung"/>.</summary>
    public string Rest => Text[Sung.Length..];

    /// <summary>Whether part of the line is lit, which is what draws the glow behind it.</summary>
    public bool IsSinging => Sung.Length > 0;

    /// <summary>Lights the first <paramref name="length"/> characters, or none for null.</summary>
    public void Sing(int? length) => Sung = length is { } count && count > 0 ? Text[..Math.Min(count, Text.Length)] : string.Empty;
}

/// <summary>
/// The words of the record the listener hears, as the Now playing panel and Studio draw them.
/// </summary>
/// <remarks>
/// <para>
/// A projection of <see cref="LyricsUiState"/> (Core's <c>Lyrics.State</c>), which is where every
/// decision is made: whether there is anything to show, and which line is lit. This only turns that
/// answer into rows a list can bind to, and keeps the rows when only the lit line moved, so the
/// tick re-lights one line rather than redrawing the song.
/// </para>
/// </remarks>
public sealed partial class LyricsViewModel : ObservableObject
{
    private IReadOnlyList<LyricLineDetail>? _shownLines;

    /// <summary>The timed lines, for a record that has them. Empty otherwise.</summary>
    public ObservableCollection<LyricLineViewModel> Lines { get; } = [];

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasLyrics), nameof(IsSynced), nameof(IsPlain), nameof(PlainText), nameof(Credit))]
    [NotifyPropertyChangedFor(nameof(StudioShowsWords), nameof(StudioShowsCover))]
    private LyricsUiState _state = LyricsUiState.Hidden.Instance;

    /// <summary>The line being sung, or -1 when none is: before the singing, in a gap, or unknown.</summary>
    [ObservableProperty]
    private int _current = -1;

    /// <summary>Whether the panel's Lyrics section is open. Per session, and open to begin with.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ToggleHint))]
    private bool _isOpen = true;

    public string ToggleHint => IsOpen ? "Hide the lyrics" : "Show the lyrics";

    /// <summary>
    /// Whether Studio was asked for the words in place of the cover. Per session, like Studio itself.
    /// </summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(StudioShowsWords), nameof(StudioShowsCover), nameof(StudioHint))]
    private bool _wordsInStudio;

    /// <summary>
    /// The words take the cover's place only while there are words: a record with none, or the next
    /// airing before its answer arrives, puts the cover back without anybody pressing anything.
    /// </summary>
    public bool StudioShowsWords => WordsInStudio && HasLyrics;

    public bool StudioShowsCover => !StudioShowsWords;

    public string StudioHint => WordsInStudio ? "Show the cover" : "Show the lyrics";

    /// <summary>
    /// Whether the words on screen are timed word by word, so the playhead should move finely enough to
    /// light each one: ten times a second rather than twice. Only while the lyrics are showing (the
    /// panel's section open, or Studio showing the words), and only for a song whose source timed its
    /// words, because a line lit whole gains nothing from the faster tick.
    /// </summary>
    public bool FollowsWords => _hasWordTimings && (IsOpen || StudioShowsWords);

    private bool _hasWordTimings;

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

    [RelayCommand]
    private void ToggleStudio() => WordsInStudio = !WordsInStudio;

    /// <summary>Draws <paramref name="state"/>, keeping the rows when they are the same song's.</summary>
    public void Show(LyricsUiState state)
    {
        if (state is LyricsUiState.Synced synced)
        {
            if (!ReferenceEquals(synced.Lines, _shownLines))
            {
                _shownLines = synced.Lines;
                _hasWordTimings = Core.NowPlaying.Lyrics.HasWordTimings(synced.Lines);
                Current = -1;
                Lines.Clear();
                foreach (var line in synced.Lines)
                {
                    Lines.Add(new LyricLineViewModel(line.Text));
                }
            }

            Light(synced.Current ?? -1, synced.Sung);
        }
        else
        {
            if (_shownLines is not null)
            {
                _shownLines = null;
                _hasWordTimings = false;
                Lines.Clear();
            }

            Current = -1;
        }

        if (!Equals(State, state))
        {
            State = state;
        }
    }

    private void Light(int index, int? sung)
    {
        if (index != Current)
        {
            if (Current >= 0 && Current < Lines.Count)
            {
                Lines[Current].IsCurrent = false;
                Lines[Current].Sing(null);
            }

            if (index >= 0 && index < Lines.Count)
            {
                Lines[index].IsCurrent = true;
            }

            Current = index;
        }

        if (index >= 0 && index < Lines.Count)
        {
            Lines[index].Sing(sung);
        }
    }
}
