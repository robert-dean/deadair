using System.Net;
using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.Themes;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;
using Destination = MaroonedSoftware.Deadair.Desktop.Navigation.Destination;

namespace Shots;

/// <summary>
/// A whole shell, with nothing behind it.
/// </summary>
/// <remarks>
/// The sidebar and the player bar are only themselves inside a shell — the sidebar reads the session
/// for its account line and the navigation for its sections, and the bar reaches the window for
/// where it is. So looking at either means building all of it, which is what this does: real view
/// models, a player that plays nothing, a settings file that is a variable, and an HTTP client that
/// refuses everything. Nothing here is a test double for behaviour; they exist so that a constructor
/// can run.
/// </remarks>
internal static class Fakes
{
    public static ShellViewModel Shell(bool operatorSignedIn)
    {
        var http = Http();
        var settings = new MemorySettings();
        var session = new SessionManager(new InMemorySecretStore(), http);
        var actions = new OperatorActions(session);
        var dispatcher = ImmediateUiDispatcher.Instance;
        var navigation = new NavigationViewModel();

        var shell = new ShellViewModel(
            settings,
            session,
            new SetupViewModel(settings, new StationProbe(http)),
            new ListenerViewModel(new NullStationPlayer(), new NullSystemNowPlaying(), settings, http, dispatcher),
            new LoginViewModel(session),
            new TransportViewModel(session, actions, http, dispatcher),
            new RunningOrderViewModel(session, actions, http, dispatcher),
            navigation,
            new ProgrammeViewModel(actions, http),
            new LibraryViewModel(actions, http),
            new HistoryViewModel(actions, http),
            new CheckupViewModel(actions, http),
            new SettingsViewModel(actions, http, settings, new ThemeManager()),
            new VoiceViewModel(actions, http),
            new ThemeManager())
        {
            NeedsStation = false,
            SignedOut = !operatorSignedIn,
            Account = operatorSignedIn ? "marla@deanhome.app" : null,
        };

        // Attached, because opening a page runs that page's load and a view model with no station
        // has no URL to build a client from. In the app this order is guaranteed — the setup screen
        // sits above everything until a station answers — so this is the shot tool standing in for
        // that rather than papering over a reachable crash. The client refuses, so nothing arrives
        // and the posed rows stay.
        // Every page EXCEPT the listener. Attaching that one subscribes it to `/nowplaying`, and a
        // poller against a client that refuses everything marks the reading stale — which put "Not
        // answering. Showing the last reading." on every desk frame, including the one whose whole
        // job was to show what a station that IS answering looks like. Nothing here needs the poll:
        // the desk's frames are posed outright.
        if (StationUrl.TryParse("https://radio.example.com", out var station))
        {
            shell.Programme.Attach(station);
            shell.Library.Attach(station);
            shell.History.Attach(station);
            shell.Checkup.Attach(station);
            shell.StationSettings.Attach(station);
            shell.Voice.Attach(station);
        }

        navigation.ApplyRole(operatorSignedIn);
        return shell;
    }

    /// <summary>What is on air, posed. Every one of these has a public setter for exactly this.</summary>
    public static void PutOnAir(ListenerViewModel listener)
    {
        listener.StationName = "Deadair";
        listener.Title = "Alive";
        listener.Artist = "Pearl Jam";
        listener.Album = "Ten, 1991";
        listener.OnAir = true;
        listener.Listeners = 12;
        listener.ListenersLabel = ListenerCount.Label(12);
        listener.Listening = ListeningState.Playing;
        listener.ListeningLabel = "Listening";
        listener.Tone = StatusTone.Live;
        listener.HasPlayhead = true;
        listener.Duration = 341;
        listener.Position = 108;
        listener.Elapsed = "1:48";
        listener.Remaining = "-3:53";
        listener.FormatLabel = "MP3 128 kb/s";
        listener.Volume = 0.7;
    }

    /// <summary>The station cannot say where the record is up to, which is ordinary.</summary>
    public static void WithoutAPlayhead(ListenerViewModel listener)
    {
        listener.HasPlayhead = false;
        listener.Duration = 0;
        listener.Position = 0;
        listener.Elapsed = ClockFormat.Unknown;
        listener.Remaining = ClockFormat.Unknown;
    }

    /// <summary>The seconds after somebody presses Listen, which are the station waking up.</summary>
    public static void WarmingUp(ListenerViewModel listener)
    {
        listener.Listening = ListeningState.WarmingUp;
        listener.ListeningLabel = "Warming up";
        listener.Tone = StatusTone.Standby;
        WithoutAPlayhead(listener);
    }

    /// <summary>A quiet station, which is the resting state of an audience-gated one.</summary>
    public static void OffAir(ListenerViewModel listener)
    {
        listener.StationName = "Deadair";
        listener.Title = null;
        listener.Artist = null;
        listener.Album = null;
        listener.OnAir = false;
        listener.Listeners = 0;
        listener.ListenersLabel = ListenerCount.Label(0);
        listener.Listening = ListeningState.Stopped;
        listener.ListeningLabel = "Stopped";
        listener.Tone = StatusTone.Off;
        listener.FormatLabel = "MP3 128 kb/s";
        WithoutAPlayhead(listener);
    }

    /// <summary>A failed poll keeps the last good answer and says it is old.</summary>
    public static void Stale(ListenerViewModel listener) => listener.Stale = true;

    /// <summary>The operator's half, posed: a running order with every state in it.</summary>
    public static void PutTheDeskOnAir(ShellViewModel shell)
    {
        shell.Transport.IsOperator = true;
        shell.Transport.OnAir = true;
        shell.Transport.StreamUp = true;
        shell.Transport.Queued = 6;

        shell.Order.IsOperator = true;
        shell.Order.Name = "Wednesday mornings";
        shell.Order.Brief = "Something with guitars, nothing after 1999.";
        shell.Order.Host = "Marla Vance";
        shell.Order.RunsDryLabel = "Runs dry at about 13:20";
        shell.Order.CanUndo = true;
        shell.Order.UndoLabel = "Dropped Jeremy";

        shell.Order.Items.Add(Row("Alive", "Pearl Jam", StationItemState.Airing, canMove: false));
        shell.Order.Items.Add(Row("Talk break: Alive into Black", "", StationItemState.Handed, canMove: false, segment: true));
        shell.Order.Items.Add(Row("Black", "Pearl Jam", StationItemState.Planned, canMove: true));
        shell.Order.Items.Add(Row("Would?", "Alice In Chains", StationItemState.Planned, canMove: true));
        shell.Order.Items.Add(Row("Rooster", "Alice In Chains", StationItemState.Unavailable, canMove: true));
        shell.Order.Items.Add(Row("Nutshell", "Alice In Chains", StationItemState.Planned, canMove: true));
    }

    private static OrderItemViewModel Row(string title, string artist, StationItemState state, bool canMove, bool segment = false) =>
        new(
            new StationOrderItem
            {
                Id = Guid.NewGuid().ToString(),
                Kind = segment ? StationOrderItemKind.Segment : StationOrderItemKind.Track,
                State = state,
                Title = title,
                Artists = artist.Length == 0 ? [] : [artist],
                DurationMs = 214_000,
                TrackId = segment ? null : Guid.NewGuid().ToString(),
            },
            canMove);


    /// <summary>
    /// The kind of thing a real station answers with.
    /// </summary>
    /// <remarks>
    /// The data matters as much as the layout. A page of one-word rows looks fine and proves nothing:
    /// these carry a long persona style, a wrapped talk break, a module name that runs past its
    /// column and a title that has to trim, because that is where a layout actually goes wrong.
    ///
    /// One set, reached through the shell, so a page cannot be looked at with different data from the
    /// one the sidebar and the bar are drawn around.
    /// </remarks>
    public static void Fill(ShellViewModel shell, Destination destination)
    {
        switch (destination)
        {
            case Destination.Voice:
                Voice(shell.Voice);
                break;
            case Destination.Checkup:
                Checkup(shell.Checkup);
                break;
            case Destination.History:
                History(shell.History);
                break;
            case Destination.Library:
                Library(shell.Library);
                break;
            case Destination.Programme:
                Programme(shell.Programme);
                break;
            case Destination.Settings:
                Settings(shell.StationSettings);
                break;
            default:
                break;
        }
    }

    private static void Voice(VoiceViewModel voice)
    {
        voice.Personas.Add(new PersonaRowViewModel(
            "1",
            "Marla Vance",
            "Dry, unhurried, and never explains a joke. Speaks as though she has been up all night and "
            + "is the only one who noticed.",
            Active: true));
        voice.Personas.Add(new PersonaRowViewModel(
            "2",
            "The Conspiracy Host",
            "Certain about everything, wrong about most of it, and defers to the daypart he is handed.",
            Active: false));
        voice.Personas.Add(new PersonaRowViewModel("3", "Newsreader", "Flat, exact, and never editorialises.", false));

        voice.Scripts.Add(new ScriptRowViewModel(
            "11:42", "talk", "model",
            "That was Pearl Jam, and before that a record I have been trying to place all morning. "
            + "Stay where you are.",
            StatusTone.Ok));
        voice.Scripts.Add(new ScriptRowViewModel(
            "11:39", "talk", "model", "Declined: wrong-daypart", StatusTone.Standby));
        voice.Scripts.Add(new ScriptRowViewModel(
            "11:38", "welcome", "floor", "You're listening to Deadair.", StatusTone.Ok));
        voice.Scripts.Add(new ScriptRowViewModel(
            "11:31", "news", "model", "The speech engine did not answer in time.", StatusTone.Fault));

        voice.Segments.Add(new SegmentRowViewModel("Talk break: Jeremy into Alive", "talk", "ready", StatusTone.Ok));
        voice.Segments.Add(new SegmentRowViewModel("Station ident, evening", "ident", "ready", StatusTone.Ok));
        voice.Segments.Add(new SegmentRowViewModel("Talk break: Regulate into My Boo", "talk", "rendering", StatusTone.Standby));
        voice.Segments.Add(new SegmentRowViewModel("News bulletin, 11:30", "news", "failed", StatusTone.Fault));

        voice.Productions.Add(new ProductionRowViewModel("p1", "Phone-in: the worst gig you ever went to", "callin", "drafting", true));
        voice.Productions.Add(new ProductionRowViewModel("p2", "Evening feature", "feature", "ready", false));

    }

    private static void Checkup(CheckupViewModel checkup)
    {
        checkup.ReadAt = "Read at 11:48:02";
        checkup.Revision = "Built from 6ec2d2c1a4f9";
        checkup.Backlog = "412 of 766 records held locally, 389 measured";

        checkup.Attention.Add(new AttentionViewModel(
            "Four records cannot be fetched",
            "Every copy has been written off, so they will not air. Re-check them or remove them from rotation.",
            Severity.Failure,
            4));
        checkup.Attention.Add(new AttentionViewModel(
            "The speech engine is slow",
            "Two breaks took longer than their slot allowed and were dropped.",
            Severity.Warning,
            null));
        checkup.Attention.Add(new AttentionViewModel(
            "No news feeds configured",
            "The station has nothing to read a bulletin from.",
            Severity.Notice,
            null));

        checkup.Loops.Add(new LoopViewModel("playout.reconcile", "just now", "3h ago"));
        checkup.Loops.Add(new LoopViewModel("director.commit", "4s ago", "3h ago"));
        checkup.Loops.Add(new LoopViewModel("catalog.sweep", "6h ago", "3h ago"));
        checkup.Loops.Add(new LoopViewModel("analysis.walk", "has not come round yet", "12m ago"));

        checkup.Activity.Add(new ActivityViewModel("11:48:01", "playout", "Handed Alive to the player.", Severity.Notice));
        checkup.Activity.Add(new ActivityViewModel("11:47:58", "director", "Committed a talk break ahead of Alive.", Severity.Notice));
        checkup.Activity.Add(new ActivityViewModel("11:47:12", "render", "Spoke a talk break in 2.1s.", Severity.Notice));
        checkup.Activity.Add(new ActivityViewModel("11:46:40", "enrichment", "Wikipedia returned nothing for Pearl Jam.", Severity.Warning));
        checkup.Activity.Add(new ActivityViewModel("11:44:03", "analysis", "Measured 6 records.", Severity.Notice));
        checkup.Activity.Add(new ActivityViewModel("11:41:19", "llm", "The model declined a talk break: wrong-daypart.", Severity.Warning));
        checkup.Activity.Add(new ActivityViewModel("11:39:02", "playout", "Icecast stopped answering its stats endpoint.", Severity.Failure));

    }

    private static void History(HistoryViewModel history)
    {
        history.Days.Add(new HistoryDayViewModel("Today",
        [
            new("11:42", "Alive", "Pearl Jam", false, null),
            new("11:36", "Jeremy", "Pearl Jam", false, null),
            new("11:31", "Would?", "Alice In Chains", false, null),
            new("11:27", "Plush", "Stone Temple Pilots", false, null),
        ]));

        history.Days.Add(new HistoryDayViewModel("Yesterday",
        [
            new("23:51", "Regulate (feat. Nate Dogg) - Original Version", "Warren G, Nate Dogg", false, null),
            new("23:46", "Nutshell", "Alice In Chains", false, null),
            new("23:40", "Black", "Pearl Jam", true, null),
        ]));
    }

    private static void Library(LibraryViewModel library)
    {
        library.Total = 766;
        library.Summary = "1–50 of 766";

        library.Tracks.Add(new TrackRowViewModel(Guid.NewGuid(), "Alive", "Pearl Jam", "Ten", "5:41", "1991", null));
        library.Tracks.Add(new TrackRowViewModel(Guid.NewGuid(), "Black", "Pearl Jam", "Ten", "5:43", "1991", null));
        library.Tracks.Add(new TrackRowViewModel(
            Guid.NewGuid(),
            "Regulate (feat. Nate Dogg) - Original Version",
            "Warren G, Nate Dogg",
            "Regulate... G Funk Era",
            "4:08",
            "1994",
            null));
        library.Tracks.Add(new TrackRowViewModel(Guid.NewGuid(), "Would?", "Alice In Chains", "Dirt", "3:28", "1992", null));
        library.Tracks.Add(new TrackRowViewModel(Guid.NewGuid(), "Rooster", "Alice In Chains", "Dirt", "6:15", "1992", null));
        library.Tracks.Add(new TrackRowViewModel(Guid.NewGuid(), "Nutshell", "Alice In Chains", "Jar Of Flies", "4:19", "1994", null));
        library.Tracks.Add(new TrackRowViewModel(Guid.NewGuid(), "Outshined", "Soundgarden", "Badmotorfinger", "5:11", "1991", null));
    }

    private static void Programme(ProgrammeViewModel programme)
    {
        programme.OnNow = "Wednesday mornings, held past its slot";

        programme.Slots.Add(new SlotViewModel("1", "Mon–Fri", "06:00–10:00", "Breakfast", "Bright, and nothing anybody has to think about.", false));
        programme.Slots.Add(new SlotViewModel("2", "Wednesday", "10:00–13:00", "Wednesday mornings", "Something with guitars, nothing after 1999.", true));
        programme.Slots.Add(new SlotViewModel("3", "Every day", "23:00–00:00", "The late one", null, false));
    }

    private static void Settings(SettingsViewModel settings)
    {
        settings.ApplyMounts(
        [
            new() { Format = NowPlayingMountFormat.Mp3, Path = "/live.mp3", BitrateKbps = 128 },
            new() { Format = NowPlayingMountFormat.Hls, Path = "/hls/live.m3u8" },
        ]);

        settings.Groups.Add(new SettingGroupViewModel("Playout",
        [
            Field("playout.airMode", "Air mode", "Audience: the station goes on air when somebody connects.", "true", ConfigFieldType.Boolean),
            Field("playout.linger", "Linger after the last listener", "Milliseconds. Five minutes by default.", "300000", ConfigFieldType.Number),
            Field("stream.adminPassword", "Icecast admin password", "Never sent back. An empty box leaves it alone.", "", ConfigFieldType.Secret),
        ]));
    }

    /// <summary>One declared setting. The station's half of Settings is drawn entirely from these.</summary>
    private static SettingFieldViewModel Field(string key, string label, string help, string value, ConfigFieldType type) =>
        new(
            new StationSettingDescriptor
            {
                Key = key,
                Label = label,
                Help = help,
                Type = type,
                Group = SettingGroup.Playout,
            },

            // Every value the station holds is TEXT, whatever its declared type: a switch travels as
            // the word `true` and a number as its digits.
            JsonSerializer.SerializeToElement(value),
            configured: true);

    public static HttpClient Http() => new(new Refuses());

    private sealed class Refuses : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
    }

    /// <summary>Settings in a variable. A shot must not read or write somebody's real preferences.</summary>
    private sealed class MemorySettings : ISettingsStore
    {
        public DesktopSettings Current { get; private set; } = new();

        public event Action<DesktopSettings>? Changed;

        public Task LoadAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task SaveAsync(DesktopSettings settings, CancellationToken cancellationToken = default)
        {
            Current = settings;
            Changed?.Invoke(settings);
            return Task.CompletedTask;
        }
    }
}
