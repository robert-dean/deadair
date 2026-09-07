using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class SessionManagerTests
{
    private const string Origin = "https://radio.example.com";
    private const string Other = "https://other.example.com";

    private static StationUrl Station(string origin)
    {
        Assert.True(StationUrl.TryParse(origin, out var station));
        return station;
    }

    private static (SessionManager Session, InMemorySecretStore Store, FakeTransport Transport) Build()
    {
        var transport = new FakeTransport();
        SessionManager? manager = null;
        var handler = new SessionHandler(() => manager) { InnerHandler = transport };
        var client = new HttpClient(handler);
        var store = new InMemorySecretStore();
        manager = new SessionManager(store, client);
        return (manager, store, transport);
    }

    [Fact]
    public async Task ReadsTheRolesAtSignInAndRemembersThem()
    {
        var (session, store, _) = Build();
        await session.AttachAsync(Station(Origin), TestContext.Current.CancellationToken);

        await session.SignInAsync("operator@example.com", "hunter2", TestContext.Current.CancellationToken);

        var state = Assert.IsType<SessionState.SignedIn>(session.State);
        Assert.True(state.IsOperator);

        var stored = await store.ReadAsync(Origin, TestContext.Current.CancellationToken);
        Assert.Equal(PlatformRole.Admin, Assert.Single(stored!.Roles));
    }

    [Fact]
    public async Task DropsASessionHeldForADifferentStation()
    {
        var (session, store, _) = Build();
        await session.AttachAsync(Station(Origin), TestContext.Current.CancellationToken);
        await session.SignInAsync("operator@example.com", "hunter2", TestContext.Current.CancellationToken);

        // Pointing the app somewhere else. A token is only meaningful to the station that issued it,
        // so what is held for this one is simply not offered to that one.
        await session.AttachAsync(Station(Other), TestContext.Current.CancellationToken);

        Assert.IsType<SessionState.SignedOut>(session.State);

        // And the original is left alone rather than deleted: coming back to it should not need
        // another sign-in.
        Assert.NotNull(await store.ReadAsync(Origin, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task RestoresASessionFromTheStore()
    {
        var (session, store, _) = Build();
        await store.WriteAsync(
            new StoredSession
            {
                Origin = Origin,
                Email = "operator@example.com",
                AccessToken = "kept-access",
                RefreshToken = "kept-refresh",
                Roles = [PlatformRole.Admin],
            },
            TestContext.Current.CancellationToken);

        await session.AttachAsync(Station(Origin), TestContext.Current.CancellationToken);

        var state = Assert.IsType<SessionState.SignedIn>(session.State);
        Assert.Equal("operator@example.com", state.Email);
        Assert.True(state.IsOperator);
    }

    [Fact]
    public async Task SigningOutClearsTheSessionEvenIfTheStationNeverHeard()
    {
        var (session, store, transport) = Build();
        await session.AttachAsync(Station(Origin), TestContext.Current.CancellationToken);
        await session.SignInAsync("operator@example.com", "hunter2", TestContext.Current.CancellationToken);

        transport.AnswerOnce(System.Net.HttpStatusCode.ServiceUnavailable);
        await session.SignOutAsync(TestContext.Current.CancellationToken);

        // An operator who pressed sign out and is still signed in because the station was unreachable
        // has been ignored. The local clear is unconditional.
        Assert.IsType<SessionState.SignedOut>(session.State);
        Assert.Null(await store.ReadAsync(Origin, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task KeepsTheOldRefreshTokenWhenARotationDoesNotSupplyANewOne()
    {
        var (session, store, transport) = Build();
        await session.AttachAsync(Station(Origin), TestContext.Current.CancellationToken);
        await session.SignInAsync("operator@example.com", "hunter2", TestContext.Current.CancellationToken);

        transport.RefreshOmitsRefreshToken = true;
        var outcome = await session.RefreshedAsync("first-access", TestContext.Current.CancellationToken);

        Assert.IsType<RefreshOutcome.Renewed>(outcome);

        // Dropping it here would end the session at the FOLLOWING refresh, which is a bug that shows
        // up fifteen minutes after the change that caused it.
        var stored = await store.ReadAsync(Origin, TestContext.Current.CancellationToken);
        Assert.Equal("first-refresh", stored!.RefreshToken);
    }

    [Fact]
    public async Task ARefreshForATokenSomebodyElseAlreadyReplacedReturnsTheirs()
    {
        var (session, _, transport) = Build();
        await session.AttachAsync(Station(Origin), TestContext.Current.CancellationToken);
        await session.SignInAsync("operator@example.com", "hunter2", TestContext.Current.CancellationToken);

        var exchangesBefore = transport.Exchanges;

        // A caller arriving with a token that is already stale. Spending the refresh token again would
        // revoke the whole family, so the answer is the token that is current.
        var outcome = await session.RefreshedAsync("a-token-nobody-holds", TestContext.Current.CancellationToken);

        var renewed = Assert.IsType<RefreshOutcome.Renewed>(outcome);
        Assert.Equal("first-access", renewed.AccessToken);
        Assert.Equal(exchangesBefore, transport.Exchanges);
    }

    [Fact]
    public async Task ASecondFactorIsA200AndNotAFailure()
    {
        var (session, _, transport) = Build();
        transport.RequiresSecondFactor = true;
        await session.AttachAsync(Station(Origin), TestContext.Current.CancellationToken);

        var result = await session.SignInAsync("operator@example.com", "hunter2", TestContext.Current.CancellationToken);

        var challenge = Assert.IsType<SignInResult.SecondFactorNeeded>(result);
        Assert.Equal("c_0193f2a1", challenge.ChallengeId);
        Assert.IsType<SessionState.SignedOut>(session.State);

        transport.RequiresSecondFactor = false;
        var completed = await session.CompleteSecondFactorAsync(
            "operator@example.com", challenge.ChallengeId, challenge.Factors[0].MethodId, "123456",
            TestContext.Current.CancellationToken);

        Assert.IsType<SignInResult.Ok>(completed);
        Assert.IsType<SessionState.SignedIn>(session.State);
    }

    [Fact]
    public async Task AWrongPasswordIsItsOwnAnswerRatherThanAnError()
    {
        var (session, _, transport) = Build();
        transport.AnswerOnce(System.Net.HttpStatusCode.Unauthorized);
        await session.AttachAsync(Station(Origin), TestContext.Current.CancellationToken);

        var result = await session.SignInAsync("operator@example.com", "wrong", TestContext.Current.CancellationToken);

        Assert.IsType<SignInResult.BadCredentials>(result);
    }

    [Fact]
    public async Task AnAccountWithNoRolesIsSignedInAndDrawsNoOperatorControls()
    {
        var (session, _, transport) = Build();
        transport.SessionIsForbidden = true;
        await session.AttachAsync(Station(Origin), TestContext.Current.CancellationToken);

        await session.SignInAsync("listener@example.com", "hunter2", TestContext.Current.CancellationToken);

        // Onboarding writes only `admin`, so an account that arrived any other way holds nothing. It
        // is an ordinary state and not a failed sign-in — and listening needs no account at all.
        var state = Assert.IsType<SessionState.SignedIn>(session.State);
        Assert.False(state.IsOperator);
        Assert.Empty(state.Roles);
    }
}
