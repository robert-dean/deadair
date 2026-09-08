using System.Net;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Answering a second factor, and the three ways a station refuses one.
/// </summary>
/// <remarks>
/// Written after a real report that "the 2FA code is not accepted". The code was fine: the app was
/// sending the FIRST factor of the challenge rather than the authenticator, the station refused it
/// as `invalid_factor`, and the app reported "that code was not accepted" — so the one message the
/// operator could see was the one that ruled out the actual cause.
/// </remarks>
public class SecondFactorTests
{
    private const string Origin = "https://radio.example.com";

    private static MfaChallengeFactor Factor(AuthenticationFactorMethod method, string methodId) => new()
    {
        Method = method,
        MethodId = methodId,
        Kind = AuthenticationFactorKind.Knowledge,
    };

    [Fact]
    public void PicksTheAuthenticatorRatherThanWhicheverFactorIsFirst()
    {
        // A challenge lists every enrolled factor in ENROLMENT order, so an email factor enrolled
        // first sits ahead of the authenticator — and this app can only answer the authenticator.
        List<MfaChallengeFactor> factors =
        [
            Factor(AuthenticationFactorMethod.Email, "email-1"),
            Factor(AuthenticationFactorMethod.Authenticator, "totp-1"),
        ];

        var usable = ChallengeFactors.Authenticators(factors);

        Assert.Equal("totp-1", Assert.Single(usable).MethodId);
    }

    [Fact]
    public void AnswersNothingWhenTheAccountHasNoAuthenticator()
    {
        // Better than a code box that would refuse every code: the app cannot complete this sign-in
        // and should say so rather than let somebody keep trying.
        List<MfaChallengeFactor> factors = [Factor(AuthenticationFactorMethod.Email, "email-1")];

        Assert.Empty(ChallengeFactors.Authenticators(factors));
    }

    [Fact]
    public async Task AWrongCodeIsReportedAsAWrongCode()
    {
        var (session, transport) = await ChallengedAsync();
        transport.TokenRefusal = ("invalid_grant", HttpStatusCode.Unauthorized);

        var result = await session.CompleteSecondFactorAsync(
            "operator@example.com", "c_1", "totp-1", "000000", TestContext.Current.CancellationToken);

        Assert.IsType<SignInResult.BadCredentials>(result);
    }

    [Fact]
    public async Task AFactorTheStationWillNotAcceptIsNotAWrongCode()
    {
        // The bug's own signature. The station says `invalid_factor`, which means the method id was
        // wrong — not the digits — and reporting it as a bad code sends somebody to re-read their
        // authenticator forever.
        var (session, transport) = await ChallengedAsync();
        transport.TokenRefusal = ("invalid_factor", HttpStatusCode.Unauthorized);

        var result = await session.CompleteSecondFactorAsync(
            "operator@example.com", "c_1", "email-1", "123456", TestContext.Current.CancellationToken);

        Assert.IsType<SignInResult.FactorRefused>(result);
    }

    [Fact]
    public async Task AnExpiredChallengeIsItsOwnAnswer()
    {
        // A code can be retyped; an expired challenge cannot be answered at all, so the remedy is to
        // start again rather than to try harder.
        var (session, transport) = await ChallengedAsync();
        transport.TokenRefusal = ("invalid_challenge", HttpStatusCode.Unauthorized);

        var result = await session.CompleteSecondFactorAsync(
            "operator@example.com", "c_1", "totp-1", "123456", TestContext.Current.CancellationToken);

        Assert.IsType<SignInResult.ChallengeExpired>(result);
    }

    [Fact]
    public async Task ARightCodeSignsIn()
    {
        var (session, _) = await ChallengedAsync();

        var result = await session.CompleteSecondFactorAsync(
            "operator@example.com", "c_1", "totp-1", "123456", TestContext.Current.CancellationToken);

        Assert.IsType<SignInResult.Ok>(result);
        Assert.IsType<SessionState.SignedIn>(session.State);
    }

    [Fact]
    public async Task TheProofGrantCarriesTheMethodTheCodeBelongsTo()
    {
        var (session, transport) = await ChallengedAsync();
        transport.Seen.Clear();

        await session.CompleteSecondFactorAsync(
            "operator@example.com", "c_1", "totp-1", "123456", TestContext.Current.CancellationToken);

        var body = transport.Seen.Single(seen => seen.Path.EndsWith("/auth/token", StringComparison.Ordinal)).Body!;

        Assert.Contains("grant_type=authenticator", body, StringComparison.Ordinal);
        Assert.Contains("mfa_challenge_id=c_1", body, StringComparison.Ordinal);
        Assert.Contains("method_id=totp-1", body, StringComparison.Ordinal);
        Assert.Contains("code=123456", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TheLoginPanelSendsTheAuthenticatorEvenWhenAnotherFactorIsListedFirst()
    {
        // The regression test for the report. Driving the panel itself rather than the helper,
        // because the bug was in which factor the panel PICKED, and every layer beneath it was fine.
        var transport = new FakeTransport
        {
            RequiresSecondFactor = true,
            ChallengeFactorsJson = """
                [
                  { "method": "email", "method_id": "email-1", "kind": "possession" },
                  { "method": "authenticator", "method_id": "totp-1", "kind": "knowledge" }
                ]
                """,
        };

        SessionManager? manager = null;
        var handler = new SessionHandler(() => manager) { InnerHandler = transport };
        var client = new HttpClient(handler);
        manager = new SessionManager(new InMemorySecretStore(), client);

        Assert.True(StationUrl.TryParse(Origin, out var station));
        await manager.AttachAsync(station, TestContext.Current.CancellationToken);

        var login = new MaroonedSoftware.Deadair.Desktop.ViewModels.LoginViewModel(manager)
        {
            Email = "operator@example.com",
            Password = "hunter2",
        };

        await login.SubmitCommand.ExecuteAsync(null);
        Assert.True(login.NeedsCode);
        Assert.Null(login.Problem);

        transport.RequiresSecondFactor = false;
        transport.Seen.Clear();
        login.Code = "123456";

        await login.SubmitCommand.ExecuteAsync(null);

        var body = transport.Seen.Single(seen => seen.Path.EndsWith("/auth/token", StringComparison.Ordinal)).Body!;

        // `email-1` is what the old code sent, and the station refused it as `invalid_factor` while
        // the app said the code was wrong.
        Assert.Contains("method_id=totp-1", body, StringComparison.Ordinal);
        Assert.DoesNotContain("method_id=email-1", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TheLoginPanelSaysSoWhenItCannotAnswerTheFactorAtAll()
    {
        var transport = new FakeTransport
        {
            RequiresSecondFactor = true,
            ChallengeFactorsJson = """[{ "method": "email", "method_id": "email-1", "kind": "possession" }]""",
        };

        SessionManager? manager = null;
        var handler = new SessionHandler(() => manager) { InnerHandler = transport };
        var client = new HttpClient(handler);
        manager = new SessionManager(new InMemorySecretStore(), client);

        Assert.True(StationUrl.TryParse(Origin, out var station));
        await manager.AttachAsync(station, TestContext.Current.CancellationToken);

        var login = new MaroonedSoftware.Deadair.Desktop.ViewModels.LoginViewModel(manager)
        {
            Email = "operator@example.com",
            Password = "hunter2",
        };

        await login.SubmitCommand.ExecuteAsync(null);

        // No code box, because no code could ever work.
        Assert.False(login.NeedsCode);
        Assert.NotNull(login.Problem);
    }

    private static async Task<(SessionManager Session, FakeTransport Transport)> ChallengedAsync()
    {
        var transport = new FakeTransport();
        SessionManager? manager = null;
        var handler = new SessionHandler(() => manager) { InnerHandler = transport };
        var client = new HttpClient(handler);
        manager = new SessionManager(new InMemorySecretStore(), client);

        Assert.True(StationUrl.TryParse(Origin, out var station));
        await manager.AttachAsync(station, TestContext.Current.CancellationToken);

        return (manager, transport);
    }
}
