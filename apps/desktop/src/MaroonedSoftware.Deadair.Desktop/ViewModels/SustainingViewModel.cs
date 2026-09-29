using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// The Sustaining tab: what the station plays in the hours no block claims.
/// </summary>
/// <remarks>
/// <para>
/// A slot with the when-half taken off, drawn as the web console draws it: a sentence saying what
/// plays between blocks, and behind Change, the source picker (a provider's playlist or a chart, one
/// choice) above the station's own declared fields for the words, the period and the calls. The
/// picker's values go out in the same write as the form's, so the two halves cannot land apart.
/// </para>
/// <para>
/// Nothing here changes what is on air now. The station hands over at the first boundary after a
/// block ends, so a source saved now is what the NEXT gap plays.
/// </para>
/// </remarks>
public sealed partial class SustainingViewModel : ObservableObject
{
    private readonly OperatorActions _actions;
    private readonly Func<DeadairSdk> _sdk;
    private IReadOnlyList<CatalogPlaylist> _playlists = [];
    private IReadOnlyList<StationChart> _charts = [];
    private ProgrammeSource? _storedSource;
    private ScheduleSlotSourceChartOrder _storedOrder;

    public SustainingViewModel(OperatorActions actions, Func<DeadairSdk> sdk)
    {
        _actions = actions;
        _sdk = sdk;
        Settings = new SettingsSubsetViewModel(actions, sdk, Sustaining.FormKeys)
        {
            Extra = () => SourceWrites(),
        };
        Settings.Presented += Present;
    }

    /// <summary>The words, the period and the calls, through the shared form.</summary>
    public SettingsSubsetViewModel Settings { get; }

    public IReadOnlyList<ChartOrderChoice> ChartOrders { get; } =
    [
        new(ScheduleSlotSourceChartOrder.Countdown, "Countdown, ending on number one"),
        new(ScheduleSlotSourceChartOrder.Ranked, "Number one first"),
        new(ScheduleSlotSourceChartOrder.Unordered, "No fixed order"),
    ];

    [ObservableProperty]
    private IReadOnlyList<SourceChoice> _sources = [];

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsChart))]
    private SourceChoice? _source;

    [ObservableProperty]
    private ChartOrderChoice? _chartOrder;

    /// <summary>What plays between blocks, as one line. Empty until the station has answered.</summary>
    [ObservableProperty]
    private string _summary = string.Empty;

    /// <summary>Whether the form is out from behind Change.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ToggleLabel))]
    private bool _isOpen;

    public string ToggleLabel => IsOpen ? "Done" : "Change";

    public bool IsChart => Source?.Source is ProgrammeSource.Chart;

    public async Task LoadAsync(CancellationToken cancellationToken)
    {
        // The picker's choices first, so the summary can name what the settings point at.
        var playlists = await _actions.RunAsync(
            async token =>
            {
                using var client = _sdk();
                return await client.Playlists.ListImportablePlaylistsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        var charts = await _actions.RunAsync(
            async token =>
            {
                using var client = _sdk();
                return await client.Charts.ListChartsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        _playlists = playlists?.Playlists ?? _playlists;
        _charts = charts?.Charts ?? _charts;

        await Settings.LoadAsync(cancellationToken).ConfigureAwait(true);
    }

    /// <summary>Offers the picker's choices, for a page posed without a station.</summary>
    public void Offer(IReadOnlyList<CatalogPlaylist> playlists, IReadOnlyList<StationChart> charts)
    {
        _playlists = playlists;
        _charts = charts;
        Present();
    }

    [RelayCommand]
    private void Toggle() => IsOpen = !IsOpen;

    /// <summary>Redraws the picker and the sentence from what the station holds now.</summary>
    private void Present()
    {
        var values = Settings.Values;
        _storedSource = Sustaining.Source(values);
        _storedOrder = Sustaining.ChartOrder(values);

        // No station playlists here: the sustaining source has no key for one.
        Sources = SourceChoices.Build([], _playlists, _charts, _storedSource, includeOwned: false);
        Source = Sources.FirstOrDefault(choice => choice.Source == _storedSource) ?? Sources[0];
        ChartOrder = ChartOrders.First(choice => choice.Value == _storedOrder);
        Summary = Settings.HasForm ? Sustaining.Summary(values, _playlists, _charts) : string.Empty;
    }

    /// <summary>
    /// The picker's part of a save: all four source keys when it changed, and nothing when it did not,
    /// so a save of the brief alone leaves a source somebody else set in place.
    /// </summary>
    private Dictionary<string, JsonElement> SourceWrites()
    {
        var source = Source?.Source;
        var order = ChartOrder?.Value ?? ScheduleSlotSourceChartOrder.Countdown;
        var changed = source != _storedSource || (source is ProgrammeSource.Chart && order != _storedOrder);

        return changed ? Sustaining.Writes(source, order) : new Dictionary<string, JsonElement>();
    }
}
