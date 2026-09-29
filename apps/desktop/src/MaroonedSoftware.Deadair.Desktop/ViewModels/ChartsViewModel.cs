using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>A published chart the station can be put on air from.</summary>
public sealed record ChartRowViewModel(string Id, string Name, string Source)
{
    /// <summary>A chart is a list the station builds, so there is no cover: the square is a letter.</summary>
    public string Initial => Name.Length == 0 ? "?" : char.ToUpperInvariant(Name[0]).ToString();
}

/// <summary>
/// The charts the station's plugins publish, read before and put on air.
/// </summary>
public sealed partial class ChartsViewModel(
    OperatorActions actions,
    HttpClient http,
    NavigationViewModel navigation,
    IDialogs dialogs) : LibraryTabViewModel(actions, http)
{
    public ObservableCollection<ChartRowViewModel> Charts { get; } = [];

    protected override async Task<bool> ReadAsync(CancellationToken cancellationToken)
    {
        var list = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Charts.ListChartsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (list is null)
        {
            return false;
        }

        Charts.Clear();
        foreach (var chart in list.Charts)
        {
            Charts.Add(new ChartRowViewModel(chart.Id, chart.Name, chart.PluginId));
        }

        return true;
    }

    /// <summary>Opens a chart to read before putting it on air.</summary>
    [RelayCommand]
    private void Open(ChartRowViewModel chart)
    {
        ArgumentNullException.ThrowIfNull(chart);
        navigation.Push(new Navigation.Destination.ChartDetail(chart.Id, chart.Name));
    }

    /// <remarks>
    /// A chart answers with the status BEFORE the changeover and does the work as a job, so there is
    /// nothing immediate to report beyond having asked.
    /// </remarks>
    [RelayCommand]
    private async Task PlayAsync(ChartRowViewModel chart)
    {
        ArgumentNullException.ThrowIfNull(chart);

        if (!await dialogs.ConfirmAsync(
                $"Put {chart.Name} on air?",
                "It replaces the running order with the chart's records. What is on air now finishes first.",
                "Put on air").ConfigureAwait(true))
        {
            return;
        }

        var status = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Playout.PlayAChartAsync(new PlayoutChartInput { ChartId = chart.Id }, token)
                    .ConfigureAwait(false);
            },
            new Dictionary<int, string> { [422] = "That chart could not be read." })
            .ConfigureAwait(true);

        if (status is not null)
        {
            Notice = $"Building a running order from {chart.Name}. It takes a moment.";
        }
    }

    public override void Reset()
    {
        base.Reset();
        Charts.Clear();
    }
}
