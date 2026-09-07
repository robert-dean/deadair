using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;
using Xunit;

namespace MaroonedSoftware.Deadair.Sdk.Tests;

/// <summary>
/// That a token grant leaves this client in the shape the station reads.
///
/// Every other decode test here is about what comes back. This one is about what goes out, and it
/// exists because `/auth/token` declares `application/x-www-form-urlencoded` BEFORE
/// `application/json` and the generator uses the first declared mime, so `RequestTokenAsync` sends a
/// form rather than a JSON body. That is correct and it is invisible at the call site: the method
/// takes a typed record either way. What it means is that the grant's fields travel through
/// `SdkHttp.Params`, which walks the record's JSON — so a `[JsonPropertyName]` that is wrong makes a
/// form field that is wrong, and sign-in fails against a server that is behaving perfectly.
/// </summary>
public class TokenRequestEncodeTests
{
    private static readonly SdkHttp Http = new(new SdkOptions { BaseUrl = "https://example.invalid/api" });

    private static async Task<string> FormTextAsync(AuthenticationRequest request)
    {
        using var content = Http.FormContent(request);
        return await content.ReadAsStringAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task WritesAPasswordGrantAsAForm()
    {
        var body = await FormTextAsync(new PasswordAuthenticationRequest
        {
            Username = "operator@example.com",
            Password = "hunter2",
        });

        Assert.Contains("grant_type=password", body, StringComparison.Ordinal);
        Assert.Contains("username=operator%40example.com", body, StringComparison.Ordinal);
        Assert.Contains("password=hunter2", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task WritesARefreshGrantAsAForm()
    {
        var body = await FormTextAsync(new RefreshTokenAuthenticationRequest
        {
            RefreshToken = "rt_9f8e7d6c",
        });

        Assert.Contains("grant_type=refresh_token", body, StringComparison.Ordinal);
        Assert.Contains("refresh_token=rt_9f8e7d6c", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CarriesTheChallengeIdOnTheProofGrant()
    {
        // The second half of a second factor. `mfa_challenge_id` and `method_id` are what bind this
        // grant to the challenge the 200 handed back, and both are snake on the wire.
        var body = await FormTextAsync(new AuthenticatorAuthenticationRequest
        {
            Code = "123456",
            MfaChallengeId = "c_0193f2a1",
            MethodId = "f_1",
        });

        Assert.Contains("grant_type=authenticator", body, StringComparison.Ordinal);
        Assert.Contains("mfa_challenge_id=c_0193f2a1", body, StringComparison.Ordinal);
        Assert.Contains("method_id=f_1", body, StringComparison.Ordinal);
        Assert.Contains("code=123456", body, StringComparison.Ordinal);
    }

    [Fact]
    public void DoesNotSendAnAbsentOptionalAsAnEmptyField()
    {
        // An optional the caller did not set must be absent from the form, not present and blank: the
        // server tells "not supplied" from "supplied as nothing" on several of these.
        using var content = Http.FormContent(new RefreshTokenAuthenticationRequest
        {
            RefreshToken = "rt_9f8e7d6c",
        });

        var pairs = Http.Params(new RefreshTokenAuthenticationRequest { RefreshToken = "rt_9f8e7d6c" });

        Assert.DoesNotContain(pairs, pair => pair.Value.Length == 0);
    }
}
