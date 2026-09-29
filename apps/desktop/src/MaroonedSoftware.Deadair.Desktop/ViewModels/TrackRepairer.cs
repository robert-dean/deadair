using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One entry in a record's Repair menu.</summary>
public sealed class RepairChoiceViewModel(string label, IAsyncRelayCommand run)
{
    public string Label { get; } = label;

    public IAsyncRelayCommand RunCommand { get; } = run;
}

/// <summary>
/// Asks, then does one repair to one record, the same way from the list and from the record's page.
/// </summary>
/// <remarks>
/// The station's answer is kept rather than a bare "done". "Dropped 2 copies" and "The station was not
/// holding any copies of this record" are different facts about the record, and a menu that closed
/// silently would throw away the more interesting one. A record about to air is left alone with a 409,
/// whose own sentence says what to do instead, so that is reported as the station words it.
/// </remarks>
public sealed class TrackRepairer(OperatorActions actions, IDialogs dialogs, Func<DeadairSdk> sdk)
{
    /// <summary>Asks, and does it. Answers the station's own account of what happened, or null.</summary>
    public async Task<string?> RepairAsync(Guid trackId, TrackRepair repair, CancellationToken cancellationToken = default)
    {
        var words = TrackRepairs.Words(repair);
        if (!await dialogs.ConfirmAsync(words.Question, words.Consequence, words.Verb, Destroys(repair)).ConfigureAwait(true))
        {
            return null;
        }

        var result = await actions.RunAsync(
            async token =>
            {
                using var client = sdk();
                return await Call(client, trackId, repair, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        return result?.Detail;
    }

    /// <summary>
    /// Does one repair to each record in turn, without asking each time, and counts what happened.
    /// </summary>
    /// <remarks>
    /// One after another rather than all at once. Every one of these sends the station to fetch a
    /// record, and a hundred at one provider together is the request storm the backoff being cleared
    /// exists to prevent. A record the station will not act on is counted, not thrown, so it cannot
    /// stop the other ninety-nine.
    /// </remarks>
    public async Task<(int Done, int Refused)> RepairAllAsync(
        IReadOnlyList<Guid> trackIds,
        TrackRepair repair,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(trackIds);

        var done = 0;
        var refused = 0;
        foreach (var id in trackIds)
        {
            var result = await actions.RunAsync(
                async token =>
                {
                    using var client = sdk();
                    return await Call(client, id, repair, token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (result is null)
            {
                refused++;
            }
            else
            {
                done++;
            }
        }

        return (done, refused);
    }

    /// <summary>The menu for one record, whose entries each ask and then report through <paramref name="said"/>.</summary>
    public IReadOnlyList<RepairChoiceViewModel> Menu(Guid trackId, Action<string> said) =>
        TrackRepairs.All
            .Select(repair => new RepairChoiceViewModel(
                TrackRepairs.Words(repair).Label,
                new AsyncRelayCommand(async () =>
                {
                    if (await RepairAsync(trackId, repair).ConfigureAwait(true) is { } detail)
                    {
                        said(detail);
                    }
                })))
            .ToList();

    /// <summary>The three that throw something away are drawn as destructive; retrying and re-offering throw nothing away.</summary>
    public static bool Destroys(TrackRepair repair) => repair is TrackRepair.Audio or TrackRepair.Analysis or TrackRepair.Enrichment;

    private static Task<TrackClearResult> Call(DeadairSdk client, Guid id, TrackRepair repair, CancellationToken token) => repair switch
    {
        TrackRepair.Audio => client.Catalog.ClearTrackAudioAsync(id, token),
        TrackRepair.Analysis => client.Catalog.ClearTrackAnalysisAsync(id, token),
        TrackRepair.Enrichment => client.Catalog.ClearTrackEnrichmentAsync(id, cancellationToken: token),
        TrackRepair.Retry => client.Catalog.RetryTrackAudioAsync(id, token),
        TrackRepair.Offer => client.Catalog.OfferTrackCopiesAgainAsync(id, token),
        _ => throw new ArgumentOutOfRangeException(nameof(repair), repair, null),
    };
}
