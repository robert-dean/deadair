using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs;
using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Http;
using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Playback;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Tests;

/// <summary>
/// Driving a player that is not there.
///
/// Against a scripted handler rather than a mocked client, because what matters is the requests:
/// which are made, in what order, and what the player's own answers become.
/// </summary>
public sealed class BluOsStationPlayerTests : IDisposable
{
    private static readonly Uri Mount = new("https://radio.deanhome.app/live.mp3");

    private readonly FakeBluOsPlayer _device = new();
    private readonly RecordingLogger _logger = new();
    private readonly HttpClient _http;

    public BluOsStationPlayerTests()
    {
        _http = new HttpClient(_device) { Timeout = Timeout.InfiniteTimeSpan };
    }

    /// <summary>
    /// A player sitting idle is simply played. Stopping it first would be a request for nothing.
    /// </summary>
    [Fact]
    public async Task AnIdlePlayerIsJustPlayed()
    {
        _device.Next("stop", null, streamUrl: null);
        await using var player = Player();

        await player.PlayAsync(Mount, TestContext.Current.CancellationToken);

        Assert.DoesNotContain(_device.Asked, asked => asked.StartsWith("/Stop", StringComparison.Ordinal));
        Assert.Contains(_device.Asked, asked => asked.StartsWith("/Play?url=", StringComparison.Ordinal));
    }

    /// <summary>
    /// A player already on our mount has to be stopped first: measured, a /Play against the URL
    /// already playing does nothing in either direction and answers as though it worked.
    /// </summary>
    [Fact]
    public async Task APlayerAlreadyOnOurMountIsStoppedBeforeItIsPlayed()
    {
        _device.Next("stream", 40);
        await using var player = Player();

        await player.PlayAsync(Mount, TestContext.Current.CancellationToken);

        var stop = _device.Asked.FindIndex(asked => asked.StartsWith("/Stop", StringComparison.Ordinal));
        var play = _device.Asked.FindIndex(asked => asked.StartsWith("/Play", StringComparison.Ordinal));

        Assert.True(stop >= 0 && play > stop, string.Join(" ", _device.Asked));
    }

    /// <summary>
    /// A /Play switches a player from another source on its own, so stopping it first would put a
    /// gap in whatever somebody else was listening to for no reason.
    /// </summary>
    [Fact]
    public async Task APlayerOnSomethingElseIsNotStoppedFirst()
    {
        _device.Next("stream", 40, streamUrl: "Deezer:142986206");
        await using var player = Player();

        await player.PlayAsync(Mount, TestContext.Current.CancellationToken);

        Assert.DoesNotContain(_device.Asked, asked => asked.StartsWith("/Stop", StringComparison.Ordinal));
    }

    /// <summary>
    /// The three phases somebody watching the bar actually sees, each once. Warm-up is real seconds
    /// on an audience-gated station, and none of it is a fault.
    /// </summary>
    [Fact]
    public async Task ReportsWarmUpThenPlaying()
    {
        _device.Next("stop", null, streamUrl: null);
        _device.Next("connecting", 0);
        _device.Next("stream", 0);
        _device.Next("stream", 12);
        _device.Resting = FakeBluOsPlayer.Status("stream", 13, Mount.ToString());

        await using var player = Player();
        var seen = Watch(player);

        await player.PlayAsync(Mount, TestContext.Current.CancellationToken);
        await Settle();

        Assert.Equal(
            [PlayerPhase.Opening, PlayerPhase.Buffering, PlayerPhase.Playing],
            seen.Select(status => status.Phase).Distinct());
    }

    /// <summary>
    /// A boundary changes the record and nothing about what the player is doing. Reporting it would
    /// have the host redraw for a fact it did not come from here.
    /// </summary>
    [Fact]
    public async Task TheSamePhaseTwiceIsReportedOnce()
    {
        _device.Next("stop", null, streamUrl: null);
        _device.Resting = FakeBluOsPlayer.Status("stream", 30, Mount.ToString());

        await using var player = Player();
        var seen = Watch(player);

        await player.PlayAsync(Mount, TestContext.Current.CancellationToken);
        await Settle();

        Assert.Single(seen, status => status.Phase == PlayerPhase.Playing);
    }

    /// <summary>
    /// One dropped request is a network rather than a fault, and reporting it would step the host's
    /// backoff and interrupt a player that is streaming perfectly well. Three in a row is different,
    /// and it is said once rather than on every poll after it.
    /// </summary>
    [Fact]
    public async Task ThreeFailuresInARowAreReportedOnce_AndNotTheFirstOne()
    {
        _device.Next("stop", null, streamUrl: null);
        await using var player = Player();
        var seen = Watch(player);

        await player.PlayAsync(Mount, TestContext.Current.CancellationToken);

        _device.Failing = 20;
        await Settle(TimeSpan.FromSeconds(12));

        var failures = seen.Where(status => status.Phase == PlayerPhase.Failed).ToList();
        Assert.Single(failures);
        Assert.Contains("stopped answering", failures[0].Detail, StringComparison.Ordinal);
        Assert.Contains("10.0.1.36:11000", failures[0].Detail, StringComparison.Ordinal);
    }

    [Fact]
    public async Task APlayerThatComesBackIsPlayingAgain()
    {
        _device.Next("stop", null, streamUrl: null);
        await using var player = Player();
        var seen = Watch(player);

        await player.PlayAsync(Mount, TestContext.Current.CancellationToken);

        _device.Failing = 4;
        _device.Resting = FakeBluOsPlayer.Status("stream", 40, Mount.ToString());
        await Settle(TimeSpan.FromSeconds(16));

        Assert.Equal(PlayerPhase.Playing, seen[^1].Phase);
    }

    [Fact]
    public async Task StoppingStopsTheDeviceAndEndsTheWatching()
    {
        _device.Next("stop", null, streamUrl: null);
        _device.Resting = FakeBluOsPlayer.Status("stream", 30, Mount.ToString());

        await using var player = Player();
        await player.PlayAsync(Mount, TestContext.Current.CancellationToken);
        await Settle();

        await player.StopAsync(TestContext.Current.CancellationToken);

        Assert.Equal(PlayerPhase.Stopped, player.Status.Phase);
        Assert.Contains(_device.Asked, asked => asked.StartsWith("/Stop", StringComparison.Ordinal));

        var asked = _device.Asked.Count;
        await Settle();
        Assert.Equal(asked, _device.Asked.Count);
    }

    /// <summary>
    /// Measured: the player answers `stop` and the very next status still says `stream`. Reading the
    /// status back would report a stop that worked as one that failed.
    /// </summary>
    [Fact]
    public async Task AStopIsBelievedRatherThanCheckedAgainstAStatusThatLagsIt()
    {
        _device.Next("stop", null, streamUrl: null);
        _device.Resting = FakeBluOsPlayer.Status("stream", 30, Mount.ToString());

        await using var player = Player();
        await player.PlayAsync(Mount, TestContext.Current.CancellationToken);
        await player.StopAsync(TestContext.Current.CancellationToken);

        Assert.Equal(PlayerPhase.Stopped, player.Status.Phase);
    }

    /// <summary>
    /// A player left streaming after the app forgot about it is an audience the station keeps
    /// counting with nothing left to end it.
    /// </summary>
    [Fact]
    public async Task ThrowingThePlayerAwayStopsTheDevice()
    {
        _device.Next("stop", null, streamUrl: null);
        var player = Player();
        await player.PlayAsync(Mount, TestContext.Current.CancellationToken);

        await player.DisposeAsync();

        Assert.Contains(_device.Asked, asked => asked.StartsWith("/Stop", StringComparison.Ordinal));
    }

    [Fact]
    public async Task APlayerThatCannotBeReachedAtAllSaysSoRatherThanThrowing()
    {
        _device.Failing = 5;
        await using var player = Player();
        var seen = Watch(player);

        await player.PlayAsync(Mount, TestContext.Current.CancellationToken);

        Assert.Equal(PlayerPhase.Failed, seen[^1].Phase);
        Assert.Contains("did not take the station", seen[^1].Detail, StringComparison.Ordinal);
    }

    /// <summary>
    /// A slider dragged across its travel is dozens of values, each one a request to a small
    /// computer in another room. The value the hand stopped on is the one that has to land.
    /// </summary>
    [Fact]
    public async Task DraggingTheSliderSendsAHandfulOfRequestsEndingOnTheLastValue()
    {
        await using var player = Player();

        for (var level = 1; level <= 40; level++)
        {
            player.Volume = level / 100.0;
        }

        await Settle();

        var volumes = _device.Asked.Where(asked => asked.StartsWith("/Volume", StringComparison.Ordinal)).ToList();

        Assert.NotEmpty(volumes);
        Assert.True(volumes.Count < 40, $"{volumes.Count} requests for one gesture");
        Assert.EndsWith("level=40", volumes[^1], StringComparison.Ordinal);
    }

    /// <summary>
    /// A player has not said how loud it is until it has, and a slider drawn at zero would read as
    /// silence rather than as a question nobody has asked yet.
    /// </summary>
    [Fact]
    public async Task TheVolumeIsUnknownUntilThePlayerHasSaid()
    {
        _device.Next("stop", null, streamUrl: null);
        await using var player = Player();

        Assert.False(player.VolumeKnown);

        await player.PlayAsync(Mount, TestContext.Current.CancellationToken);

        Assert.True(player.VolumeKnown);
        Assert.Equal(0.2, player.Volume, 3);
    }

    /// <summary>
    /// -1 means the player's volume is fixed, which is "there is no volume here" and not silence.
    /// Taking it as a level would drop the slider to the bottom and invite somebody to drag it.
    /// </summary>
    [Fact]
    public async Task AFixedVolumeLeavesTheLastRealReadingAlone()
    {
        _device.Next("stop", null, streamUrl: null, volume: 20);
        _device.Resting = FakeBluOsPlayer.Status("stream", 30, Mount.ToString(), volume: -1);

        await using var player = Player();
        await player.PlayAsync(Mount, TestContext.Current.CancellationToken);
        await Settle();

        Assert.Equal(0.2, player.Volume, 3);
    }

    /// <summary>
    /// A hand on the player's own front panel moves a volume this app does not own, and the slider
    /// should follow it rather than argue with it.
    /// </summary>
    [Fact]
    public async Task SomebodyTurningTheDialMovesTheSlider()
    {
        _device.Next("stop", null, streamUrl: null, volume: 20);
        _device.Resting = FakeBluOsPlayer.Status("stream", 30, Mount.ToString(), volume: 45);

        await using var player = Player();
        var moved = 0;
        player.VolumeChanged += () => Interlocked.Increment(ref moved);

        await player.PlayAsync(Mount, TestContext.Current.CancellationToken);
        await Settle();

        Assert.Equal(0.45, player.Volume, 3);
        Assert.True(moved >= 2, $"{moved}");
    }

    /// <summary>
    /// Sixty seconds unless the client would give up first. The client the host supplies has no
    /// timeout at all, but a plugin should not fail differently because somebody handed it a
    /// stricter one.
    /// </summary>
    [Theory]
    [InlineData(0, 60)]
    [InlineData(15, 10)]
    [InlineData(30, 25)]
    [InlineData(120, 60)]
    public void TheLongPollFitsInsideWhicheverClientItWasGiven(int clientSeconds, int expected)
    {
        using var http = new HttpClient(new FakeBluOsPlayer())
        {
            Timeout = clientSeconds == 0 ? Timeout.InfiniteTimeSpan : TimeSpan.FromSeconds(clientSeconds),
        };

        var client = new BluOsClient(http, new BluOsEndpoint("10.0.1.36"), _logger);

        Assert.Equal(expected, (int)client.LongPollTimeout.TotalSeconds);
    }

    public void Dispose() => _http.Dispose();

    private BluOsStationPlayer Player() => new(
        new BluOsClient(_http, new BluOsEndpoint("10.0.1.36"), _logger),
        new BluOsSettings(Discover: true, Players: [], Caption: null, Logo: null),
        TimeProvider.System,
        _logger);

    private static List<PlayerStatus> Watch(BluOsStationPlayer player)
    {
        var seen = new List<PlayerStatus>();

        player.StatusChanged += status =>
        {
            lock (seen)
            {
                seen.Add(status);
            }
        };

        return seen;
    }

    /// <summary>
    /// Waits for the watcher, which polls on a real clock because a long poll is a real request.
    /// </summary>
    private static Task Settle(TimeSpan? howLong = null) => Task.Delay(howLong ?? TimeSpan.FromSeconds(5));
}
