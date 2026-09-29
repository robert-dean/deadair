using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>What every catalog detail page is handed: the station, and where it can lead.</summary>
public sealed record CatalogPageContext(
    OperatorActions Actions,
    HttpClient Http,
    StationUrl Station,
    NavigationViewModel Navigation,
    IDialogs Dialogs)
{
    public DeadairSdk Sdk() => new(new SdkOptions { BaseUrl = Station.ApiBase, HttpClient = Http });
}

/// <summary>
/// An act's, a release's or a record's own page, read when it opens.
/// </summary>
/// <remarks>
/// The thing itself, what the providers said about it, and (for the two that have one) its list are
/// three reads rather than one, as they are in the web console: the list pages on its own, and a
/// provider's answer arriving late or not at all must not keep the page blank.
/// </remarks>
public abstract partial class CatalogDetailViewModel(CatalogPageContext context, string name) : ObservableObject
{
    protected CatalogPageContext Context { get; } = context;

    /// <summary>What the page is called: the list's name until the station has answered with its own.</summary>
    [ObservableProperty]
    private string _name = name;

    /// <summary>The line under the name.</summary>
    [ObservableProperty]
    private string? _credit;

    [ObservableProperty]
    private Uri? _artworkUrl;

    [ObservableProperty]
    private RatingViewModel? _rating;

    [ObservableProperty]
    private bool _busy;

    /// <summary>Said when the thing itself could not be read, in place of everything else.</summary>
    [ObservableProperty]
    private string? _problem;

    public string Initial => Name.Length == 0 ? "?" : char.ToUpperInvariant(Name[0]).ToString();

    partial void OnNameChanged(string value) => OnPropertyChanged(nameof(Initial));

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            await ReadAsync(cancellationToken).ConfigureAwait(true);
        }
        finally
        {
            Busy = false;
        }
    }

    protected abstract Task ReadAsync(CancellationToken cancellationToken);

    protected Func<DeadairSdk> Sdk => Context.Sdk;
}

/// <summary>The paging a detail page's own list needs, which is only forward and back.</summary>
public sealed partial class DetailPager(Func<Task> read) : ObservableObject
{
    public const long Size = 50;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanGoBack), nameof(CanGoForward), nameof(IsPaged))]
    private long _page;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanGoForward), nameof(Summary), nameof(IsPaged))]
    private long _total;

    public bool CanGoBack => Page > 0;

    public bool CanGoForward => CatalogPaging.HasNext(Page, Size, Total);

    /// <summary>Only drawn when there is more than one page: one page of a release has nowhere to go.</summary>
    public bool IsPaged => Total > Size;

    public string Summary => CatalogPaging.Summary(Page, Size, Total);

    [RelayCommand]
    private async Task NextAsync()
    {
        if (CanGoForward)
        {
            Page++;
            await read().ConfigureAwait(true);
            OnPropertyChanged(nameof(Summary));
        }
    }

    [RelayCommand]
    private async Task PreviousAsync()
    {
        if (CanGoBack)
        {
            Page--;
            await read().ConfigureAwait(true);
            OnPropertyChanged(nameof(Summary));
        }
    }
}
