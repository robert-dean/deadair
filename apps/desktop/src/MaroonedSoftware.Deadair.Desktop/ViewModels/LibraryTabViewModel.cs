using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// One tab of the Library, which reads once when it is first opened.
/// </summary>
/// <remarks>
/// <para>
/// The Library was one view model holding six lists, and a page that grew ratings, repairs, imports,
/// podcasts and narrations would have been one file nobody could change without reading all of it.
/// So each tab is its own, owned by <see cref="LibraryViewModel"/>, which is still the one the shell
/// and the container know about.
/// </para>
/// <para>
/// Whether a tab has read is a flag and not "its list is empty", which is what it used to be: a list
/// that is empty because the station HAS nothing was read again on every visit, and one whose read
/// failed was never retried. The flag is set only by a read that answered.
/// </para>
/// </remarks>
public abstract partial class LibraryTabViewModel(OperatorActions actions, HttpClient http) : ObservableObject
{
    private bool _read;

    protected OperatorActions Actions { get; } = actions;

    protected StationUrl Station { get; private set; }

    [ObservableProperty]
    private bool _busy;

    /// <summary>What the last thing done on this tab came to, kept on screen until the next.</summary>
    [ObservableProperty]
    private string? _notice;

    public void Attach(StationUrl station) => Station = station;

    /// <summary>Reads the tab the first time it is opened, and not again.</summary>
    public async Task OpenAsync()
    {
        if (_read || Busy)
        {
            return;
        }

        await RefreshAsync(CancellationToken.None).ConfigureAwait(true);
    }

    /// <summary>Reads the tab again, because somebody asked.</summary>
    [RelayCommand]
    private async Task RefreshAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            _read = await ReadAsync(cancellationToken).ConfigureAwait(true) || _read;
        }
        finally
        {
            Busy = false;
        }
    }

    /// <summary>Reads what the tab shows, and answers whether the station answered.</summary>
    protected abstract Task<bool> ReadAsync(CancellationToken cancellationToken);

    /// <summary>Forgets the old station's answers, so the next visit reads the new one's.</summary>
    public virtual void Reset()
    {
        _read = false;
        Notice = null;
    }

    protected DeadairSdk Sdk() => new(new SdkOptions { BaseUrl = Station.ApiBase, HttpClient = http });
}

/// <summary>
/// A tab whose list is paged, searched and ordered by the station.
/// </summary>
/// <remarks>
/// A new search or a new ordering starts at the first page. Staying on page seven of the previous
/// results is how a search appears to return nothing.
/// </remarks>
public abstract partial class PagedTabViewModel(OperatorActions actions, HttpClient http) : LibraryTabViewModel(actions, http)
{
    [ObservableProperty]
    private string _search = string.Empty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanGoBack), nameof(CanGoForward))]
    private long _page;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanGoForward))]
    private long _total;

    [ObservableProperty]
    private string _summary = string.Empty;

    /// <summary>How many rows a page holds. Fifty, the console's own choice for a desk monitor.</summary>
    public virtual long PageSize => 50;

    public bool CanGoBack => Page > 0;

    public bool CanGoForward => CatalogPaging.HasNext(Page, PageSize, Total);

    /// <summary>The search as the station should get it: absent rather than blank.</summary>
    protected string? Term => string.IsNullOrWhiteSpace(Search) ? null : Search.Trim();

    /// <summary>Reads the current page, and answers its total or null when the station did not answer.</summary>
    protected abstract Task<long?> ReadPageAsync(CancellationToken cancellationToken);

    protected sealed override async Task<bool> ReadAsync(CancellationToken cancellationToken)
    {
        if (await ReadPageAsync(cancellationToken).ConfigureAwait(true) is not { } total)
        {
            return false;
        }

        Total = total;
        Summary = CatalogPaging.Summary(Page, PageSize, Total);
        return true;
    }

    [RelayCommand]
    private async Task FindAsync()
    {
        Page = 0;
        await RefreshCommand.ExecuteAsync(null).ConfigureAwait(true);
    }

    [RelayCommand]
    private async Task NextPageAsync()
    {
        if (!CanGoForward)
        {
            return;
        }

        Page++;
        await RefreshCommand.ExecuteAsync(null).ConfigureAwait(true);
    }

    [RelayCommand]
    private async Task PreviousPageAsync()
    {
        if (!CanGoBack)
        {
            return;
        }

        Page--;
        await RefreshCommand.ExecuteAsync(null).ConfigureAwait(true);
    }

    /// <summary>Starts the list again at its first page, as a change of ordering or filter does.</summary>
    protected void Restart()
    {
        Page = 0;
        _ = RefreshCommand.ExecuteAsync(null);
    }

    public override void Reset()
    {
        base.Reset();
        Search = string.Empty;
        Page = 0;
        Total = 0;
        Summary = string.Empty;
    }
}
