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
        var challenge = failure.ResponseHeaders?.WwwAuthenticate;
        if (challenge is null)
        {
            return false;
        }

        foreach (var value in challenge)
        {
            if (value.Parameter?.Contains("error=\"mfa_required\"", StringComparison.Ordinal) == true)
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Whether the account simply does not hold the permission.</summary>
    public static bool IsForbidden(SdkException failure)
    {
        ArgumentNullException.ThrowIfNull(failure);
        return failure.Status == 403 && !IsStepUpRequired(failure);
    }
}
