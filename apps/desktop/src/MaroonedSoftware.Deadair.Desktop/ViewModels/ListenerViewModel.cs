using System.Globalization;
using Avalonia.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.History;
using MaroonedSoftware.Deadair.Desktop.Core.Net;
using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;
using MaroonedSoftware.Deadair.Sdk.Models;
using NowPlayingReading = MaroonedSoftware.Deadair.Sdk.Models.NowPlaying;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// What is on air, and the one control a listener needs.
/// </summary>
/// <remarks>
/// The listener half of the app. It reads <c>GET /nowplaying</c> and plays a mount from the list that
/// answer carries — never one it guessed, and never by trying them, because a connection of any
/// length registers an audience for five minutes.
/// </remarks>
public sealed partial class ListenerViewModel : ObservableObject, IAsyncDisposable
{
    private readonly OutputSwitch _player;
    private readonly ISystemNowPlaying _systemNowPlaying;
    private readonly ISettingsStore _settings;
    private readonly HttpClient _http;
    private readonly IUiDispatcher _dispatcher;
    private readonly PlaybackConductor _conductor = new();
    private readonly DispatcherTicker _ticker;

    /// <summary>
    /// Holds a volume change back until the hand stops moving.
    /// </summary>
    /// <remarks>
    /// The player hears every change at once, because a slider that lags is a slider nobody trusts.
    /// The FILE does not: dragging across the bar is dozens of values, and writing each one is dozens
    /// of writes to somebody's Application Support folder for one gesture.
    /// </remarks>
    private readonly DispatcherTicker _volumeSettles;

    private NowPlayingRepository? _repository;
    private IDisposable? _lease;
    private StationUrl _station;
    private DateTimeOffset? _readAt;
    private string? _artworkShowing;
    private byte[]? _artworkBytes;

    public ListenerViewModel(
        OutputSwitch player,
        ISystemNowPlaying systemNowPlaying,
        ISettingsStore settings,
        HttpClient http,
        IUiDispatcher dispatcher,
        OutputsViewModel? outputs = null)
    {
        Outputs = outputs;
        _player = player;
        _systemNowPlaying = systemNowPlaying;
        _settings = settings;
        _http = http;
        _dispatcher = dispatcher;

        _player.StatusChanged += OnPlayerStatus;

        // A handover is not a stall. The old target has been stopped and the new one has not started
        // yet, so the seconds after it are exactly the seconds after pressing play — including the
        // station waking up again if it went quiet in between.
        _player.TargetChanged += OnTargetChanged;
        _player.VolumeChanged += OnDeviceVolumeChanged;

        // The conductor's own retry, scheduled rather than merely computed. Requested() must not be
        // called here: that would reset the backoff the failure just advanced.
        _conductor.RetryDue += OnRetryDue;

        // The keyboard's play key and the widget's buttons reach the same commands the on-screen ones
        // do, so there is one path into the player rather than two that can disagree.
        _systemNowPlaying.Commanded += command => _dispatcher.Post(() => _ = OnCommandedAsync(command));

        // Half a second, counted from the reading rather than from a wall clock, so the playhead
        // moves smoothly between polls and is re-anchored whenever a real answer arrives.
        _ticker = new DispatcherTicker(TimeSpan.FromMilliseconds(500), Tick);

        _volumeSettles = new DispatcherTicker(TimeSpan.FromMilliseconds(400), SaveVolume);
    }

    /// <summary>
    /// The picker in the bar.
    /// </summary>
    /// <remarks>
    /// Optional so that a shot can build a bar without one, and so that the two are wired in one
    /// direction: the picker knows about outputs and the bar knows about the picker, and neither
    /// asks the other anything.
    /// </remarks>
    public OutputsViewModel? Outputs { get; }

    [ObservableProperty]
    private string _stationName = "deadair";

    [ObservableProperty]
    private string? _title;

    [ObservableProperty]
    private string? _artist;

    [ObservableProperty]
    private string? _album;

    [ObservableProperty]
    private Bitmap? _artwork;

    [ObservableProperty]
    private long _listeners;

    [ObservableProperty]
    private bool _onAir;

    [ObservableProperty]
    private ListeningState _listening = ListeningState.Stopped;

    [ObservableProperty]
    private string _listeningLabel = "Stopped";

    [ObservableProperty]
    private StatusTone _tone = StatusTone.Off;

    [ObservableProperty]
    private double _position;

    [ObservableProperty]
    private double _duration;

    [ObservableProperty]
    private string _elapsed = "--:--";

    [ObservableProperty]
    private string _remaining = "--:--";

    [ObservableProperty]
    private bool _stale;

    /// <summary>
    /// Whether the station could say where the record is up to.
    /// </summary>
    /// <remarks>
    /// The bar draws a playhead when this is true and the word LIVE when it is not. Both are honest
    /// answers; what would not be is a bar sitting at zero, which reads as a record that has not
    /// started rather than as a station that cannot say.
    /// </remarks>
    [ObservableProperty]
    private bool _hasPlayhead;

    /// <summary>How the mount currently chosen names itself: <c>MP3 128 kb/s</c>, <c>FLAC</c>.</summary>
    /// <remarks>
    /// Read out of <c>mounts[]</c> and never by asking a mount anything. A connection of any length
    /// registers an audience for the full linger, so a bar that probed to label itself would put a
    /// silent station on air just by being drawn.
    /// </remarks>
    [ObservableProperty]
    private string _formatLabel = string.Empty;

    /// <summary>Whether the wanted format was not on offer and MP3 is playing instead.</summary>
    [ObservableProperty]
    private bool _formatFellBack;

    [ObservableProperty]
    private string _listenersLabel = ListenerCount.Label(0);

    /// <summary>The record's own initial, for the square drawn when there is no cover.</summary>
    /// <remarks>
    /// A letter rather than a musical note, which is the web console's answer to the same question:
    /// a note is a picture of "music" on a page that is already entirely about music, while an
    /// initial at least tells two missing covers apart.
    /// </remarks>
    public string Initial => First(Title ?? StationName);

    /// <summary>Whether something is genuinely on air, which is the only thing allowed to pulse.</summary>
    public bool IsLive => Tone is StatusTone.Live;

    /// <summary>The lamp beside ON AIR, which is about the STATION rather than about this listener.</summary>
    public StatusTone AirTone => OnAir ? StatusTone.Live : StatusTone.Off;

    public bool Playing => Listening is not ListeningState.Stopped;

    /// <summary>0.0 to 1.0.</summary>
    /// <remarks>
    /// The player hears a change immediately; the file hears it once the hand stops, and only while
    /// the sound is coming out of this machine. A speaker's volume belongs to the speaker: it is
    /// shared with whoever else plays to it and a hand on its front panel moves it, so writing it
    /// here would make this Mac come back at whatever the kitchen was set to.
    /// </remarks>
    public double Volume
    {
        get => _volume;
        set
        {
            if (Math.Abs(_volume - value) < 0.001)
            {
                return;
            }

            _volume = value;
            OnPropertyChanged();

            _player.Volume = value;

            if (!_player.IsLocal)
            {
                return;
            }

            _volumeSettles.Stop();
            _volumeSettles.Start();
        }
    }

    private double _volume = 0.8;

    /// <summary>Whether the current output has said how loud it is.</summary>
    /// <remarks>
    /// A speaker has not until it has been asked, and the slider is drawn disabled until then: one
    /// sitting at zero would read as silence rather than as a question nobody has answered yet.
    /// </remarks>
    [ObservableProperty]
    private bool _volumeKnown = true;

    /// <summary>What the picker's button says it is playing on.</summary>
    [ObservableProperty]
    private string _outputName = Output.ThisMac.Name;

    /// <summary>Whether that is somewhere other than this machine.</summary>
    [ObservableProperty]
    private bool _onDevice;

    private void SaveVolume()
    {
        _volumeSettles.Stop();

        if (!_player.IsLocal)
        {
            return;
        }

        _ = _settings.UpdateAsync(settings => settings with { Volume = _volume });
    }

    private void OnTargetChanged(Output output) => _dispatcher.Post(() =>
    {
        OutputName = output.Name;
        OnDevice = !output.IsLocal;

        ReadVolumeFromPlayer();

        if (Playing)
        {
            // Warm-up again, deliberately. The conductor has just been handed a different player
            // which has heard nothing yet, and reporting the gap as a reconnection would describe a
            // fault where the operator asked for a move.
            _conductor.Requested();
            Apply();
        }
    });

    private void OnDeviceVolumeChanged() => _dispatcher.Post(ReadVolumeFromPlayer);

    /// <summary>
    /// Takes the volume from whatever is playing, without writing anything back.
    /// </summary>
    /// <remarks>
    /// Set through the field rather than the property, because the property is the SLIDER's way in:
    /// going through it would push this value back at the player it just came from and, on this
    /// machine, save it to the file.
    /// </remarks>
    private void ReadVolumeFromPlayer()
    {
        VolumeKnown = _player.VolumeKnown;

        if (!VolumeKnown)
        {
            return;
        }

        _volume = _player.Volume;
        OnPropertyChanged(nameof(Volume));
    }

    private static string First(string value) =>
        value.Length == 0 ? "?" : char.ToUpperInvariant(value[0]).ToString();

    public void Attach(StationUrl station, string? name)
    {
        _station = station;
        StationName = name ?? station.Origin.Host;

        if (_player.IsLocal)
        {
            _volume = _settings.Current.Volume;
            OnPropertyChanged(nameof(Volume));
        }

        _repository = new NowPlayingRepository(station, _http, _dispatcher);
        _repository.Changed += OnReading;
        _lease = _repository.Subscribe();
    }

    [RelayCommand]
    private async Task ToggleAsync()
    {
        if (Playing)
        {
            _conductor.Released();
            Apply();
            await _player.StopAsync().ConfigureAwait(true);
            _ticker.Stop();
            PublishToSystem();
            return;
        }

        if (_repository?.Current.Value?.Mounts is null)
        {
            // No reading yet. Asking again is the right move: the address is known to be a station,
            // so the list is a moment away.
            _repository?.Kick();
            return;
        }

        _conductor.Requested();
        Apply();

        // Pushed only for this machine. A speaker already has a volume, which is shared with
        // whoever else plays to it, and starting the station on it is no reason to change it.
        if (_player.IsLocal)
        {
            _player.Volume = Volume;
        }

        await PlayChosenMountAsync().ConfigureAwait(true);
    }

    /// <summary>
    /// Chooses a mount from the station's own list and asks the player for it. Shared by the button
    /// and by the conductor's own retry, neither of which should duplicate the other's copy of this.
    /// </summary>
    private async Task PlayChosenMountAsync()
    {
        var mounts = _repository?.Current.Value?.Mounts;
        if (mounts is null)
        {
            return;
        }

        var choice = MountSelection.Choose(mounts, _settings.Current.Format);

        await _player.PlayAsync(_station.MountUrl(choice.Path)).ConfigureAwait(true);
        _ticker.Start();
    }

    private void OnPlayerStatus(PlayerStatus status) => _dispatcher.Post(() =>
    {
        _conductor.Observed(status);
        Apply();
        PublishToSystem();
    });

    /// <summary>
    /// The conductor's own backoff has elapsed. Re-issues the play the listener already asked for;
    /// <see cref="PlaybackConductor.Requested"/> is deliberately not called, since that would reset
    /// the backoff the failure just advanced.
    /// </summary>
    private void OnRetryDue() => _dispatcher.Post(() => _ = PlayChosenMountAsync());

    /// <summary>Raised so the desk can act on a Skip asked for from outside the window.</summary>
    public event Func<Task>? SkipRequested;

    /// <summary>
    /// Raised with every reading's <c>mounts[]</c>, so a page that wants to know what the station
    /// publishes can be told rather than ask.
    /// </summary>
    /// <remarks>
    /// This exists so that the format picker is not tempted to fetch, and certainly not to connect.
    /// One subscription to `/nowplaying` for the whole app is also one User-Agent and one place the
    /// rate limit is spent.
    /// </remarks>
    public event Action<IReadOnlyList<NowPlayingMount>>? MountsChanged;

    private async Task OnCommandedAsync(RemoteCommand command)
    {
        switch (command)
        {
            case RemoteCommand.Play when !Playing:
            case RemoteCommand.Stop when Playing:
                await ToggleAsync().ConfigureAwait(true);
                break;

            case RemoteCommand.Next:
                // The operator's Skip. It is only offered while the account holds the role, so
                // reaching here at all means the station should accept it.
                if (SkipRequested is { } skip)
                {
                    await skip().ConfigureAwait(true);
                }

                break;
        }
    }

    /// <summary>Offers the next button, or takes it away. Called when the signed-in role changes.</summary>
    public void SetCanSkip(bool canSkip) => _systemNowPlaying.SetCanSkip(canSkip);

    private void PublishToSystem()
    {
        if (!Playing)
        {
            // Cleared rather than left showing a paused record: the app is not playing, and a widget
            // that still names a track is claiming otherwise to the whole desktop.
            _systemNowPlaying.Clear();
            return;
        }

        var track = _repository?.Current.Value?.Track;

        _systemNowPlaying.Show(new NowPlayingCard(
            Title ?? StationName,
            Artist,
            Album,
            _artworkBytes,
            Playhead.Duration(track),
            Playhead.Position(track, _readAt, DateTimeOffset.UtcNow) ?? TimeSpan.Zero,
            Playing));
    }

    private void OnReading(Reading<NowPlayingReading> reading)
    {
        Stale = reading.Stale;
        _readAt = reading.ReadAt;

        if (reading.Value is not { } now)
        {
            return;
        }

        StationName = now.Station;
        Listeners = now.Listeners;
        ListenersLabel = ListenerCount.Label(now.Listeners);
        OnAir = now.OnAir;
        OnPropertyChanged(nameof(AirTone));

        // The mount named without asking one anything: `mounts[]` is carried for exactly this.
        var mount = MountSelection.Choose(now.Mounts, _settings.Current.Format);
        FormatLabel = MountLabel.Name(mount.Format) + Rate(now.Mounts, mount);
        FormatFellBack = mount.FellBack;
        MountsChanged?.Invoke(now.Mounts);

        var track = now.Track;
        Title = track?.Title;
        Artist = track?.Artist;
        Album = track?.Album;
        OnPropertyChanged(nameof(Initial));

        Duration = Playhead.Duration(track)?.TotalSeconds ?? 0;
        Tick();
        PublishToSystem();

        _ = LoadArtworkAsync(track?.ArtworkUrl);
    }

    private void Tick()
    {
        var track = _repository?.Current.Value?.Track;
        var position = Playhead.Position(track, _readAt, DateTimeOffset.UtcNow);
        var duration = Playhead.Duration(track);

        if (position is null || duration is null)
        {
            // The station could not say. Drawing nothing is the honest answer; the tempting fallback
            // measures when the record STARTED and leads what is being heard.
            HasPlayhead = false;
            Position = 0;
            Elapsed = ClockFormat.Unknown;
            Remaining = ClockFormat.Unknown;
            return;
        }

        HasPlayhead = true;
        Position = position.Value.TotalSeconds;
        Elapsed = ClockFormat.Elapsed(position.Value);
        Remaining = ClockFormat.Remaining(duration.Value - position.Value);
    }

    /// <summary>The bitrate, when the chosen mount has one to give.</summary>
    private static string Rate(IReadOnlyList<NowPlayingMount> mounts, MountChoice choice)
    {
        foreach (var mount in mounts)
        {
            if (mount.Path == choice.Path && mount.BitrateKbps is { } rate and > 0)
            {
                return string.Create(CultureInfo.CurrentCulture, $" {rate} kb/s");
            }
        }

        return string.Empty;
    }

    private async Task LoadArtworkAsync(string? artworkUrl)
    {
        var resolved = _station.ArtUrl(artworkUrl);
        var key = resolved?.ToString();

        if (key == _artworkShowing)
        {
            // The same cover every three seconds is the ordinary case: re-fetching it would be most
            // of this app's requests, and the station rate-limits.
            return;
        }

        _artworkShowing = key;

        if (resolved is null)
        {
            Artwork = null;
            return;
        }

        try
        {
            await using var stream = await _http.GetStreamAsync(resolved).ConfigureAwait(false);
            using var buffer = new MemoryStream();
            await stream.CopyToAsync(buffer).ConfigureAwait(false);
            buffer.Position = 0;

            var bytes = buffer.ToArray();
            buffer.Position = 0;
            var bitmap = new Bitmap(buffer);

            _dispatcher.Post(() =>
            {
                Artwork = bitmap;
                _artworkBytes = bytes;
                PublishToSystem();
            });
        }
        catch (Exception)
        {
            // Art is hotlinked until the station's cache pass runs, so a dead upstream is ordinary
            // rather than a fault. The view falls back to a quiet square.
            _dispatcher.Post(() =>
            {
                Artwork = null;
                _artworkBytes = null;
            });
        }
    }

    private void Apply()
    {
        Listening = _conductor.State;
        OnPropertyChanged(nameof(Playing));
        OnPropertyChanged(nameof(IsLive));

        (ListeningLabel, Tone) = _conductor.State switch
        {
            ListeningState.Playing => ("Listening", StatusTone.Live),

            // Not an error, and not a spinner that never resolves. Connecting is what puts an
            // audience-gated station on air, so these seconds are the station waking up.
            ListeningState.WarmingUp => ("Warming up", StatusTone.Standby),
            ListeningState.Reconnecting => ("Reconnecting", StatusTone.Standby),
            ListeningState.Unreachable => ("Cannot reach the station", StatusTone.Fault),
            _ => ("Stopped", StatusTone.Off),
        };
    }

    public async ValueTask DisposeAsync()
    {
        _player.StatusChanged -= OnPlayerStatus;
        _player.TargetChanged -= OnTargetChanged;
        _player.VolumeChanged -= OnDeviceVolumeChanged;
        _conductor.RetryDue -= OnRetryDue;
        _conductor.Dispose();
        _ticker.Stop();
        _volumeSettles.Stop();
        _systemNowPlaying.Clear();
        _lease?.Dispose();

        if (_repository is not null)
        {
            await _repository.DisposeAsync().ConfigureAwait(false);
        }
    }
}
