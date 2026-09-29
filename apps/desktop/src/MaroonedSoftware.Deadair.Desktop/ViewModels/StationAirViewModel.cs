using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Director;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// The station's air, on the desk: who is driving it, whether the schedule may take it back, what
/// puts it on air, who presents it, planning it, taking a call, and rating the record on air.
/// </summary>
/// <remarks>
/// <para>
/// Owned by <see cref="RunningOrderViewModel"/> and fed from its poll: the air is read on the same
/// tick as the order (<see cref="OrderRepository"/>), so this holds no timer and no lease of its own,
/// and it is only fed while the order is, which is while somebody is signed in as the operator.
/// </para>
/// <para>
/// Everything here changes what airs, so every command asks first: the air mode and the hold through
/// a confirmation, and the host and the plan through dialogs that are themselves the question.
/// </para>
/// </remarks>
public sealed partial class StationAirViewModel(OperatorActions actions, IDialogs dialogs, HttpClient http) : ObservableObject
{
    private OrderRepository? _repository;
    private StationUrl _station;
    private StationOrder? _order;

    /// <summary>Whether an air reading has arrived. Nothing about it is drawn before one has.</summary>
    [ObservableProperty]
    private bool _hasAir;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsAudience), nameof(IsAlways))]
    private AirMode _mode = AirMode.Audience;

    public bool IsAudience => HasAir && Mode == AirMode.Audience;

    public bool IsAlways => HasAir && Mode == AirMode.Always;

    /// <summary>Who chose what is on, in words. Null while the station is stood down.</summary>
    [ObservableProperty]
    private string? _driving;

    [ObservableProperty]
    private string? _drivingHint;

    /// <summary>A person driving is the state worth noticing, because the schedule will end it.</summary>
    [ObservableProperty]
    private StatusTone _drivingTone = StatusTone.Off;

    [ObservableProperty]
    private bool _offersHold;

    [ObservableProperty]
    private bool _held;

    [ObservableProperty]
    private string _holdLine = string.Empty;

    /// <summary>What the broadcast on air was asked for, which keeps steering every refill.</summary>
    [ObservableProperty]
    private string? _brief;

    [ObservableProperty]
    private string _hostLabel = "Presented by the station's host";

    /// <summary>Whether a broadcast is loaded at all, which decides whether a plan can keep it.</summary>
    [ObservableProperty]
    private bool _hasOrder;

    [ObservableProperty]
    private bool _busy;

    /// <summary>The record on air, when it is one the catalog knows and so can hold an opinion of.</summary>
    private Guid? _playingTrack;

    [ObservableProperty]
    private bool _canRate;

    [ObservableProperty]
    private string? _playingTitle;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsLiked), nameof(IsDisliked), nameof(IsNeutral))]
    private Rating _rating = Rating.Neutral;

    public bool IsLiked => Rating == Rating.Liked;

    public bool IsDisliked => Rating == Rating.Disliked;

    public bool IsNeutral => Rating == Rating.Neutral;

    /// <summary>A rating is being written, so the order's older reading does not put the last one back.</summary>
    [ObservableProperty]
    private bool _ratingWriting;

    public void Attach(OrderRepository repository, StationUrl station)
    {
        // Nothing is drawn from what the repository last read: that may be a signed-out session's,
        // and the next tick of the order brings a reading for this one.
        _repository = repository;
        _station = station;
    }

    public void ApplyAir(StationAir air)
    {
        ArgumentNullException.ThrowIfNull(air);

        HasAir = true;
        Mode = air.AirMode;
        OnPropertyChanged(nameof(IsAudience));
        OnPropertyChanged(nameof(IsAlways));

        Driving = AirWords.Driving(air.AirSource);
        DrivingHint = AirWords.DrivingHint(air.AirSource);
        DrivingTone = air.AirSource == AirSource.Operator ? StatusTone.Standby : StatusTone.Off;

        Held = air.Held;
        OffersHold = AirWords.OffersHold(air.AirSource, air.Held);
        HoldLine = AirWords.Hold(air.Held, air.HoldUntil);
    }

    public void ApplyOrder(StationOrder order)
    {
        ArgumentNullException.ThrowIfNull(order);

        _order = order;
        Brief = string.IsNullOrWhiteSpace(order.Brief) ? null : order.Brief;
        HasOrder = order.Items.Count > 0;

        // Named even when the broadcast named nobody: a host who cannot be changed from the page
        // about what is on air is one an operator goes looking for, so the current answer is said
        // whichever way it was arrived at.
        HostLabel = $"Presented by {order.PersonaLabel ?? "the station's host"}";

        // The running order carries each record's rating, which is how the thumbs know what the
        // station already thinks of the record on air.
        var airing = order.Items.FirstOrDefault(item => item is { State: StationItemState.Airing, Kind: StationOrderItemKind.Track });
        _playingTrack = Guid.TryParse(airing?.TrackId, out var track) ? track : null;
        CanRate = _playingTrack is not null;
        PlayingTitle = airing?.Title;

        if (!RatingWriting)
        {
            Rating = airing?.Rating ?? Rating.Neutral;
        }
    }

    /// <summary>Forgets the station, before the app is pointed at another or the operator signs out.</summary>
    public void Reset()
    {
        _repository = null;
        _order = null;
        HasAir = false;
        Mode = AirMode.Audience;
        Driving = null;
        DrivingHint = null;
        DrivingTone = StatusTone.Off;
        OffersHold = false;
        Held = false;
        HoldLine = string.Empty;
        Brief = null;
        HostLabel = "Presented by the station's host";
        HasOrder = false;
        _playingTrack = null;
        CanRate = false;
        PlayingTitle = null;
        Rating = Rating.Neutral;
    }

    /// <summary>
    /// What the station thinks of the record on air, which is where an operator forms an opinion of
    /// one: they are hearing it.
    /// </summary>
    /// <remarks>
    /// No question first. A rating changes what the rotation draws later and nothing that is airing,
    /// and withdrawing it is the middle button. The write goes to the catalog, and the order is read
    /// again because it carries the rating.
    /// </remarks>
    [RelayCommand]
    private async Task RateAsync(string rating)
    {
        if (_playingTrack is not { } track || !Enum.TryParse<Rating>(rating, out var wanted) || wanted == Rating)
        {
            return;
        }

        var before = Rating;
        Rating = wanted;
        RatingWriting = true;
        try
        {
            var written = await actions.RunAsync(async token =>
            {
                using var sdk = new DeadairSdk(new SdkOptions { BaseUrl = _station.ApiBase, HttpClient = http });
                return await sdk.Catalog.RateTrackAsync(track, new RateInput { Rating = wanted }, token).ConfigureAwait(false);
            }).ConfigureAwait(true);

            if (written is null)
            {
                Rating = before;
            }
        }
        finally
        {
            RatingWriting = false;
        }

        _repository?.Kick();
    }

    /// <summary>
    /// Puts somebody on the phone: a short production, written and spoken a turn at a time.
    /// </summary>
    [RelayCommand]
    private async Task TakeCallAsync()
    {
        if (!HasOrder)
        {
            return;
        }

        // A failed read of the hosts still opens it: the call can always be presented by this show's own.
        var hosts = await HostsAsync(report: false).ConfigureAwait(true) ?? [];
        await dialogs.ShowAsync(new TakeACallDialogViewModel(actions, _station, http, _order?.PersonaId, _order?.PersonaLabel, hosts))
            .ConfigureAwait(true);
    }

    /// <summary>The air mode, asked before it is changed: it decides whether the station airs to nobody.</summary>
    [RelayCommand]
    private async Task SetModeAsync(string mode)
    {
        if (_repository is not { } repository || !Enum.TryParse<AirMode>(mode, out var wanted) || (HasAir && wanted == Mode))
        {
            return;
        }

        var asked = await dialogs.ConfirmAsync(
            $"Put the station on air {AirWords.Mode(wanted)}?",
            AirWords.ModeConsequence(wanted),
            "Change",
            destructive: false).ConfigureAwait(true);

        if (asked)
        {
            await RunAsync(token => repository.SetAirModeAsync(wanted, token)).ConfigureAwait(true);
        }
    }

    /// <summary>Holds the broadcast past the next block, until released.</summary>
    [RelayCommand]
    private Task HoldPastBlockAsync() => HoldAsync(
        null,
        "Keep this on past the next block?",
        "The schedule leaves this broadcast alone until you release it, so the next block does not start.");

    [RelayCommand]
    private Task HoldTwoHoursAsync() => HoldAsync(
        120,
        "Keep this on for two hours?",
        "The schedule leaves this broadcast alone for two hours. Any block that starts in that time is skipped.");

    private async Task HoldAsync(long? minutes, string question, string consequence)
    {
        if (_repository is not { } repository)
        {
            return;
        }

        if (await dialogs.ConfirmAsync(question, consequence, "Keep it on", destructive: false).ConfigureAwait(true))
        {
            await RunAsync(token => repository.HoldAsync(minutes, token)).ConfigureAwait(true);
        }
    }

    /// <summary>Hands the broadcast back to the schedule.</summary>
    [RelayCommand]
    private async Task ReleaseAsync()
    {
        if (_repository is not { } repository)
        {
            return;
        }

        var asked = await dialogs.ConfirmAsync(
            "Release this to the schedule?",
            "The next block takes the station over when it begins, and this broadcast ends then.",
            "Release",
            destructive: false).ConfigureAwait(true);

        if (asked)
        {
            await RunAsync(token => repository.ReleaseAsync(token)).ConfigureAwait(true);
        }
    }

    /// <summary>Changing what the station plays, from here on or as a new show.</summary>
    [RelayCommand]
    private async Task PlanAsync()
    {
        if (_repository is not { } repository)
        {
            return;
        }

        // The hosts are read when the dialog opens rather than kept: a character added on the Voice
        // page a minute ago should be offered. A failed read still opens the dialog, which can put a
        // show on air with the station's own host.
        var hosts = await HostsAsync(report: false).ConfigureAwait(true) ?? [];
        await dialogs.ShowAsync(new PlanDialogViewModel(actions, repository, _order, hosts)).ConfigureAwait(true);
    }

    /// <summary>Who presents the show on air: the one place it can change without starting another.</summary>
    [RelayCommand]
    private async Task RecastAsync()
    {
        if (_repository is not { } repository)
        {
            return;
        }

        if (await HostsAsync(report: true).ConfigureAwait(true) is not { } hosts)
        {
            return;
        }

        await dialogs.ShowAsync(new RecastDialogViewModel(actions, repository, _order?.PersonaId, hosts)).ConfigureAwait(true);
    }

    /// <summary>The station's hosts, callers left out. Null when they could not be read.</summary>
    private async Task<IReadOnlyList<Persona>?> HostsAsync(bool report)
    {
        async Task<PersonaList> Read(CancellationToken token)
        {
            using var sdk = new DeadairSdk(new SdkOptions { BaseUrl = _station.ApiBase, HttpClient = http });
            return await sdk.Personas.ListPersonasAsync(token).ConfigureAwait(false);
        }

        if (report)
        {
            var list = await actions.RunAsync(Read).ConfigureAwait(true);
            return list is null ? null : Presenters.Of(list.Personas);
        }

        try
        {
            return Presenters.Of((await Read(CancellationToken.None).ConfigureAwait(true)).Personas);
        }
        catch (HttpRequestException)
        {
            return null;
        }
    }

    private async Task RunAsync(Func<CancellationToken, Task<StationAir>> call)
    {
        Busy = true;
        try
        {
            await actions.RunAsync(call).ConfigureAwait(true);
        }
        finally
        {
            Busy = false;
        }
    }
}

/// <summary>One choice in a list, and what it is called.</summary>
public sealed record Choice<T>(T Value, string Label)
{
    public override string ToString() => Label;
}

/// <summary>A host a show can be given, or (with no id) the station's own.</summary>
public sealed record HostChoice(string? Id, string Label, string? Detail = null)
{
    public override string ToString() => Label;
}

/// <summary>
/// Who presents the show on air.
/// </summary>
/// <remarks>
/// "The station's host" is an entry rather than an absence: choosing it hands the show back, which
/// is something an operator means rather than leaves blank. Changing it rewrites the breaks already
/// written, which is why the dialog says so and is the question asked before it happens.
/// </remarks>
public sealed partial class RecastDialogViewModel : DialogViewModel
{
    private readonly OperatorActions _actions;
    private readonly OrderRepository _repository;
    private readonly string? _current;

    public RecastDialogViewModel(OperatorActions actions, OrderRepository repository, string? current, IReadOnlyList<Persona> hosts)
    {
        ArgumentNullException.ThrowIfNull(hosts);
        _actions = actions;
        _repository = repository;
        _current = current;

        var stationsOwn = hosts.FirstOrDefault(host => host.DefaultHost);
        Choices.Add(new HostChoice(null, "The station's host", stationsOwn?.Label));
        foreach (var host in hosts)
        {
            Choices.Add(new HostChoice(host.Id, host.Label, host.Presenting ? "on air now" : null));
        }

        _chosen = Choices.FirstOrDefault(choice => choice.Id == current);
    }

    public override string Title => "Who presents this show";

    public override string AcceptLabel => "Change host";

    public ObservableCollection<HostChoice> Choices { get; } = [];

    [ObservableProperty]
    private HostChoice? _chosen;

    partial void OnChosenChanged(HostChoice? value) => Revalidate();

    /// <summary>Only a change: choosing whoever already presents would rewrite the breaks for nothing.</summary>
    public override bool CanAccept => Chosen is not null && Chosen.Id != _current;

    public override async Task<bool> AcceptAsync(CancellationToken cancellationToken) =>
        await _actions.RunAsync(token => _repository.RecastAsync(Chosen?.Id, token), cancellationToken: cancellationToken)
            .ConfigureAwait(true) is not null;
}
