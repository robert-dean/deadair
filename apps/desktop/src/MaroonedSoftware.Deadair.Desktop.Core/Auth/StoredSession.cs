using System.Text.Json.Serialization;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Auth;

/// <summary>
/// A signed-in operator, as kept between launches.
/// </summary>
/// <remarks>
/// Keyed by the station's ORIGIN, because a token is only meaningful to the station that issued it.
/// Pointing the app at a different station drops what is held rather than presenting it somewhere it
/// cannot work.
/// </remarks>
public sealed record StoredSession
{
    [JsonPropertyName("origin")]
    public required string Origin { get; init; }

    [JsonPropertyName("email")]
    public required string Email { get; init; }

    [JsonPropertyName("accessToken")]
    public required string AccessToken { get; init; }

    /// <summary>
    /// Single-use and rotating. Presenting a spent one revokes the whole family, which is why the
    /// refresh is single-flight and why a rotation that answers without a new one keeps this.
    /// </summary>
    [JsonPropertyName("refreshToken")]
    public required string RefreshToken { get; init; }

    /// <summary>
    /// What the station said this account may do, cached beside the tokens.
    /// </summary>
    /// <remarks>
    /// A HINT about what to draw, never a gate. The API decides, and a 403 refreshes this rather than
    /// being reported as a failure. An empty list is an ordinary state: onboarding writes only
    /// `admin`, so an account that arrived any other way holds no role at all and can still listen.
    /// </remarks>
    [JsonPropertyName("roles")]
    public IReadOnlyList<PlatformRole> Roles { get; init; } = [];
}
