using System.Globalization;
using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs;
using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Discovery;
using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Http;
using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Playback;
using MaroonedSoftware.Deadair.Desktop.PluginSdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

// The generated station SDK has a `PluginLogLevel` of its own, about the SERVER's plugins. This
// spike is about a desktop one, so the contract's is named explicitly.
using PluginLogLevel = MaroonedSoftware.Deadair.Desktop.PluginSdk.PluginLogLevel;

// The BluOS spike. Finds players, plays the station on one, watches what it says, and stops.
//
// Kept in the solution rather than deleted, for the reason PlayerSpike is: it is how this plugin is
// re-measured after any change to it, and against a firmware that can move under everybody without
// a version number changing.
//
//     dotnet run --project apps/desktop/plugins/bluos/spikes/BluOsSpike -- \
//         https://radio.deanhome.app [player-host[:port]] [seconds] [--allow-stop]
//
// What it exists to settle, in the order the answers matter:
//
//   1. What `streamUrl` holds after a /Play with a url, if anything. The phase mapping treats an
//      absent one as ours, and that is a guess: the probe only ever recorded a streamUrl for a
//      station added through the controller app.
//   2. Whether UDP 11430 can be bound while the BluOS controller app is running, and whether the
//      player honours a query asking it to reply directly.
//   3. The M10's own brand, model and modelName strings, which the test fixtures currently guess.
//   4. How long `connecting` and `secs=0` last against a cold, audience-gated station.
//   5. Whether /Volume answers with the new level or the old one.
//   6. Whether /Play against the URL already playing really is inert, which the probe measured once.
//
// ON THE STATION: connecting a player to the mount is a listener arriving, which on an
// audience-gated station is what puts it on air. That is expected and is what the amp does daily.
// Stopping drops that listener, and the station's own count lingers five minutes past the last one
// by design, so the honest witness of a stop is the count six minutes later.

var origin = (args.Length > 0 ? args[0] : "https://radio.deanhome.app").TrimEnd('/');
var wanted = args.Length > 1 && !args[1].StartsWith("--", StringComparison.Ordinal) ? args[1] : null;
var seconds = args.Length > 2 && int.TryParse(args[2], CultureInfo.InvariantCulture, out var parsed) ? parsed : 30;
var allowStop = args.Contains("--allow-stop", StringComparer.Ordinal);

var logger = new Printing();

using var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
http.DefaultRequestHeaders.Add("User-Agent", "deadair-desktop/0.1.0 (plugin deadair.bluos)");

using var station = new HttpClient();
station.DefaultRequestHeaders.Add("User-Agent", "deadair-desktop/0.1.0");

void Say(string line) =>
    Console.WriteLine($"{DateTimeOffset.Now:HH:mm:ss}  {line}");

// 1. Who is out there.

Say($"station:  {origin}");
Say($"asking for players on udp {LsdpPacket.Port}, listening {LsdpDiscovery.Window.TotalSeconds:0.0}s");

var announcements = await new LsdpDiscovery(TimeProvider.System, logger).ListenAsync(CancellationToken.None);

foreach (var announcement in announcements)
{
    var records = string.Join("; ", announcement.Records.Select(record =>
        $"class {record.ClassId:x4} " + string.Join(' ', record.Text.Select(pair => $"{pair.Key}={pair.Value}"))));

    Say($"  heard {announcement.NodeId} at {announcement.Address}: {records}");
}

var devices = LsdpDevices.From(announcements, "deadair.bluos").ToList();
Say($"found {devices.Count} player(s)");

var endpoint = wanted is not null
    ? BluOsEndpoint.Parse(wanted)
    : devices.Count > 0 ? BluOsEndpoint.Parse(devices[0].Address) : null;

if (endpoint is null)
{
    Say("no player found and none named on the command line; nothing else to do");
    return;
}

Say($"using {endpoint}");

var player = new BluOsClient(http, endpoint, logger);

// 2. What it says it is. Question 3: the real brand and model strings.

var sync = await player.SyncStatusAsync(CancellationToken.None);
Say($"  name={sync.Name} brand={sync.Brand} model={sync.Model} modelName={sync.ModelName} mac={sync.Mac} volume={sync.Volume}");

// 3. What the station is publishing. Read from `mounts[]` and never by trying one: a connection of
// any length registers an audience for the full five-minute linger.

var now = JsonSerializer.Deserialize<NowPlaying>(
    await station.GetStringAsync(new Uri($"{origin}/api/nowplaying")),
    SdkJson.Options)!;

Say($"station: onAir={now.OnAir} listeners={now.Listeners} mounts={string.Join(", ", now.Mounts.Select(mount => mount.Path))}");

var choice = MountSelection.Choose(now.Mounts, NowPlayingMountFormat.Mp3);
var mount = new Uri(new Uri(origin), choice.Path);

Say($"mount: {mount}");
Say("NOTE: the player connecting is a listener arriving, which on an audience-gated station puts it on air.");

if (now.Listeners > 0)
{
    // Worth knowing before starting rather than before stopping. This spike always stops what it
    // started: leaving a player streaming would be a listener the station keeps counting with
    // nothing left to stop it, which is the exact failure the plugin's own dispose exists to avoid.
    Say($"NOTE: {now.Listeners} listener(s) already, so the station is somebody's broadcast right now.");

    if (!allowStop)
    {
        Say("      Nothing here interrupts them, but pass --allow-stop if you would rather not be running this at all.");
    }
}

// 4. Before, then play. Question 6: whether a second /Play against the same URL is inert.

var before = await player.StatusAsync(etag: null, longPoll: false, CancellationToken.None);
Print("before", before);

var stopFirst = BluOsPlayPlan.StopFirst(before.State, BluOsPhase.Match(before.StreamUrl, mount));
Say($"stop first: {stopFirst}");

if (stopFirst)
{
    Say($"  /Stop -> {await player.StopAsync(CancellationToken.None)}");
}

var caption = Environment.GetEnvironmentVariable("DEADAIR_BLUOS_CAPTION");
var logo = Environment.GetEnvironmentVariable("DEADAIR_BLUOS_LOGO") is { Length: > 0 } text ? new Uri(text) : null;

Say($"  /Play -> {await player.PlayAsync(mount, caption, logo, CancellationToken.None)}");

// 5. Watch. Questions 1 and 4: what streamUrl holds, and how long warm-up lasts.

var conductor = new PlaybackConductor();
conductor.Requested();

var deadline = DateTimeOffset.UtcNow.AddSeconds(seconds);
string? etag = null;

while (DateTimeOffset.UtcNow < deadline)
{
    var status = await player.StatusAsync(etag: null, longPoll: false, CancellationToken.None);
    etag = status.Etag;

    var phase = BluOsPhase.From(status.State, status.Secs, BluOsPhase.Match(status.StreamUrl, mount));
    conductor.Observed(phase);

    Print($"{phase.Phase}/{conductor.State}", status);

    await Task.Delay(TimeSpan.FromSeconds(1));
}

// 6. The long poll. The probe measured this returning early on a track boundary; what is unknown is
// how long it takes to come back and whether `secs` alone ever brings it back, which it should not.

Say($"long poll, timeout {player.LongPollTimeout.TotalSeconds:0}s, etag {etag}");
var started = DateTimeOffset.UtcNow;
var change = await player.StatusAsync(etag, longPoll: true, CancellationToken.None);
Say($"  returned after {(DateTimeOffset.UtcNow - started).TotalSeconds:0.0}s");
Print("  changed", change);

// 7. Volume. Question 5: what /Volume answers with.

var original = change.Volume ?? sync.Volume ?? 20;
Say($"  /Volume?level=12 -> {await player.SetVolumeAsync(12, CancellationToken.None)}");
await Task.Delay(TimeSpan.FromSeconds(2));
Say($"  /Volume?level={original} -> {await player.SetVolumeAsync(original, CancellationToken.None)}");

// 8. The second /Play, which the probe says does nothing at all.

var beforeSecond = await player.StatusAsync(etag: null, longPoll: false, CancellationToken.None);
Say($"  /Play again -> {await player.PlayAsync(mount, caption, logo, CancellationToken.None)}");
await Task.Delay(TimeSpan.FromSeconds(3));
var afterSecond = await player.StatusAsync(etag: null, longPoll: false, CancellationToken.None);

Say($"secs {beforeSecond.Secs} -> {afterSecond.Secs}, state {beforeSecond.State} -> {afterSecond.State}");
Say(afterSecond.Secs >= beforeSecond.Secs && afterSecond.State == beforeSecond.State
    ? "  inert, as the probe measured"
    : "  NOT inert: it reconnected, and BluOsPlayPlan is written on the opposite assumption");

// 9. Stop, and what the station makes of it. Always: what this started, this ends.

Say($"  /Stop -> {await player.StopAsync(CancellationToken.None)}");
Print("after", await player.StatusAsync(etag: null, longPoll: false, CancellationToken.None));

var settled = JsonSerializer.Deserialize<NowPlaying>(
    await station.GetStringAsync(new Uri($"{origin}/api/nowplaying")),
    SdkJson.Options)!;

Say($"station now: onAir={settled.OnAir} listeners={settled.Listeners}");
Say("the station's count lingers five minutes past the last listener by design; the honest witness of the stop is that number six minutes from now.");

void Print(string label, BluOsStatus status) => Say(
    $"{label,-24} state={status.State,-11} secs={status.Secs,-5} service={status.Service,-8} " +
    $"vol={status.Volume,-4} etag={status.Etag,-10} streamUrl={status.StreamUrl ?? "(none)"} " +
    $"title1={status.Title1} | title2={status.Title2}");

internal sealed class Printing : IPluginLogger
{
    public void Log(PluginLogLevel level, string message, Exception? exception = null) =>
        Console.WriteLine($"{DateTimeOffset.Now:HH:mm:ss}  [{level}] {message}{(exception is null ? string.Empty : ": " + exception.Message)}");
}
