using System.Net;
using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Plugins;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;
using MaroonedSoftware.Deadair.Desktop.Services;
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
        // Listening to an OperatorActions nothing else uses, so the fake client's refusals (every
        // page's load is refused) do not put "The station refused that" at the foot of every frame.
        // A frame that wants a notice sets one.
        var dialogs = new DialogsViewModel(new OperatorActions(session), dispatcher);

        // Previews that play nothing: a shot is a picture, and a picture makes no sound.
        var previews = new PreviewsViewModel(new ClipPlayer(() => new NullStationPlayer()), dispatcher);
        var library = new LibraryViewModel(actions, http, navigation, dialogs, new NoFiles());
        var voice = new VoiceViewModel(actions, http, dialogs, previews, new NoFiles(), navigation);
        var stationSettings = new SettingsViewModel(
            actions, http, settings, new ThemeManager(), dialogs, session, dispatcher, plugins: PosedPlugins(), navigation: navigation);

        // The picker, over a catalog whose plugins are two speakers that do not exist. A shot must
        // not go looking for real ones: a broadcast on somebody's network is not a thing to do to
        // draw a picture.
        var outputs = new OutputsViewModel(
            new OutputCatalog(new PosedOutputs(), new OutputSwitch(new NullStationPlayer()), settings),
            dispatcher);

        var shell = new ShellViewModel(
            settings,
            session,
            new SetupViewModel(settings, new StationProbe(http)),
            new ListenerViewModel(new OutputSwitch(new NullStationPlayer()), new NullSystemNowPlaying(), settings, http, dispatcher, outputs),
            new LoginViewModel(session),
            new TransportViewModel(session, actions, http, dispatcher),
            new RunningOrderViewModel(session, actions, http, dispatcher, dialogs, navigation),
            navigation,
            new ProgrammeViewModel(actions, http, dialogs),
            library,
            new HistoryViewModel(actions, http),
            new CheckupViewModel(actions, http, new NoFiles()),
            stationSettings,
            voice,
            new DetailPages(actions, http, library, voice, stationSettings),
            dialogs,
            new ThemeManager(),
            dispatcher)
        {
            NeedsStation = false,
            SignedOut = !operatorSignedIn,
            Account = operatorSignedIn ? "operator@example.com" : null,
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
            shell.Details.Attach(station);
        }

        navigation.ApplyRole(operatorSignedIn);

        // The session is signed out whatever the frame says, so the station's sections of Settings
        // are listed by saying so rather than by signing in.
        shell.StationSettings.ApplyRole(operatorSignedIn);
        return shell;
    }

    /// <summary>
    /// The desk while the station is loaded and waiting for its audience, with the sentence it gives,
    /// which is long enough to need wrapping in the card.
    /// </summary>
    public static void Quiet(ShellViewModel shell)
    {
        shell.Transport.ShowSilence = true;
        shell.Transport.SilenceTone = StatusTone.Standby;
        shell.Transport.Silence = "The station is loaded and the stream is up. It goes on air when the first listener arrives.";
        shell.Transport.Remedy = "Press play here, or open the stream anywhere else.";
    }

    /// <summary>What is on air, posed. Every one of these has a public setter for exactly this.</summary>
    public static void PutOnAir(ListenerViewModel listener)
    {
        listener.StationName = "Deadair";
        listener.Title = "Alive";
        listener.Artist = "Pearl Jam";

        // A cover's colours as the sampler would give them, so the page's wash is in frame: a shot
        // has no cover to sample, and without these every frame drew the page with none.
        listener.CoverPalette = [0xFF1C2A3A, 0xFFB8452B, 0xFFE9D8B8];
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

    /// <summary>The station coming out of a speaker in another room.</summary>
    public static void OnASpeaker(ListenerViewModel listener)
    {
        PutOnAir(listener);
        listener.OutputName = "Living Room NAD M10 V2";
        listener.OnDevice = true;
    }

    /// <summary>Fills the picker, and marks the speaker the station is on.</summary>
    public static async Task ShowOutputsAsync(OutputsViewModel outputs, bool onASpeaker)
    {
        // Attached first. The picker fills itself from the catalog's own notification, and without
        // a station it is never subscribed to one — which is exactly how the first render of this
        // frame came out as a heading and a button with nothing between them.
        if (StationUrl.TryParse("https://radio.example.com", out var station))
        {
            outputs.Attach(station);
        }

        await outputs.RescanAsync();

        if (!onASpeaker)
        {
            return;
        }

        foreach (var choice in outputs.Choices)
        {
            choice.IsActive = choice.Name.StartsWith("Living Room", StringComparison.Ordinal);
        }
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

        // The station's air as a takeover an operator started and then held, with a brief long
        // enough to have to trim beside the host at the window's minimum.
        shell.Order.Air.ApplyOrder(new StationOrder
        {
            Name = "Wednesday mornings",
            Brief = "Something with guitars, nothing after 1999, and more of the Seattle records than anybody would admit to liking",
            PersonaId = "1",
            PersonaLabel = "Marla Vance",
            Mode = StationMode.Rotation,
            OnEnd = StationOnEnd.Extend,
            Source = "director",
            Items = [.. shell.Order.Items.Select(row => new StationOrderItem
            {
                Id = row.Id,
                Kind = row.IsSegment ? StationOrderItemKind.Segment : StationOrderItemKind.Track,
                State = row.State,
                Title = row.Title,
                Artists = [row.Artists],
                TrackId = row.TrackId?.ToString(),

                // The record on air already liked, so the thumbs have an answer to draw.
                Rating = row.IsAiring ? Rating.Liked : null,
            })],
        });
        shell.Order.Air.ApplyAir(new StationAir
        {
            Active = true,
            AirMode = AirMode.Audience,
            Remaining = 6,
            AirSource = AirSource.Operator,
            Held = true,
            HoldUntil = DateTimeOffset.Now.AddHours(2).ToString("O", System.Globalization.CultureInfo.InvariantCulture),
        });
    }

    /// <summary>
    /// What the station says needs the operator, one row of each kind: a failure with a count, a
    /// warning about a plugin (Settings), a notice about a character (Voice), a row about the
    /// broadcast (the desk, so no link), and one naming a page this app does not have.
    /// </summary>
    public static void NeedsYou(ShellViewModel shell) => shell.Order.NeedsYou.Apply(new StationAttention
    {
        Items =
        [
            Attention(AttentionItemSeverity.Failure, "/catalog?state=benched", "4 records have no copy left that will play",
                "Every copy has been written off, so they will not air until a sync sees them again.", 4),
            Attention(AttentionItemSeverity.Warning, "/onair", "The running order runs dry before the next block",
                "It has about eighteen minutes left and nothing is scheduled to follow it."),
            Attention(AttentionItemSeverity.Warning, "/plugins/spotify", "Spotify will not start",
                "The token was refused. Reconnect it from the plugin's own page, which asks Spotify again."),
            Attention(AttentionItemSeverity.Notice, "/personas", "No caller has a voice",
                "A phone-in needs somebody to ring in, and none of the characters marked as callers has a voice to do it in."),
            Attention(AttentionItemSeverity.Notice, "/somewhere-new", "The station has something this app cannot show yet",
                "A page the station knows about and this build does not."),
        ],
    });

    private static AttentionItem Attention(AttentionItemSeverity severity, string route, string title, string detail, long? count = null) =>
        new() { Code = route, Severity = severity, Route = route, Title = title, Detail = detail, Count = count };

    /// <summary>The hosts a recast or a plan offers, one of whom is presenting.</summary>
    public static IReadOnlyList<Persona> Hosts() =>
    [
        Persona("1", "Marla Vance", defaultHost: true, presenting: true),
        Persona("2", "The Conspiracy Host, who defers to the daypart he is handed", defaultHost: false, presenting: false),
        Persona("3", "Newsreader", defaultHost: false, presenting: false),
    ];

    private static Persona Persona(string id, string label, bool defaultHost, bool presenting) => new()
    {
        Id = id,
        Key = id,
        Label = label,
        Style = string.Empty,
        DefaultHost = defaultHost,
        Presenting = presenting,
    };

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
        voice.Characters.Pose(Roster(), Voices());

        voice.Scripts.Scripts.Add(new ScriptRowViewModel(
            "11:42", "talk", "model",
            "That was Pearl Jam, and before that a record I have been trying to place all morning. "
            + "Stay where you are.",
            StatusTone.Ok));
        voice.Scripts.Scripts.Add(new ScriptRowViewModel(
            "11:39", "talk", "model", "Declined: wrong-daypart", StatusTone.Standby));
        voice.Scripts.Scripts.Add(new ScriptRowViewModel(
            "11:38", "welcome", "floor", "You're listening to Deadair.", StatusTone.Ok));
        voice.Scripts.Scripts.Add(new ScriptRowViewModel(
            "11:31", "news", "model", "The speech engine did not answer in time.", StatusTone.Fault));

        voice.Segments.Segments.Add(new SegmentRowViewModel("1", "Talk break: Jeremy into Alive", "talk", "ready", StatusTone.Ok, canPlay: true) { IsPlaying = true });
        voice.Segments.Segments.Add(new SegmentRowViewModel("2", "Station ident, evening", "ident", "ready", StatusTone.Ok, canPlay: true));
        voice.Segments.Segments.Add(new SegmentRowViewModel("3", "Talk break: Regulate into My Boo", "talk", "rendering", StatusTone.Standby, canPlay: false));
        voice.Segments.Segments.Add(new SegmentRowViewModel("4", "News bulletin, 11:30", "news", "failed", StatusTone.Fault, canPlay: false));

        voice.Productions.Productions.Add(new ProductionRowViewModel("p1", "Phone-in: the worst gig you ever went to", "callin", "drafting", true));
        voice.Productions.Productions.Add(new ProductionRowViewModel("p2", "Evening feature", "feature", "ready", false));
    }

    /// <summary>
    /// A roster with every state a card can be in: on air, the station's own while a show has its
    /// own host, a caller tied to two hosts, and a character missing everything a summary mentions.
    /// </summary>
    public static IReadOnlyList<Persona> Roster() =>
    [
        new()
        {
            Id = "1",
            Key = "marla",
            Label = "Marla Vance",
            Style = "Dry, unhurried, and never explains a joke. Speaks as though she has been up all night and is the only one who "
                + "noticed, and would rather you did not mention it either.",
            DjName = "Midnight Marla",
            Voice = "marla",
            Templates = "That was {{previous.title}}.",
            DictionMarkers = ["mm"],
            DefaultHost = false,
            Presenting = true,
        },
        new()
        {
            Id = "2",
            Key = "conspiracy",
            Label = "The Conspiracy Host, Who Has A Theory About Every Record On The Running Order",
            Style = "Certain about everything, wrong about most of it, and defers to the daypart he is handed.",
            Voice = "gravel",
            DictionMarkers = ["they"],
            DefaultHost = true,
            Presenting = false,
        },
        new() { Id = "3", Key = "newsreader", Label = "Newsreader", Style = "Flat, exact, and never editorialises.", DefaultHost = false, Presenting = false },
        new()
        {
            Id = "4",
            Key = "taxi",
            Kind = PersonaKind.Caller,
            Label = "Dennis the taxi driver",
            Style = "Rings in every week to argue about the charts, and is never once right about a release year.",
            Hosts = ["1", "2"],
            DictionMarkers = ["mate"],
            Voice = "dennis",
            DefaultHost = false,
            Presenting = false,
        },
    ];

    /// <summary>
    /// A character's notebook, shelf, timeline and a rehearsal, each with the states worth seeing: a
    /// proposal with the words it was drawn from, a story in parts with a proposed next part, a
    /// telling that was passed over and one not yet aired.
    /// </summary>
    public static void Accumulate(PersonaDetailViewModel page)
    {
        page.Notes!.Present(new PersonaNoteList
        {
            PersonaId = "1",
            Notes =
            [
                new() { Id = "n1", Kind = PersonaNoteKind.Trait, Note = "Has taken to calling the listener a night-shift colleague, and never explains why.", State = PersonaNoteState2.Suggested, Origin = PersonaNoteOrigin.Model, SourceQuote = "Stay with me, colleague. The kettle is on and the records are long tonight.", CreatedAt = "2026-09-28T02:00:00Z" },
                new() { Id = "n2", Kind = PersonaNoteKind.Said, Note = "Said she once worked the graveyard shift at a pressing plant in Hull.", State = PersonaNoteState2.Active, Origin = PersonaNoteOrigin.Model, CreatedAt = "2026-09-20T02:00:00Z" },
                new() { Id = "n3", Kind = PersonaNoteKind.Trait, Note = "Never says good morning before four.", State = PersonaNoteState2.Active, Origin = PersonaNoteOrigin.Operator, CreatedAt = "2026-09-10T02:00:00Z" },
                new() { Id = "n4", Kind = PersonaNoteKind.Trait, Note = "Hums along to the outro.", State = PersonaNoteState2.Rejected, Origin = PersonaNoteOrigin.Model, CreatedAt = "2026-09-12T02:00:00Z" },
            ],
        });

        page.Stories!.Present(new PersonaStoryList
        {
            PersonaId = "1",
            Stories =
            [
                new()
                {
                    Id = "s1", Title = "The Barstow lights", Kind = PersonaStoryKind.Arc, State = PersonaStoryState2.Active, Origin = PersonaStoryOrigin.Operator,
                    Story = "She saw three lights over the desert outside Barstow in ninety-seven. No sound at all, and gone before the tape was running.",
                    TimesTold = 2, CreatedAt = "2026-09-01T00:00:00Z",
                    Beats =
                    [
                        new() { Id = "b1", StoryId = "s1", Ordinal = 10, Beat = "The drive out, and the radio losing the station one frequency at a time.", State = PersonaStoryBeatState.Active, Origin = PersonaStoryBeatOrigin.Operator, CreatedAt = "2026-09-01T00:00:00Z" },
                        new() { Id = "b2", StoryId = "s1", Ordinal = 20, Beat = "The lights, and the tape that ran out a second too early.", State = PersonaStoryBeatState.Active, Origin = PersonaStoryBeatOrigin.Operator, CreatedAt = "2026-09-01T00:00:00Z" },
                        new() { Id = "b3", StoryId = "s1", Ordinal = 30, Beat = "Years later a caller rings in from Barstow.", State = PersonaStoryBeatState.Suggested, Origin = PersonaStoryBeatOrigin.Model, CreatedAt = "2026-09-28T00:00:00Z" },
                    ],
                    Details = [new() { Id = "d1", Detail = "It was the night of the Hale-Bopp broadcast.", State = PersonaStoryDetailState.Active, Origin = PersonaStoryDetailOrigin.Operator, CreatedAt = "2026-09-01T00:00:00Z" }],
                },
                new()
                {
                    Id = "s2", Title = "The pressing plant", Kind = PersonaStoryKind.Anecdote, State = PersonaStoryState2.Suggested, Origin = PersonaStoryOrigin.Model,
                    Story = "A whole run of a Northern Soul reissue pressed off-centre, and she kept one.", Source = "a break on 26 September",
                    TimesTold = 0, CreatedAt = "2026-09-28T00:00:00Z", Beats = [], Details = [],
                },
            ],
        });

        page.Memory!.Present(
        [
            new() { Id = "t1", StoryId = "s1", Title = "The Barstow lights", Source = PersonaTellingSource.Break, Mode = PersonaTellingMode.Told, Told = true, Said = "Ninety-seven, the desert outside Barstow, and the radio losing us one frequency at a time. Stay with me.", AiredAt = "2026-09-28T23:41:00Z", At = "2026-09-28T23:40:00Z" },
            new() { Id = "t2", StoryId = "s2", Title = "The pressing plant", Source = PersonaTellingSource.Break, Mode = PersonaTellingMode.Offered, Told = false, At = "2026-09-28T22:10:00Z" },
            new() { Id = "t3", StoryId = "s1", Title = "The Barstow lights", Source = PersonaTellingSource.Break, Mode = PersonaTellingMode.Told, Told = true, Said = "The tape ran out a second too early. It always does.", At = "2026-09-29T00:05:00Z" },
        ]);

        page.Rehearsal!.Present(new PersonaRehearsal
        {
            PersonaId = "1",
            Previous = "Alive by Pearl Jam",
            Next = "Would? by Alice In Chains",
            Script = "That was Pearl Jam, and it is later than any of us meant it to be. Alice In Chains next, and then I will tell you about the kettle.",
            Writer = "model",
            Attempts =
            [
                new() { Writer = "model", Outcome = "declined", DurationMs = 2140, Reason = "out of character: none of the words that prove it" },
                new() { Writer = "model", Outcome = "written", DurationMs = 1870, Script = "That was Pearl Jam, and it is later than any of us meant it to be. Alice In Chains next, and then I will tell you about the kettle." },
            ],
        });
    }

    /// <summary>The presenter name and the story wait, as the station declares and holds them.</summary>
    public static void CharacterSettings(CharactersViewModel characters) =>
        characters.PresentSettings(new StationSettings
        {
            Descriptors =
            [
                new() { Key = "station.djName", Label = "Presenter name", Help = "Used by any host without a name of its own, and while nobody is on air.", Type = ConfigFieldType.String, Group = SettingGroup.Personas },
                new() { Key = "personas.threadGapMinutes", Label = "Wait before returning to a story (minutes)", Help = "How long a presenter leaves a story in parts, or a running joke, before coming back to it.", Type = ConfigFieldType.Number, Group = SettingGroup.Personas },
            ],
            Values = new Dictionary<string, JsonElement>
            {
                ["station.djName"] = JsonSerializer.SerializeToElement("Night Desk"),
                ["personas.threadGapMinutes"] = JsonSerializer.SerializeToElement("90"),
            },
            Configured = [],
            Derived = [],
        });

    public static IReadOnlyList<MaroonedSoftware.Deadair.Sdk.Models.Voice> Voices() =>
    [
        new() { Id = "marla", Label = "Marla", Description = "a low, close alto with a smoker's rasp" },
        new() { Id = "gravel", Label = "Gravel", Description = "an older man, slow and certain" },
        new() { Id = "dennis", Label = "Dennis", Description = "south London, quick" },
    ];

    private static void Checkup(CheckupViewModel checkup)
    {
        var machinery = checkup.Machinery;
        machinery.HasPlayout = true;
        machinery.SilenceTone = StatusTone.Standby;
        machinery.Silence = "The station is loaded and the stream is up. It goes on air when the first listener arrives.";
        machinery.Remedy = "Press play here, or open the stream anywhere else.";
        machinery.Listeners = "0";
        machinery.Stream = "up";
        machinery.Queued = "14";
        machinery.Mounts.Add(new MountViewModel("MP3", "https://radio.example.com/live.mp3", "128 kbps"));
        machinery.Mounts.Add(new MountViewModel("FLAC", "https://radio.example.com/live-lossless-for-the-living-room.flac", "lossless"));
        machinery.StaleConfig.Add("liquidsoap: running a configuration that was replaced 2 hours ago. Restart the container to pick up the new one.");

        machinery.ReadAt = "Read at 11:48:02";
        machinery.Version = "1.42.0";
        machinery.Revision = "6ec2d2c1a4f9e0b7c3d21f4a9b8e7d6c5b4a3f21";
        machinery.Build = "Built from 6ec2d2c";
        machinery.NewerRelease = "deadair 1.43.0 is out.";
        machinery.HasBacklog = true;
        machinery.Records = "766";
        machinery.Cached = "412";
        machinery.Measured = "389";
        machinery.MeasuredPercent = 50.8;

        machinery.Attention.Add(new AttentionViewModel(
            "Four records cannot be fetched",
            "Every copy has been written off, so they will not air. Re-check them or remove them from rotation.",
            Severity.Failure,
            4));
        machinery.Attention.Add(new AttentionViewModel(
            "The speech engine is slow",
            "Two breaks took longer than their slot allowed and were dropped.",
            Severity.Warning,
            null));
        machinery.Attention.Add(new AttentionViewModel(
            "No news feeds configured",
            "The station has nothing to read a bulletin from.",
            Severity.Notice,
            null));

        machinery.HasLoops = true;
        machinery.Loops.Add(new LoopViewModel("playout.reconcile", "just now", "3h ago"));
        machinery.Loops.Add(new LoopViewModel("director.commit", "4s ago", "3h ago"));
        machinery.Loops.Add(new LoopViewModel("catalog.sweep-placeholders-and-orphaned-sources", "6h ago", "3h ago"));
        machinery.Loops.Add(new LoopViewModel("analysis.walk", "not yet", "12m ago"));

        machinery.StorageReadAt = "Read at 11:47";
        machinery.Stores.Add(new StoreViewModel("Record audio", "38.2 GB", "12,408 files", "3 unclaimed", null));
        machinery.Stores.Add(new StoreViewModel("Cover art", "412 MB", "2,211 files", null, null));
        machinery.Stores.Add(new StoreViewModel("Spoken segments and productions", "1.9 GB", "5,730 files", null, "12 missing"));
        machinery.Stores.Add(new StoreViewModel("Voices", "84 MB", "11 files", null, null));

        var history = checkup.History;
        history.Entries.Add(new ActivityViewModel("11:48:01", "playout", "Handed Alive to the player.", Severity.Notice));
        history.Entries.Add(new ActivityViewModel("11:47:58", "director", "Committed a talk break ahead of Alive, written by the late-night host with two facts about Pearl Jam's first rehearsals in Seattle and a request from Leeds.", Severity.Notice));
        history.Entries.Add(new ActivityViewModel("11:47:12", "render", "Spoke a talk break in 2.1s.", Severity.Notice));
        history.Entries.Add(new ActivityViewModel("11:46:40", "catalog", "Wikipedia returned nothing for Pearl Jam.", Severity.Warning));
        history.Entries.Add(new ActivityViewModel("11:44:03", "storage", "Measured 6 records.", Severity.Notice));
        history.Entries.Add(new ActivityViewModel("11:39:02", "playout", "Icecast stopped answering its stats endpoint, so the listener count is the last one it gave.", Severity.Failure));
        history.Entries.Add(new ActivityViewModel("28 Sep 23:51", "playout", "Stood down: nobody had listened for five minutes.", Severity.Notice));
        history.Entries.Add(new ActivityViewModel("28 Sep 23:40", "plugins", "Spotify refused a token refresh. Reconnect it under Settings.", Severity.Warning));
        history.CanLoadMore = true;

        var releases = checkup.Releases;
        releases.Loaded = true;
        releases.Checks = true;
        releases.CheckLine = "The station checks GitHub for newer releases every few hours. It last heard back 29 Sep 2026, 09:12.";
        releases.AvailableHeading = "OUT, AND NOT ON THIS STATION YET";
        releases.Available.Add(new ReleaseCardViewModel(
            "1.43.0",
            "29 Sep 2026",
            "Not installed",
            new Uri("https://github.com/robert-dean/deadair/releases/tag/v1.43.0"),
            "Minor Changes\n• 4d2e1f0: Phone-ins can be cast from the listeners who wrote in, and a caller who never answers is replaced rather than left as silence.\n\nPatch Changes\n• 9a8b7c6: The running order no longer shows a record twice after a replan."));
        releases.Notes.Add(new ReleaseCardViewModel(
            "1.42.0",
            "27 Sep 2026",
            "This station",
            null,
            "Minor Changes\n• 1a2b3c4: The check-up says what each loop last did and when it started, so a slow first pass and a stopped loop no longer look alike."));
        releases.Notes.Add(new ReleaseCardViewModel("1.41.2", "25 Sep 2026", null, null, string.Empty));
        releases.Older = 23;

        Cost(checkup.Cost);
        Logs(checkup.Logs);
    }

    /// <summary>
    /// What the station spent: a write that caused a render that caused a stitch, a failing plugin
    /// call, a page load, and a job this app has no words for yet. The write is open.
    /// </summary>
    private static void Cost(CostViewModel cost)
    {
        var at = new DateTimeOffset(2026, 9, 29, 11, 40, 0, TimeSpan.Zero);
        TraceDecision Decision(string id, string kind, string? parent, int minutes, long ms, long calls, long failed) => new()
        {
            Id = id,
            Kind = kind,
            Parent = parent,
            At = at.AddMinutes(minutes),
            Ms = ms,
            Calls = calls,
            Failed = failed,
        };

        TraceDecision[] decisions =
        [
            Decision("7c1e9a40-2b4f-4d1a-9e3c-5a6b7c8d9e0f", "director.write_break", null, 8, 19_243, 4, 0),
            Decision("a1b2c3d4-0000-4000-8000-000000000001", "render.segment", "7c1e9a40-2b4f-4d1a-9e3c-5a6b7c8d9e0f", 8, 2_140, 2, 0),
            Decision("a1b2c3d4-0000-4000-8000-000000000002", "render.stitch_production", "a1b2c3d4-0000-4000-8000-000000000001", 8, 412, 1, 0),
            Decision("a1b2c3d4-0000-4000-8000-000000000003", "catalog.enrich", null, 6, 125_600, 9, 2),
            Decision("a1b2c3d4-0000-4000-8000-000000000004", "GET /voices", null, 5, 38, 1, 0),
            Decision("a1b2c3d4-0000-4000-8000-000000000005", "podcasts.fetch_episode_enclosures_for_every_carried_show", null, 2, 0, 0, 0),
        ];

        var now = at.AddMinutes(10);
        foreach (var placed in MaroonedSoftware.Deadair.Desktop.Core.Checkup.TraceWords.Forest(decisions))
        {
            var decision = placed.Decision;
            cost.Decisions.Add(new DecisionRowViewModel(
                decision.Id,
                MaroonedSoftware.Deadair.Desktop.Core.Checkup.CheckupWords.Moment(now, decision.At),
                MaroonedSoftware.Deadair.Desktop.Core.Checkup.TraceWords.Describe(decision.Kind),
                decision.Kind,
                placed.Depth,
                MaroonedSoftware.Deadair.Desktop.Core.Checkup.TraceWords.Cost(decision.Ms),
                decision.Calls,
                decision.Failed));
        }

        var open = cost.Decisions[0];
        CostViewModel.Fill(open, new TraceDetail
        {
            Decision = decisions[0],
            Caused = [decisions[1]],
            Spans =
            [
                new TraceSpan { At = at, Op = "llm.generate", Target = "claude-sonnet via the station's own key", Ms = 17_802, Outcome = TraceOutcome.Ok,
                    Detail = new() { ["inputTokens"] = JsonDocument.Parse("12408").RootElement, ["outputTokens"] = JsonDocument.Parse("389").RootElement, ["finish"] = JsonDocument.Parse("\"end_turn\"").RootElement } },
                new TraceSpan { At = at, Op = "plugin.facts", Target = "wikipedia", Ms = 1_204, Outcome = TraceOutcome.Failed,
                    Error = "The request timed out after 1200ms, so the break was written without the facts it asked for." },
                new TraceSpan { At = at, Op = "db.query", Ms = 3, Outcome = TraceOutcome.Ok },
            ],
        });
        cost.Selected = open;
        cost.Showing = MaroonedSoftware.Deadair.Desktop.Core.Checkup.TraceWords.Showing(cost.Decisions.Count, 1318, 5204);
    }

    /// <summary>The station's own log, graded, with a warning and an error among ordinary lines.</summary>
    private static void Logs(LogsViewModel logs)
    {
        var station = new LogSource
        {
            Id = "station",
            Label = "Station",
            Description = "What the station itself wrote: every request, job and decision, at every level.",
            Present = true,
            Levels = true,
            Bytes = 3_565_158,
            LastWriteAt = new DateTimeOffset(2026, 9, 29, 11, 48, 1, TimeSpan.Zero),
        };
        var liquidsoap = new LogSource
        {
            Id = "liquidsoap",
            Label = "Audio chain (Liquidsoap)",
            Description = "What the audio chain wrote.",
            Present = false,
            Levels = false,
            Bytes = 0,
        };

        logs.Sources.Add(new LogSourceViewModel(station, MaroonedSoftware.Deadair.Desktop.Core.Checkup.LogWords.Offered(station)));
        logs.Sources.Add(new LogSourceViewModel(liquidsoap, MaroonedSoftware.Deadair.Desktop.Core.Checkup.LogWords.Offered(liquidsoap)));
        logs.Source = logs.Sources[0];
        logs.Level = logs.Levels[0];

        logs.Lines.Add(new LogLineViewModel("12:48:01", "[info] playout: handed 3f2a0c1e (Alive) to the player", null));
        logs.Lines.Add(new LogLineViewModel("12:47:58", "[debug] director: committed talk break 91be4c7d ahead of 3f2a0c1e, 214 words, persona late-night", null));
        logs.Lines.Add(new LogLineViewModel("12:46:40", "[warn] plugins: wikipedia answered 429 for https://en.wikipedia.org/api/rest_v1/page/summary/Pearl_Jam_(band_from_Seattle,_Washington) and will be asked again in 60s", Severity.Warning));
        logs.Lines.Add(new LogLineViewModel("12:39:02", "[error] playout: icecast stats endpoint refused the connection (ECONNREFUSED 127.0.0.1:8000)", Severity.Failure));
        logs.Lines.Add(new LogLineViewModel("12:38:55", "[info] render: spoke segment 91be4c7d in 2.1s", null));
        logs.TailProblem = null;
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
        library.Charts.Charts.Add(new ChartRowViewModel("uk-singles", "Official Singles Chart Top 100 (GB)", "officialcharts", "The UK's biggest songs of the week, counted from sales and streams, published every Friday."));
        library.Charts.Charts.Add(new ChartRowViewModel("hot-100", "Billboard Hot 100 (US)", "billboard"));

        // A page the station might answer with: every combination of what it holds, a record with
        // no release and no length, a title that has to trim, and both kinds of opinion.
        library.Records.Present(new TrackPage
        {
            Meta = new Pagination { Total = 766, PageSize = 50 },
            States = new TrackStateCounts { Total = 766, Cached = 412, Measured = 389, Enriched = 701, Benched = 3, Failing = 0 },
            Data =
            [
                Track("Alive", "Pearl Jam", "Ten", 341_000, 1991, Rating.Liked, audio: true, measured: true, enriched: true),
                Track("Black", "Pearl Jam", "Ten", 343_000, 1991, Rating.Neutral, audio: true, measured: false, enriched: true),
                Track("Regulate (feat. Nate Dogg) - Original Version", "Warren G, Nate Dogg", "Regulate: G Funk Era", 248_000, 1994, Rating.Neutral, audio: false, measured: false, enriched: true),
                Track("Would?", "Alice In Chains", "Dirt", 208_000, 1992, Rating.Disliked, audio: true, measured: true, enriched: false),
                Track("Rooster", "Alice In Chains", "Dirt", 375_000, 1992, Rating.Neutral, audio: false, measured: false, enriched: false),
                Track("Untitled demo, recorded in the rehearsal room above the laundrette", "Mother Love Bone", null, null, null, Rating.Neutral, audio: false, measured: false, enriched: false),
                Track("Outshined", "Soundgarden", "Badmotorfinger", 311_000, 1991, Rating.Liked, audio: true, measured: true, enriched: true),
            ],
        });
        library.Records.Total = 766;
        library.Records.Summary = "1–50 of 766";

        library.Acts.Artists.Add(Act("Pearl Jam", 11, 142, Rating.Liked));
        library.Acts.Artists.Add(Act("Alice In Chains", 6, 71, Rating.Neutral));
        library.Acts.Artists.Add(Act("Godspeed You! Black Emperor and the long name that has to trim", 1, 1, Rating.Disliked));
        library.Acts.Artists.Add(Act("Soundgarden", 7, 88, Rating.Neutral));
        // Three feeds, two of them filed under a category, and stories with and without a teaser.
        library.News.PresentFeeds(new StationFeedList
        {
            Feeds =
            [
                new() { Id = "rss:bbc-world", PluginId = "rss", Name = "BBC World", Category = "World", Language = "en" },
                new() { Id = "rss:pitchfork", PluginId = "rss", Name = "Pitchfork: the long name of a music news feed", Category = "Music", Language = "en" },
                new() { Id = "rss:local", PluginId = "rss", Name = "The Evening Post" },
            ],
        });
        library.News.PresentStories(new NewsPage
        {
            Stories =
            [
                Story("rss:bbc-world", "BBC World", "Storm closes three airports as the coast braces for a second night of high winds", "Flights were grounded across the region and ferry crossings cancelled until at least Thursday morning.", ["weather"]),
                Story("rss:pitchfork", "Pitchfork", "A lost Mother Love Bone session turns up in a Seattle attic", null, ["music", "reissues"]),
                Story("rss:local", "The Evening Post", "Council approves the late licence for the old picture house", "The venue can open until two on Fridays and Saturdays from next month.", null),
            ],
        });

        // Two shows, an episode in each state worth seeing, and a directory search with one show the
        // station already carries.
        library.Podcasts.PresentShows(new StationShowList
        {
            Shows =
            [
                new() { Id = "s1", PluginId = "podcast", Title = "The Rest Is History", FeedUrl = "https://feeds.example.org/history" },
                new() { Id = "s2", PluginId = "podcast", Title = "Song Exploder", FeedUrl = "https://feeds.example.org/exploder" },
            ],
        });
        library.Podcasts.PresentEpisodes(new StationEpisodePage
        {
            Episodes =
            [
                Episode("The Rest Is History", "The fall of the Roman Republic, part three: the long and bitter road to the Rubicon", "Tom and Dominic follow Caesar across the river and into civil war.", fetched: true, error: null, scheduled: "2026-09-29T21:00:00Z"),
                Episode("Song Exploder", "Massive Attack: Teardrop", null, fetched: false, error: "The host answered 404 for the enclosure", scheduled: null),
                Episode("Song Exploder", "Portishead: Roads", "How a record made in a Bristol studio became the sound of a decade.", fetched: false, error: null, scheduled: null),
            ],
        });
        library.Podcasts.PresentResults(new StationDirectoryPage
        {
            Results =
            [
                new() { Id = "d1", PluginId = "podcast", Title = "Song Exploder", Author = "Hrishikesh Hirway", FeedUrl = "https://feeds.example.org/exploder" },
                new() { Id = "d2", PluginId = "podcast", Title = "Switched on Pop: the long-running show about how pop music works", Author = "Vulture", FeedUrl = "https://feeds.example.org/switched-on-pop/a/very/long/path/that/must/trim" },
            ],
        });

        // A serial and a column, with a piece in each state worth seeing, one of them withdrawn and one
        // that failed with the station's own long reason.
        library.Narrations.PresentSeries(new StationSeriesList
        {
            Series =
            [
                new() { Id = "n1", PluginId = "gutenberg", Title = "Great Expectations", Order = StationSeriesOrder.Serial },
                new() { Id = "n2", PluginId = "rss", Title = "The Sunday column", Order = StationSeriesOrder.Latest },
            ],
        });
        library.Narrations.PresentPieces(new StationPiecePage
        {
            Pieces =
            [
                Piece("Great Expectations", "Chapter VII", 6, 4_812, rendered: true, error: null, withdrawn: null, aired: null),
                Piece("Great Expectations", "Chapter VIII", 7, 5_390, rendered: false, error: "The station has no mixer configured, so a reading longer than one take could not be joined. Set the render mixer in Settings, then read it again.", withdrawn: null, aired: null),
                Piece("The Sunday column", "Why nobody listens to the radio any more, and why they are wrong", null, 1_204, rendered: false, error: null, withdrawn: "2026-09-27T09:00:00Z", aired: null),
                Piece("Great Expectations", "Chapter VI", 5, 3_975, rendered: true, error: null, withdrawn: null, aired: "2026-09-28T21:00:00Z"),
            ],
        });

        library.Acts.Total = 212;
        library.Acts.Summary = "1–50 of 212";

        // Two of the station's own (one with records still to find), a source's own list, one it
        // will not share, one it made itself, one somebody hid, and a source that could not answer.
        library.Playlists.Present(
            new CatalogPlaylistPage
            {
                Playlists =
                [
                    SourceList("navidrome", "Navidrome", "Wednesday mornings, the long version with everything nobody asked for", 142),
                    SourceList("ytmusic", "YouTube Music", "Liked music", 1_204),
                    SourceList("spotify", "Spotify", "Discover Weekly", 30) with { Permissions = [] },
                    SourceList("ytmusic", "YouTube Music", "Your Supermix", 50) with { MadeByProvider = true },
                    SourceList("navidrome", "Navidrome", "Christmas", 64) with { Hidden = true },
                ],
                Errors = [new() { PluginId = "deezer", PluginName = "Deezer", Message = "The account's session has expired; sign in again in its settings." }],
            },
            new StationPlaylistList
            {
                Playlists =
                [
                    Own("Late and loud", 88, 88, null, "Everything after eleven, nothing gentle."),
                    Own("Imported from the old station", 212, 180, "navidrome", string.Empty),
                ],
            });
    }

    private static StationEpisode Episode(string show, string title, string? summary, bool fetched, string? error, string? scheduled) => new()
    {
        Id = Guid.NewGuid().ToString(),
        ShowId = "s1",
        EpisodeId = Guid.NewGuid().ToString(),
        ShowTitle = show,
        Title = title,
        Summary = summary,
        Url = "https://example.org/episode",
        PublishedAt = DateTimeOffset.Now.AddDays(-2).ToString("O", System.Globalization.CultureInfo.InvariantCulture),
        DurationMs = 3_540_000,
        Explicit = error is not null,
        SeenAt = DateTimeOffset.Now.AddDays(-2).ToString("O", System.Globalization.CultureInfo.InvariantCulture),
        Fetched = fetched,
        FetchError = error,
        ScheduledFor = scheduled,
    };

    private static StationPiece Piece(string series, string title, long? ordinal, long words, bool rendered, string? error, string? withdrawn, string? aired) => new()
    {
        Id = Guid.NewGuid().ToString(),
        SeriesId = "n1",
        PieceId = Guid.NewGuid().ToString(),
        SeriesTitle = series,
        Title = title,
        Order = ordinal is null ? StationPieceOrder.Latest : StationPieceOrder.Serial,
        Ordinal = ordinal,
        WordCount = words,
        SeenAt = "2026-09-20T00:00:00Z",
        Rendered = rendered,
        Rendering = false,
        RenderError = error,
        WithdrawnAt = withdrawn,
        AiredAt = aired,
    };

    private static NewsStory Story(string feed, string feedName, string title, string? summary, List<string>? categories) => new()
    {
        Id = Guid.NewGuid().ToString(),
        FeedId = feed,
        FeedName = feedName,
        Title = title,
        Summary = summary,
        Url = "https://example.org/story",
        PublishedAt = DateTimeOffset.Now.AddMinutes(-47).ToString("O", System.Globalization.CultureInfo.InvariantCulture),
        Categories = categories,
    };

    private static CatalogPlaylist SourceList(string plugin, string pluginName, string name, long tracks) => new()
    {
        PluginId = plugin,
        PluginName = pluginName,
        Id = Guid.NewGuid().ToString(),
        Name = name,
        TrackCount = tracks,
        Description = "Posed for a frame.",
    };

    private static StationPlaylist Own(string name, long tracks, long held, string? origin, string prompt) => new()
    {
        Id = Guid.NewGuid().ToString(),
        Name = name,
        Prompt = prompt,
        OriginPluginId = origin,
        TrackCount = tracks,
        ResolvedCount = held,
        CreatedAt = DateTimeOffset.Now.AddDays(-3),
        UpdatedAt = DateTimeOffset.Now,
    };

    /// <summary>A station playlist with records held and records still to be looked up.</summary>
    public static void OwnPlaylist(StationPlaylistDetailViewModel page) => page.Present(
        new StationPlaylistDetail
        {
            Id = Guid.NewGuid().ToString(),
            Name = "Imported from the old station",
            Prompt = "Everything the old station played on a Sunday night, kept so the two can be compared.",
            OriginPluginId = "navidrome",
            TrackCount = 5,
            ResolvedCount = 3,
            CreatedAt = DateTimeOffset.Now.AddDays(-3),
            UpdatedAt = DateTimeOffset.Now,
            Tracks =
            [
                Entry(0, "Teardrop", "Massive Attack", "Mezzanine", 330_000, held: true),
                Entry(1, "Roads", "Portishead", "Dummy", 305_000, held: true),
                Entry(2, "A record with a title long enough that it has to trim before the artist", "Somebody, Somebody Else", null, null, held: false),
                Entry(3, "Unfinished Sympathy", "Massive Attack", "Blue Lines", 308_000, held: true),
                Entry(4, "Glory Box", "Portishead", "Dummy", null, held: false),
            ],
        },
        origin: "Navidrome");

    private static StationPlaylistTrack Entry(long position, string title, string artist, string? album, long? ms, bool held) => new()
    {
        Id = Guid.NewGuid().ToString(),
        Position = position,
        Title = title,
        Artists = [artist],
        Album = album,
        DurationMs = ms,
        TrackId = held ? Guid.NewGuid().ToString() : null,
    };

    /// <summary>An import previewed: most records held, some to look up, and a notice about the file.</summary>
    public static void Previewed(PlaylistImportDialogViewModel dialog) => dialog.Present(
        new PlaylistImportInput { Text = "posed" },
        new PlaylistImportPlan
        {
            Name = "Sunday night",
            Matched = 3,
            ToAdd = 0,
            ToLookUp = 2,
            Skipped = 1,
            Notices = ["One line was not a record and was left out: \"#EXTM3U\"."],
            Entries =
            [
                new() { Position = 0, Title = "Teardrop", Artists = ["Massive Attack"], Outcome = PlaylistImportEntryOutcome.Matched },
                new() { Position = 1, Title = "Roads", Artists = ["Portishead"], Outcome = PlaylistImportEntryOutcome.Matched },
                new() { Position = 2, Title = "A record with a title long enough that it has to trim in the dialog", Artists = ["Somebody", "Somebody Else"], Outcome = PlaylistImportEntryOutcome.ToLookUp },
                new() { Position = 3, Title = "Unfinished Sympathy", Artists = ["Massive Attack"], Outcome = PlaylistImportEntryOutcome.Matched },
                new() { Position = 4, Title = "Glory Box", Artists = ["Portishead"], Outcome = PlaylistImportEntryOutcome.ToLookUp },
            ],
        });

    private static TrackRow Track(string title, string artists, string? album, long? ms, long? year, Rating rating, bool audio, bool measured, bool enriched) => new()
    {
        Id = Guid.NewGuid(),
        Title = title,
        ArtistId = Guid.NewGuid(),
        ArtistName = artists,
        Artists = artists,
        AlbumId = album is null ? null : Guid.NewGuid(),
        AlbumName = album,
        DurationMs = ms,
        Year = year,
        Rating = rating,
        HasAudio = audio,
        Measured = measured,
        Enriched = enriched,
    };

    private static ArtistRowViewModel Act(string name, long albums, long tracks, Rating rating) =>
        new(Guid.NewGuid(), name, albums, tracks, null, RatingViewModel.Fixed(rating, name));

    /// <summary>
    /// A record with every kind of copy, a failed measurement, a handful of airings and a provider
    /// that could not be asked: the page somebody opens to find out why a record will not play.
    /// </summary>
    public static void Track(TrackDetailViewModel page)
    {
        var now = DateTimeOffset.Now;
        page.Present(new TrackDetail
        {
            Id = Guid.NewGuid(),
            Title = "Regulate (feat. Nate Dogg) - Original Version",
            ArtistId = Guid.NewGuid(),
            ArtistName = "Warren G",
            Artists = "Warren G, Nate Dogg",
            AlbumId = Guid.NewGuid(),
            AlbumName = "Regulate: G Funk Era",
            Year = 1994,
            DurationMs = 248_000,
            Rating = Rating.Liked,
            PlayCount = 14,
            Bindings =
            [
                new() { SourceId = Guid.NewGuid(), PluginId = "navidrome", ExternalId = "tr-1f0c2a9e8b7d4c3a", Playable = true, Origin = "playlist", Attempts = 0, Format = "flac", Bitrate = 912_000, ByteSize = 27_400_000, FetchedAt = now.AddDays(-2), LastServedAt = now.AddHours(-5) },
                new() { SourceId = Guid.NewGuid(), PluginId = "ytmusic", ExternalId = "dQw4w9WgXcQ", Playable = true, Origin = "discovered", Attempts = 3, LastError = "The provider answered 429 Too Many Requests", NextAttemptAt = now.AddMinutes(40) },
                new() { SourceId = Guid.NewGuid(), PluginId = "spotify", ExternalId = "spotify:track:3VA8T3rNy5V24AXxNK5u9E", Playable = false, Origin = "playlist", Attempts = 0 },
            ],
            Analysis = new TrackAnalysis
            {
                SchemaVersion = 3,
                Complete = false,
                Analyzer = "analysis sidecar 2.4",
                AnalyzedAt = now.AddDays(-1),
                FailedAt = now.AddDays(-1),
                FailureReason = "The download ended 41 seconds in, so the tail could not be measured.",
            },
            Plays =
            [
                new() { AiredAt = now.AddHours(-5), Source = "director" },
                new() { AiredAt = now.AddDays(-1).AddHours(-3), Source = "request" },
                new() { AiredAt = now.AddDays(-4), Source = "chart" },
            ],
        });

        page.Enrichment.Reading = EnrichmentReading.From(new TrackEnrichmentDetail
        {
            TrackId = Guid.NewGuid(),
            Merged = new TrackEnrichmentData
            {
                Genres = ["g-funk", "west coast hip hop"],
                Moods = ["laid back"],
                ReleaseDate = "1994-04-26",
                Label = "Death Row / Interscope",
                Bpm = 95,
                MusicalKey = "D minor",
                Isrc = "USUM79400123",
                Facts = ["Recorded for the Above the Rim soundtrack before it was a single."],
                Links = [new() { Label = "Wikipedia", Url = "https://en.wikipedia.org/wiki/Regulate_(song)" }],
            },
            Sources =
            [
                new() { Provider = "musicbrainz", FetchedAt = now.AddDays(-30), Stale = false, Found = true, Failed = false, Data = new TrackEnrichmentData() },
                new() { Provider = "lastfm", FetchedAt = now.AddDays(-30), Stale = true, Found = false, Failed = true, Data = new TrackEnrichmentData() },
            ],
            Claims =
            [
                new()
                {
                    Id = Guid.NewGuid(),
                    Claim = "It samples Michael McDonald's I Keep Forgettin' (Every Time You're Near).",
                    Category = "sample",
                    Source = "model",
                    SourceProvider = "wikipedia",
                    SourceUrl = "https://en.wikipedia.org/wiki/Regulate_(song)",
                    SourceQuote = "The song samples Michael McDonald's 1982 single \"I Keep Forgettin' (Every Time You're Near)\".",
                },
            ],
        });
    }

    /// <summary>An act with a biography long enough to fold, and releases to list.</summary>
    public static void Artist(ArtistDetailViewModel page)
    {
        page.Present(new Artist { Id = Guid.NewGuid(), Name = "Alice In Chains", AlbumCount = 6, TrackCount = 71, Rating = Rating.Neutral });
        page.Present(new AlbumPage
        {
            Meta = new Pagination { Total = 6 },
            Data =
            [
                Release("Facelift", 1990, 12, Rating.Neutral),
                Release("Dirt", 1992, 13, Rating.Liked),
                Release("Jar Of Flies", 1994, 7, Rating.Neutral),
                Release("Alice In Chains (the one with the three-legged dog on the cover)", 1995, 12, Rating.Disliked),
            ],
        });
        page.Enrichment.Reading = EnrichmentReading.From(new ArtistEnrichmentDetail
        {
            ArtistId = Guid.NewGuid(),
            Merged = new ArtistEnrichmentData
            {
                Genres = ["grunge", "alternative metal", "sludge"],
                Biography = "Alice in Chains is an American rock band from Seattle, Washington, formed in 1987 by guitarist and vocalist Jerry Cantrell and drummer Sean Kinney, who recruited bassist Mike Starr and lead vocalist Layne Staley. The band's sound, drawn from heavy metal as much as from the punk that shaped its neighbours, set it apart from the rest of the city's scene, and the harmonies between Staley and Cantrell became its signature. It has released six studio albums, three EPs, three live albums, four compilations, two DVDs, 43 music videos and 32 singles.",
            },
            Sources = [new() { Provider = "lastfm", FetchedAt = DateTimeOffset.Now.AddDays(-12), Stale = false, Found = true, Failed = false, Data = new ArtistEnrichmentData() }],
            Claims = [],
        });
    }

    private static Album Release(string name, long year, long tracks, Rating rating) =>
        new() { Id = Guid.NewGuid(), Name = name, ArtistId = Guid.NewGuid(), ArtistName = "Alice In Chains", Year = year, TrackCount = tracks, Rating = rating };

    /// <summary>A chart's first places, with a featured artist and a record that has no run.</summary>
    public static void Chart(ChartDetailViewModel chart)
    {
        chart.Places.Clear();
        chart.Places.Add(new ChartPlaceViewModel("1", "Espresso", "Sabrina Carpenter", "Short n' Sweet, 2024", "peak 1 · 38 wk"));
        chart.Places.Add(new ChartPlaceViewModel("2", "Die With A Smile", "Lady Gaga feat. Bruno Mars", null, "peak 1 · 21 wk"));
        chart.Places.Add(new ChartPlaceViewModel("3", "Birds of a Feather", "Billie Eilish", "Hit Me Hard and Soft, 2024", "peak 2 · 40 wk"));
        chart.Places.Add(new ChartPlaceViewModel("4", "A Bar Song (Tipsy) - Remix with a title long enough to trim", "Shaboozey", null, string.Empty));
        chart.Summary = "4 records";
        chart.CanAir = true;
    }

    private static void Programme(ProgrammeViewModel programme)
    {
        // The week: weekdays, one day, a block running past midnight, one ending at midnight, and the
        // one on air with a name long enough to trim.
        programme.Timetable.Present(
            new ScheduleSlotList
            {
                Slots =
                [
                    Slot("1", "Breakfast", 360, 600, "Bright, and nothing anybody has to think about.", "p1") with { Days = [1, 2, 3, 4, 5] },
                    Slot("2", "Wednesday mornings with a name long enough to have to trim at the minimum window", 600, 780, "Something with guitars, nothing after 1999, and nothing anybody would call a ballad.", "p1"),
                    Slot("3", "The late one", 1380, 0, null, null) with { Days = [] },
                    Slot("6", "Overnight", 60, 300, "Quiet, instrumental, and long.", null) with { Days = [0, 6] },
                    Slot("7", "Friday night", 1260, 120, null, "p2") with { Days = [5] },
                ],
            },
            airing: "2");

        // The boundary rule as the station declares it, with the cut switched on.
        programme.Timetable.Overrun.Present(new StationSettings
        {
            Descriptors =
            [
                Setting("schedule.capOverrun", "Start shows on time", "When a block starts, the record already playing is left to finish, however long it is. Turn this on and a record still going the number of minutes below into the new block is cut, the way the Skip button cuts.", ConfigFieldType.Boolean, SettingGroup.Schedule),
                Setting("schedule.overrunMinutes", "Let a record run into the next show for (minutes)", "Most records end well inside five minutes, so only the long ones are ever cut. Zero cuts whatever is playing the moment the block starts.", ConfigFieldType.Number, SettingGroup.Schedule) with { Min = 0, Max = 60 },
            ],
            Values = new Dictionary<string, JsonElement>
            {
                ["schedule.capOverrun"] = JsonSerializer.SerializeToElement("true"),
                ["schedule.overrunMinutes"] = JsonSerializer.SerializeToElement("5"),
            },
            Configured = [],
            Derived = [],
        });

        // The strip, posed from a reading as the station sends it: a block held past its slot, so the
        // first cell says Due now and carries the sentence explaining why.
        List<ScheduleSlot> slots =
        [
            Slot("2", "Wednesday mornings with a name long enough to have to trim at the minimum window", 600, 780, "Something with guitars, nothing after 1999, and nothing anybody would call a ballad.", "p1"),
            Slot("4", "Lunch", 780, 840, null, null),
            Slot("5", "The afternoon", 840, 1020, "Warm and unhurried.", "p2"),
        ];
        programme.Today.PresentOnNow(
            new ScheduleNow
            {
                Now = "2026-09-30 11:12:00",
                SlotId = "2",
                AiringSlotId = "1",
                Upcoming =
                [
                    new() { SlotId = "2", Label = slots[0].Label, Start = "2026-09-30 10:00:00", End = "2026-09-30 13:00:00" },
                    new() { SlotId = "4", Label = "Lunch", Start = "2026-09-30 13:00:00", End = "2026-09-30 14:00:00" },
                    new() { SlotId = "5", Label = "The afternoon", Start = "2026-09-30 14:00:00", End = "2026-09-30 17:00:00" },
                ],
            },
            slots,
            [Persona("p1", "Marla Vance"), Persona("p2", "The Night Owl")]);

        // Every shape a band takes: hourly, once a day, a spacing rule, one switched off, one about a
        // subject, and one nothing on the station can make.
        programme.Today.PresentClock(new ClockBandList
        {
            ProducibleKinds = ["news", "ident", "weather", "talk", "welcome"],
            Bands =
            [
                Band("b1", "ident", ClockBandAt.Clock, null, 0, null, 0, true, null),
                Band("b2", "news", ClockBandAt.Clock, null, 30, null, 1, true, "Technology and the internet"),
                Band("b3", "weather", ClockBandAt.Clock, null, 55, null, 2, true, null),
                Band("b4", "sponsor", ClockBandAt.Clock, null, 20, null, 3, true, null),
                Band("b5", "news", ClockBandAt.Clock, 9, 0, null, 4, false, null),
                Band("b6", "talk", ClockBandAt.Interval, null, null, 20 * 60_000, 5, true, null),
            ],
        });

        // Between blocks: a chart counting down, with words, a period and calls, as the station
        // declares and holds them.
        programme.Sustaining.Settings.Present(new StationSettings
        {
            Descriptors =
            [
                Setting("schedule.sustainingBrief", "Asked to play", "In your own words, for the model that chooses records, exactly as a block's own brief works.", ConfigFieldType.Text, SettingGroup.Schedule),
                Setting("schedule.sustainingEraFrom", "From year", "The period played between blocks, as a four-digit year.", ConfigFieldType.Number, SettingGroup.Schedule),
                Setting("schedule.sustainingEraTo", "To year", "The other end, on the same terms.", ConfigFieldType.Number, SettingGroup.Schedule),
                Setting("schedule.sustainingCallins", "Take calls", "Whether somebody phones in between blocks, exactly as a block that takes calls does.", ConfigFieldType.Boolean, SettingGroup.Schedule),
            ],
            Values = new Dictionary<string, JsonElement>
            {
                ["schedule.sustainingChartId"] = JsonSerializer.SerializeToElement("lastfm:top"),
                ["schedule.sustainingBrief"] = JsonSerializer.SerializeToElement("Nothing too loud after midnight, and nothing anybody would have to turn down in an open-plan office."),
                ["schedule.sustainingEraFrom"] = JsonSerializer.SerializeToElement("1985"),
                ["schedule.sustainingCallins"] = JsonSerializer.SerializeToElement("true"),
            },
            Configured = [],
            Derived = [],
        });
        programme.Sustaining.Offer(
            [new CatalogPlaylist { PluginId = "spotify", PluginName = "Spotify", Id = "dw", Name = "Discover Weekly" }],
            [new StationChart { Id = "lastfm:top", PluginId = "lastfm", Name = "Top 40 this week" }]);
        programme.Sustaining.IsOpen = true;

        // Every state a request can be in, with a dedication long enough to wrap and a reason.
        programme.Requests.Present(
        [
            Request("Northern Sky", "Nick Drake", "Sam from the late shift", RequestStatus.Waiting, RequestSource.Chat, "Ellie", "Because you always put this on when the rain starts, and it is raining."),
            Request("Harvest Moon", "Neil Young", "Priya", RequestStatus.Pending, RequestSource.App, null, null),
            Request("Pink Moon", "Nick Drake", "Tom", RequestStatus.Queued, RequestSource.App, "my brother", null),
            Request("A Song With A Title Long Enough That It Has To Trim Before The Column Ends", "Somebody", "A listener whose name is also long", RequestStatus.Waiting, RequestSource.App, null, null),
            Request("Wonderwall", "Oasis", "Jo", RequestStatus.Declined, RequestSource.Chat, null, null) with { Reason = "Not tonight." },
        ]);
    }

    private static ListenerRequest Request(string title, string artist, string by, RequestStatus status, RequestSource source, string? dedicateTo, string? message) => new()
    {
        Id = Guid.NewGuid(),
        Title = title,
        Artist = artist,
        RequesterName = by,
        Status = status,
        Source = source,
        CreatedAt = new DateTimeOffset(2026, 9, 30, 10, 42, 0, TimeSpan.Zero),
        DedicateTo = dedicateTo,
        Message = message,
    };

    private static ScheduleSlot Slot(string id, string label, long start, long end, string? brief, string? persona) => new()
    {
        Id = id,
        Label = label,
        StartsAtMinutes = start,
        EndsAtMinutes = end,
        Days = [3],
        Brief = brief,
        PersonaId = persona,
        Mode = ScheduleSlotMode.Rotation,
        OnEnd = ScheduleSlotOnEnd.Extend,
    };

    private static Persona Persona(string id, string label) => new()
    {
        Id = id,
        Key = id,
        Label = label,
        Style = string.Empty,
        DefaultHost = false,
        Presenting = false,
    };

    private static ClockBand Band(string id, string kind, ClockBandAt at, long? hour, long? minute, long? everyMs, long position, bool enabled, string? topic) => new()
    {
        Id = id,
        Kind = kind,
        At = at,
        Hour = hour,
        Minute = minute,
        EveryMs = everyMs,
        Position = position,
        Enabled = enabled,
        TopicId = topic is null ? null : "t1",
        TopicLabel = topic,
    };

    private static void Settings(SettingsViewModel settings)
    {
        settings.ApplyMounts(
        [
            new() { Format = NowPlayingMountFormat.Mp3, Path = "/live.mp3", BitrateKbps = 128 },
            new() { Format = NowPlayingMountFormat.Hls, Path = "/hls/live.m3u8" },
        ]);

        // Every value the station holds is TEXT, whatever its declared type: a switch travels as the
        // word `true` and a number as its digits. A list is a JSON array in a string.
        settings.Present(new StationSettings
        {
            Descriptors =
            [
                Setting("playout.airMode", "Air mode", "Audience: the station goes on air when somebody connects.", ConfigFieldType.Boolean, SettingGroup.Playout),
                Setting("playout.linger", "Linger after the last listener", "Milliseconds. Five minutes by default.", ConfigFieldType.Number, SettingGroup.Playout),
                Setting("storage.cap", "Audio cache limit", "Records beyond this are let go, oldest first.", ConfigFieldType.Number, SettingGroup.Playout) with { Unit = ConfigFieldUnit.Bytes },
                Setting("mail.host", "SMTP server", "The mail server the station signs people in through.", ConfigFieldType.String, SettingGroup.Mail),
                Setting("mail.password", "Password", "Never sent back. An empty box leaves it alone.", ConfigFieldType.Secret, SettingGroup.Mail),
                Setting("mail.security", "Security", null, ConfigFieldType.Select, SettingGroup.Mail) with
                {
                    Options = [new() { Value = "starttls", Label = "STARTTLS" }, new() { Value = "tls", Label = "TLS" }, new() { Value = "none", Label = "None" }],
                },
                Setting("breaks.feeds", "Bulletin feeds", "Where the news comes from, one row per feed.", ConfigFieldType.List, SettingGroup.Bulletins) with
                {
                    Columns =
                    [
                        new() { Key = "name", Label = "Name", Type = ConfigFieldColumnType.String },
                        new() { Key = "url", Label = "Address", Type = ConfigFieldColumnType.Url },
                    ],
                },
            ],
            Values = new Dictionary<string, JsonElement>
            {
                ["playout.airMode"] = JsonSerializer.SerializeToElement("true"),
                ["playout.linger"] = JsonSerializer.SerializeToElement("300000"),
                ["storage.cap"] = JsonSerializer.SerializeToElement("50000000000"),
                ["mail.host"] = JsonSerializer.SerializeToElement("smtp.example.org"),
                ["mail.security"] = JsonSerializer.SerializeToElement("starttls"),
                ["breaks.feeds"] = JsonSerializer.SerializeToElement(
                    """[{"name":"BBC World","url":"https://feeds.bbci.co.uk/news/world/rss.xml"},{"name":"A long feed name that has to fit","url":"https://example.org/rss"}]"""),
            },
            Configured = new Dictionary<string, bool> { ["mail.password"] = true },
            Derived = [],
        });
    }

    /// <summary>One declared setting. The station's half of Settings is drawn entirely from these.</summary>
    private static StationSettingDescriptor Setting(string key, string label, string? help, ConfigFieldType type, SettingGroup group) =>
        new() { Key = key, Label = label, Help = help, Type = type, Group = group };

    public static HttpClient Http() => new(new Refuses());

    /// <summary>A settings store that keeps nothing, for a frame that builds its own view model.</summary>
    public static ISettingsStore Settings() => new MemorySettings();

    /// <summary>A file picker nobody answers: a shot never opens a panel.</summary>
    private sealed class NoFiles : MaroonedSoftware.Deadair.Desktop.Services.IFilePicker
    {
        public Task<MaroonedSoftware.Deadair.Desktop.Services.PickedFile?> OpenAsync(string title, IReadOnlyList<string> patterns) =>
            Task.FromResult<MaroonedSoftware.Deadair.Desktop.Services.PickedFile?>(null);

        public Task<bool> SaveAsync(string title, string suggestedName, byte[] data) => Task.FromResult(false);
    }

    private sealed class Refuses : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
    }

    /// <summary>
    /// Two plugins that are not installed: one working with settings to fill in, one that could not
    /// be loaded at all.
    /// </summary>
    /// <remarks>
    /// The broken one is the point. A row that could not be drawn is exactly the row somebody is
    /// looking at the page for, and a card posed with two happy plugins would never show whether
    /// there is room for the sentence that says what went wrong.
    /// </remarks>
    private static NoPluginCatalog PosedPlugins() => new(
    [
        new PluginInfo(
            "deadair.bluos",
            "BluOS players",
            "0.1.0",
            "Bundled",
            Enabled: true,
            [
                new FieldSpec("discover", "Find players on the network", "Asks for players with a broadcast on UDP port 11430, which is how BluOS itself finds them.", FieldKind.Boolean, "true"),
                new FieldSpec("players", "Players", "Addresses to use whether or not they were found, one per line. Port 11000 is assumed.", FieldKind.Text, null),
                new FieldSpec("caption", "Caption on the player", "Shown as the first line on the player's own display.", FieldKind.Line, null),
            ],
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["discover"] = "true",
                ["players"] = "192.0.2.40",
            },
            Problem: null,
            ["12:34  offering 2 player(s)", "12:34  looking for players on the network, plus 1 address written down"]),

        new PluginInfo(
            "somebody.sonos",
            "somebody.sonos",
            string.Empty,
            "Installed",
            Enabled: false,
            [],
            new Dictionary<string, string>(StringComparer.Ordinal),
            Problem: "MaroonedSoftware.Sonos.dll is not in the plugin's folder; it may not have been built.",
            []),
    ]);

    /// <summary>Two speakers that are not there, so the picker has something to draw.</summary>
    private sealed class PosedOutputs : IOutputSource
    {
        public Task<IReadOnlyList<Output>> DiscoverAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<Output>>(
            [
                new Output("deadair.bluos", "90:56:82:0a:bc:0d", "Kitchen", "Bluesound Pulse Mini 2i", "192.0.2.36:11000"),

                // A long one on purpose. A name that fits proves nothing about a bar at its minimum
                // width, and this is the frame that decides whether the caption's cap is right.
                new Output("deadair.bluos", "90:56:82:0a:bc:0e", "Living Room NAD M10 V2", "M10 V2", "192.0.2.40:11000"),
            ]);

        public IStationPlayer? Open(Output output) => new NullStationPlayer();
    }

    /// <summary>Settings in a variable. A shot must not read or write somebody's real preferences.</summary>
    private sealed class MemorySettings : ISettingsStore
    {
        public DesktopSettings Current { get; private set; } = new();

        public SettingsFileProblem? Problem => null;

        public event Action<DesktopSettings>? Changed;

        public Task LoadAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task SaveAsync(DesktopSettings settings, CancellationToken cancellationToken = default) =>
            UpdateAsync(_ => settings, cancellationToken);

        public Task<DesktopSettings> UpdateAsync(Func<DesktopSettings, DesktopSettings> change, CancellationToken cancellationToken = default)
        {
            Current = change(Current);
            Changed?.Invoke(Current);
            return Task.FromResult(Current);
        }
    }
}
