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
/// operator could see was the one that ruled out the actual cause. The emailed code came later, for an
/// account with an email factor and a passkey and no authenticator, which was refused outright.
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
    public void AnEmailFactorIsNotAnAuthenticator_ButIsFoundAsTheEmailOne()
    {
        // An emailed code is answered by a different grant, after a send, so it is not one of the
        // authenticators a method id can be sent with.
        List<MfaChallengeFactor> factors = [Factor(AuthenticationFactorMethod.Email, "email-1")];

        Assert.Empty(ChallengeFactors.Authenticators(factors));
        Assert.Equal("email-1", ChallengeFactors.Email(factors)?.MethodId);
    }

    [Fact]
    public void FindsNoEmailFactorWhereThereIsNone()
    {
        List<MfaChallengeFactor> factors = [Factor(AuthenticationFactorMethod.Fido, "fido-1")];

        Assert.Null(ChallengeFactors.Email(factors));
    }

    [Fact]
    public async Task AsksTheStationToEmailACodeForTheChallenge()
    {
        var (session, transport) = await ChallengedAsync();

        var result = await session.SendEmailCodeAsync("c_1", TestContext.Current.CancellationToken);

        Assert.Equal(new CodeSendResult.Sent("e_1"), result);
        var body = transport.Seen.Single(seen => seen.Path.EndsWith("/auth/factors/start", StringComparison.Ordinal)).Body!;
        Assert.Contains("\"method\":\"email\"", body, StringComparison.Ordinal);
        Assert.Contains("\"mfa_challenge_id\":\"c_1\"", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ASendAgainstASpentChallenge_OrAStationWithNoMail_SaysWhich()
    {
        var (expired, expiredTransport) = await ChallengedAsync();
        expiredTransport.FactorStartAnswers = HttpStatusCode.Unauthorized;
        Assert.IsType<CodeSendResult.ChallengeExpired>(await expired.SendEmailCodeAsync("c_1", TestContext.Current.CancellationToken));

        var (noMail, noMailTransport) = await ChallengedAsync();
        noMailTransport.FactorStartAnswers = HttpStatusCode.ServiceUnavailable;
        Assert.IsType<CodeSendResult.NoMail>(await noMail.SendEmailCodeAsync("c_1", TestContext.Current.CancellationToken));

        var (broken, brokenTransport) = await ChallengedAsync();
        brokenTransport.FactorStartAnswers = HttpStatusCode.InternalServerError;
        Assert.IsType<CodeSendResult.Failed>(await broken.SendEmailCodeAsync("c_1", TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task AnEmailedCodeIsAnsweredWithTheCodeGrantAndTheMessageItCameIn()
    {
        var (session, transport) = await ChallengedAsync();

        var result = await session.CompleteEmailCodeAsync(
            "operator@example.com", "c_1", "e_1", "123456", TestContext.Current.CancellationToken);

        Assert.IsType<SignInResult.Ok>(result);
        Assert.IsType<SessionState.SignedIn>(session.State);
        var body = transport.Seen.First(seen => seen.Path.EndsWith("/auth/token", StringComparison.Ordinal)).Body!;
        Assert.Contains("grant_type=code", body, StringComparison.Ordinal);
        Assert.Contains("mfa_challenge_id=c_1", body, StringComparison.Ordinal);
        Assert.Contains("challenge_id=e_1", body, StringComparison.Ordinal);
        Assert.Contains("code=123456", body, StringComparison.Ordinal);
        Assert.DoesNotContain("method_id", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AWrongEmailedCodeIsReportedAsAWrongCode()
    {
        var (session, transport) = await ChallengedAsync();
        transport.TokenRefusal = ("invalid_grant", HttpStatusCode.Unauthorized);

        var result = await session.CompleteEmailCodeAsync(
            "operator@example.com", "c_1", "e_1", "000000", TestContext.Current.CancellationToken);

        Assert.IsType<SignInResult.BadCredentials>(result);
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
        // A passkey needs a WebAuthn assertion this app cannot produce.
        var (login, _) = await LoginOverAsync("""[{ "method": "fido", "method_id": "fido-1", "kind": "possession" }]""");

        await login.SubmitCommand.ExecuteAsync(null);

        // No code box, because no code could ever work.
        Assert.False(login.NeedsCode);
        Assert.NotNull(login.Problem);
    }

    [Fact]
    public async Task AnAccountWithEmailAndAPasskeyIsSentACodeRatherThanRefused()
    {
        // The account that reported this: an email factor and a passkey, and no authenticator.
        var (login, transport) = await LoginOverAsync("""
            [
              { "method": "email", "method_id": "email-1", "kind": "possession", "label": "o•••@example.com" },
              { "method": "fido", "method_id": "fido-1", "kind": "possession" }
            ]
            """);

        await login.SubmitCommand.ExecuteAsync(null);

        Assert.True(login.NeedsCode);
        Assert.True(login.UsingEmail);
        Assert.Null(login.Problem);
        Assert.Equal(1, transport.CodesSent);
        Assert.Equal("We sent a code to o•••@example.com.", login.CodeWords);
        Assert.False(login.CanUseEmail);
        Assert.True(login.CanSendAgain);

        transport.RequiresSecondFactor = false;
        transport.Seen.Clear();
        login.Code = "123456";
        await login.SubmitCommand.ExecuteAsync(null);

        var body = transport.Seen.First(seen => seen.Path.EndsWith("/auth/token", StringComparison.Ordinal)).Body!;
        Assert.Contains("grant_type=code", body, StringComparison.Ordinal);
        Assert.Contains("challenge_id=e_1", body, StringComparison.Ordinal);
        Assert.False(login.NeedsCode);
    }

    [Fact]
    public async Task AnAuthenticatorLeads_AndEmailIsOfferedInstead()
    {
        // An authenticator costs nothing to offer where email sends a message, so nothing is sent
        // until somebody asks for it.
        var (login, transport) = await LoginOverAsync("""
            [
              { "method": "email", "method_id": "email-1", "kind": "possession" },
              { "method": "authenticator", "method_id": "totp-1", "kind": "knowledge" }
            ]
            """);

        await login.SubmitCommand.ExecuteAsync(null);

        Assert.False(login.UsingEmail);
        Assert.Equal(0, transport.CodesSent);
        Assert.True(login.CanUseEmail);
        Assert.Equal("Enter the code from your authenticator.", login.CodeWords);

        login.Code = "12";
        await login.UseEmailCommand.ExecuteAsync(null);

        Assert.True(login.UsingEmail);
        Assert.Equal(1, transport.CodesSent);
        Assert.Equal(string.Empty, login.Code);
        Assert.False(login.CanUseEmail);
        Assert.Equal("We sent a code to your email.", login.CodeWords);
    }

    [Fact]
    public async Task SendingAgainAsksForAnotherAndAnswersWithTheNewMessage()
    {
        var (login, transport) = await LoginOverAsync("""[{ "method": "email", "method_id": "email-1", "kind": "possession" }]""");
        await login.SubmitCommand.ExecuteAsync(null);

        await login.SendAgainCommand.ExecuteAsync(null);
        Assert.Equal(2, transport.CodesSent);

        transport.RequiresSecondFactor = false;
        transport.Seen.Clear();
        login.Code = "654321";
        await login.SubmitCommand.ExecuteAsync(null);

        // The code is bound to the message it came in, and that is the latest one.
        var body = transport.Seen.First(seen => seen.Path.EndsWith("/auth/token", StringComparison.Ordinal)).Body!;
        Assert.Contains("challenge_id=e_2", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ARefusedEmailedCodeSaysToCheckTheEmailRatherThanWait()
    {
        var (login, transport) = await LoginOverAsync("""[{ "method": "email", "method_id": "email-1", "kind": "possession" }]""");
        await login.SubmitCommand.ExecuteAsync(null);

        transport.TokenRefusal = ("invalid_grant", HttpStatusCode.Unauthorized);
        login.Code = "000000";
        await login.SubmitCommand.ExecuteAsync(null);

        Assert.Equal("That code was not accepted. Check the latest email, or send it again.", login.Problem);
        Assert.True(login.NeedsCode);
        Assert.Equal(string.Empty, login.Code);
    }

    [Fact]
    public async Task ASendTheStationCannotMakeSaysWhy_AndAnExpiredOneEndsTheRound()
    {
        var (noMail, noMailTransport) = await LoginOverAsync("""[{ "method": "email", "method_id": "email-1", "kind": "possession" }]""");
        noMailTransport.FactorStartAnswers = HttpStatusCode.ServiceUnavailable;
        await noMail.SubmitCommand.ExecuteAsync(null);

        Assert.True(noMail.NeedsCode);
        Assert.Contains("cannot send email", noMail.Problem, StringComparison.Ordinal);

        // Nothing to answer, so Return does nothing rather than sending a code against no message.
        noMailTransport.Seen.Clear();
        noMail.Code = "123456";
        await noMail.SubmitCommand.ExecuteAsync(null);
        Assert.Empty(noMailTransport.Seen);

        var (expired, expiredTransport) = await LoginOverAsync("""[{ "method": "email", "method_id": "email-1", "kind": "possession" }]""");
        expiredTransport.FactorStartAnswers = HttpStatusCode.Unauthorized;
        await expired.SubmitCommand.ExecuteAsync(null);

        Assert.False(expired.NeedsCode);
        Assert.Equal("That sign-in took too long and has expired. Start again.", expired.Problem);
        Assert.Equal("operator@example.com", expired.Email);
    }

    /// <summary>A sign-in panel over a station whose password step answers with these factors.</summary>
    private static async Task<(MaroonedSoftware.Deadair.Desktop.ViewModels.LoginViewModel Login, FakeTransport Transport)> LoginOverAsync(string factorsJson)
    {
        var transport = new FakeTransport { RequiresSecondFactor = true, ChallengeFactorsJson = factorsJson };

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

        return (login, transport);
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
