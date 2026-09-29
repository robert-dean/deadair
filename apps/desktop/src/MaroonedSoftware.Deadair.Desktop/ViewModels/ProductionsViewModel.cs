using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One programme being made.</summary>
public sealed record ProductionRowViewModel(string Id, string Title, string Kind, string State, bool CanCancel)
{
    public string? Brief { get; init; }

    /// <summary>How long, how it is written, how far along, and when it is due.</summary>
    public string? Details { get; init; }

    /// <summary>Who is on it, which answers "why was there somebody else in that programme".</summary>
    public string? Cast { get; init; }

    public string? Error { get; init; }
}

/// <summary>
/// Programmes the station writes for itself: several beats of speech, made over minutes and aired as
/// one block.
/// </summary>
/// <remarks>
/// Asking for one queues it; nothing is made while anybody waits, and it goes into the running order
/// once every beat has been spoken. So the dialog closes when the station has taken the request, and
/// the row shows it being made.
/// </remarks>
public sealed partial class ProductionsViewModel(OperatorActions actions, HttpClient http, IDialogs dialogs)
    : VoiceTabViewModel(actions, http)
{
    public ObservableCollection<ProductionRowViewModel> Productions { get; } = [];

    public string? Empty => Productions.Count > 0 ? null
        : "The station has not made anything yet. Ask for one, or put a line like 21:00 podcast on the station clock and one is "
            + "commissioned ahead of every slot.";

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var list = await RunAsync((sdk, token) => sdk.Productions.ListProductionsAsync(token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);

        if (list is not null)
        {
            Present(list.Productions);
        }
    }

    public void Present(IEnumerable<Production> productions)
    {
        ArgumentNullException.ThrowIfNull(productions);

        Productions.Clear();
        foreach (var production in productions)
        {
            Productions.Add(Row(production));
        }

        OnPropertyChanged(nameof(Empty));
    }

    /// <summary>A production as its row: the state in plain words, and the cast as it was stored.</summary>
    public static ProductionRowViewModel Row(Production production)
    {
        ArgumentNullException.ThrowIfNull(production);

        var minutes = Math.Max(1, (int)Math.Round(production.TargetMs / 60_000d));
        var details = new List<string>
        {
            minutes == 1 ? "about 1 minute" : $"about {minutes} minutes",
            $"{Wire.Name<ProductionWritingMode>(production.WritingMode)} write",
        };

        if (production.Beats > 0)
        {
            details.Add(production.Beats == 1 ? "1 beat written" : $"{production.Beats} beats written");
        }

        if (production.ScheduledFor is { } due)
        {
            details.Add($"due {due.ToLocalTime().ToString("ddd HH:mm", CultureInfo.CurrentCulture)}");
        }

        return new ProductionRowViewModel(production.Id, production.Title, production.Kind, StateWords(production.State), IsCancellable(production.State))
        {
            Brief = production.Brief,
            Details = string.Join(" · ", details),
            Cast = production.Cast.Count > 1 ? CastLine(production.Cast) : null,
            Error = production.Error,
        };
    }

    /// <summary>The state in words, rather than the machine's own.</summary>
    public static string StateWords(ProductionState state) => state switch
    {
        ProductionState.Planned => "queued",
        ProductionState.Outlining => "planning it",
        ProductionState.Drafting => "writing it",
        ProductionState.Checking => "checking it",
        ProductionState.Rendering => "speaking it",
        ProductionState.Stitching => "joining it up",
        ProductionState.Ready => "ready",
        ProductionState.Aired => "in the running order",
        ProductionState.Failed => "failed",
        ProductionState.Cancelled => "stopped",
        _ => state.ToString().ToLowerInvariant(),
    };

    /// <summary>Who presents and who rings in, from the stored cast, since a character may have been edited since.</summary>
    public static string CastLine(IReadOnlyList<ProductionCastMember> cast)
    {
        ArgumentNullException.ThrowIfNull(cast);

        var host = cast.FirstOrDefault(member => member.Role == ProductionCastMemberRole.Host && member.Name is not null)?.Name;
        var callers = string.Join(" and ", cast.Where(member => member.Role == ProductionCastMemberRole.Caller && member.Name is not null).Select(member => member.Name));

        return (host, callers.Length > 0) switch
        {
            ({ } presenter, true) => $"presented by {presenter}, with {callers}",
            ({ } presenter, false) => $"presented by {presenter}",
            (null, true) => $"with {callers}",
            _ => $"{cast.Count} voices",
        };
    }

    /// <summary>
    /// Anything short of ready or finished is still being made, and only that can be called off.
    /// </summary>
    /// <remarks>
    /// Listing the states that CAN be cancelled rather than the ones that cannot means a stage added
    /// upstream is not silently cancellable by omission.
    /// </remarks>
    public static bool IsCancellable(ProductionState state) =>
        state is ProductionState.Planned
            or ProductionState.Outlining
            or ProductionState.Drafting
            or ProductionState.Checking
            or ProductionState.Rendering
            or ProductionState.Stitching;

    /// <summary>Asks the station to make one, presented by a host of the operator's choosing or by whoever is on air.</summary>
    [RelayCommand]
    private async Task RequestAsync()
    {
        var roster = await RunAsync((sdk, token) => sdk.Personas.ListPersonasAsync(token)).ConfigureAwait(true);
        var dialog = new ProductionRequestDialogViewModel(Actions, Http, Station, roster?.Personas ?? []);
        if (await dialogs.ShowAsync(dialog).ConfigureAwait(true) && dialog.Result is { } production)
        {
            Notice = $"Queued {production.Title}. Nothing is made while you wait; it joins the running order once every beat is spoken.";
            await LoadAsync(CancellationToken.None).ConfigureAwait(true);
        }
    }

    [RelayCommand]
    private async Task CancelProductionAsync(ProductionRowViewModel production)
    {
        ArgumentNullException.ThrowIfNull(production);

        if (!await dialogs.ConfirmAsync(
                $"Cancel {production.Title}?",
                "What has been made so far is thrown away, and it will not air.",
                "Cancel production").ConfigureAwait(true))
        {
            return;
        }

        var cancelled = await RunAsync((sdk, token) => sdk.Productions.CancelProductionAsync(production.Id, token)).ConfigureAwait(true);
        if (cancelled is not null)
        {
            Notice = $"Cancelled {production.Title}.";
            await LoadAsync(CancellationToken.None).ConfigureAwait(true);
        }
    }
}

/// <summary>
/// A production asked for. The brief is what the planning pass actually works from, and matters far
/// more than the title does.
/// </summary>
public sealed partial class ProductionRequestDialogViewModel : DialogViewModel
{
    private readonly OperatorActions _actions;
    private readonly HttpClient _http;
    private readonly StationUrl _station;

    public ProductionRequestDialogViewModel(OperatorActions actions, HttpClient http, StationUrl station, IReadOnlyList<Persona> roster)
    {
        ArgumentNullException.ThrowIfNull(roster);

        _actions = actions;
        _http = http;
        _station = station;

        // Who PRESENTS it, so hosts only: the callers a production casts are chosen per beat.
        Presenters =
        [
            new ChoiceViewModel(string.Empty, "Whoever is on air when it is made"),
            .. roster.Where(persona => PersonaRoster.KindOf(persona) == PersonaKind.Host).Select(persona => new ChoiceViewModel(persona.Id, persona.Label)),
        ];
        _presenter = Presenters[0];
        _mode = Modes[0];
    }

    public override string Title => "Ask for a production";

    public override string AcceptLabel => "Ask for it";

    public override bool CanAccept => Name.Trim().Length > 0 && (Minutes.Trim().Length == 0 || int.TryParse(Minutes, out var minutes) && minutes > 0);

    public IReadOnlyList<ChoiceViewModel> Presenters { get; }

    public static IReadOnlyList<ChoiceViewModel> Modes { get; } =
    [
        new(string.Empty, "The station's default"),
        new("quick", "Quick: one draft per beat"),
        new("outlined", "Outlined: plan it, then write it"),
        new("polished", "Polished: plan, write, then check and fix"),
    ];

    [ObservableProperty]
    private string _name = string.Empty;

    [ObservableProperty]
    private string _brief = string.Empty;

    [ObservableProperty]
    private string _kind = "podcast";

    [ObservableProperty]
    private string _minutes = string.Empty;

    [ObservableProperty]
    private ChoiceViewModel _mode;

    [ObservableProperty]
    private ChoiceViewModel _presenter;

    public Production? Result { get; private set; }

    partial void OnNameChanged(string value) => Revalidate();

    partial void OnMinutesChanged(string value) => Revalidate();

    public override async Task<bool> AcceptAsync(CancellationToken cancellationToken)
    {
        var body = new ProductionRequest
        {
            Title = Name.Trim(),
            Kind = Kind.Trim().Length == 0 ? null : Kind.Trim(),
            Brief = Brief.Trim().Length == 0 ? null : Brief.Trim(),
            TargetMs = int.TryParse(Minutes, out var minutes) && minutes > 0 ? minutes * 60_000L : null,
            WritingMode = Wire.Parse<ProductionRequestWritingMode>(Mode.Value),
            PersonaId = Presenter.Value.Length == 0 ? null : Presenter.Value,
        };

        Result = await _actions.RunAsync(
            async token =>
            {
                using var sdk = VoiceTabViewModel.Sdk(_station, _http);
                return await sdk.Productions.RequestProductionAsync(body, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        return Result is not null;
    }
}
