using System.Net;
using Avalonia.Controls;
using MaroonedSoftware.Deadair.Desktop.Controls;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Director;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.Core.Updates;
using MaroonedSoftware.Deadair.Desktop.Services;
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
        yield return ("studio", Studio(), 1180, 720);
        yield return ("studio-break", Studio(Fakes.OnTheMic), 1180, 720);
        yield return ("studio-off-air", Studio(Fakes.OffAir), 1180, 720);
        yield return ("studio-min", Studio(), 820, 520);
        yield return ("studio-screen", Studio(), 1728, 1117);
        yield return ("studio-backdrop", Backdrop(), 1180, 720);
        yield return ("studio-backdrop-no-cover", new StudioBackdrop { Phase = 0.3 }, 1180, 720);
        yield return ("shell-desk-break", Shell(operatorSignedIn: false, Fakes.OnTheMic), 1180, 720);
        yield return ("shell-desk-warming-up", Shell(operatorSignedIn: false, Fakes.WarmingUp), 1180, 720);
        yield return ("shell-desk-off-air", Shell(operatorSignedIn: false, Fakes.OffAir), 1180, 720);
        yield return ("shell-desk-stale", Shell(operatorSignedIn: false, Fakes.Stale), 1180, 720);
        yield return ("shell-history", Page(new Destination.History(), operatorSignedIn: false), 1180, 720);
        yield return ("shell-library", Page(new Destination.Library(), operatorSignedIn: true), 1180, 720);
        yield return ("shell-library-chart", Chart(), 1180, 720);
        yield return ("shell-library-min", Page(new Destination.Library(), operatorSignedIn: true), 820, 520);
        yield return ("shell-library-acts", Library("Artists"), 1180, 720);
        yield return ("shell-library-track", Detail(new Destination.TrackDetail(Guid.NewGuid(), "Regulate"), page => Fakes.Track((TrackDetailViewModel)page)), 1180, 720);
        yield return ("shell-library-track-tall", Detail(new Destination.TrackDetail(Guid.NewGuid(), "Regulate"), page => Fakes.Track((TrackDetailViewModel)page)), 1180, 1500);
        yield return ("shell-library-track-min", Detail(new Destination.TrackDetail(Guid.NewGuid(), "Regulate"), page => Fakes.Track((TrackDetailViewModel)page)), 820, 520);
        yield return ("shell-library-playlists", Library("Playlists"), 1180, 720);
        yield return ("shell-library-news", Library("News"), 1180, 720);
        yield return ("shell-library-news-min", Library("News"), 820, 520);
        yield return ("shell-library-charts", Library("Charts"), 1180, 720);
        yield return ("shell-library-podcasts", Library("Podcasts"), 1180, 720);
        yield return ("shell-library-podcasts-tall", Library("Podcasts"), 1180, 1200);
        yield return ("shell-library-podcasts-min", Library("Podcasts"), 820, 520);
        yield return ("shell-library-readings", Library("Narrations"), 1180, 720);
        yield return ("shell-library-readings-min", Library("Narrations"), 820, 520);
        yield return ("shell-library-playlists-min", Library("Playlists"), 820, 520);
        yield return ("shell-library-own-playlist", Detail(new Destination.StationPlaylistDetail(Guid.NewGuid(), "Imported"), page => Fakes.OwnPlaylist((StationPlaylistDetailViewModel)page)), 1180, 720);
        yield return ("dialog-playlist-import", Import(), 1180, 720);
        yield return ("shell-library-artist", Detail(new Destination.ArtistDetail(Guid.NewGuid(), "Alice In Chains"), page => Fakes.Artist((ArtistDetailViewModel)page)), 1180, 1100);

        // A question over the whole window, bar included, with the longest thing it is ever asked
        // about in its title.
        yield return ("dialog-confirm", Confirm(), 1180, 720);
        yield return ("dialog-jump", Jump(), 1180, 720);
        yield return ("dialog-jump-min", Jump(), 820, 520);

        // Planning the station, both halves: keeping the show (a brief and nothing else) and a new
        // one (every field), the second at the minimum window where it has to scroll. Then the host.
        yield return ("dialog-plan", Plan(PlanScope.Keep), 1180, 720);
        yield return ("dialog-plan-new", Plan(PlanScope.New), 820, 520);
        yield return ("dialog-recast", Recast(), 1180, 720);
        yield return ("dialog-take-a-call", TakeACall(), 820, 520);
        yield return ("shell-notice", Refused(), 1180, 720);
        yield return ("shell-settings", Page(new Destination.Settings(), operatorSignedIn: true), 1180, 720);

        // The station's sections, one declared group each, between them every kind the declared form
        // draws: a switch, a number, a size in gigabytes, a secret that is set, a choice and a table of
        // rows. The last at the minimum window, where the section list and the form share 580 units.
        yield return ("shell-settings-playout", SettingsFakes.Frame(SettingsSectionId.Playout), 1180, 720);
        yield return ("shell-settings-list", SettingsFakes.Frame(SettingsSectionId.Playout, nowPlaying: false), 1180, 720);
        yield return ("shell-settings-mail", SettingsFakes.Frame(SettingsSectionId.Mail), 1180, 720);
        yield return ("shell-settings-bulletins-min", SettingsFakes.Frame(SettingsSectionId.Bulletins), 820, 520);
        yield return ("shell-settings-empty-group", SettingsFakes.Frame(SettingsSectionId.Station), 1180, 720);
        yield return ("shell-settings-artwork", SettingsFakes.Frame(SettingsSectionId.Artwork), 1180, 720);
        yield return ("shell-settings-storage", SettingsFakes.Frame(SettingsSectionId.Storage), 1180, 720);
        yield return ("shell-settings-storage-min", SettingsFakes.Frame(SettingsSectionId.Storage), 820, 520);
        yield return ("shell-settings-providers", SettingsFakes.Frame(SettingsSectionId.Providers), 1180, 1000);
        yield return ("shell-settings-grants", SettingsFakes.Frame(SettingsSectionId.Grants), 1180, 720);
        yield return ("shell-settings-plugins", SettingsFakes.Frame(SettingsSectionId.Plugins), 1180, 900);
        yield return ("shell-settings-plugin", SettingsFakes.Plugin(), 1180, 2000);
        yield return ("shell-settings-plugin-min", SettingsFakes.Plugin(), 820, 520);
        yield return ("shell-settings-security", SettingsFakes.Frame(SettingsSectionId.Security), 1180, 2600);
        yield return ("shell-settings-security-min", SettingsFakes.Frame(SettingsSectionId.Security), 820, 520);
        yield return ("dialog-step-up", SettingsFakes.StepUp(), 1180, 720);
        yield return ("shell-settings-languages", SettingsFakes.Frame(SettingsSectionId.Languages), 1180, 720);
        yield return ("shell-settings-languages-min", SettingsFakes.Frame(SettingsSectionId.Languages), 820, 520);
        yield return ("shell-settings-listener", Page(new Destination.Settings(), operatorSignedIn: false), 1180, 720);
        // Taller than the app's own window, deliberately: the card is two plugins long and the
        // second is the broken one, which is the row somebody opens this page to read.
        yield return ("shell-settings-extensions", Extensions(), 1180, 1000);
        yield return ("shell-programme", Page(new Destination.Programme(), operatorSignedIn: true), 1180, 720);
        yield return ("shell-programme-min", Page(new Destination.Programme(), operatorSignedIn: true), 820, 520);
        yield return ("shell-programme-timetable", Programme(ProgrammeTab.Timetable), 1180, 720);
        yield return ("shell-programme-timetable-tall", Programme(ProgrammeTab.Timetable), 1180, 1100);

        // Tall enough for the whole format clock: once with the Now playing panel put away, where the
        // dial sits beside the list, and once with it, where the page is narrow and the dial moves above.
        yield return ("shell-programme-clock", Programme(ProgrammeTab.Today, nowPlaying: false), 1180, 1100);
        yield return ("shell-programme-clock-narrow", Programme(ProgrammeTab.Today), 1180, 1300);
        yield return ("shell-programme-sustaining", Programme(ProgrammeTab.Sustaining), 1180, 1000);
        yield return ("shell-programme-requests", Programme(ProgrammeTab.Requests), 1180, 720);
        yield return ("shell-programme-requests-min", Programme(ProgrammeTab.Requests), 820, 520);
        yield return ("shell-programme-requests-forbidden", Programme(ProgrammeTab.Requests, forbidden: true), 1180, 720);
        yield return ("dialog-decline", Decline(), 1180, 720);
        yield return ("dialog-band", Band(), 1180, 720);
        yield return ("dialog-slot", SlotEditor(), 1180, 720);
        yield return ("dialog-slot-min", SlotEditor(), 820, 520);
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
        yield return ("shell-voice-min", Page(new Destination.Voice(), operatorSignedIn: true), 820, 520);
        yield return ("shell-voice-auditions", Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Auditions), 1180, 900);
        yield return ("shell-voice-auditions-min", Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Auditions), 820, 520);
        yield return ("shell-voice-voices", Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Voices), 1180, 720);
        yield return ("shell-voice-segments-min", Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Segments), 820, 520);
        yield return ("shell-voice-pronunciations", Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Pronunciations), 1180, 720);
        yield return ("shell-voice-pronunciations-min", Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Pronunciations), 820, 520);
        yield return ("shell-voice-soundboard", Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Soundboard), 1180, 1000);
        yield return ("shell-voice-soundboard-min", Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Soundboard), 820, 520);
        yield return ("dialog-pad-upload", VoiceDialog(station => new PadUploadDialogViewModel(
            Fakes.Actions(), Fakes.Http(), station, new("Air Horn (Stadium) 03.wav", []), ["station", "late-night-and-other-quiet-hours"])), 1180, 720);
        yield return ("shell-voice-phrasings", Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Phrasings), 1180, 720);
        yield return ("shell-voice-subjects", Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Subjects), 1180, 720);
        yield return ("shell-voice-subjects-min", Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Subjects), 820, 520);
        yield return ("shell-voice-productions", Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Productions), 1180, 720);
        yield return ("shell-voice-said-narrowed", Said(), 1180, 720);
        yield return ("shell-voice-said-min", Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Said), 820, 520);
        yield return ("dialog-production-request", VoiceDialog(station => new ProductionRequestDialogViewModel(
            Fakes.Actions(), Fakes.Http(), station, Fakes.Roster()) { Name = "The machine nobody wanted" }), 1180, 720);
        yield return ("dialog-subject", Subject(), 1180, 720);
        yield return ("dialog-segment-upload", VoiceDialog(station => new SegmentUploadDialogViewModel(
            Fakes.Actions(), Fakes.Http(), station, new("evening_ident-v3_FINAL.wav", []), ["ident", "talkbreak"]) { Kind = "sweeper" }), 1180, 720);
        yield return ("dialog-segment-compose", VoiceDialog(station => new SegmentComposeDialogViewModel(
            Fakes.Actions(), Fakes.Http(), station, Fakes.Voices()) { Label = "Station ident, late", Script = "You are listening to Deadair. It is later than you think." }), 1180, 720);

        // A character's sheet: an existing host, and a new caller with its ties to the hosts.
        yield return ("shell-voice-persona", Persona(caller: false), 1180, 720);
        yield return ("shell-voice-persona-caller", Persona(caller: true), 1180, 1400);
        yield return ("shell-voice-persona-min", Persona(caller: false), 820, 520);
        yield return ("dialog-persona-import", PersonaImport(), 1180, 720);

        // What a character has accumulated, each section of its page, and the question a rollback asks.
        yield return ("shell-voice-persona-notebook", Section(PersonaSection.Notebook), 1180, 900);
        yield return ("shell-voice-persona-stories", Section(PersonaSection.Stories), 1180, 1100);
        yield return ("shell-voice-persona-memory", Section(PersonaSection.Memory), 1180, 720);
        yield return ("shell-voice-persona-rehearsal", Section(PersonaSection.Rehearsal), 1180, 720);
        yield return ("shell-voice-persona-stories-min", Section(PersonaSection.Stories), 820, 520);
        yield return ("dialog-persona-rollback", Rollback(), 1180, 720);
        yield return ("shell-voice-settings", CharacterSettings(), 1180, 900);
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

    /// <summary>The Library on one of its tabs, over the same posed station.</summary>
    private static MainWindowContent Library(string tab)
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Library());
        shell.Navigation.Show(new Destination.Library());
        shell.Library.ShowTabCommand.Execute(tab);

        // Opening the tab asks the station, and the fake one refuses: the posed rows stay, and the
        // refusal it reports is not what this frame is for.
        shell.Dialogs.Notice = null;
        return new MainWindowContent { Shell = shell };
    }

    /// <summary>The import dialog over the Playlists tab, previewed, so the plan and the name are in frame.</summary>
    private static MainWindowContent Import()
    {
        var shell = Library("Playlists");
        var dialog = new PlaylistImportDialogViewModel(
            new OperatorActions(new SessionManager(new InMemorySecretStore(), Fakes.Http())),
            () => throw new InvalidOperationException("A frame calls no station."),
            new FilePicker(),
            _ => { });
        _ = shell.Shell!.Dialogs.ShowAsync(dialog);
        dialog.From = ImportFrom.Paste;
        dialog.Pasted = "Massive Attack - Teardrop\nPortishead - Roads";
        Fakes.Previewed(dialog);
        return shell;
    }

    /// <summary>A catalog page pushed from the Library, posed once the fake station has refused to fill it.</summary>
    private static MainWindowContent Detail(Destination destination, Action<object> pose)
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        shell.Navigation.Show(new Destination.Library());
        shell.Navigation.Push(destination);
        pose(shell.Details.Current!);

        // The fake station refused the page's own read, which is what these lines undo: the frame is
        // of a page that was read.
        shell.Dialogs.Notice = null;
        if (shell.Details.Current is CatalogDetailViewModel page)
        {
            page.Problem = null;
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
        shell.Library.Charts.OpenCommand.Execute(shell.Library.Charts.Charts[0]);
        Fakes.Chart((ChartDetailViewModel)shell.Details.Current!);
        shell.Dialogs.Notice = null;

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>The programme on one of its tabs.</summary>
    private static MainWindowContent Programme(ProgrammeTab tab, bool nowPlaying = true, bool forbidden = false)
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Programme());
        shell.Navigation.Show(new Destination.Programme());
        shell.Programme.Tab = tab;
        shell.ShowNowPlaying = nowPlaying;

        // Somebody the station will not show requests to: its sentence, in place of the list.
        if (forbidden)
        {
            shell.Programme.Requests.Present([]);
            shell.Programme.Requests.Forbidden = Requests.Forbidden;
        }

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

    /// <summary>The on-air slot open for editing, playing from a chart, so the chart's own row is in frame.</summary>
    private static MainWindowContent SlotEditor()
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Programme());
        shell.Navigation.Show(new Destination.Programme());
        shell.Programme.Tab = ProgrammeTab.Timetable;

        var chart = new ProgrammeSource.Chart("lastfm:top");
        _ = shell.Dialogs.ShowAsync(new SlotDialogViewModel(
            new SlotDraft
            {
                Label = "Wednesday mornings",
                StartsAt = "10:00",
                EndsAt = "13:00",
                Days = new HashSet<int> { 3 },
                Source = chart,
                PersonaId = "p1",
                Brief = "Something with guitars, nothing after 1999, and nothing anybody would call a ballad.",
                EraTo = "1999",
                Callins = true,
            },
            isNew: false,
            airing: true,
            [
                new SourceChoice(SourceChoices.Nothing, string.Empty, null),
                new SourceChoice("Late night guitars", "The station's", new ProgrammeSource.Station(Guid.Empty)),
                new SourceChoice("Discover Weekly", "Spotify", new ProgrammeSource.Playlist("spotify", "dw")),
                new SourceChoice("Top 40 this week", "Chart · lastfm", chart),
            ],
            [new HostChoice(null, "The station's own host"), new HostChoice("p1", "Marla Vance"), new HostChoice("p2", "The Night Owl")],
            (_, _) => Task.FromResult(true)));

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>Declining a request from a chat, which says the listener is told there.</summary>
    private static MainWindowContent Decline()
    {
        var shell = Programme(ProgrammeTab.Requests);
        var row = shell.Shell!.Programme.Requests.Rows[0];
        shell.Shell.Programme.Requests.DeclineCommand.Execute(row);

        return shell;
    }

    /// <summary>A character opened from the roster, or a new caller from New caller.</summary>
    private static MainWindowContent Persona(bool caller)
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Voice());
        shell.Navigation.Show(new Destination.Voice());

        if (caller)
        {
            shell.Voice.Characters.NewCallerCommand.Execute(null);
            var page = (PersonaDetailViewModel)shell.Details.Current!;
            page.Label = "Dennis the taxi driver";
            page.Style = "Rings in every week to argue about the charts, and is never once right about a release year.";
            page.Hosts[0].IsChosen = true;
            page.Templates = "Right, {{previous.tittle}} was never a single";
        }
        else
        {
            shell.Voice.Characters.EditCommand.Execute(shell.Voice.Characters.Rows[0]);
        }

        shell.Dialogs.Notice = null;

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>One section of an existing character's page, posed with what a real one holds.</summary>
    private static MainWindowContent Section(PersonaSection section)
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Voice());
        shell.Navigation.Show(new Destination.Voice());
        shell.Voice.Characters.EditCommand.Execute(shell.Voice.Characters.Rows[0]);

        var page = (PersonaDetailViewModel)shell.Details.Current!;
        page.Section = section;
        Fakes.Accumulate(page);
        shell.Dialogs.Notice = null;

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>A rollback with both of the costs nobody expects in its counts.</summary>
    private static MainWindowContent Rollback()
    {
        var content = Section(PersonaSection.Memory);
        var shell = content.Shell!;

        if (StationUrl.TryParse("https://radio.example.com", out var station))
        {
            _ = shell.Dialogs.ShowAsync(new PersonaRollbackDialogViewModel(
                new OperatorActions(new SessionManager(new InMemorySecretStore(), Fakes.Http())),
                Fakes.Http(),
                station,
                "1",
                "2026-09-27T21:14:00Z",
                "Roll Marla Vance back to before this?",
                "Everything after 27 Sep 2026, 22:14 goes. That telling itself stays.",
                new PersonaMemoryChange { Tellings = 3, Notes = 2, Stories = 1, Details = 4, Rejected = 1, Touched = 2 }));
        }

        return content;
    }

    /// <summary>The Characters tab with its two settings open, drawn by the shared form.</summary>
    private static MainWindowContent CharacterSettings()
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Voice());
        shell.Navigation.Show(new Destination.Voice());
        Fakes.CharacterSettings(shell.Voice.Characters);
        shell.Voice.Characters.ToggleSettingsCommand.Execute(null);
        shell.Dialogs.Notice = null;

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>What it said, narrowed to one character from its card, with one row opened and rated.</summary>
    private static MainWindowContent Said()
    {
        var content = Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Said);
        var scripts = content.Shell!.Voice.Scripts;
        scripts.PersonaKey = "marla";
        scripts.Scripts.Clear();
        foreach (var attempt in Fakes.Attempts())
        {
            scripts.Scripts.Add(ScriptsViewModel.Row(attempt));
        }

        scripts.Scripts[0].IsOpen = true;
        content.Shell.Dialogs.Notice = null;
        return content;
    }

    /// <summary>A subject opened for editing: its name, and the field its kind declares.</summary>
    private static MainWindowContent Subject()
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Voice());
        shell.Navigation.Show(new Destination.Voice());
        shell.Voice.ShowTabCommand.Execute("Subjects");
        shell.Dialogs.Notice = null;

        var row = shell.Voice.Subjects.Kinds[0].Subjects[0];
        if (StationUrl.TryParse("https://radio.example.com", out var station))
        {
            _ = shell.Dialogs.ShowAsync(new TopicDialogViewModel(Fakes.Actions(), Fakes.Http(), station, row.Kind, row.Topic, row.Topic.Position));
        }

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>A Voice page with one of its dialogs open over it.</summary>
    private static MainWindowContent VoiceDialog(Func<StationUrl, DialogViewModel> build)
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Voice());
        shell.Navigation.Show(new Destination.Voice());
        shell.Dialogs.Notice = null;

        if (StationUrl.TryParse("https://radio.example.com", out var station))
        {
            _ = shell.Dialogs.ShowAsync(build(station));
        }

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>A file's plan, with a notice on one character and one that would be rewritten.</summary>
    private static MainWindowContent PersonaImport()
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Voice());
        shell.Navigation.Show(new Destination.Voice());

        var plan = new PersonaImportPlan
        {
            Format = "deadair.personas/1",
            Notices = [new() { Kind = PersonaImportNoticeKind.Format, Message = "This file was written by a newer station; anything it does not know is left out." }],
            Personas =
            [
                new()
                {
                    Key = "marla", Label = "Marla Vance", Outcome = PersonaImportEntryOutcome.Update,
                    StoriesNew = 2, StoriesHeld = 5, DetailsNew = 0, DetailsHeld = 0,
                    Notices = [new() { Kind = PersonaImportNoticeKind.Duplicate, Message = "Speaks as \"marla\", which this station's engine does not map, so it would use the default voice." }],
                },
                new()
                {
                    Key = "taxi", Label = "Dennis the taxi driver", Kind = PersonaImportEntryKind.Caller, Outcome = PersonaImportEntryOutcome.Create,
                    StoriesNew = 0, StoriesHeld = 0, DetailsNew = 0, DetailsHeld = 0, Notices = [],
                },
            ],
        };
        var file = new PersonaFile { Format = "deadair.personas/1", TakenAt = "2026-09-29T10:00:00Z", Personas = [] };
        shell.Dialogs.Notice = null;

        if (StationUrl.TryParse("https://radio.example.com", out var station))
        {
            _ = shell.Dialogs.ShowAsync(new PersonaImportDialogViewModel(
                new OperatorActions(new SessionManager(new InMemorySecretStore(), Fakes.Http())),
                Fakes.Http(),
                station,
                "personas-radio.example.com-2026-09-29.json",
                file,
                plan));
        }

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>
    /// The jump-to palette with a query typed: what the station found first, then the places that
    /// match, as the palette lists them.
    /// </summary>
    private static MainWindowContent Jump()
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        Fakes.PutOnAir(shell.Listener);
        shell.Navigation.Show(new Destination.Desk());

        var pages = MaroonedSoftware.Deadair.Desktop.Core.Ui.JumpTo.Pages
            .Select(page => (page, new JumpTarget(page.Label, page.Group, () => { })))
            .ToList();
        var jump = new JumpDialogViewModel(pages, (_, _) => Task.FromResult<IReadOnlyList<JumpTarget>>([]));
        jump.Query = "re";

        // Posed rather than searched: the fake station refuses, and the frame is of the rows.
        jump.Results.Insert(0, new JumpTarget("Regulate (feat. Nate Dogg) - Original Version", "Warren G, Nate Dogg", () => { }));
        jump.Results.Insert(1, new JumpTarget("R.E.M.", "Act", () => { }));
        jump.Status = null;
        _ = shell.Dialogs.ShowAsync(jump);

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

    /// <summary>Studio up over the shell, as a listener sees it. The shell is under it, as it is in the app.</summary>
    private static MainWindowContent Studio(Action<ListenerViewModel>? pose = null)
    {
        var shell = Fakes.Shell(operatorSignedIn: false);
        Fakes.PutOnAir(shell.Listener);
        pose?.Invoke(shell.Listener);
        shell.IsStudio = true;

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>Studio's backdrop alone, in the posed cover's colours, part-way round its loop.</summary>
    private static StudioBackdrop Backdrop() => new()
    {
        Palette = [0xFF1C2A3A, 0xFFB8452B, 0xFFE9D8B8],
        Phase = 0.3,
    };

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
