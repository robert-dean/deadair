using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Director;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// Planning the station: keeping the show and programming what is still to come again, or starting
/// a new one.
/// </summary>
/// <remarks>
/// <para>
/// The web console's plan dialog, and its three decisions with it. The scope changes which fields
/// EXIST rather than which are greyed out, because a replan carries a brief and nothing else, and a
/// wall of disabled inputs invites the operator to try. The safe half is the default, because keeping
/// the show cuts nobody off and starting one is heard by everybody within a record. And keeping seeds
/// the brief off the broadcast, so the words steering it are visible and clearing them is an obvious
/// gesture, while a new show opens empty.
/// </para>
/// <para>
/// The dialog is itself the question asked before what airs changes, and a new show over one that is
/// playing colours its button for the reason the web console draws a warning line.
/// </para>
/// </remarks>
public sealed partial class PlanDialogViewModel : DialogViewModel
{
    private readonly OperatorActions _actions;
    private readonly OrderRepository _repository;
    private readonly StationOrder? _order;

    public PlanDialogViewModel(OperatorActions actions, OrderRepository repository, StationOrder? order, IReadOnlyList<Persona> hosts)
    {
        ArgumentNullException.ThrowIfNull(hosts);
        _actions = actions;
        _repository = repository;
        _order = order;

        // Nothing is on, so there is no show to keep and the choice is not a choice.
        CanKeep = order is { Items.Count: > 0 };
        _scope = CanKeep ? PlanScope.Keep : PlanScope.New;
        _brief = CanKeep ? order?.Brief ?? string.Empty : string.Empty;

        Hosts = [new HostChoice(null, "The station's host", null), .. hosts.Select(host => new HostChoice(
            host.Id,
            host.Presenting ? $"{host.Label} (on air)" : host.Label,
            null))];
        _host = Hosts[0];
        _mode = Modes[0];
        _onEnd = OnEnds[0];
    }

    public override string Title => "Plan";

    public override string AcceptLabel => IsKeep ? "Replan" : "Go on air";

    /// <summary>A new show over one that is playing stops what is playing.</summary>
    public override bool Destructive => IsNew && CanKeep;

    public override bool CanAccept => Hint is null;

    /// <summary>Whether there is a show on air to keep. Without one only a new show is offered.</summary>
    public bool CanKeep { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsKeep), nameof(IsNew), nameof(Intro), nameof(BriefHelp), nameof(Footer), nameof(AcceptLabel), nameof(Destructive))]
    private PlanScope _scope;

    public bool IsKeep => Scope == PlanScope.Keep;

    public bool IsNew => Scope == PlanScope.New;

    /// <summary>Whether to draw the warning that a new show stops the one playing.</summary>
    public bool WarnsNew => IsNew && CanKeep;

    public string Intro => IsKeep
        ? "Everything still to come is dropped and the station programmes that stretch again. What is playing, and what the player is already holding, keeps going."
        : "The station programmes itself against this, from your own library first and from your providers when the library cannot fill it. What you like and dislike is taken into account either way.";

    public string BriefHelp => IsKeep
        ? "This steers every refill for the rest of the broadcast, not just these records. Empty it and the station goes back to its ordinary rotation."
        : "In your own words, for the model that chooses records. It keeps steering every refill until the station is put on air again.";

    public string Footer => IsKeep
        ? "The host, the period and the shape belong to this show and keep running with it. Changing any of them starts a new one. The records are chosen before the old ones are dropped, so nothing goes quiet."
        : "Choosing records against your words needs a model configured to programme with. Without one the station plays its own rotation, which is the designed answer rather than a failure.";

    [ObservableProperty]
    private string _brief;

    public IReadOnlyList<HostChoice> Hosts { get; }

    [ObservableProperty]
    private HostChoice _host;

    [ObservableProperty]
    private string _eraFrom = string.Empty;

    [ObservableProperty]
    private string _eraTo = string.Empty;

    [ObservableProperty]
    private bool _callins;

    public IReadOnlyList<Choice<StationMode>> Modes { get; } =
    [
        new(StationMode.Rotation, "Rotation"),
        new(StationMode.Setlist, "Setlist"),
        new(StationMode.Feature, "Feature"),
    ];

    [ObservableProperty]
    private Choice<StationMode> _mode;

    public IReadOnlyList<Choice<StationOnEnd>> OnEnds { get; } =
    [
        new(StationOnEnd.Extend, "Keep going"),
        new(StationOnEnd.Repeat, "Start again"),
        new(StationOnEnd.Stop, "Stop"),
    ];

    [ObservableProperty]
    private Choice<StationOnEnd> _onEnd;

    /// <summary>What stops it being sent, said under the fields while it is true.</summary>
    public string? Hint => PlanRequest.Problem(Form());

    [RelayCommand]
    private void ShowScope(string scope)
    {
        if (!Enum.TryParse<PlanScope>(scope, out var wanted) || (wanted == PlanScope.Keep && !CanKeep) || wanted == Scope)
        {
            return;
        }

        Scope = wanted;

        // Keeping seeds the brief off the broadcast; a new show opens empty, because it mints a new
        // broadcast rather than editing this one.
        Brief = wanted == PlanScope.Keep ? _order?.Brief ?? string.Empty : string.Empty;
    }

    partial void OnScopeChanged(PlanScope value) => Changed();

    partial void OnBriefChanged(string value) => Changed();

    partial void OnEraFromChanged(string value) => Changed();

    partial void OnEraToChanged(string value) => Changed();

    private void Changed()
    {
        OnPropertyChanged(nameof(Hint));
        OnPropertyChanged(nameof(WarnsNew));
        Revalidate();
    }

    public PlanForm Form() => new(
        Scope,
        Brief,
        _order?.Brief,
        Host.Id,
        EraFrom,
        EraTo,
        Callins,
        Mode.Value,
        OnEnd.Value);

    public override async Task<bool> AcceptAsync(CancellationToken cancellationToken)
    {
        var form = Form();

        if (PlanRequest.Problem(form) is not null)
        {
            return false;
        }

        if (form.Scope == PlanScope.Keep)
        {
            return await _actions.DoAsync(
                token => _repository.ReplanAsync(PlanRequest.Replan(form), token),
                cancellationToken: cancellationToken).ConfigureAwait(true);
        }

        return await _actions.RunAsync(
            token => _repository.PutOnAirAsync(PlanRequest.PutOnAir(form), token),
            cancellationToken: cancellationToken).ConfigureAwait(true) is not null;
    }
}
