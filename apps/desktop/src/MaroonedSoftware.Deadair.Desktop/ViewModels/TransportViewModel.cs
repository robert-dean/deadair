using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Net;
using MaroonedSoftware.Deadair.Desktop.Core.Playout;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// The operator's controls, and the station's own account of why it is quiet.
/// </summary>
/// <remarks>
/// Drawn only while the cached roles say `admin`, which is a hint about what to SHOW. The station
/// decides what is allowed, and a 403 refreshes the hint rather than being reported as a failure.
/// </remarks>
public sealed partial class TransportViewModel : ObservableObject, IAsyncDisposable
{
    private readonly SessionManager _session;
    private readonly OperatorActions _actions;
    private readonly HttpClient _http;
    private readonly IUiDispatcher _dispatcher;
    private readonly ArmedStop _stop = new();

    private PlayoutRepository? _repository;
    private IDisposable? _lease;

    public TransportViewModel(
        SessionManager session,
        OperatorActions actions,
        HttpClient http,
        IUiDispatcher dispatcher)
    {
        _session = session;
        _actions = actions;
        _http = http;
        _dispatcher = dispatcher;

        _session.Changed += _ => _dispatcher.Post(ApplySession);
        _actions.Noticed += notice => _dispatcher.Post(() => NoticeText = Describe(notice));
    }

    [ObservableProperty]
    private bool _isOperator;

    [ObservableProperty]
    private bool _streamUp;

    [ObservableProperty]
    private bool _onAir;

    [ObservableProperty]
    private long _queued;

    [ObservableProperty]
    private string _silence = string.Empty;

    [ObservableProperty]
    private string? _remedy;

    [ObservableProperty]
    private StatusTone _silenceTone = StatusTone.Off;

    [ObservableProperty]
    private bool _showSilence;

    [ObservableProperty]
    private string _stopLabel = "Stop";

    /// <summary>
    /// Whether Stop is waiting for its second press.
    /// </summary>
    /// <remarks>
    /// Beside the label rather than derived from it: a view asking "is this string 'Press again'"
    /// would be a view that breaks when the words change, and the words are the kind of thing that
    /// changes.
    /// </remarks>
    [ObservableProperty]
    private bool _isArmed;

    [ObservableProperty]
    private string? _noticeText;

    [ObservableProperty]
    private bool _busy;

    public void Attach(StationUrl station)
    {
        _repository = new PlayoutRepository(station, _http, _dispatcher);
        _repository.Changed += OnReading;
        ApplySession();
    }

    private void ApplySession()
    {
        var operating = _session.State is SessionState.SignedIn { IsOperator: true };
        IsOperator = operating;

        if (operating)
        {
            // Only an operator may read the status at all, so the poll starts and stops with the role
            // rather than with the window.
            _lease ??= _repository?.Subscribe();
        }
        else
        {
            _lease?.Dispose();
            _lease = null;
        }
    }

    private void OnReading(Reading<PlayoutStatus> reading)
    {
        if (reading.Value is not { } status)
        {
            return;
        }

        StreamUp = status.StreamUp;
        OnAir = status.OnAir;
        Queued = status.QueuedCount;

        // The station composes the sentence; this only chooses a colour for it.
        Silence = status.Silence.Detail;
        Remedy = status.Silence.Remedy;
        SilenceTone = SilenceReading.ToneFor(status.Silence.Cause);
        ShowSilence = SilenceReading.WorthShowing(status.Silence);
    }

    /// <summary>
    /// The same skip the on-screen button performs, for a media key pressed outside the window.
    /// </summary>
    /// <remarks>
    /// One path into the station rather than two: a keyboard skip and a clicked skip must not be able
    /// to disagree about notices, roles or the settling re-reads.
    /// </remarks>
    public Task SkipFromSystemAsync() => SkipAsync(CancellationToken.None);

    [RelayCommand]
    private async Task SkipAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            await _actions.RunAsync(
                token => _repository!.SkipAsync(token),
                cancellationToken: cancellationToken).ConfigureAwait(true);
        }
        finally
        {
            Busy = false;
        }
    }

    /// <summary>
    /// Arms on the first press and acts on the second.
    /// </summary>
    /// <remarks>
    /// Stop takes the station off the air with no undo, and it sits beside Skip. The two-press
    /// arrangement is the web console's, for the same reason.
    /// </remarks>
    [RelayCommand]
    private async Task StopAsync(CancellationToken cancellationToken)
    {
        if (!_stop.Press())
        {
            StopLabel = "Press again";
            IsArmed = true;
            return;
        }

        StopLabel = "Stop";
        IsArmed = false;
        Busy = true;
        try
        {
            await _actions.RunAsync(
                token => _repository!.StopAsync(token),
                cancellationToken: cancellationToken).ConfigureAwait(true);
        }
        finally
        {
            Busy = false;
        }
    }

    [RelayCommand]
    private async Task StartAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            await _actions.RunAsync(
                token => _repository!.StartAsync(token),

                // Not a fault: the station was stood down with nothing left in the running order, and
                // saying so is more useful than saying the request failed.
                new Dictionary<int, string> { [409] = "There is nothing to resume." },
                cancellationToken).ConfigureAwait(true);
        }
        finally
        {
            Busy = false;
        }
    }

    private static string Describe(Notice notice) => notice switch
    {
        Notice.NoLongerOperator => "This account is no longer an operator.",
        Notice.StepUpNeeded => "The station wants your authenticator code again before that.",
        Notice.Expected expected => expected.Detail,
        Notice.Failed failed => failed.Detail,
        _ => "Something went wrong.",
    };

    public async ValueTask DisposeAsync()
    {
        _lease?.Dispose();

        if (_repository is not null)
        {
            await _repository.DisposeAsync().ConfigureAwait(false);
        }
    }
}
