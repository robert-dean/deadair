using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Handing the station from one place to another.
///
/// The rule under test is a rule about TWO players, which is why it lives in one type rather than in
/// the view model that uses it: a network player fetching the mount is a listener to the station in
/// its own right, so a moment with both playing is a moment the station serves two audiences for one
/// person, and on an audience-gated station it holds the mount open for five minutes afterwards for
/// somebody who has walked away.
/// </summary>
public sealed class OutputSwitchTests
{
    private static readonly Uri Mount = new("https://radio.example.com/live.mp3");

    private static readonly Output Kitchen = new("deadair.bluos", "90:56:82:00:bc:99", "Kitchen", "N130", "10.0.1.36:11000");
    private static readonly Output LivingRoom = new("deadair.bluos", "90:56:82:00:bc:aa", "Living Room", "M10 V2", "10.0.1.40:11000");

    [Fact]
    public async Task StartsOnThisMachine()
    {
        await using var @switch = new OutputSwitch(new NullStationPlayer());

        Assert.Equal(Output.ThisMac, @switch.Active);
        Assert.True(@switch.IsLocal);
    }

    /// <summary>
    /// The whole point. The old one is stopped and dropped before the new one is asked for anything.
    /// </summary>
    [Fact]
    public async Task TheOldOutputStopsBeforeTheNewOneStarts()
    {
        var log = new List<string>();
        var local = new Watched("mac", log);
        var device = new Watched("kitchen", log);

        await using var @switch = new OutputSwitch(local);
        await @switch.PlayAsync(Mount, TestContext.Current.CancellationToken);

        await @switch.SelectAsync(Kitchen, device, TestContext.Current.CancellationToken);

        Assert.Equal(["mac play", "mac stop", "kitchen play"], log);
    }

    [Fact]
    public async Task TheStationCarriesOnPlayingOnTheNewOutput()
    {
        var local = new NullStationPlayer();
        var device = new NullStationPlayer();

        await using var @switch = new OutputSwitch(local);
        await @switch.PlayAsync(Mount, TestContext.Current.CancellationToken);
        await @switch.SelectAsync(Kitchen, device, TestContext.Current.CancellationToken);

        Assert.Equal(Mount, device.LastMount);
        Assert.Equal(Kitchen, @switch.Active);
        Assert.False(@switch.IsLocal);
    }

    /// <summary>
    /// Choosing a speaker while nothing is playing chooses a speaker. It does not start the station
    /// in somebody's kitchen.
    /// </summary>
    [Fact]
    public async Task ChoosingAnOutputWhileNothingIsPlayingStartsNothing()
    {
        var device = new NullStationPlayer();

        await using var @switch = new OutputSwitch(new NullStationPlayer());
        await @switch.SelectAsync(Kitchen, device, TestContext.Current.CancellationToken);

        Assert.Null(device.LastMount);
        Assert.Equal(Kitchen, @switch.Active);
    }

    [Fact]
    public async Task ChoosingTheOneAlreadyChosenDoesNothingAtAll()
    {
        var log = new List<string>();
        var device = new Watched("kitchen", log);

        await using var @switch = new OutputSwitch(new Watched("mac", log));
        await @switch.SelectAsync(Kitchen, device, TestContext.Current.CancellationToken);
        await @switch.PlayAsync(Mount, TestContext.Current.CancellationToken);
        log.Clear();

        await @switch.SelectAsync(Kitchen, new Watched("another", log), TestContext.Current.CancellationToken);

        Assert.Empty(log);
    }

    [Fact]
    public async Task TheVolumeReachesOnlyWhereTheSoundIs()
    {
        var local = new NullStationPlayer();
        var device = new NullStationPlayer();

        await using var @switch = new OutputSwitch(local) { Volume = 0.4 };
        Assert.Equal(0.4, local.Volume, 3);

        await @switch.SelectAsync(Kitchen, device, TestContext.Current.CancellationToken);
        @switch.Volume = 0.9;

        Assert.Equal(0.9, device.Volume, 3);
        Assert.Equal(0.4, local.Volume, 3);
    }

    /// <summary>
    /// A player reports on whatever thread it likes, so one can already be on its way when the
    /// handover happens. Letting it through would tell the conductor that the player it is now
    /// watching had stopped, which is a reconnect of the wrong device in the middle of a move.
    /// </summary>
    [Fact]
    public async Task SomethingSaidByAnOutputThatWasLeftIsNotPassedOn()
    {
        var local = new NullStationPlayer();
        var device = new NullStationPlayer();

        await using var @switch = new OutputSwitch(local);
        await @switch.SelectAsync(Kitchen, device, TestContext.Current.CancellationToken);

        var heard = new List<PlayerStatus>();
        @switch.StatusChanged += heard.Add;

        local.Report(new PlayerStatus(PlayerPhase.Failed, "the machine this app is on"));
        device.Report(new PlayerStatus(PlayerPhase.Playing));

        Assert.Equal(PlayerPhase.Playing, Assert.Single(heard).Phase);
    }

    /// <summary>
    /// A device that has been left is thrown away, because keeping it would mean holding a watcher
    /// and a connection to a player nobody is listening on. This machine's own is never thrown away:
    /// it is the one output that has to still be there.
    /// </summary>
    [Fact]
    public async Task ADeviceThatWasLeftIsDisposedAndThisMachineIsNot()
    {
        var local = new Counted();
        var kitchen = new Counted();

        var @switch = new OutputSwitch(local);
        await @switch.SelectAsync(Kitchen, kitchen, TestContext.Current.CancellationToken);
        await @switch.SelectAsync(LivingRoom, new Counted(), TestContext.Current.CancellationToken);

        Assert.Equal(1, kitchen.Disposals);
        Assert.Equal(0, local.Disposals);

        await @switch.DisposeAsync();
        Assert.Equal(1, local.Disposals);
    }

    /// <summary>
    /// Raised before the new target plays, so that whoever is watching can reset what it thinks is
    /// happening before the first reading of the new player arrives.
    /// </summary>
    [Fact]
    public async Task TheHandoverIsAnnouncedBeforeTheNewOutputIsAskedToPlay()
    {
        var order = new List<string>();
        var device = new NullStationPlayer();

        await using var @switch = new OutputSwitch(new NullStationPlayer());
        await @switch.PlayAsync(Mount, TestContext.Current.CancellationToken);

        @switch.TargetChanged += output => order.Add($"told about {output.Name}");
        device.StatusChanged += _ => order.Add("device playing");

        await @switch.SelectAsync(Kitchen, device, TestContext.Current.CancellationToken);

        Assert.Equal("told about Kitchen", order[0]);
    }

    /// <summary>
    /// A device that will not stop is a problem for the station's listener count, and not a reason to
    /// refuse to move: the operator asked for the sound somewhere else and should get it.
    /// </summary>
    [Fact]
    public async Task ADeviceThatWillNotStopDoesNotTrapTheStationOnIt()
    {
        var stubborn = new Refuses();

        await using var @switch = new OutputSwitch(new NullStationPlayer());
        await @switch.SelectAsync(Kitchen, stubborn, TestContext.Current.CancellationToken);
        await @switch.SelectAsync(Output.ThisMac, null, TestContext.Current.CancellationToken);

        Assert.Equal(Output.ThisMac, @switch.Active);
    }

    [Fact]
    public async Task AskingForADeviceWithoutOneIsRefusedRatherThanIgnored()
    {
        await using var @switch = new OutputSwitch(new NullStationPlayer());

        await Assert.ThrowsAsync<ArgumentException>(
            () => @switch.SelectAsync(Kitchen, player: null, TestContext.Current.CancellationToken));
    }

    /// <summary>A player that says nothing about its volume is one whose volume is simply known.</summary>
    [Fact]
    public async Task AnOutputThatCannotReportItsVolumeIsNotTreatedAsSilent()
    {
        await using var @switch = new OutputSwitch(new NullStationPlayer());

        Assert.True(@switch.VolumeKnown);
    }

    /// <summary>Writes what it was asked to do, so an ordering can be asserted rather than inferred.</summary>
    private sealed class Watched(string name, List<string> log) : IStationPlayer
    {
        public PlayerStatus Status { get; private set; } = PlayerStatus.Stopped;

        public event Action<PlayerStatus>? StatusChanged;

        public double Volume { get; set; }

        public Task PlayAsync(Uri mount, CancellationToken cancellationToken = default)
        {
            log.Add($"{name} play");
            Status = new PlayerStatus(PlayerPhase.Playing);
            StatusChanged?.Invoke(Status);
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken = default)
        {
            log.Add($"{name} stop");
            Status = PlayerStatus.Stopped;
            return Task.CompletedTask;
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    private sealed class Counted : IStationPlayer
    {
        public int Disposals { get; private set; }

        public PlayerStatus Status => PlayerStatus.Stopped;

        public event Action<PlayerStatus>? StatusChanged;

        public double Volume { get; set; }

        public Task PlayAsync(Uri mount, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task StopAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

        public ValueTask DisposeAsync()
        {
            Disposals++;
            StatusChanged?.Invoke(PlayerStatus.Stopped);
            return ValueTask.CompletedTask;
        }
    }

    private sealed class Refuses : IStationPlayer
    {
        public PlayerStatus Status => PlayerStatus.Stopped;

        public event Action<PlayerStatus>? StatusChanged;

        public double Volume { get; set; }

        public Task PlayAsync(Uri mount, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task StopAsync(CancellationToken cancellationToken = default) =>
            throw new HttpRequestException("the speaker did not answer");

        public ValueTask DisposeAsync()
        {
            StatusChanged?.Invoke(PlayerStatus.Stopped);
            return ValueTask.CompletedTask;
        }
    }
}
