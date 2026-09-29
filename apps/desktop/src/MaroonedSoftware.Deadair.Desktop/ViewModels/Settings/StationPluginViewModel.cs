using System.Collections.ObjectModel;
using System.Globalization;
using System.Text;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Desktop.Core.Forms;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One line a station plugin wrote.</summary>
public sealed record PluginLogLineViewModel(string At, string Level, string Text, StatusTone Tone);

/// <summary>A choice of which lines to show.</summary>
public sealed record PluginLogFilter(string Label, PluginLogLevel? Level);

/// <summary>
/// One station plugin's own page: what it is, whether it can reach its provider, its settings, the
/// sign-in it holds, what it wrote, and the way to remove it. The console's plugin detail page.
/// </summary>
/// <remarks>
/// <para>
/// A detail page, built per visit by <c>DetailPages</c>. The only work it does on its own is waiting
/// for a sign-in to land after somebody was sent to a provider's consent screen in their browser, and
/// that stops when the plugin reports itself connected, when Stop is pressed, or when the page is left
/// (<see cref="Dispose"/>). The station rate-limits, and nobody is looking at a page they have left.
/// </para>
/// <para>
/// A reading taken while waiting redraws the header and nothing else. The settings form is rebuilt
/// only by opening the page or saving it, because a rebuild would throw away what somebody was typing
/// while they waited.
/// </para>
/// </remarks>
public sealed partial class StationPluginViewModel : ObservableObject, IDisposable
{
    private static readonly TimeSpan WaitEvery = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan WaitAtMost = TimeSpan.FromMinutes(5);

    private readonly SettingsCalls _calls;
    private readonly DeclaredOptions? _declared;
    private readonly Action _removed;
    private CancellationTokenSource? _waiting;
    private bool _enabled;

    public StationPluginViewModel(string id, string name, SettingsCalls calls, DeclaredOptions? declared, Action removed)
    {
        Id = id;
        _name = name;
        _calls = calls;
        _declared = declared;
        _removed = removed;
        _logFilter = LogFilters[0];
    }

    public string Id { get; }

    [ObservableProperty]
    private string _name;

    /// <summary>The station's last reading of this plugin.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(
        nameof(Heading), nameof(Description), nameof(Status), nameof(Tone), nameof(StatusDescription), nameof(IsInstalled),
        nameof(Capabilities), nameof(LastError), nameof(LoadedFrom), nameof(HasOAuth), nameof(IsConnected), nameof(ConnectLabel),
        nameof(HasFetcher), nameof(Verbose), nameof(IsRead))]
    private PluginDetail? _detail;

    public bool IsRead => Detail is not null;

    public string Heading => Detail is { } detail ? $"{detail.Id} · {detail.Version}" : Id;

    public string? Description => Detail?.Description;

    public string Status => Detail is { } detail ? PluginStatusWords.Label(detail.Status) : string.Empty;

    public StatusTone Tone => Detail is { } detail ? PluginStatusWords.Tone(detail.Status) : StatusTone.Off;

    public string StatusDescription => Detail is { } detail ? PluginStatusWords.Description(detail.Status) : string.Empty;

    public bool IsInstalled => Detail?.Origin == PluginOrigin.Installed;

    public IReadOnlyList<string> Capabilities => Detail?.Capabilities.Select(PluginRoles.Label).ToList() ?? [];

    public string? LastError => Detail?.LastError;

    /// <summary>
    /// Where the station looked, said only for a plugin that never loaded: that is usually a directory
    /// problem, and where it looked is the first thing needed to fix any of them.
    /// </summary>
    public string? LoadedFrom => Detail is { Status: PluginStatus.Failed, LastError: not null } detail ? $"Loaded from {detail.Dir}" : null;

    /// <summary>The switch, as on the row: setting it asks the station, and a refusal puts it back.</summary>
    public bool Enabled
    {
        get => _enabled;
        set
        {
            if (SetProperty(ref _enabled, value) && Detail is { } detail && value != detail.Enabled)
            {
                _ = SwitchAsync(detail, value);
            }
        }
    }

    [ObservableProperty]
    private bool _busy;

    // Test connection.

    [ObservableProperty]
    private string? _testResult;

    [ObservableProperty]
    private StatusTone _testTone;

    // What it has asked for.

    public ObservableCollection<PluginGrantRowViewModel> Grants { get; } = [];

    public bool HasGrants => Grants.Count > 0;

    // Settings.

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasSettings), nameof(HasNoSettings))]
    private ConfigFormViewModel? _form;

    public bool HasSettings => Form is { Fields.Count: > 0 };

    public bool HasNoSettings => Form is { Fields.Count: 0 };

    [ObservableProperty]
    private string? _settingsNotice;

    // Its sign-in with a provider.

    public bool HasOAuth => Detail?.Capabilities.Contains(PluginRoles.OAuth) == true;

    public bool IsConnected => Detail?.OauthConnected == true;

    public string ConnectLabel => IsConnected ? "Reconnect" : "Connect";

    /// <summary>The address to register with the provider, the console's own callback page.</summary>
    public string CallbackUrl => PluginLinks.OAuthCallback(_calls.Station, Id).AbsoluteUri;

    [ObservableProperty]
    private bool _waitingForSignIn;

    [ObservableProperty]
    private string? _signInNotice;

    // The track fetcher's own authorization.

    public bool HasFetcher => Detail?.UsesTrackFetcher == true;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(FetcherLabel), nameof(FetcherTone), nameof(FetcherSays), nameof(FetcherAction), nameof(CanAuthorize), nameof(FetcherLoginError))]
    private FetcherAuthorization? _fetcher;

    public string FetcherLabel => Fetcher is { } state ? PluginLinks.Fetcher(state).Label : string.Empty;

    public StatusTone FetcherTone => Fetcher is { } state ? PluginLinks.Fetcher(state).Tone : StatusTone.Off;

    /// <summary>The one sentence for where the authorization stands.</summary>
    public string FetcherSays => (Detail, Fetcher) switch
    {
        ({ Enabled: false } detail, _) => $"Enable {detail.Name} to see whether the station can fetch its audio.",
        (_, { Configured: false }) => "The stream half of this install has not been set up, so there is nothing here to authorize yet.",
        (_, { Reachable: false }) => "The track fetcher is not answering. Nothing can be authorized until it is running, and this is not the same as the station never having been authorized, so nothing has been lost.",
        (_, { Authorized: true }) => "The station holds its own Spotify authorization. Redo it only if the fetcher has started refusing logins, or to move the station to a different Spotify account.",
        (_, { Authorized: false }) => "The station cannot fetch any audio yet. Without this, every record is dropped from the running order for want of audio, however healthy the connection above looks.",
        _ => string.Empty,
    };

    public string? FetcherLoginError => Fetcher?.LoginError;

    public bool CanAuthorize => Detail is { Enabled: true } && Fetcher is not { Configured: false } and not { Reachable: false };

    public string FetcherAction => AuthorizeUrl is not null ? "Start again" : Fetcher?.Authorized == true ? "Re-authorize" : "Authorize";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(FetcherAction), nameof(IsAuthorizing))]
    private string? _authorizeUrl;

    public bool IsAuthorizing => AuthorizeUrl is not null;

    /// <summary>What the browser was sent to, pasted back from its address bar.</summary>
    [ObservableProperty]
    private string _pasted = string.Empty;

    [ObservableProperty]
    private string? _fetcherNotice;

    // What it wrote.

    public IReadOnlyList<PluginLogFilter> LogFilters { get; } =
    [
        new("All levels", null),
        new("Debug", PluginLogLevel.Debug),
        new("Info", PluginLogLevel.Info),
        new("Warn", PluginLogLevel.Warn),
        new("Error", PluginLogLevel.Error),
    ];

    [ObservableProperty]
    private PluginLogFilter _logFilter;

    public ObservableCollection<PluginLogLineViewModel> Log { get; } = [];

    [ObservableProperty]
    private bool _logEmpty;

    /// <summary>Whether the plugin writes its debug lines too. A property of the plugin, kept by the station.</summary>
    public bool Verbose
    {
        get => Detail?.LogLevel == PluginLogLevel.Debug;
        set
        {
            if (Detail is { } detail && value != (detail.LogLevel == PluginLogLevel.Debug))
            {
                _ = SetVerboseAsync(value);
            }
        }
    }

    partial void OnLogFilterChanged(PluginLogFilter value) => _ = ReadLogAsync(CancellationToken.None);

    partial void OnDetailChanged(PluginDetail? value)
    {
        if (value is not null)
        {
            Name = value.Name;
            _enabled = value.Enabled;
            OnPropertyChanged(nameof(Enabled));
        }
    }

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            var detail = await _calls.Actions.RunAsync(
                async token =>
                {
                    using var sdk = _calls.Sdk();
                    return await sdk.Plugins.GetPluginAsync(Id, token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (detail is null)
            {
                return;
            }

            Present(detail);
            await Task.WhenAll(
                OfferAsync(cancellationToken),
                ReadGrantsAsync(cancellationToken),
                ReadLogAsync(cancellationToken),
                ReadFetcherAsync(cancellationToken)).ConfigureAwait(true);
        }
        finally
        {
            Busy = false;
        }
    }

    /// <summary>Draws a reading, form and all.</summary>
    public void Present(PluginDetail detail)
    {
        ArgumentNullException.ThrowIfNull(detail);

        Detail = detail;

        // Typed: a plugin's configuration is stored exactly as sent and read by the plugin as a
        // boolean or a number, unlike the station's own settings, which are all text.
        Form = new ConfigFormViewModel(detail.ConfigFields.Select(FormField.From), detail.Config, detail.SecretsConfigured, FormEncoding.Typed);
    }

    /// <summary>The choices the plugin suggests for its own fields, and the live sources its fields name.</summary>
    private async Task OfferAsync(CancellationToken cancellationToken)
    {
        if (Form is not { } form)
        {
            return;
        }

        if (_declared is not null && form.Sources() is { Count: > 0 } sources)
        {
            form.Offer(await _declared.ResolveAsync(_calls.Station, sources, cancellationToken).ConfigureAwait(true));
        }

        // Quietly: a plugin that cannot suggest right now (not running, no provider) still has a form
        // somebody can type into, and a notice saying so would be about nothing they asked for.
        try
        {
            using var sdk = _calls.Sdk();
            var suggested = await sdk.Plugins.SuggestPluginConfigOptionsAsync(Id, cancellationToken).ConfigureAwait(true);
            if (suggested.Supported && ReferenceEquals(Form, form))
            {
                form.Suggest(suggested.Fields);
            }
        }
        catch (HttpRequestException)
        {
        }
    }

    private async Task ReadGrantsAsync(CancellationToken cancellationToken)
    {
        var list = await _calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = _calls.Sdk();
                return await sdk.Plugins.ListPluginGrantsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (list is not null)
        {
            PresentGrants(list);
        }
    }

    /// <summary>This plugin's requests out of the station's whole list.</summary>
    public void PresentGrants(PluginGrantList list)
    {
        ArgumentNullException.ThrowIfNull(list);

        Grants.Clear();
        foreach (var grant in list.Grants.Where(grant => grant.PluginId == Id))
        {
            Grants.Add(new PluginGrantRowViewModel(grant, _calls, PresentGrants));
        }

        OnPropertyChanged(nameof(HasGrants));
    }

    private async Task SwitchAsync(PluginDetail detail, bool enabled)
    {
        var after = await StationPluginSwitch.SetAsync(_calls, detail, enabled).ConfigureAwait(true);
        if (after is null)
        {
            _enabled = detail.Enabled;
            OnPropertyChanged(nameof(Enabled));
            return;
        }

        Detail = after;
        await ReadFetcherAsync(CancellationToken.None).ConfigureAwait(true);
    }

    [RelayCommand]
    private async Task TestAsync(CancellationToken cancellationToken)
    {
        TestResult = null;
        var result = await _calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = _calls.Sdk();
                return await sdk.Plugins.TestPluginConnectionAsync(Id, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        // A plugin that could not connect is the answer to the question rather than a failed request,
        // so it is said in the same place a success would be.
        if (result is not null)
        {
            TestTone = result.Ok ? StatusTone.Ok : StatusTone.Fault;
            TestResult = result.Message ?? (result.Ok ? "Connected." : "The plugin could not connect.");
        }
    }

    [RelayCommand]
    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        if (Form is not { } form)
        {
            return;
        }

        if (form.Problem() is { } problem)
        {
            SettingsNotice = problem;
            return;
        }

        var changed = form.Submission();
        if (changed.Count == 0)
        {
            SettingsNotice = "Nothing has changed.";
            return;
        }

        var detail = await _calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = _calls.Sdk();
                return await sdk.Plugins.UpdatePluginConfigurationAsync(Id, new PluginConfigInput { Config = changed }, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (detail is not null)
        {
            Present(detail);
            await OfferAsync(cancellationToken).ConfigureAwait(true);
            SettingsNotice = "Saved. The plugin started again with it.";
        }
    }

    /// <summary>
    /// Sends somebody to the provider's consent screen in their browser, and waits for the plugin to
    /// say it is connected.
    /// </summary>
    /// <remarks>
    /// The provider sends the browser back to the CONSOLE's callback page on the station, which
    /// finishes the exchange; nothing comes back to this app, so it asks the plugin every few seconds
    /// instead. A reconnect is not waited for: the plugin says connected before and after, so there is
    /// nothing to see change, and the console's page in the browser says when it is done.
    /// </remarks>
    [RelayCommand]
    private async Task ConnectAsync(CancellationToken cancellationToken)
    {
        SignInNotice = null;
        var start = await _calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = _calls.Sdk();
                return await sdk.Plugins.StartPluginOAuthAuthorizationAsync(Id, token).ConfigureAwait(false);
            },
            new Dictionary<int, string>
            {
                [403] = "Connecting this plugin is not something your account is allowed to do.",
                [503] = "The plugin is not running, so it cannot start an authorization. Check its configuration and status first.",
                [501] = "This plugin declares a sign-in but does not implement one.",
            },
            cancellationToken).ConfigureAwait(true);

        if (start is null || !Uri.TryCreate(start.Url, UriKind.Absolute, out var link))
        {
            return;
        }

        if (_calls.Shell?.Open(link) != true)
        {
            SignInNotice = $"Open this address in your browser to connect: {start.Url}";
            return;
        }

        if (IsConnected)
        {
            SignInNotice = "Finish in your browser. The page it comes back to says when the new sign-in is stored.";
            return;
        }

        await WaitForSignInAsync().ConfigureAwait(true);
    }

    private async Task WaitForSignInAsync()
    {
        StopWaiting();
        var waiting = new CancellationTokenSource(WaitAtMost);
        _waiting = waiting;
        WaitingForSignIn = true;
        SignInNotice = "Waiting for you to finish in your browser…";

        try
        {
            while (!waiting.IsCancellationRequested)
            {
                await Task.Delay(WaitEvery, waiting.Token).ConfigureAwait(true);

                // Asked directly rather than through the one path refusals take: a station that did
                // not answer one of these is not worth a notice every three seconds.
                try
                {
                    using var sdk = _calls.Sdk();
                    var detail = await sdk.Plugins.GetPluginAsync(Id, waiting.Token).ConfigureAwait(true);
                    Detail = detail;

                    if (detail.OauthConnected == true)
                    {
                        SignInNotice = "Connected. The plugin has stored its sign-in.";
                        return;
                    }
                }
                catch (HttpRequestException)
                {
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            if (ReferenceEquals(_waiting, waiting))
            {
                _waiting = null;
                WaitingForSignIn = false;
                if (!IsConnected && SignInNotice?.StartsWith("Waiting", StringComparison.Ordinal) == true)
                {
                    SignInNotice = "Stopped waiting. If you finished in the browser, open this page again to see whether it connected.";
                }
            }

            waiting.Dispose();
        }
    }

    [RelayCommand]
    private void StopWaiting()
    {
        _waiting?.Cancel();
    }

    [RelayCommand]
    private async Task CopyCallbackAsync()
    {
        if (_calls.Shell is { } shell)
        {
            await shell.CopyAsync(CallbackUrl).ConfigureAwait(true);
            SignInNotice = "The callback address is on the clipboard.";
        }
    }

    [RelayCommand]
    private async Task DisconnectAsync(CancellationToken cancellationToken)
    {
        if (!await _calls.Dialogs.ConfirmAsync(
                $"Disconnect {Name}?",
                $"{Name} will lose access to its provider until it is connected again. Anything it does that depends on that connection will stop working until then.",
                "Disconnect").ConfigureAwait(true))
        {
            return;
        }

        var detail = await _calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = _calls.Sdk();
                return await sdk.Plugins.DisconnectPluginOAuthAsync(Id, token).ConfigureAwait(false);
            },
            new Dictionary<int, string>
            {
                [403] = "Disconnecting this plugin is not something your account is allowed to do.",
                [501] = "This plugin declares a sign-in but does not implement one.",
            },
            cancellationToken).ConfigureAwait(true);

        if (detail is not null)
        {
            Detail = detail;
            SignInNotice = null;
        }
    }

    private async Task ReadFetcherAsync(CancellationToken cancellationToken)
    {
        // Only asked while the plugin is on: the fetcher is the plugin's, and a switched-off plugin's
        // page says to enable it first rather than reporting on something nobody is using.
        if (Detail is not { UsesTrackFetcher: true, Enabled: true })
        {
            Fetcher = null;
            return;
        }

        var state = await _calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = _calls.Sdk();
                return await sdk.Stream.ReadFetcherAuthorizationAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        Fetcher = state;
        AuthorizeUrl ??= state?.PendingUrl;
    }

    /// <summary>
    /// Starts the track fetcher's own authorization and opens the approval page. Starting again
    /// replaces whichever was pending, so somebody who lost the link gets a fresh one.
    /// </summary>
    [RelayCommand]
    private async Task AuthorizeAsync(CancellationToken cancellationToken)
    {
        FetcherNotice = null;
        var start = await _calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = _calls.Sdk();
                return await sdk.Stream.StartFetcherAuthorizationAsync(token).ConfigureAwait(false);
            },
            new Dictionary<int, string>
            {
                [403] = "Authorizing playback is not something your account is allowed to do.",
                [503] = "The track fetcher is not answering, so there is nothing to authorize yet. Check that the stream half of this install is running.",
            },
            cancellationToken).ConfigureAwait(true);

        if (start is null)
        {
            return;
        }

        AuthorizeUrl = start.AuthorizeUrl;
        OpenApproval();
    }

    [RelayCommand]
    private void OpenApproval()
    {
        if (AuthorizeUrl is { } url && Uri.TryCreate(url, UriKind.Absolute, out var link) && _calls.Shell?.Open(link) != true)
        {
            FetcherNotice = $"Open this address in your browser: {url}";
        }
    }

    [RelayCommand]
    private async Task FinishAuthorizingAsync(CancellationToken cancellationToken)
    {
        var redirect = Pasted.Trim();
        if (redirect.Length == 0)
        {
            FetcherNotice = "Paste the whole address your browser was sent to.";
            return;
        }

        var finished = await _calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = _calls.Sdk();
                return await sdk.Stream.FinishFetcherAuthorizationAsync(new FetcherAuthorizationInput { RedirectUrl = redirect }, token)
                    .ConfigureAwait(false);
            },
            new Dictionary<int, string>
            {
                [400] = "That address could not be used. Start the authorization again and use the new link.",
                [502] = "Spotify refused the exchange. This is worth trying again in a moment.",
                [503] = "The track fetcher is not answering, so the authorization could not be finished.",
            },
            cancellationToken).ConfigureAwait(true);

        if (finished is null)
        {
            return;
        }

        Pasted = string.Empty;
        AuthorizeUrl = null;
        FetcherNotice = $"The station now fetches as {finished.Username}.";
        await ReadFetcherAsync(cancellationToken).ConfigureAwait(true);
    }

    [RelayCommand]
    private Task RefreshLogAsync(CancellationToken cancellationToken) => ReadLogAsync(cancellationToken);

    private async Task ReadLogAsync(CancellationToken cancellationToken)
    {
        var page = await _calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = _calls.Sdk();
                return await sdk.Plugins.GetPluginLogsAsync(Id, new PluginLogQuery { Limit = 200, Level = LogFilter.Level }, token)
                    .ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is not null)
        {
            PresentLog(page);
        }
    }

    public void PresentLog(PluginLogPage page)
    {
        ArgumentNullException.ThrowIfNull(page);

        Log.Clear();
        foreach (var entry in page.Entries)
        {
            Log.Add(Line(entry));
        }

        LogEmpty = Log.Count == 0;
    }

    /// <summary>A line as it is drawn: the time on this Mac's clock, the level, the words.</summary>
    public static PluginLogLineViewModel Line(PluginLogEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);

        var at = DateTimeOffset.TryParse(entry.Ts, CultureInfo.InvariantCulture, DateTimeStyles.None, out var when)
            ? when.ToLocalTime().ToString("HH:mm:ss", CultureInfo.InvariantCulture)
            : entry.Ts;

        var (level, tone) = entry.Level switch
        {
            PluginLogLevel.Error => ("ERROR", StatusTone.Live),
            PluginLogLevel.Warn => ("WARN", StatusTone.Fault),
            PluginLogLevel.Info => ("INFO", StatusTone.Standby),
            _ => ("DEBUG", StatusTone.Off),
        };

        return new PluginLogLineViewModel(at, level, entry.Text, tone);
    }

    private async Task SetVerboseAsync(bool verbose)
    {
        var detail = await _calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = _calls.Sdk();
                return await sdk.Plugins.SetPluginLogLevelAsync(
                    Id,
                    new PluginLogLevelInput { Level = verbose ? PluginLogLevel.Debug : PluginLogLevel.Info },
                    token).ConfigureAwait(false);
            }).ConfigureAwait(true);

        if (detail is not null)
        {
            Detail = detail;
        }
        else
        {
            OnPropertyChanged(nameof(Verbose));
        }
    }

    [RelayCommand]
    private async Task DownloadLogAsync(CancellationToken cancellationToken)
    {
        if (_calls.Files is not { } files)
        {
            return;
        }

        var log = await _calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = _calls.Sdk();
                return await sdk.Plugins.DownloadPluginLogsAsync(Id, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (log is not null)
        {
            await files.SaveAsync(
                $"Save {Name}'s log",
                PluginLinks.FileName(log.Headers.ContentDisposition, $"{Id}.log"),
                Encoding.UTF8.GetBytes(log.Data)).ConfigureAwait(true);
        }
    }

    [RelayCommand]
    private async Task RemoveAsync(CancellationToken cancellationToken)
    {
        if (!IsInstalled
            || !await _calls.Dialogs.ConfirmAsync(
                $"Remove {Name}?",
                $"{Name} stops, and its folder on the station is deleted. Its settings and what it was allowed are kept, so importing it again brings them back.",
                $"Remove {Name}").ConfigureAwait(true))
        {
            return;
        }

        var removed = await _calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = _calls.Sdk();
                return await sdk.Plugins.RemovePluginAsync(Id, token).ConfigureAwait(false);
            },
            new Dictionary<int, string> { [403] = "Removing a plugin is an administrator action." },
            cancellationToken).ConfigureAwait(true);

        if (removed is not null)
        {
            StopWaiting();
            _removed();
        }
    }

    /// <summary>Stops any wait for a sign-in: the page has been left, and nobody is looking.</summary>
    public void Dispose()
    {
        StopWaiting();
    }
}
