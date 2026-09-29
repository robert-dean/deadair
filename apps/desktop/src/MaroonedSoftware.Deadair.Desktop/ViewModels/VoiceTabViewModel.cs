using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// One tab of the Voice page: a station to ask, a way to ask it, and a line to say what happened.
/// </summary>
/// <remarks>
/// <para>
/// Ten tabs share this rather than ten copies of the same client plumbing. Each is owned by
/// <see cref="VoiceViewModel"/>, which attaches it and loads it when it is shown, so a tab fetches when
/// it is opened and never on a timer: the station rate-limits at a hundred requests per five seconds.
/// </para>
/// <para>
/// <see cref="Notice"/> is the tab's own good news ("Saved", "Imported three characters"). A refusal is
/// not written here: <see cref="OperatorActions"/> reports it at the foot of the page, or on the dialog
/// that is saving.
/// </para>
/// </remarks>
public abstract partial class VoiceTabViewModel(OperatorActions actions, HttpClient http) : ObservableObject
{
    protected OperatorActions Actions { get; } = actions;

    protected HttpClient Http { get; } = http;

    protected StationUrl Station { get; private set; }

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private string? _notice;

    public void Attach(StationUrl station) => Station = station;

    /// <summary>Reads what the tab shows.</summary>
    [RelayCommand]
    public async Task LoadAsync(CancellationToken cancellationToken)
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

    /// <summary>What reading the tab means.</summary>
    protected abstract Task ReadAsync(CancellationToken cancellationToken);

    /// <summary>Stops anything the tab keeps running, when the page is left or the station changes.</summary>
    public virtual void Leave()
    {
    }

    /// <summary>A call that answers with a body, or null when the station refused (and has been reported).</summary>
    protected Task<T?> RunAsync<T>(
        Func<DeadairSdk, CancellationToken, Task<T>> call,
        IReadOnlyDictionary<int, string>? expected = null,
        CancellationToken cancellationToken = default)
        where T : class =>
        Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await call(sdk, token).ConfigureAwait(false);
            },
            expected,
            cancellationToken);

    protected DeadairSdk Sdk() => Sdk(Station, Http);

    /// <summary>A client for one station over the app's one HttpClient.</summary>
    public static DeadairSdk Sdk(StationUrl station, HttpClient http) => new(new SdkOptions
    {
        BaseUrl = station.ApiBase,
        HttpClient = http,
    });
}
