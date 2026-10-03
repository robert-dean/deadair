using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text.Json;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;
using Windows.Media;
using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.Media.Streaming.Adaptive;
using Windows.System;
using Windows.System.Profile;

namespace PlayerSpike;

/// <summary>
/// The player and everything it is measured by. Owned by <see cref="App"/>, never by a page, so the
/// page can be thrown away in the background without the audio noticing.
/// </summary>
public sealed class SpikeSession : IDisposable
{
    /// <summary>One string on every request this spike makes that it is able to label.</summary>
    /// <remarks>
    /// The API and the HLS fetches carry it. The MP3 mount does NOT: <see cref="MediaSource.CreateFromUri"/>
    /// offers no way to set a header, so whatever the station logs for that connection is one of the
    /// readings this spike exists to take.
    /// </remarks>
    public const string UserAgent = "deadair-xbox-spike/0.0.1";

    private readonly MediaPlayer _player = new() { AudioCategory = MediaPlayerAudioCategory.Media, AutoPlay = true };
    private readonly System.Net.Http.HttpClient _http = new();
    private readonly Windows.Web.Http.HttpClient _mediaHttp = new();
    private readonly Timer _memoryTimer;

    private string _origin = string.Empty;
    private IReadOnlyList<NowPlayingMount> _mounts = [];
    private NowPlaying? _nowPlaying;
    private NowPlayingMountFormat _lastFormat = NowPlayingMountFormat.Mp3;
    private IDisposable? _source;
    private DateTimeOffset _startedAt;
    private bool _reachedPlaying;
    private bool _inBackground;
    private ulong _peakBackgroundUsage;

    public SpikeSession()
    {
        _http.DefaultRequestHeaders.UserAgent.ParseAdd(UserAgent);
        _mediaHttp.DefaultRequestHeaders.UserAgent.ParseAdd(UserAgent);

        // The remote, the guide and the media overlay all arrive here. Pause is answered as Stop,
        // because a paused live connection is still an audience to the station's gate, and Next is
        // the operator's Skip, which a listener's app never offers.
        var commands = _player.CommandManager;
        commands.IsEnabled = true;
        commands.NextBehavior.EnablingRule = MediaCommandEnablingRule.Never;
        commands.PreviousBehavior.EnablingRule = MediaCommandEnablingRule.Never;
        commands.PauseReceived += (_, args) =>
        {
            args.Handled = true;
            SpikeLog.Write("remote: pause, answered as stop");
            Stop();
        };
        commands.PlayReceived += (manager, args) =>
        {
            args.Handled = true;
            SpikeLog.Write("remote: play");
            _ = PlayAsync(_lastFormat);
        };

        _player.PlaybackSession.PlaybackStateChanged += (session, _) => OnState(session.PlaybackState);
        _player.MediaFailed += (_, args) => SpikeLog.Write($"player: FAILED {args.Error} {args.ExtendedErrorCode?.HResult:X8} {args.ErrorMessage}");

        MemoryManager.AppMemoryUsageLimitChanging += (_, args) =>
            SpikeLog.Write($"memory: limit changing {Mb(args.OldLimit)} -> {Mb(args.NewLimit)}, using {Mb(MemoryManager.AppMemoryUsage)}");
        MemoryManager.AppMemoryUsageIncreased += (_, _) =>
            SpikeLog.Write($"memory: usage level now {MemoryManager.AppMemoryUsageLevel}, using {Mb(MemoryManager.AppMemoryUsage)} of {Mb(MemoryManager.AppMemoryUsageLimit)}");

        _memoryTimer = new Timer(_ => SampleMemory(), null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5));
    }

    /// <summary>What this process is, which is the first answer the spike has to give.</summary>
    public static void DescribeRuntime()
    {
        SpikeLog.Divider("runtime");
        SpikeLog.Write($"device family:  {AnalyticsInfo.VersionInfo.DeviceFamily}");
        SpikeLog.Write($"framework:      {RuntimeInformation.FrameworkDescription}");
        SpikeLog.Write($"architecture:   {RuntimeInformation.ProcessArchitecture}");
        SpikeLog.Write($"dynamic code:   {RuntimeFeature.IsDynamicCodeSupported} (false means Native AOT)");
        SpikeLog.Write($"json reflection {(JsonSerializer.IsReflectionEnabledByDefault ? "ON" : "OFF")} by default");
        SpikeLog.Write($"memory:         {Mb(MemoryManager.AppMemoryUsage)} of {Mb(MemoryManager.AppMemoryUsageLimit)}");
    }

    /// <summary>
    /// Reads <c>GET /nowplaying</c> twice: through the generated SDK, which is the path the real app
    /// would take, and through <see cref="JsonDocument"/>, which needs no reflection and so works
    /// whatever the first one says. Never by probing a mount.
    /// </summary>
    public async Task ReadStationAsync(string origin)
    {
        _origin = origin.Trim().TrimEnd('/');
        SpikeLog.Divider($"station {_origin}");

        try
        {
            using var sdk = new DeadairSdk(new SdkOptions { BaseUrl = $"{_origin}/api", HttpClient = _http });
            _nowPlaying = await sdk.Nowplaying.GetNowPlayingAsync();
            _mounts = _nowPlaying.Mounts;
            SpikeLog.Write("sdk decode:     OK");
        }
        catch (Exception error)
        {
            SpikeLog.Write($"sdk decode:     FAILED {error.GetType().Name}: {error.Message}");
            await ReadMountsByHandAsync();
        }

        if (_nowPlaying is not null)
        {
            SpikeLog.Write($"name:           {_nowPlaying.Station}");
            SpikeLog.Write($"on air:         {_nowPlaying.OnAir}, {_nowPlaying.Listeners} listening");
            SpikeLog.Write($"track:          {(_nowPlaying.Track is null ? "(quiet)" : $"{_nowPlaying.Track.Artist} - {_nowPlaying.Track.Title}")}");
        }

        SpikeLog.Write($"mounts:         {string.Join(", ", _mounts.Select(m => $"{m.Format} {m.Path}"))}");
    }

    private async Task ReadMountsByHandAsync()
    {
        try
        {
            var body = await _http.GetStringAsync(new Uri($"{_origin}/api/nowplaying"));
            using var document = JsonDocument.Parse(body);
            var mounts = new List<NowPlayingMount>();
            foreach (var mount in document.RootElement.GetProperty("mounts").EnumerateArray())
            {
                var format = mount.GetProperty("format").GetString() switch
                {
                    "hls" => NowPlayingMountFormat.Hls,
                    "aac" => NowPlayingMountFormat.Aac,
                    "opus" => NowPlayingMountFormat.Opus,
                    "flac" => NowPlayingMountFormat.Flac,
                    _ => NowPlayingMountFormat.Mp3,
                };
                mounts.Add(new NowPlayingMount { Format = format, Path = mount.GetProperty("path").GetString() ?? "/live.mp3" });
            }

            _mounts = mounts;
            SpikeLog.Write("hand decode:    OK, so the station is fine and the SDK is what failed");
        }
        catch (Exception error)
        {
            SpikeLog.Write($"hand decode:    FAILED {error.GetType().Name}: {error.Message}");
        }
    }

    public async Task PlayAsync(NowPlayingMountFormat format)
    {
        Stop();
        _lastFormat = format;

        var mount = _mounts.FirstOrDefault(m => m.Format == format);
        if (mount is null)
        {
            SpikeLog.Write($"play {format}: the station does not publish it (read the station first)");
            return;
        }

        var url = new Uri($"{_origin}{mount.Path}");
        SpikeLog.Divider($"play {format} {url}");
        _startedAt = DateTimeOffset.UtcNow;
        _reachedPlaying = false;

        MediaSource source;
        if (format == NowPlayingMountFormat.Hls)
        {
            var created = await AdaptiveMediaSource.CreateFromUriAsync(url, _mediaHttp);
            if (created.Status != AdaptiveMediaSourceCreationStatus.Success)
            {
                SpikeLog.Write($"hls: could not open, {created.Status} {created.ExtendedError?.HResult:X8}");
                return;
            }

            created.MediaSource.DownloadFailed += (_, args) => SpikeLog.Write($"hls: download failed {args.ResourceType} {args.HttpResponseMessage?.StatusCode}");
            source = MediaSource.CreateFromAdaptiveMediaSource(created.MediaSource);
        }
        else
        {
            source = MediaSource.CreateFromUri(url);
        }

        _source = source;
        var item = new MediaPlaybackItem(source);
        var display = item.GetDisplayProperties();
        display.Type = MediaPlaybackType.Music;
        display.MusicProperties.Title = _nowPlaying?.Track?.Title ?? "deadair";
        display.MusicProperties.Artist = _nowPlaying?.Track?.Artist ?? _nowPlaying?.Station ?? string.Empty;
        item.ApplyDisplayProperties(display);

        _player.Source = item;
    }

    /// <summary>Drops the connection. Never a pause.</summary>
    public void Stop()
    {
        if (_player.Source is null && _source is null)
        {
            return;
        }

        _player.Source = null;
        _source?.Dispose();
        _source = null;
        SpikeLog.Write("stopped: source dropped, connection closed");
    }

    public void EnteredBackground()
    {
        _inBackground = true;
        _peakBackgroundUsage = 0;
        SpikeLog.Divider("entered background");
        SampleMemory();
    }

    public void LeavingBackground()
    {
        _inBackground = false;
        SpikeLog.Divider($"leaving background, peak while there {Mb(_peakBackgroundUsage)}");
    }

    private void OnState(MediaPlaybackState state)
    {
        var since = (DateTimeOffset.UtcNow - _startedAt).TotalSeconds;
        SpikeLog.Write($"player: {state} at +{since:F2}s");
        if (state == MediaPlaybackState.Playing && !_reachedPlaying)
        {
            _reachedPlaying = true;
            SpikeLog.Write($"player: FIRST PLAYING after {since:F2}s");
        }
    }

    private void SampleMemory()
    {
        var usage = MemoryManager.AppMemoryUsage;
        if (_inBackground)
        {
            _peakBackgroundUsage = Math.Max(_peakBackgroundUsage, usage);
        }

        SpikeLog.Write($"memory: {Mb(usage)} of {Mb(MemoryManager.AppMemoryUsageLimit)}{(_inBackground ? " (background)" : string.Empty)}, player {_player.PlaybackSession.PlaybackState}");
    }

    private static string Mb(ulong bytes) => $"{bytes / (1024.0 * 1024.0):F1}MB";

    public void Dispose()
    {
        _memoryTimer.Dispose();
        Stop();
        _player.Dispose();
        _http.Dispose();
        _mediaHttp.Dispose();
    }
}
