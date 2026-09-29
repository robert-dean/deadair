using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One programme being made.</summary>
public sealed record ProductionRowViewModel(string Id, string Title, string Kind, string State, bool CanCancel);

/// <summary>What the station is making: phone-ins and features, from outline to stitched audio.</summary>
public sealed partial class ProductionsViewModel(OperatorActions actions, HttpClient http, IDialogs dialogs)
    : VoiceTabViewModel(actions, http)
{
    public ObservableCollection<ProductionRowViewModel> Productions { get; } = [];

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var list = await RunAsync((sdk, token) => sdk.Productions.ListProductionsAsync(token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);

        if (list is null)
        {
            return;
        }

        Productions.Clear();
        foreach (var production in list.Productions)
        {
            Productions.Add(new ProductionRowViewModel(
                production.Id,
                production.Title,
                production.Kind,
                production.State.ToString().ToLowerInvariant(),
                IsCancellable(production.State)));
        }
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
