using System.Globalization;
using Avalonia.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Net;
using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
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
    private readonly IStationPlayer _player;
    private readonly ISettingsStore _settings;
    private readonly HttpClient _http;
    private readonly IUiDispatcher _dispatcher;
    private readonly PlaybackConductor _conductor = new();
    private readonly DispatcherTicker _ticker;

    private NowPlayingRepository? _repository;
    private IDisposable? _lease;
    private StationUrl _station;
    private DateTimeOffset? _readAt;
    private string? _artworkShowing;

    public ListenerViewModel(IStationPlayer player, ISettingsStore settings, HttpClient http, IUiDispatcher dispatcher)
    {
        _player = player;
        _settings = settings;
        _http = http;
        _dispatcher = dispatcher;

        _player.StatusChanged += OnPlayerStatus;

        // Half a second, counted from the reading rather than from a wall clock, so the playhead
        // moves smoothly between polls and is re-anchored whenever a real answer arrives.
        _ticker = new DispatcherTicker(TimeSpan.FromMilliseconds(500), Tick);
    }

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

    public bool Playing => Listening is not ListeningState.Stopped;

    public void Attach(StationUrl station, string? name)
    {
        _station = station;
        StationName = name ?? station.Origin.Host;

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
            return;
        }

        var mounts = _repository?.Current.Value?.Mounts;
        if (mounts is null)
        {
            // No reading yet. Asking again is the right move: the address is known to be a station,
            // so the list is a moment away.
            _repository?.Kick();
            return;
        }

        var choice = MountSelection.Choose(mounts, _settings.Current.Format);

        _conductor.Requested();
        Apply();

        _player.Volume = _settings.Current.Volume;
        await _player.PlayAsync(_station.MountUrl(choice.Path)).ConfigureAwait(true);
        _ticker.Start();
    }

    private void OnPlayerStatus(PlayerStatus status) => _dispatcher.Post(() =>
    {
        _conductor.Observed(status);
        Apply();
    });

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
        OnAir = now.OnAir;

        var track = now.Track;
        Title = track?.Title;
        Artist = track?.Artist;
        Album = track?.Album;

        Duration = Playhead.Duration(track)?.TotalSeconds ?? 0;
        Tick();

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
            Position = 0;
            Elapsed = "--:--";
            Remaining = "--:--";
            return;
        }

        Position = position.Value.TotalSeconds;
        Elapsed = Clock(position.Value);
        Remaining = "-" + Clock(duration.Value - position.Value);
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

            var bitmap = new Bitmap(buffer);
            _dispatcher.Post(() => Artwork = bitmap);
        }
        catch (Exception)
        {
            // Art is hotlinked until the station's cache pass runs, so a dead upstream is ordinary
            // rather than a fault. The view falls back to a quiet square.
            _dispatcher.Post(() => Artwork = null);
        }
    }

    private void Apply()
    {
        Listening = _conductor.State;
        OnPropertyChanged(nameof(Playing));

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

    private static string Clock(TimeSpan value)
    {
        if (value < TimeSpan.Zero)
        {
            value = TimeSpan.Zero;
        }

        return value.TotalHours >= 1
            ? value.ToString(@"h\:mm\:ss", CultureInfo.InvariantCulture)
            : value.ToString(@"m\:ss", CultureInfo.InvariantCulture);
    }

    public async ValueTask DisposeAsync()
    {
        _player.StatusChanged -= OnPlayerStatus;
        _ticker.Stop();
        _lease?.Dispose();

        if (_repository is not null)
        {
            await _repository.DisposeAsync().ConfigureAwait(false);
        }
    }
}
