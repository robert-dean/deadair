using System.Net;
using System.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// One rejected token becomes one refresh and one retry, and the token endpoints are left alone.
/// </summary>
public class SessionHandlerTests
{
    private const string Origin = "https://radio.example.com";

    [Fact]
    public async Task AttachesTheBearerToAnOrdinaryRequest()
    {
        var (client, transport, _) = await SignedInAsync();

        await client.GetAsync(new Uri($"{Origin}/api/playout/status"), TestContext.Current.CancellationToken);

        Assert.Equal("Bearer first-access", transport.Seen[0].Authorization);
    }

    [Fact]
    public async Task RefreshesOnceAndReplaysOnceOnA401()
    {
        var (client, transport, _) = await SignedInAsync();
        transport.AnswerOnce(HttpStatusCode.Unauthorized);

        var response = await client.GetAsync(
            new Uri($"{Origin}/api/playout/status"),
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        // The rejected call, the token exchange, and the replay. Not two replays and not two
        // exchanges: a refresh token is single-use, and presenting a spent one revokes the family.
        Assert.Equal(3, transport.Seen.Count);
        Assert.Equal("Bearer first-access", transport.Seen[0].Authorization);
        Assert.EndsWith("/auth/token", transport.Seen[1].Path, StringComparison.Ordinal);
        Assert.Equal("Bearer second-access", transport.Seen[2].Authorization);
    }

    [Fact]
    public async Task DoesNotRefreshForTheTokenEndpointItself()
    {
        var (client, transport, _) = await SignedInAsync();
        transport.AnswerOnce(HttpStatusCode.Unauthorized);

        var response = await client.PostAsync(
            new Uri($"{Origin}/api/auth/token"),
            new StringContent("grant_type=password"),
            TestContext.Current.CancellationToken);

        // A 401 here is a wrong password, and refreshing in response to one would be a loop rather
        // than a recovery.
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Single(transport.Seen);
    }

    [Fact]
    public async Task ReplaysTheBodyRatherThanSendingAnEmptyOne()
    {
        var (client, transport, _) = await SignedInAsync();
        transport.AnswerOnce(HttpStatusCode.Unauthorized);

        await client.PostAsync(
            new Uri($"{Origin}/api/director/air/extend"),
            new StringContent("{\"minutes\":30}", Encoding.UTF8, "application/json"),
            TestContext.Current.CancellationToken);

        // The reason the handler buffers before sending: a stream that has been read once cannot be
        // read again, and a replay with an empty body is a request the station answers differently.
        Assert.Equal("{\"minutes\":30}", transport.Seen[^1].Body);
    }

    [Fact]
    public async Task EndsTheSessionWhenTheRefreshIsRefused()
    {
        var (client, transport, session) = await SignedInAsync();
        transport.AnswerOnce(HttpStatusCode.Unauthorized);
        transport.RefreshAnswers = HttpStatusCode.BadRequest;

        var response = await client.GetAsync(
            new Uri($"{Origin}/api/playout/status"),
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.IsType<SessionState.SignedOut>(session.State);
    }

    [Fact]
    public async Task KeepsTheSessionWhenTheRefreshFailsBecauseTheStationIsDown()
    {
        var (client, transport, session) = await SignedInAsync();
        transport.AnswerOnce(HttpStatusCode.Unauthorized);
        transport.RefreshAnswers = HttpStatusCode.BadGateway;

        await client.GetAsync(new Uri($"{Origin}/api/playout/status"), TestContext.Current.CancellationToken);

        // A 4xx to the refresh ends a session and NOTHING else does. Signing somebody out because
        // their wifi dropped, or because the station restarted, is the wrong answer.
        Assert.IsType<SessionState.SignedIn>(session.State);
    }

    [Fact]
    public async Task TwoRequestsRejectedTogetherProduceOneExchange()
    {
        var (client, transport, _) = await SignedInAsync();
        transport.AnswerOnce(HttpStatusCode.Unauthorized);
        transport.AnswerOnce(HttpStatusCode.Unauthorized);

        await Task.WhenAll(
            client.GetAsync(new Uri($"{Origin}/api/playout/status"), TestContext.Current.CancellationToken),
            client.GetAsync(new Uri($"{Origin}/api/director/air"), TestContext.Current.CancellationToken));

        // The single-flight rule, which is the one that costs a whole sign-in when it is wrong: the
        // second caller finds the token already replaced and uses it rather than spending the
        // refresh token again.
        var exchanges = transport.Seen.Count(seen => seen.Path.EndsWith("/auth/token", StringComparison.Ordinal));
        Assert.Equal(1, exchanges);
    }

    private static async Task<(HttpClient Client, FakeTransport Transport, SessionManager Session)> SignedInAsync()
    {
        var transport = new FakeTransport();
        SessionManager? manager = null;

        var handler = new SessionHandler(() => manager) { InnerHandler = transport };
        var client = new HttpClient(handler);

        var store = new InMemorySecretStore();
        manager = new SessionManager(store, client);

        Assert.True(StationUrl.TryParse(Origin, out var station));
        await manager.AttachAsync(station, TestContext.Current.CancellationToken);

        var result = await manager.SignInAsync("operator@example.com", "hunter2", TestContext.Current.CancellationToken);
        Assert.IsType<SignInResult.Ok>(result);

        transport.Seen.Clear();
        return (client, transport, manager);
    }
}
