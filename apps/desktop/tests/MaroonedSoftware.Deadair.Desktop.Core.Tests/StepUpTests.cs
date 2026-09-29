using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// A change the station will not make on an old proof: the code it asks for, the call tried again,
/// and the account's own keys and factors around it.
/// </summary>
/// <remarks>
/// The step-up has to carry the CURRENT session's bearer, or the station mints a second session
/// beside the first instead of rotating this one. The refused call is tried once more after a good
/// code and not again, so a station that keeps asking cannot hold somebody in a loop of code boxes.
/// And a key, an enrolment and a registered app each hand a secret over exactly once, which only
/// works if what is sent to earn it is right the first time.
/// </remarks>
public class StepUpTests
{
    private static SdkException StepUpRefusal() =>
        new(403, """{"message":"Verify again","details":{"kind":"step_up_required"}}""");

    private static OperatorActions Actions() =>
        new(new SessionManager(new InMemorySecretStore(), new HttpClient(new FakeTransport())));

    [Fact]
    public async Task ARefusalForASecondFactorAsksForOneAndTriesTheCallAgain()
    {
        var actions = Actions();
        var asked = 0;
        var calls = 0;
        actions.StepUp = _ =>
        {
            asked++;
            return Task.FromResult(true);
        };

        var answer = await actions.RunAsync(
            _ => ++calls == 1 ? Task.FromException<string>(StepUpRefusal()) : Task.FromResult("done"),
            cancellationToken: TestContext.Current.CancellationToken);

        Assert.Equal("done", answer);
        Assert.Equal(1, asked);
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task ASecondRefusalAfterAGoodCodeIsReported_NotAskedAboutAgain()
    {
        var actions = Actions();
        var asked = 0;
        Notice? said = null;
        actions.StepUp = _ =>
        {
            asked++;
            return Task.FromResult(true);
        };
        actions.Noticed += notice => said = notice;

        var done = await actions.DoAsync(_ => Task.FromException(StepUpRefusal()), cancellationToken: TestContext.Current.CancellationToken);

        Assert.False(done);
        Assert.Equal(1, asked);
        Assert.IsType<Notice.StepUpNeeded>(said);
    }

    [Fact]
    public async Task DecliningTheCodeSaysNothingAtTheFootOfThePage()
    {
        var actions = Actions();
        Notice? said = null;
        actions.StepUp = _ => Task.FromResult(false);
        actions.Noticed += notice => said = notice;

        var answer = await actions.RunAsync(_ => Task.FromException<string>(StepUpRefusal()), cancellationToken: TestContext.Current.CancellationToken);

        Assert.Null(answer);
        Assert.Null(said);
    }

    [Fact]
    public async Task TheStepUpCarriesTheCurrentSessionsBearer_SoTheStationRotatesItRatherThanMintingAnother()
    {
        var transport = new FakeTransport();
        SessionManager? manager = null;
        var client = new HttpClient(new SessionHandler(() => manager) { InnerHandler = transport });
        manager = new SessionManager(new InMemorySecretStore(), client);
        Assert.True(StationUrl.TryParse("https://radio.example.com", out var station));
        await manager.AttachAsync(station, TestContext.Current.CancellationToken);
        await manager.SignInAsync("operator@example.com", "hunter2", TestContext.Current.CancellationToken);

        var result = await manager.StepUpAsync("c_1", "totp-1", "123456", TestContext.Current.CancellationToken);

        Assert.IsType<SignInResult.Ok>(result);
        var stepUp = transport.Seen.Last(seen => seen.Path.EndsWith("/auth/token", StringComparison.Ordinal));
        Assert.Equal("Bearer first-access", stepUp.Authorization);
        Assert.Contains("grant_type=authenticator", stepUp.Body, StringComparison.Ordinal);
    }

    [Fact]
    public void TheStepUpOffersOnlyAuthenticators_AndSaysSoWhenThereAreNone()
    {
        var calls = new SettingsCalls(Actions(), new HttpClient(new FakeTransport()), new DialogsViewModel(Actions(), ImmediateUiDispatcher.Instance), files: null);
        var dialog = new StepUpDialogViewModel(new SessionManager(new InMemorySecretStore(), new HttpClient(new FakeTransport())), calls);

        dialog.Present(new MfaRequiredResponse
        {
            ChallengeId = "c_1",
            ExpiresAt = DateTimeOffset.UtcNow,
            Factors =
            [
                new() { Method = AuthenticationFactorMethod.Email, MethodId = "email-1", Kind = AuthenticationFactorKind.Possession },
                new() { Method = AuthenticationFactorMethod.Authenticator, MethodId = "totp-1", Kind = AuthenticationFactorKind.Possession },
            ],
        });
        Assert.Equal("totp-1", Assert.Single(dialog.Factors).MethodId);
        Assert.Null(dialog.Problem);

        dialog.Present(new EnrollmentRequiredResponse());
        Assert.Empty(dialog.Factors);
        Assert.NotNull(dialog.Problem);
        Assert.False(dialog.CanAccept);
    }

    [Fact]
    public void TheEnrolmentChallengeIsTheHashOfTheVerifier_AsRfc7636Says() =>
        Assert.Equal("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", Pkce.Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));

    [Fact]
    public void AVerifierIsFortyThreeUrlSafeCharacters()
    {
        var verifier = Pkce.Verifier();

        Assert.Equal(43, verifier.Length);
        Assert.DoesNotContain(verifier, character => character is '+' or '/' or '=');
    }

    [Fact]
    public void ARevokedKeyReadsRevokedEvenOnceItHasAlsoExpired()
    {
        var now = DateTimeOffset.UtcNow;
        var key = new ApiKey { Id = Guid.NewGuid(), Name = "k", Hint = "…", Scopes = [ApiKeyScope.View], CreatedAt = now.AddDays(-9), ExpiresAt = now.AddDays(-1), RevokedAt = now.AddDays(-2) };

        Assert.Equal("revoked", AccountWords.KeyState(key, now));
        Assert.Equal("expired", AccountWords.KeyState(key with { RevokedAt = null }, now));
        Assert.Equal("active", AccountWords.KeyState(key with { RevokedAt = null, ExpiresAt = null }, now));
    }

    [Theory]
    [InlineData("https://app.example.com/callback", null)]
    [InlineData("http://127.0.0.1:8123/callback", null)]
    [InlineData("http://app.example.com/callback", "http://app.example.com/callback is not an https address or this computer's own.")]
    [InlineData("  \n ", "Give at least one address it may be sent back to.")]
    public void AnAppMayBeSentBackOnlyToHttpsOrThisComputer(string text, string? problem) =>
        Assert.Equal(problem, AccountWords.Redirects(text).Problem);

    [Fact]
    public void TheStationsQrCodeIsReadOutOfItsDataUri()
    {
        Assert.Equal([1, 2, 3], AccountWords.DataUri("data:image/png;base64,AQID"));
        Assert.Null(AccountWords.DataUri("https://example.com/qr.png"));
        Assert.Null(AccountWords.DataUri("data:image/png;base64,not base64!"));
    }

    [Theory]
    [InlineData("123456", true)]
    [InlineData("12345", false)]
    [InlineData("12345a", false)]
    public void ACodeIsSixDigits(string code, bool whole) => Assert.Equal(whole, AccountWords.IsCode(code));

    [Fact]
    public void AChatPlatformIsNamedFromItsPlugin() => Assert.Equal("Telegram", AccountWords.Platform("deadair.telegram"));
}
