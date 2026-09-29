using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Services;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>Which part of the library is showing.</summary>
public enum LibraryTab
{
    Tracks,
    Artists,
    Albums,
    Playlists,
    Charts,
    News,
    Podcasts,
}

/// <summary>
/// The records the station can draw on, as one page of tabs.
/// </summary>
/// <remarks>
/// <para>
/// This is the page the shell and the container know about, and it owns one view model per tab
/// (<see cref="LibraryTabViewModel"/>): it attaches them, resets them, and opens whichever is chosen.
/// Each tab reads once, when it is first opened.
/// </para>
/// <para>
/// Read on demand rather than polled. A catalog does not change while somebody is looking at it, and
/// a station that rate-limits at a hundred requests per five seconds should not be asked for a page
/// of records every two.
/// </para>
/// </remarks>
public sealed partial class LibraryViewModel : ObservableObject
{
    public LibraryViewModel(OperatorActions actions, HttpClient http, NavigationViewModel navigation, IDialogs dialogs, IFilePicker picker)
    {
        Navigation = navigation;
        Dialogs = dialogs;
        Picker = picker;
        Records = new RecordsViewModel(actions, http, dialogs, navigation);
        Acts = new ActsViewModel(actions, http, navigation);
        Releases = new AlbumsViewModel(actions, http, navigation);
        Playlists = new PlaylistsViewModel(actions, http, dialogs, navigation, picker);
        Charts = new ChartsViewModel(actions, http, navigation, dialogs);
        Podcasts = new PodcastsViewModel(actions, http);
        News = new NewsViewModel(actions, http);
    }

    /// <summary>Where a detail page opened from this one goes, for the pages <c>DetailPages</c> builds.</summary>
    public NavigationViewModel Navigation { get; }

    /// <summary>What a detail page opened from this one asks through.</summary>
    public IDialogs Dialogs { get; }

    /// <summary>The open and save panels, for the pages that take a file in or write one out.</summary>
    public IFilePicker Picker { get; }

    public RecordsViewModel Records { get; }

    public ActsViewModel Acts { get; }

    public AlbumsViewModel Releases { get; }

    public PlaylistsViewModel Playlists { get; }

    public ChartsViewModel Charts { get; }

    public NewsViewModel News { get; }

    public PodcastsViewModel Podcasts { get; }

    private IEnumerable<LibraryTabViewModel> All => [Records, Acts, Releases, Playlists, Charts, News, Podcasts];

    /// <summary>The records, which the shell asks after to know whether the page has been read.</summary>
    public ObservableCollection<TrackRowViewModel> Tracks => Records.Tracks;

    [ObservableProperty]
    private LibraryTab _tab = LibraryTab.Tracks;

    public bool IsTracks => Tab == LibraryTab.Tracks;

    public bool IsArtists => Tab == LibraryTab.Artists;

    public bool IsAlbums => Tab == LibraryTab.Albums;

    public bool IsPlaylists => Tab == LibraryTab.Playlists;

    public bool IsCharts => Tab == LibraryTab.Charts;

    public bool IsNews => Tab == LibraryTab.News;

    public bool IsPodcasts => Tab == LibraryTab.Podcasts;

    /// <summary>The tab showing.</summary>
    public LibraryTabViewModel Current => Tab switch
    {
        LibraryTab.Artists => Acts,
        LibraryTab.Albums => Releases,
        LibraryTab.Playlists => Playlists,
        LibraryTab.Charts => Charts,
        LibraryTab.News => News,
        LibraryTab.Podcasts => Podcasts,
        _ => Records,
    };

    public void Attach(StationUrl station)
    {
        foreach (var tab in All)
        {
            tab.Attach(station);
        }
    }

    /// <summary>Forgets the old station's library, so the next visit reads the new one's.</summary>
    /// <remarks>
    /// Each tab reads only once, which is right for one station and would show the old station's
    /// records forever after a switch without this.
    /// </remarks>
    public void Reset()
    {
        foreach (var tab in All)
        {
            tab.Reset();
        }

        Tab = LibraryTab.Tracks;
    }

    partial void OnTabChanged(LibraryTab value)
    {
        OnPropertyChanged(nameof(IsTracks));
        OnPropertyChanged(nameof(IsArtists));
        OnPropertyChanged(nameof(IsAlbums));
        OnPropertyChanged(nameof(IsPlaylists));
        OnPropertyChanged(nameof(IsCharts));
        OnPropertyChanged(nameof(IsNews));
        OnPropertyChanged(nameof(IsPodcasts));
        OnPropertyChanged(nameof(Current));

        _ = Current.OpenAsync();
    }

    [RelayCommand]
    private void ShowTab(string tab)
    {
        if (Enum.TryParse<LibraryTab>(tab, out var parsed))
        {
            Tab = parsed;
        }
    }

    /// <summary>
    /// Goes to the records, searched for a title: where a chart's Find leads. The search is set before
    /// the tab so a first visit reads the search rather than the whole catalog and then the search.
    /// </summary>
    public void FindRecords(string title)
    {
        Records.Search = title;
        Navigation.Show(new Navigation.Destination.Library());
        var opening = Tab != LibraryTab.Tracks;
        Tab = LibraryTab.Tracks;
        if (!opening || Records.Tracks.Count > 0)
        {
            Records.FindCommand.Execute(null);
        }
    }

    /// <summary>Opens the page on whichever tab it was left on.</summary>
    [RelayCommand]
    private Task LoadAsync() => Current.OpenAsync();
}
