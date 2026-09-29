using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>The check-up's tabs, in the web console's order.</summary>
public enum CheckupTab
{
    Machinery,
    History,
    Cost,
    Logs,
    Releases,
}

/// <summary>
/// The check-up: the machinery, what it has been doing, what that cost, the logs underneath, and
/// what changed in the build.
/// </summary>
/// <remarks>
/// <para>
/// One question asked in tenses, as the console's shell puts it. Machinery says what the station is
/// doing NOW, History what it DID, and Cost what each decision spent doing it. Logs is not a fourth
/// tense: it is what the processes actually wrote, where somebody ends up when the composed answer
/// was not enough. What's new is about the build rather than about what it is doing, and sits here
/// because Check-up is where the build is already named.
/// </para>
/// <para>
/// A view model per tab, each owning its own reads, and this one owning which is open. A tab is read
/// when it is opened and on every visit to the page while it is the open one, never on a timer.
/// </para>
/// </remarks>
public sealed partial class CheckupViewModel : ObservableObject
{
    private readonly HttpClient _http;
    private StationUrl _station;

    public CheckupViewModel(OperatorActions actions, HttpClient http, IFilePicker files)
    {
        _http = http;
        Machinery = new MachineryViewModel(actions, Sdk) { OpenReleases = () => Tab = CheckupTab.Releases };
        History = new ActivityFeedViewModel(actions, Sdk);
        Cost = new CostViewModel(actions, Sdk);
        Logs = new LogsViewModel(actions, Sdk, files);
        Releases = new ReleasesViewModel(actions, Sdk);
    }

    public MachineryViewModel Machinery { get; }

    public ActivityFeedViewModel History { get; }

    public CostViewModel Cost { get; }

    public LogsViewModel Logs { get; }

    public ReleasesViewModel Releases { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsMachinery))]
    [NotifyPropertyChangedFor(nameof(IsHistory))]
    [NotifyPropertyChangedFor(nameof(IsCost))]
    [NotifyPropertyChangedFor(nameof(IsLogs))]
    [NotifyPropertyChangedFor(nameof(IsReleases))]
    private CheckupTab _tab = CheckupTab.Machinery;

    public bool IsMachinery => Tab == CheckupTab.Machinery;

    public bool IsHistory => Tab == CheckupTab.History;

    public bool IsCost => Tab == CheckupTab.Cost;

    public bool IsLogs => Tab == CheckupTab.Logs;

    public bool IsReleases => Tab == CheckupTab.Releases;

    public void Attach(StationUrl station)
    {
        _station = station;
        Machinery.Attach(station.ToString());
    }

    partial void OnTabChanged(CheckupTab value) => LoadCommand.Execute(null);

    [RelayCommand]
    private void ShowTab(string tab)
    {
        if (Enum.TryParse<CheckupTab>(tab, out var parsed))
        {
            Tab = parsed;
        }
    }

    /// <summary>Reads the open tab.</summary>
    /// <remarks>
    /// Concurrent, because a tab pressed while the page's first read is still out is a second read of
    /// a different tab, and a command that refused it would leave that tab empty.
    /// </remarks>
    [RelayCommand(AllowConcurrentExecutions = true)]
    private Task LoadAsync(CancellationToken cancellationToken) => Tab switch
    {
        CheckupTab.History => History.LoadAsync(cancellationToken),
        CheckupTab.Cost => Cost.LoadAsync(cancellationToken),
        CheckupTab.Logs => Logs.LoadAsync(cancellationToken),
        CheckupTab.Releases => Releases.LoadAsync(cancellationToken),
        _ => Machinery.LoadAsync(cancellationToken),
    };

    private DeadairSdk Sdk() => new(new SdkOptions
    {
        BaseUrl = _station.ApiBase,
        HttpClient = _http,
    });
}

/// <summary>What a manage-only call answered, or that this account may not make it.</summary>
public sealed record Reply<T>(T? Value, bool Refused)
    where T : class;

/// <summary>
/// A call behind <c>platform.manage</c>, whose refusal is said on the page rather than at its foot.
/// </summary>
/// <remarks>
/// <see cref="OperatorActions"/> reports every plain 403 as "no longer an operator" and refreshes the
/// roles, which is right for a verb the operator was shown because the roles said they could. A
/// manage-only read on a page an operator CAN open is different: the refusal is an answer about this
/// part of the station, and the web console draws it as a sentence where the content would be. So
/// that one status is caught here and handed back; everything else still goes through the one path.
/// </remarks>
public static class ManageOnly
{
    public static async Task<Reply<T>> RunAsync<T>(
        OperatorActions actions,
        Func<CancellationToken, Task<T>> call,
        CancellationToken cancellationToken)
        where T : class
    {
        ArgumentNullException.ThrowIfNull(actions);
        ArgumentNullException.ThrowIfNull(call);

        var reply = await actions.RunAsync(
            async token =>
            {
                try
                {
                    return new Reply<T>(await call(token).ConfigureAwait(false), Refused: false);
                }
                catch (SdkException failure) when (ApiError.IsForbidden(failure))
                {
                    return new Reply<T>(null, Refused: true);
                }
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        return reply ?? new Reply<T>(null, Refused: false);
    }
}
