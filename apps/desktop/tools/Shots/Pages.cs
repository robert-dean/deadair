using System.Net;
using Avalonia.Controls;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Director;
using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.Core.Updates;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Desktop.Views;
using MaroonedSoftware.Deadair.Sdk.Models;
using Destination = MaroonedSoftware.Deadair.Desktop.Navigation.Destination;

namespace Shots;

/// <summary>
/// The pages, filled with the kind of thing a real station answers with.
/// </summary>
/// <remarks>
/// The data matters as much as the layout. A page full of one-word rows looks fine and tells you
/// nothing about what happens to a long persona style, a wrapped talk break or a module name that
/// runs past its column — which is where a layout actually goes wrong.
/// </remarks>
internal static class Pages
{
    /// <param name="Width">The window this frame is drawn in. The default is the app's own; the
    /// minimum is what the window may be dragged down to, which is where a layout clips.</param>
    public static IEnumerable<(string Name, Control Page, int Width, int Height)> All()
    {
        yield return ("shell-desk", Shell(operatorSignedIn: false), 1180, 720);
        yield return ("shell-desk-operator", Shell(operatorSignedIn: true), 1180, 720);

        // Tall enough to reach what needs the operator under the air, with the badges it puts on
        // the sidebar beside it.
        yield return ("shell-desk-needs-you", Shell(operatorSignedIn: true, desk: Fakes.NeedsYou), 1180, 1180);

        // The station's own account of why it is quiet, at its real length: the sentence ran off the
        // card for as long as no frame drew one.
        yield return ("shell-desk-quiet", Shell(operatorSignedIn: true, desk: Fakes.Quiet), 1180, 720);
        yield return ("shell-min", Shell(operatorSignedIn: true), 820, 520);
        yield return ("shell-desk-live", Shell(operatorSignedIn: false, Fakes.WithoutAPlayhead), 1180, 720);
        yield return ("shell-desk-warming-up", Shell(operatorSignedIn: false, Fakes.WarmingUp), 1180, 720);
        yield return ("shell-desk-off-air", Shell(operatorSignedIn: false, Fakes.OffAir), 1180, 720);
        yield return ("shell-desk-stale", Shell(operatorSignedIn: false, Fakes.Stale), 1180, 720);
        yield return ("shell-history", Page(new Destination.History(), operatorSignedIn: false), 1180, 720);
        yield return ("shell-library", Page(new Destination.Library(), operatorSignedIn: true), 1180, 720);
        yield return ("shell-library-chart", Chart(), 1180, 720);

        // A question over the whole window, bar included, with the longest thing it is ever asked
        // about in its title.
        yield return ("dialog-confirm", Confirm(), 1180, 720);

        // Planning the station, both halves: keeping the show (a brief and nothing else) and a new
        // one (every field), the second at the minimum window where it has to scroll. Then the host.
        yield return ("dialog-plan", Plan(PlanScope.Keep), 1180, 720);
        yield return ("dialog-plan-new", Plan(PlanScope.New), 820, 520);
        yield return ("dialog-recast", Recast(), 1180, 720);
        yield return ("dialog-take-a-call", TakeACall(), 820, 520);
        yield return ("shell-notice", Refused(), 1180, 720);
        yield return ("shell-settings", Page(new Destination.Settings(), operatorSignedIn: true), 1180, 720);

        // Tall enough to reach the station's own fields, which sit below this app's card: every
        // kind the declared form draws: a switch, a number, a size in gigabytes, a secret that is
        // set, a choice and a table of rows.
        yield return ("shell-settings-station", Page(new Destination.Settings(), operatorSignedIn: true), 1180, 2100);
        // Taller than the app's own window, deliberately: the card is two plugins long and the
        // second is the broken one, which is the row somebody opens this page to read.
        yield return ("shell-settings-extensions", Extensions(), 1180, 1000);
        yield return ("shell-programme", Page(new Destination.Programme(), operatorSignedIn: true), 1180, 720);
        yield return ("shell-programme-min", Page(new Destination.Programme(), operatorSignedIn: true), 820, 520);
        yield return ("shell-programme-timetable", Programme(ProgrammeTab.Timetable), 1180, 720);

        // Tall enough for the whole format clock: once with the Now playing panel put away, where the
        // dial sits beside the list, and once with it, where the page is narrow and the dial moves above.
        yield return ("shell-programme-clock", Programme(ProgrammeTab.Today, nowPlaying: false), 1180, 1100);
        yield return ("shell-programme-clock-narrow", Programme(ProgrammeTab.Today), 1180, 1300);
        yield return ("dialog-band", Band(), 1180, 720);
        yield return ("shell-checkup", Page(new Destination.Checkup(), operatorSignedIn: true), 1180, 720);

        // Tall enough to reach the build at the foot of Machinery, and the minimum window, where a
        // mount's address and a store's counts run out of room first.
        yield return ("shell-checkup-machinery-long", Checkup("Machinery"), 1180, 1500);
        yield return ("shell-checkup-min", Checkup("Machinery"), 820, 520);
        yield return ("shell-checkup-history", Checkup("History"), 1180, 720);
        yield return ("shell-checkup-history-min", Checkup("History"), 820, 520);
        yield return ("shell-checkup-releases", Checkup("Releases"), 1180, 720);
        yield return ("shell-checkup-cost", Checkup("Cost"), 1180, 720);
        yield return ("shell-checkup-cost-min", Checkup("Cost"), 820, 520);
        yield return ("shell-checkup-logs", Checkup("Logs"), 1180, 720);
        yield return ("shell-checkup-logs-min", Checkup("Logs"), 820, 520);
        yield return ("shell-voice", Page(new Destination.Voice(), operatorSignedIn: true), 1180, 720);
        yield return ("shell-voice-said", Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Said), 1180, 720);
        yield return ("shell-voice-segments", Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Segments), 1180, 720);
        yield return ("player-bar", Bar(), 1180, 720);
        yield return ("player-bar-on-device", Bar(Fakes.OnASpeaker), 1180, 720);

        // The operator's Shuffle and Skip beside the play button, at the window's 820 minimum (the bar is the window's full width),
        // where the bar is already full and the two buttons are the most likely to crowd it.
        yield return ("player-bar-operator", Bar(operatorSignedIn: true), 820, 120);

        // The minimum window with the longest speaker name, which is what decides whether the
        // caption beside the picker keeps its cap or loses it.
        yield return ("shell-min-on-device", Shell(operatorSignedIn: true, Fakes.OnASpeaker), 820, 520);
        yield return ("output-picker", Picker(onASpeaker: true), 1180, 720);
        yield return ("output-picker-here", Picker(onASpeaker: false), 1180, 720);
        yield return ("sidebar", Rail(operatorSignedIn: true), 1180, 720);
        yield return ("sidebar-signed-out", Rail(operatorSignedIn: false), 1180, 720);
        yield return ("sidebar-update", Rail(operatorSignedIn: false, update: true), 1180, 720);
        yield return ("login", SignIn(revealed: false), 1180, 720);
        yield return ("login-revealed", SignIn(revealed: true), 1180, 720);

        // The first thing anybody sees, and the one frame with no shell behind it. The second has
        // the keyboard in the box, which is the only way to look at a focus ring.
        yield return ("welcome", Welcome(), 1180, 720);
        yield return ("setup", Setup(focused: false), 1180, 720);
        yield return ("setup-focused", Setup(focused: true), 1180, 720);
        yield return ("setup-answered", Answered(), 1180, 720);
        yield return ("setup-sign-in", SignIn(), 1180, 720);
    }

    /// <summary>
    /// The whole window: sidebar, page and bar.
    /// </summary>
    /// <remarks>
    /// The only frame that shows what this app now IS, and the only one that catches the things that
    /// go wrong between three controls rather than inside one — a bar overflowing its column, a hero
    /// clipping beside the operator card.
    /// </remarks>
    private static MainWindowContent Shell(bool operatorSignedIn, Action<ListenerViewModel>? pose = null, Action<ShellViewModel>? desk = null)
    {
        var shell = Fakes.Shell(operatorSignedIn);
        Fakes.PutOnAir(shell.Listener);
        pose?.Invoke(shell.Listener);

        if (operatorSignedIn)
        {
            Fakes.PutTheDeskOnAir(shell);
            desk?.Invoke(shell);
        }

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>A page other than the desk, inside the shell, so the bar and the sidebar are in frame.</summary>
    private static MainWindowContent Page(Destination destination, bool operatorSignedIn, VoiceTab? tab = null)
    {
        var shell = Fakes.Shell(operatorSignedIn);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, destination);
        shell.Navigation.Show(destination);

        if (tab is { } open)
        {
            shell.Voice.ShowTabCommand.Execute(open.ToString());
        }

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>
    /// A chart opened from the library: the first detail page, so the first frame with Back in it.
    /// </summary>
    /// <summary>Check-up on one of its tabs, posed. The tab's read fails against the refusing client and the pose stays.</summary>
    private static MainWindowContent Checkup(string tab)
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Checkup());
        shell.Navigation.Show(new Destination.Checkup());
        shell.Checkup.ShowTabCommand.Execute(tab);

        return new MainWindowContent { Shell = shell };
    }

    private static MainWindowContent Chart()
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Library());
        shell.Navigation.Show(new Destination.Library());
        shell.Library.ShowTabCommand.Execute("Charts");
        shell.Library.OpenChartCommand.Execute(shell.Library.Charts[0]);
        Fakes.Chart((ChartDetailViewModel)shell.Details.Current!);

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>The programme on one of its tabs.</summary>
    private static MainWindowContent Programme(ProgrammeTab tab, bool nowPlaying = true)
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Programme());
        shell.Navigation.Show(new Destination.Programme());
        shell.Programme.Tab = tab;
        shell.ShowNowPlaying = nowPlaying;

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>
    /// A band open for editing: a daily one about a subject, so every row of the sentence and the
    /// subject picker are in frame.
    /// </summary>
    private static MainWindowContent Band()
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Programme());
        shell.Navigation.Show(new Destination.Programme());
        _ = shell.Dialogs.ShowAsync(new ClockBandDialogViewModel(
            new BandDraft { Kind = "news", When = BandWhen.Daily, Time = "07:30", TopicId = "t1", Position = 2 },
            isNew: false,
            ["news", "ident", "weather", "talk"],
            [
                new Topic { Id = "t1", Kind = "news", Key = "tech", Label = "Technology and the internet", Config = [], Position = 0 },
                new Topic { Id = "t2", Kind = "news", Key = "local", Label = "Local", Config = [], Position = 1 },
            ],
            (_, _) => Task.FromResult(true)));

        return new MainWindowContent { Shell = shell };
    }

    private static MainWindowContent Confirm()
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Library());
        shell.Navigation.Show(new Destination.Library());
        _ = shell.Dialogs.ConfirmAsync(
            "Put Official Singles Chart Top 100 on air?",
            "It replaces the running order with the chart's records. What is on air now finishes first.",
            "Put on air");

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>The plan dialog over the desk, opened on a broadcast that has a brief.</summary>
    private static MainWindowContent Plan(PlanScope scope)
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.PutTheDeskOnAir(shell);

        var order = new StationOrder
        {
            Name = "Wednesday mornings",
            Brief = "Something with guitars, nothing after 1999, and more of the Seattle records than anybody would admit to liking",
            Mode = StationMode.Rotation,
            OnEnd = StationOnEnd.Extend,
            Source = "director",
            Items = [new StationOrderItem { Id = "1", Kind = StationOrderItemKind.Track, State = StationItemState.Airing, Title = "Alive", Artists = ["Pearl Jam"] }],
        };

        var plan = new PlanDialogViewModel(new OperatorActions(new SessionManager(new InMemorySecretStore(), Fakes.Http())), Repository(), order, Fakes.Hosts());
        plan.ShowScopeCommand.Execute(scope.ToString());

        if (scope == PlanScope.New)
        {
            plan.Brief = "Heavy metal hits";
            plan.EraFrom = "1979";
            plan.EraTo = "1970";
        }

        _ = shell.Dialogs.ShowAsync(plan);
        return new MainWindowContent { Shell = shell };
    }

    private static MainWindowContent Recast()
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.PutTheDeskOnAir(shell);

        var recast = new RecastDialogViewModel(new OperatorActions(new SessionManager(new InMemorySecretStore(), Fakes.Http())), Repository(), "1", Fakes.Hosts());
        recast.Chosen = recast.Choices[2];
        _ = shell.Dialogs.ShowAsync(recast);
        return new MainWindowContent { Shell = shell };
    }

    private static MainWindowContent TakeACall()
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.PutTheDeskOnAir(shell);

        var call = new TakeACallDialogViewModel(
            new OperatorActions(new SessionManager(new InMemorySecretStore(), Fakes.Http())),
            StationUrl.TryParse("https://radio.example.com", out var station) ? station : default,
            Fakes.Http(),
            "1",
            "Marla Vance",
            Fakes.Hosts())
        {
            About = "the worst gig anybody ever went to, and why it was worth it",
        };
        _ = shell.Dialogs.ShowAsync(call);
        return new MainWindowContent { Shell = shell };
    }

    /// <summary>A running order nobody polls: a dialog needs one to send to, and a frame sends nothing.</summary>
    private static OrderRepository Repository() =>
        new(StationUrl.TryParse("https://radio.example.com", out var station) ? station : default, Fakes.Http());

    /// <summary>A refusal at the foot of a page, with the panel that used to be its only home put away.</summary>
    private static MainWindowContent Refused()
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Library());
        shell.Navigation.Show(new Destination.Library());
        shell.ShowNowPlaying = false;
        shell.Dialogs.Notice = "There is nothing on that playlist the station can play.";

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>The sidebar, signed in, so every section and both states of an entry are in frame.</summary>
    private static Border Rail(bool operatorSignedIn, bool update = false)
    {
        var shell = Fakes.Shell(operatorSignedIn);

        // The notice a newer desktop release puts above the account, posed rather than fetched: a
        // shot must not ask GitHub anything.
        if (update)
        {
            shell.UpdateNotice = new UpdateAvailable(new Version(0, 2, 0), new Uri("https://github.com/robert-dean/deadair/releases/tag/desktop-v0.2.0"));
        }

        return new()
        {
            Width = 220,
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Left,
            Child = new Sidebar { DataContext = shell },
        };
    }

    /// <summary>
    /// The sign-in step as the sidebar's Sign in opens it, filled in, so the boxes are shown holding
    /// what somebody actually pasted into them.
    /// </summary>
    private static SetupView SignIn(bool revealed)
    {
        var shell = Fakes.Shell(operatorSignedIn: false);
        shell.Login.Email = "operator@example.com";

        // A real one's length.
        shell.Login.Password = "correct-horse-battery-staple";

        var setup = new SetupViewModel(Fakes.Settings(), new StationProbe(new HttpClient(new AnswersAsAStation())));
        setup.OpenSignIn("Deadair");

        var view = new SetupView { DataContext = setup, Tag = shell };

        // After load, not before: arriving at the step turns the reveal off, so a pose set earlier is
        // undone by the time the frame is captured, which is the tool proving the app's own rule.
        if (revealed)
        {
            view.Loaded += (_, _) => view.FindControl<LoginView>("Login")?.Reveal(revealed: true);
        }

        return view;
    }

    /// <summary>What a first run opens on: the mark, the name and Find your station.</summary>
    private static SetupView Welcome()
    {
        var setup = Fakes.Shell(operatorSignedIn: false).Setup;
        setup.Address = string.Empty;
        setup.CanCancel = false;
        setup.Open(asking: false);
        return new SetupView { DataContext = setup };
    }

    /// <summary>
    /// The address half once a station has answered: Listen names it, and signing in is the quieter
    /// second button. Checked against the fake station rather than set, so the frame is what Check does.
    /// </summary>
    private static SetupView Answered()
    {
        var setup = new SetupViewModel(Fakes.Settings(), new StationProbe(new HttpClient(new AnswersAsAStation())));
        setup.CanCancel = false;
        setup.Open(asking: false);
        setup.StartCommand.Execute(null);
        setup.Address = "radio.example.com";
        setup.CheckCommand.ExecuteAsync(null).GetAwaiter().GetResult();
        return new SetupView { DataContext = setup };
    }

    /// <summary>
    /// The last step, from I run this station: sign in. The station has answered and been kept, so
    /// this is the frame with the form and the way out without it.
    /// </summary>
    private static SetupView SignIn()
    {
        var shell = Fakes.Shell(operatorSignedIn: false);
        var setup = new SetupViewModel(Fakes.Settings(), new StationProbe(new HttpClient(new AnswersAsAStation())));
        setup.Open(asking: false);
        setup.StartCommand.Execute(null);
        setup.Address = "radio.example.com";
        setup.CheckCommand.ExecuteAsync(null).GetAwaiter().GetResult();
        setup.ListenAndSignInCommand.ExecuteAsync(null).GetAwaiter().GetResult();
        setup.Attaching = false;
        return new SetupView { DataContext = setup, Tag = shell };
    }

    /// <summary>The address half as a first run reaches it: an empty box, and back to the welcome.</summary>
    private static SetupView Setup(bool focused)
    {
        var setup = Fakes.Shell(operatorSignedIn: false).Setup;
        setup.Address = string.Empty;
        setup.CanCancel = false;
        setup.Open(asking: false);
        setup.StartCommand.Execute(null);

        var view = new SetupView { DataContext = setup };

        // On Loaded and not on attach: the page is attached the moment it becomes the window's
        // content, before the window is shown, and focus asked for then is refused with nothing
        // said. Loaded fires after the first layout, which is after Show.
        if (focused)
        {
            view.Loaded += (_, _) => view.FindControl<TextBox>("AddressBox")?.Focus();
        }

        return view;
    }

    /// <summary>The bar on its own, at the width it really gets, so its columns can be looked at.</summary>
    /// <summary>
    /// The settings page scrolled to what this install has been given.
    /// </summary>
    /// <remarks>
    /// Posed with one plugin that works and one that could not be loaded, because the broken row is
    /// the one somebody opens this page to read.
    /// </remarks>
    private static MainWindowContent Extensions()
    {
        var destination = new Destination.Settings();
        var shell = Fakes.Shell(operatorSignedIn: true);

        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, destination);
        shell.StationSettings.AttachPlugins();
        shell.Navigation.Show(destination);

        return new MainWindowContent { Shell = shell };
    }

    private static PlayerBar Bar(Action<ListenerViewModel>? pose = null, bool operatorSignedIn = false)
    {
        var shell = Fakes.Shell(operatorSignedIn);
        (pose ?? Fakes.PutOnAir)(shell.Listener);

        if (operatorSignedIn)
        {
            shell.Transport.IsOperator = true;
            shell.Transport.StreamUp = true;
        }

        // The shell on the window as well, because the operator's buttons reach it through there.
        return new PlayerBar { DataContext = shell.Listener, Tag = shell };
    }

    /// <summary>
    /// The output picker, on its own.
    /// </summary>
    /// <remarks>
    /// A flyout is a separate top level and a headless render captures the window, so the picker
    /// cannot be caught inside the bar it belongs to. Drawn alone, the way sign-in is.
    /// </remarks>
    private static Border Picker(bool onASpeaker)
    {
        var shell = Fakes.Shell(operatorSignedIn: false);
        var outputs = shell.Listener.Outputs!;

        Fakes.ShowOutputsAsync(outputs, onASpeaker).GetAwaiter().GetResult();

        return new Border
        {
            Width = 268,
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
            VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center,
            Child = new OutputPicker { DataContext = outputs },
        };
    }


    /// <summary>
    /// A station that answers the probe and nothing else. Its own handler rather than the shell's,
    /// which refuses everything on purpose: the one frame that has to show a station that DID answer.
    /// </summary>
    private sealed class AnswersAsAStation : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("""{ "station": "Static Between Stations", "onAir": true, "listeners": 12, "mounts": [] }"""),
            });
    }
}
