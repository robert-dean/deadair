using System.Net;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.Themes;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;

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
