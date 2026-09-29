using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// A listener's request, and which decisions are still open on it.
/// </summary>
/// <remarks>
/// Grant offered on a request already on its way would ask the station for something it has done;
/// Decline on one in the running order belongs to the desk. And a listener's dedication is their own
/// words, which the list must show whole rather than half.
/// </remarks>
public class RequestsTests
{
    [Theory]
    [InlineData(RequestStatus.Waiting, true, true, true)]
    [InlineData(RequestStatus.Pending, true, false, true)]
    [InlineData(RequestStatus.Queued, true, false, false)]
    [InlineData(RequestStatus.Aired, false, false, false)]
    [InlineData(RequestStatus.Declined, false, false, false)]
    [InlineData(RequestStatus.Expired, false, false, false)]
    public void OnlyTheStatesThatCanBeDecidedOfferADecision(RequestStatus status, bool open, bool grant, bool decline)
    {
        Assert.Equal(open, Requests.IsOpen(status));
        Assert.Equal(grant, Requests.CanGrant(status));
        Assert.Equal(decline, Requests.CanDecline(status));
    }

    [Fact]
    public void WaitingIsTheOneStateDrawnForAttention()
    {
        Assert.Equal(StatusTone.Fault, Requests.Tone(RequestStatus.Waiting));
        Assert.Equal(StatusTone.Off, Requests.Tone(RequestStatus.Aired));
    }

    [Theory]
    [InlineData(null, null, null)]
    [InlineData("Ellie", null, "For Ellie")]
    [InlineData(null, "Rain.", "Dedicated: “Rain.”")]
    [InlineData("Ellie", "Rain.", "For Ellie: “Rain.”")]
    public void TheDedicationIsOneSentenceHoweverMuchWasFilledIn(string? to, string? message, string? expected) =>
        Assert.Equal(expected, Requests.Dedication(Request(RequestSource.App) with { DedicateTo = to, Message = message }));

    [Fact]
    public void DecliningSaysWhereTheListenerIsTold()
    {
        Assert.Equal("Sam is told it will not be played, in the chat they asked from.", Requests.Told(Request(RequestSource.Chat)));
        Assert.Equal("Sam is told it will not be played.", Requests.Told(Request(RequestSource.App)));
    }

    private static ListenerRequest Request(RequestSource source) => new()
    {
        Id = Guid.NewGuid(),
        Title = "Northern Sky",
        Artist = "Nick Drake",
        RequesterName = "Sam",
        Status = RequestStatus.Waiting,
        Source = source,
        CreatedAt = DateTimeOffset.UnixEpoch,
    };
}
