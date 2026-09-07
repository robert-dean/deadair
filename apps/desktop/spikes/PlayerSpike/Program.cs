using System.Diagnostics;
using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Player.Mac;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

// The audio spike. Reads the station's own mount list, plays each format for a while, and prints
// every phase transition with the time it happened.
//
// Deliberately outside the solution and deleted once the app itself can do this. What it answers,
// before any UI depends on it: whether AVFoundation behind a C shim actually plays this station — an
// ICY MP3 mount and an HLS playlist — and what warm-up looks like from outside.
//
//     dotnet run --project apps/desktop/spikes/PlayerSpike -- https://radio.deanhome.app [seconds]
//
// NOTHING in this file may `await`. AVFoundation services its player from the MAIN thread's run
// loop, and an `await` in a console app resumes on a thread-pool thread — after which the main
// thread parks, the main queue is never drained, and the player opens, reports buffering and never
// plays. Measured, twice, before the cause was found. So every call here is synchronous and the run
// loop is pumped on the same thread that built the player.

var origin = args.Length > 0 ? args[0].TrimEnd('/') : "https://radio.deanhome.app";
var seconds = args.Length > 1 && int.TryParse(args[1], out var parsed) ? parsed : 45;

const string UserAgent = "deadair-desktop/0.1.0";

using var http = new HttpClient();
http.DefaultRequestHeaders.UserAgent.ParseAdd(UserAgent);

string Read(string path) => http.GetStringAsync($"{origin}{path}").GetAwaiter().GetResult();

NowPlaying ReadNowPlaying() =>
    JsonSerializer.Deserialize<NowPlaying>(Read("/api/nowplaying"), SdkJson.Options)!;

Console.WriteLine($"station:   {origin}");
Console.WriteLine($"agent:     {UserAgent}");

// Never probe the mounts to find out which exist: a connection of any length registers an audience
// for five minutes, so probing would put an audience-gated station on air. This is the only correct
// way to ask.
var nowPlaying = ReadNowPlaying();

Console.WriteLine($"name:      {nowPlaying.Station}");
Console.WriteLine($"on air:    {nowPlaying.OnAir}");
Console.WriteLine($"listeners: {nowPlaying.Listeners}");
Console.WriteLine($"track:     {(nowPlaying.Track is null ? "(quiet)" : $"{nowPlaying.Track.Artist} - {nowPlaying.Track.Title}")}");
Console.WriteLine($"mounts:    {string.Join(", ", nowPlaying.Mounts.Select(m => $"{m.Format} {m.Path}"))}");
Console.WriteLine();

foreach (var format in new[] { NowPlayingMountFormat.Mp3, NowPlayingMountFormat.Hls })
{
    var choice = MountSelection.Choose(nowPlaying.Mounts, format);
    if (choice.FellBack)
    {
        Console.WriteLine($"--- {format}: not published, skipping");
        continue;
    }

    var url = new Uri($"{origin}{choice.Path}");
    Console.WriteLine($"--- {format}: {url}");

    var clock = Stopwatch.StartNew();
    var conductor = new PlaybackConductor();
    var player = new MacStationPlayer(UserAgent);

    player.StatusChanged += status =>
    {
        conductor.Observed(status);
        var detail = status.Detail is null ? string.Empty : $"  ({status.Detail})";
        Console.WriteLine($"    {clock.Elapsed.TotalSeconds,6:F2}s  {status.Phase,-9} -> {conductor.State}{detail}");
    };

    // Quiet: this runs unattended and its point is the phase transitions, not the volume.
    player.Volume = 0.12;

    conductor.Requested();
    player.PlayAsync(url).GetAwaiter().GetResult();

    // Exercise the system now-playing path while audio is actually running. The WIDGET only appears
    // for a bundled app, so what this proves is the marshalling — a byte array, a bool and three
    // optional strings across the boundary — rather than the display.
    using (var system = new MacSystemNowPlaying())
    {
        system.Commanded += command => Console.WriteLine($"    system asked for {command}");
        system.SetCanSkip(true);
        system.Show(new NowPlayingCard(
            nowPlaying.Track?.Title ?? nowPlaying.Station,
            nowPlaying.Track?.Artist,
            nowPlaying.Track?.Album,
            Artwork: null,
            Duration: TimeSpan.FromSeconds(200),
            Position: TimeSpan.FromSeconds(12),
            Playing: true));
        Console.WriteLine("    now-playing card accepted");

        MacRunLoop.Pump(TimeSpan.FromSeconds(seconds));

        system.Clear();
    }

    Console.WriteLine($"    {clock.Elapsed.TotalSeconds,6:F2}s  stopping");
    conductor.Released();
    player.StopAsync().GetAwaiter().GetResult();
    player.DisposeAsync().AsTask().GetAwaiter().GetResult();

    // A short tail, and no socket check. AVFoundation does not hold the audio connection in this
    // process — `lsof` shows none even at rate 1.0 — and the helper that does hold it is not visible
    // without elevated privileges. So a socket count is not a witness for whether stopping dropped
    // the connection, and an earlier version of this printed one that looked like proof while
    // actually counting the API client. The station's own listener count is the honest witness, and
    // it lingers five minutes by design.
    MacRunLoop.Pump(TimeSpan.FromSeconds(3));
    Console.WriteLine();
}

Console.WriteLine("done");


// Whether this process is still holding a connection to the station.
//
// Icecast's own listener count cannot answer it: an audience lingers for five minutes past the last
// listener, deliberately, so that a reconnecting player does not cut the broadcast. The socket is the
// only immediate witness, and it matters because stopping MUST drop the connection rather than pause
// it — a held connection is still an audience, and would keep an audience-gated station on air with
// nobody listening.
//
// Every resolved address is matched, not the first: the station is behind a CDN that answers with
// several, and the one AVFoundation picked is not reliably the one that resolves first.
