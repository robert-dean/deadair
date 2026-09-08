using System.Net;
using Avalonia.Controls;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Desktop.Views;
using MaroonedSoftware.Deadair.Sdk.Models;

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
    public static IEnumerable<(string Name, Control Page)> All()
    {
        yield return ("voice-characters", Voice(VoiceTab.Characters));
        yield return ("voice-said", Voice(VoiceTab.Said));
        yield return ("voice-segments", Voice(VoiceTab.Segments));
        yield return ("voice-productions", Voice(VoiceTab.Productions));
        yield return ("checkup", Checkup());
        yield return ("running-order", Order());
    }

    private static VoiceView Voice(VoiceTab tab)
    {
        var model = new VoiceViewModel(Actions(), Http());

        model.Personas.Add(new PersonaRowViewModel(
            "1",
            "Marla Vance",
            "Dry, unhurried, and never explains a joke. Speaks as though she has been up all night and "
            + "is the only one who noticed.",
            Active: true));
        model.Personas.Add(new PersonaRowViewModel(
            "2",
            "The Conspiracy Host",
            "Certain about everything, wrong about most of it, and defers to the daypart he is handed.",
            Active: false));
        model.Personas.Add(new PersonaRowViewModel("3", "Newsreader", "Flat, exact, and never editorialises.", false));

        model.Scripts.Add(new ScriptRowViewModel(
            "11:42", "talk", "model",
            "That was Pearl Jam, and before that a record I have been trying to place all morning. "
            + "Stay where you are.",
            StatusTone.Ok));
        model.Scripts.Add(new ScriptRowViewModel(
            "11:39", "talk", "model", "Declined: wrong-daypart", StatusTone.Standby));
        model.Scripts.Add(new ScriptRowViewModel(
            "11:38", "welcome", "floor", "You're listening to Deadair.", StatusTone.Ok));
        model.Scripts.Add(new ScriptRowViewModel(
            "11:31", "news", "model", "The speech engine did not answer in time.", StatusTone.Fault));

        model.Segments.Add(new SegmentRowViewModel("Talk break: Jeremy into Alive", "talk", "ready", StatusTone.Ok));
        model.Segments.Add(new SegmentRowViewModel("Station ident, evening", "ident", "ready", StatusTone.Ok));
        model.Segments.Add(new SegmentRowViewModel("Talk break: Regulate into My Boo", "talk", "rendering", StatusTone.Standby));
        model.Segments.Add(new SegmentRowViewModel("News bulletin, 11:30", "news", "failed", StatusTone.Fault));

        model.Productions.Add(new ProductionRowViewModel("p1", "Phone-in: the worst gig you ever went to", "callin", "drafting", true));
        model.Productions.Add(new ProductionRowViewModel("p2", "Evening feature", "feature", "ready", false));

        model.ShowTabCommand.Execute(tab.ToString());

        return new VoiceView { DataContext = model };
    }

    private static CheckupView Checkup()
    {
        var model = new CheckupViewModel(Actions(), Http())
        {
            ReadAt = "Read at 11:48:02",
            Revision = "Built from 6ec2d2c1a4f9",
            Backlog = "412 of 766 records held locally, 389 measured",
        };

        model.Attention.Add(new AttentionViewModel(
            "Four records cannot be fetched",
            "Every copy has been written off, so they will not air. Re-check them or remove them from rotation.",
            Severity.Failure,
            4));
        model.Attention.Add(new AttentionViewModel(
            "The speech engine is slow",
            "Two breaks took longer than their slot allowed and were dropped.",
            Severity.Warning,
            null));
        model.Attention.Add(new AttentionViewModel(
            "No news feeds configured",
            "The station has nothing to read a bulletin from.",
            Severity.Notice,
            null));

        model.Loops.Add(new LoopViewModel("playout.reconcile", "just now", "3h ago"));
        model.Loops.Add(new LoopViewModel("director.commit", "4s ago", "3h ago"));
        model.Loops.Add(new LoopViewModel("catalog.sweep", "6h ago", "3h ago"));
        model.Loops.Add(new LoopViewModel("analysis.walk", "has not come round yet", "12m ago"));

        model.Activity.Add(new ActivityViewModel("11:48:01", "playout", "Handed Alive to the player.", Severity.Notice));
        model.Activity.Add(new ActivityViewModel("11:47:58", "director", "Committed a talk break ahead of Alive.", Severity.Notice));
        model.Activity.Add(new ActivityViewModel("11:47:12", "render", "Spoke a talk break in 2.1s.", Severity.Notice));
        model.Activity.Add(new ActivityViewModel("11:46:40", "enrichment", "Wikipedia returned nothing for Pearl Jam.", Severity.Warning));
        model.Activity.Add(new ActivityViewModel("11:44:03", "analysis", "Measured 6 records.", Severity.Notice));
        model.Activity.Add(new ActivityViewModel("11:41:19", "llm", "The model declined a talk break: wrong-daypart.", Severity.Warning));
        model.Activity.Add(new ActivityViewModel("11:39:02", "playout", "Icecast stopped answering its stats endpoint.", Severity.Failure));

        return new CheckupView { DataContext = model };
    }

    private static RunningOrderView Order()
    {
        var session = new SessionManager(new InMemorySecretStore(), Http());
        var model = new RunningOrderViewModel(session, new OperatorActions(session), Http(), ImmediateUiDispatcher.Instance)
        {
            IsOperator = true,
            Name = "Wednesday mornings",
            Brief = "Something with guitars, nothing after 1999.",
            Host = "Marla Vance",
            RunsDryLabel = "Runs dry at about 13:20",
            CanUndo = true,
            UndoLabel = "Dropped Jeremy",
        };

        model.Items.Add(Row("Alive", "Pearl Jam", StationItemState.Airing, canMove: false));
        model.Items.Add(Row("Talk break: Alive into Black", "", StationItemState.Handed, canMove: false, segment: true));
        model.Items.Add(Row("Black", "Pearl Jam", StationItemState.Planned, canMove: true));
        model.Items.Add(Row("Would?", "Alice In Chains", StationItemState.Planned, canMove: true));
        model.Items.Add(Row("Rooster", "Alice In Chains", StationItemState.Unavailable, canMove: true));
        model.Items.Add(Row("Nutshell", "Alice In Chains", StationItemState.Planned, canMove: true));

        return new RunningOrderView { DataContext = model };
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

    /// <summary>Dependencies that exist so a view model can be built, and are never called.</summary>
    private static OperatorActions Actions() => new(new SessionManager(new InMemorySecretStore(), Http()));

    private static HttpClient Http() => new(new Refuses());

    private sealed class Refuses : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
    }
}
