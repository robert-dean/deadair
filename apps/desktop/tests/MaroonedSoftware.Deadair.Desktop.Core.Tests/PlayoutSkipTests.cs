using System.Net;
using MaroonedSoftware.Deadair.Desktop.Core.Playout;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Sdk.Runtime;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Skip, on the wire.
/// </summary>
/// <remarks>
/// The window reads the station every couple of seconds, so the record it shows can have ended before
/// a press arrives. The button names that record and the station refuses the press (409) rather than
/// cutting the next one; the media key names nothing and skips what is on.
/// </remarks>
public class PlayoutSkipTests
{
    [Fact]
    public async Task ANamedSkipCarriesTheRecord_AndARefusalIsTheStationsToSay()
    {
        var (playout, seen) = Build();

        var refusal = await Assert.ThrowsAnyAsync<SdkException>(() => playout.SkipAsync("item-7", TestContext.Current.CancellationToken));

        Assert.Equal(HttpStatusCode.Conflict, refusal.StatusCode);
        var asked = Assert.Single(seen);
        Assert.EndsWith("/playout/skip", asked.AbsolutePath, StringComparison.Ordinal);
        Assert.Equal("?item=item-7", asked.Query);
    }

    [Fact]
    public async Task ASkipWithNothingToNameAsksForWhateverIsOn()
    {
        var (playout, seen) = Build();

        await Assert.ThrowsAnyAsync<SdkException>(() => playout.SkipAsync(cancellationToken: TestContext.Current.CancellationToken));

        Assert.Equal(string.Empty, Assert.Single(seen).Query);
    }

    private static (PlayoutRepository Playout, List<Uri> Seen) Build()
    {
        Assert.True(StationUrl.TryParse("https://radio.example.com", out var station));
        var seen = new List<Uri>();
        return (new PlayoutRepository(station, new HttpClient(new Refuses(seen))), seen);
    }

    private sealed class Refuses(List<Uri> seen) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            seen.Add(request.RequestUri!);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Conflict));
        }
    }
}
