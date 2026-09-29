using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// A rating that writes to the station, for each of the three things that can be rated.
/// </summary>
/// <remarks>
/// One place for it, because a record is rated from the records list, a release's page and its own
/// page, and three copies of the call would be three chances for one of them to draw an answer the
/// station never kept.
/// </remarks>
public static class CatalogRatings
{
    public static RatingViewModel Track(OperatorActions actions, Func<DeadairSdk> sdk, Guid id, Rating rating, string label) =>
        new(rating, label, async (chosen, cancellationToken) =>
        {
            var rated = await actions.RunAsync(
                async token =>
                {
                    using var client = sdk();
                    return await client.Catalog.RateTrackAsync(id, new RateInput { Rating = chosen }, token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);
            return rated?.Rating;
        });

    public static RatingViewModel Artist(OperatorActions actions, Func<DeadairSdk> sdk, Guid id, Rating rating, string label) =>
        new(rating, label, async (chosen, cancellationToken) =>
        {
            var rated = await actions.RunAsync(
                async token =>
                {
                    using var client = sdk();
                    return await client.Catalog.RateArtistAsync(id, new RateInput { Rating = chosen }, token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);
            return rated?.Rating;
        });

    public static RatingViewModel Album(OperatorActions actions, Func<DeadairSdk> sdk, Guid id, Rating rating, string label) =>
        new(rating, label, async (chosen, cancellationToken) =>
        {
            var rated = await actions.RunAsync(
                async token =>
                {
                    using var client = sdk();
                    return await client.Catalog.RateAlbumAsync(id, new RateInput { Rating = chosen }, token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);
            return rated?.Rating;
        });
}
