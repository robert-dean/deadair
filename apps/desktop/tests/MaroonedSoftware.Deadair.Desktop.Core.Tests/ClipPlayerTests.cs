using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// A preview is played one at a time, from a file that goes when it does.
/// </summary>
public sealed class ClipPlayerTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"clip-tests-{Guid.NewGuid():N}");
    private readonly List<FakePlayer> _made = [];

    private sealed class FakePlayer : IStationPlayer
    {
        public Uri? Played { get; private set; }

        public bool Stopped { get; private set; }

        public PlayerStatus Status { get; private set; } = PlayerStatus.Stopped;

        public event Action<PlayerStatus>? StatusChanged;

        public double Volume { get; set; }

        public Task PlayAsync(Uri mount, CancellationToken cancellationToken = default)
        {
            Played = mount;
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken = default)
        {
            Stopped = true;
            return Task.CompletedTask;
        }

        public void Report(PlayerPhase phase)
        {
            Status = new PlayerStatus(phase);
            StatusChanged?.Invoke(Status);
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    private ClipPlayer Build() => new(() =>
    {
        var player = new FakePlayer();
        _made.Add(player);
        return player;
    }, _directory);

    [Fact]
    public async Task AClipIsPlayedFromAFileHoldingItsBytes()
    {
        var clips = Build();

        await clips.PlayAsync("voice-1", new Clip([1, 2, 3], ".mp3"), TestContext.Current.CancellationToken);

        var played = Assert.Single(_made).Played!;
        Assert.True(played.IsFile);
        Assert.Equal([1, 2, 3], await File.ReadAllBytesAsync(played.LocalPath, TestContext.Current.CancellationToken));
        Assert.Equal("voice-1", clips.Playing);
    }

    [Fact]
    public async Task StartingASecondClipStopsTheFirstAndItsFileGoes()
    {
        var clips = Build();
        await clips.PlayAsync("a", new Clip([1], ".mp3"), TestContext.Current.CancellationToken);
        var first = _made[0].Played!.LocalPath;

        await clips.PlayAsync("b", new Clip([2], ".wav"), TestContext.Current.CancellationToken);

        Assert.True(_made[0].Stopped);
        Assert.False(File.Exists(first));
        Assert.Equal("b", clips.Playing);
    }

    [Fact]
    public async Task AClipThatFinishesHasStopped()
    {
        var clips = Build();
        var changes = 0;
        clips.Changed += () => changes++;
        await clips.PlayAsync("a", new Clip([1], ".mp3"), TestContext.Current.CancellationToken);

        _made[0].Report(PlayerPhase.Ended);

        Assert.Null(clips.Playing);
        Assert.Equal(2, changes);
    }

    [Fact]
    public async Task StoppingWithNothingPlayingSaysNothing()
    {
        var clips = Build();
        var changes = 0;
        clips.Changed += () => changes++;

        await clips.StopAsync(TestContext.Current.CancellationToken);

        Assert.Equal(0, changes);
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory))
        {
            Directory.Delete(_directory, recursive: true);
        }
    }
}
