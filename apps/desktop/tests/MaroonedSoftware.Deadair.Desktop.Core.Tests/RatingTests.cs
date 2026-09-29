using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// How an opinion about an act, a release or a record is given.
/// </summary>
/// <remarks>
/// The answer on screen must be the one the station holds: a rating that changed on the press and
/// stayed changed after a refusal would tell the operator the rotation had moved when it had not.
/// </remarks>
public class RatingTests
{
    [Fact]
    public async Task AChoiceTheStationKeepsIsDrawn()
    {
        var rating = new RatingViewModel(Rating.Neutral, "Alive", (chosen, _) => Task.FromResult<Rating?>(chosen));

        await rating.SetCommand.ExecuteAsync("liked");

        Assert.True(rating.IsLiked);
        Assert.False(rating.IsDisliked);
    }

    [Fact]
    public async Task ARefusedChoiceLeavesTheOldAnswer()
    {
        var rating = new RatingViewModel(Rating.Liked, "Alive", (_, _) => Task.FromResult<Rating?>(null));

        await rating.SetCommand.ExecuteAsync("disliked");

        Assert.Equal(Rating.Liked, rating.Value);
    }

    [Fact]
    public async Task ChoosingTheAnswerItAlreadyHasSendsNothing()
    {
        var sent = 0;
        var rating = new RatingViewModel(Rating.Disliked, "Alive", (chosen, _) =>
        {
            sent++;
            return Task.FromResult<Rating?>(chosen);
        });

        await rating.SetCommand.ExecuteAsync("disliked");

        Assert.Equal(0, sent);
    }

    [Fact]
    public async Task TheMiddleWithdrawsAnOpinionAndIsNeverDrawnLit()
    {
        var rating = new RatingViewModel(Rating.Liked, "Alive", (chosen, _) => Task.FromResult<Rating?>(chosen));

        await rating.SetCommand.ExecuteAsync("neutral");

        Assert.Equal(Rating.Neutral, rating.Value);
        Assert.False(rating.IsLiked);
        Assert.False(rating.IsDisliked);
    }
}
