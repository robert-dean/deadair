using System.Collections.Frozen;
using System.Text.Json;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.Core.Auth;

/// <summary>
/// Reading what the station said went wrong.
/// </summary>
/// <remarks>
/// The station composes a sentence for most failures and a client should show that rather than one of
/// its own. It also distinguishes two 403s that look identical to a status code and mean opposite
/// things: one says this account may never do that, and the other says it may, once it proves who it
/// is again.
/// </remarks>
public static class ApiError
{
    /// <summary>
    /// The station's own sentence, when it sent one.
    /// </summary>
    /// <remarks>
    /// `details.message` is read FIRST and `message` second, matching the web console: the nested one
    /// is the considered sentence and the outer one is often the framework's.
    /// </remarks>
    public static string? Message(SdkException failure)
    {
        ArgumentNullException.ThrowIfNull(failure);

        if (failure.Json is not { } body)
        {
            return null;
        }

        if (body.ValueKind == JsonValueKind.Object
            && body.TryGetProperty("details", out var details)
            && details.ValueKind == JsonValueKind.Object
            && details.TryGetProperty("message", out var detailed)
            && detailed.ValueKind == JsonValueKind.String)
        {
            return detailed.GetString();
        }

        if (body.ValueKind == JsonValueKind.Object
            && body.TryGetProperty("message", out var message)
            && message.ValueKind == JsonValueKind.String)
        {
            return message.GetString();
        }

        return null;
    }

    /// <summary>
    /// What the station puts in the challenge when it refuses a refresh: `invalid_token` for a token
    /// that is spent, revoked or unreadable, `invalid_grant` for one whose account is gone, and
    /// `invalid_request` for none at all. Every other name belongs to some other grant.
    /// </summary>
    private static readonly FrozenSet<string> RefreshRefusals = FrozenSet.ToFrozenSet(["invalid_request", "invalid_token", "invalid_grant"]);

    /// <summary>
    /// Whether the STATION refused a refresh, which is the only answer that ends a session.
    /// </summary>
    /// <remarks>
    /// A 401 carrying one of those names, rather than any 4xx, because a 4xx on this route is not
    /// reliably a verdict on the token. The station's own limiter answers 429 and runs before the
    /// route, a tunnel or a WAF answers 403, a proxy answers 401 or 404, and none of those looked at
    /// the token. The challenge is what separates them: this request carries no bearer, and RFC 6750
    /// §3.1 has anything challenging a request without credentials leave the error code out, so a
    /// proxy's 401 names none of these. The same rule as `isRefreshRefused` in the console and
    /// `SdkError.refusesRefresh` on iOS and Android.
    /// </remarks>
    public static bool RefusesRefresh(SdkException failure)
    {
        ArgumentNullException.ThrowIfNull(failure);

        return failure.Status == 401 && AuthError(failure) is { } name && RefreshRefusals.Contains(name);
    }

    /// <summary>
    /// The station's own name for what went wrong, out of `WWW-Authenticate`.
    /// </summary>
    /// <remarks>
    /// The station distinguishes several rejections that all arrive as a 401 — `invalid_grant`,
    /// `invalid_challenge`, `invalid_factor` — and the status alone cannot tell them apart. Reading
    /// this is the difference between telling somebody their code was wrong and telling them their
    /// sign-in has expired, which are different things to do next.
    /// </remarks>
    public static string? AuthError(SdkException failure)
    {
        ArgumentNullException.ThrowIfNull(failure);

        var challenge = failure.ResponseHeaders?.WwwAuthenticate;
        if (challenge is null)
        {
            return null;
        }

        foreach (var value in challenge)
        {
            var parameter = value.Parameter;
            if (parameter is null)
            {
                continue;
            }

            const string Marker = "error=\"";
            var start = parameter.IndexOf(Marker, StringComparison.Ordinal);
            if (start < 0)
            {
                continue;
            }

            start += Marker.Length;
            var end = parameter.IndexOf('"', start);
            if (end > start)
            {
                return parameter[start..end];
            }
        }

        return null;
    }

    /// <summary>Whether the token is gone or invalid, which is the one thing a refresh can fix.</summary>
    public static bool IsInvalidToken(SdkException failure)
    {
        ArgumentNullException.ThrowIfNull(failure);
        return failure.Status == 401;
    }

    /// <summary>
    /// Whether this 403 is asking for a second factor rather than refusing outright.
    /// </summary>
    /// <remarks>
    /// The difference decides what happens next: a step-up shows a code box and retries the action,
    /// while a plain 403 means the account does not hold the permission and retrying is pointless.
    /// </remarks>
    public static bool IsStepUpRequired(SdkException failure)
    {
        ArgumentNullException.ThrowIfNull(failure);

        if (failure.Status != 403 || failure.Json is not { } body || body.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        if (body.TryGetProperty("details", out var details)
            && details.ValueKind == JsonValueKind.Object
            && details.TryGetProperty("kind", out var kind)
            && kind.ValueKind == JsonValueKind.String
            && kind.GetString() == "step_up_required")
        {
            return true;
        }

        // The other spelling of the same thing, from the `WWW-Authenticate` header the API exposes
        // through CORS for the browser's benefit and sends to everybody.
        return AuthError(failure) == "mfa_required";
    }

    /// <summary>Whether the account simply does not hold the permission.</summary>
    public static bool IsForbidden(SdkException failure)
    {
        ArgumentNullException.ThrowIfNull(failure);
        return failure.Status == 403 && !IsStepUpRequired(failure);
    }
}
