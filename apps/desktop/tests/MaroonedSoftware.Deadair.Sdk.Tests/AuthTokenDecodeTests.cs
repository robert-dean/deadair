using System.Text.Json;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;
using Xunit;

namespace MaroonedSoftware.Deadair.Sdk.Tests;

/// <summary>
/// That `POST /auth/token`'s two answers both decode, and are told apart the way the API means them
/// to be.
///
/// The station answers a discriminated union on one status. A second factor is a 200 carrying
/// `result: "mfa_required"`, NOT an error — a client that reads the status code alone sees a
/// successful sign-in with no token in it. These tests are the reason the login view model can trust
/// the type it is handed.
/// </summary>
public class AuthTokenDecodeTests
{
    [Fact]
    public void DecodesAnIssuedToken()
    {
        // snake_case on the wire and PascalCase in C#: the contract sets `format(output=snake)` and
        // the generator has to carry it into `[JsonPropertyName]`. The Kotlin SDK shipped without
        // this once and sign-in failed at decode with a missing-field error, on code that compiled.
        const string json = """
            {
              "result": "token",
              "access_token": "eyJhbGciOiJIUzI1NiJ9.e30.sig",
              "refresh_token": "rt_9f8e7d6c",
              "expires_in": 900,
              "token_type": "Bearer",
              "scope": ""
            }
            """;

        var answer = JsonSerializer.Deserialize<AuthenticationTokenResponse>(json, SdkJson.Options);

        var issued = Assert.IsType<AuthenticationTokenIssued>(answer);
        Assert.Equal("eyJhbGciOiJIUzI1NiJ9.e30.sig", issued.AccessToken);
        Assert.Equal("rt_9f8e7d6c", issued.RefreshToken);
        Assert.Equal(900, issued.ExpiresIn);
        Assert.Equal("Bearer", issued.TokenType);

        // Empty, always. Roles are not in the token and never have been: a client learns them from
        // `GET /auth/session` and treats them as a hint, because the API is the gate.
        Assert.Equal(string.Empty, issued.Scope);
    }

    [Fact]
    public void DecodesTheSecondFactorChallenge_WhichIsA200AndNotAnError()
    {
        // `format(output=snake)` on this contract, so the wire keys are `challenge_id`, `expires_at`
        // and `method_id`. The web console reads `challenge.challenge_id` for the same reason. A
        // generator that dropped the format directive would emit camelCase here and every second
        // factor would fail to decode, which is the shape of a bug the Kotlin SDK actually shipped.
        const string json = """
            {
              "result": "mfa_required",
              "challenge_id": "c_0193f2a1",
              "expires_at": "2026-09-07T18:41:00.000Z",
              "factors": [
                {
                  "method": "authenticator",
                  "method_id": "f_1",
                  "kind": "knowledge",
                  "label": "Authenticator app"
                }
              ]
            }
            """;

        var answer = JsonSerializer.Deserialize<AuthenticationTokenResponse>(json, SdkJson.Options);

        var challenge = Assert.IsType<MfaRequiredResponse>(answer);
        Assert.Equal("c_0193f2a1", challenge.ChallengeId);
        Assert.Equal(
            new DateTimeOffset(2026, 9, 7, 18, 41, 0, TimeSpan.Zero),
            challenge.ExpiresAt);

        var factor = Assert.Single(challenge.Factors);
        Assert.Equal(AuthenticationFactorMethod.Authenticator, factor.Method);

        // Echoed back as `method_id` on the proof grant, so a client that lost it cannot complete the
        // challenge for a method that does not bind another way.
        Assert.Equal("f_1", factor.MethodId);
    }

    [Fact]
    public void RefusesAnArmItDoesNotKnow_RatherThanDecodingItAsTheOtherOne()
    {
        // A tag this build has never heard of has to throw. The alternative — falling through to the
        // issued-token arm — is a sign-in that reports success and holds no token.
        const string json = """{"result":"something_else"}""";

        Assert.Throws<JsonException>(
            () => JsonSerializer.Deserialize<AuthenticationTokenResponse>(json, SdkJson.Options));
    }

    [Fact]
    public void DecodesASessionWithRoles_AndOneWithNone()
    {
        const string operatorSession = """
            {"actorId":"2f6c1e9a-0000-4000-8000-000000000001","roles":["admin"]}
            """;
        const string roleless = """
            {"actorId":"2f6c1e9a-0000-4000-8000-000000000002","roles":[]}
            """;

        var asOperator = JsonSerializer.Deserialize<AuthSession>(operatorSession, SdkJson.Options)!;
        var asNobody = JsonSerializer.Deserialize<AuthSession>(roleless, SdkJson.Options)!;

        Assert.Equal(PlatformRole.Admin, Assert.Single(asOperator.Roles));

        // Not an error and not a failure to read: onboarding writes only `admin`, so an account that
        // arrived any other way holds no role at all. The desktop draws no manage controls for it and
        // still lets it listen, because listening is accountless.
        Assert.Empty(asNobody.Roles);
    }
}
