using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Configuration;

/// <summary>
/// What the sign-in and security section says about an account's keys, factors and apps: the
/// console's words, and the few decisions under them.
/// </summary>
public static class AccountWords
{
    /// <summary>What a key or a connected app may do, the console's <c>accessWord</c>.</summary>
    public static string Access(IEnumerable<string> scopes)
    {
        ArgumentNullException.ThrowIfNull(scopes);

        var list = scopes.ToList();
        return list.Contains("manage") ? "Read and manage" : list.Contains("view") ? "Read only" : "Nothing";
    }

    public static string Access(IEnumerable<ApiKeyScope> scopes) =>
        Access(scopes.Select(scope => scope == ApiKeyScope.Manage ? "manage" : "view"));

    /// <summary>Whether a key still works: revoked outranks expired, since it is the one somebody did.</summary>
    public static string KeyState(ApiKey key, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(key);
        return key.RevokedAt is not null ? "revoked" : key.ExpiresAt is { } expires && expires <= now ? "expired" : "active";
    }

    /// <summary>When a new key stops working, from the choice somebody made, or null for never.</summary>
    public static DateTimeOffset? Expiry(int days, DateTimeOffset now) => days > 0 ? now.AddDays(days) : null;

    /// <summary>A factor as a line in a list: what kind it is, and its label where it has one.</summary>
    public static string Factor(AuthenticationFactorMethod method, string? label) => method switch
    {
        AuthenticationFactorMethod.Authenticator => label is { Length: > 0 } ? label : "Authenticator",
        AuthenticationFactorMethod.Password => "Password",
        AuthenticationFactorMethod.Email => label is { Length: > 0 } ? $"Email, {label}" : "Email",
        AuthenticationFactorMethod.Fido => "Passkey",
        AuthenticationFactorMethod.Phone => "Phone",
        _ => label is { Length: > 0 } ? $"{label} sign-in" : "Single sign-on",
    };

    /// <summary>How a registered app proves who it is, as the console says it.</summary>
    public static string ClientMethod(OAuthClientAuthMethod method) => method switch
    {
        OAuthClientAuthMethod.None => "No secret (an app on somebody's own device)",
        OAuthClientAuthMethod.ClientSecretPost => "Keeps a secret, sent in the request",
        _ => "Keeps a secret, sent as HTTP Basic",
    };

    /// <summary>
    /// The addresses an app may be sent back to, one per line, and the first that the station would
    /// refuse, in words.
    /// </summary>
    /// <remarks>
    /// https anywhere, or plain http to this computer's own loopback address, which is how an app on
    /// somebody's own machine receives its answer. The station is the authority; this spares the round
    /// trip for the obvious mistake.
    /// </remarks>
    public static (IReadOnlyList<string> Redirects, string? Problem) Redirects(string text)
    {
        ArgumentNullException.ThrowIfNull(text);

        var lines = text.Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Distinct(StringComparer.Ordinal).ToList();
        if (lines.Count == 0)
        {
            return (lines, "Give at least one address it may be sent back to.");
        }

        foreach (var line in lines)
        {
            if (!Uri.TryCreate(line, UriKind.Absolute, out var uri)
                || !(uri.Scheme == Uri.UriSchemeHttps || (uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback)))
            {
                return (lines, $"{line} is not an https address or this computer's own.");
            }
        }

        return (lines, null);
    }

    /// <summary>The bytes of a <c>data:</c> URI, such as the QR code the station draws for an authenticator, or null.</summary>
    public static byte[]? DataUri(string? uri)
    {
        if (uri is null || !uri.StartsWith("data:", StringComparison.Ordinal))
        {
            return null;
        }

        var comma = uri.IndexOf(',', StringComparison.Ordinal);
        if (comma < 0 || !uri.AsSpan(0, comma).EndsWith(";base64", StringComparison.Ordinal))
        {
            return null;
        }

        try
        {
            return Convert.FromBase64String(uri[(comma + 1)..]);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    /// <summary>A day, as the lists here print one: in this Mac's own time zone and words.</summary>
    public static string Date(DateTimeOffset at, System.Globalization.CultureInfo? culture = null) =>
        at.ToLocalTime().ToString("d MMM yyyy", culture ?? System.Globalization.CultureInfo.CurrentCulture);

    /// <summary>A chat platform's name from the id of the plugin that speaks it: <c>deadair.telegram</c> is Telegram.</summary>
    public static string Platform(string pluginId)
    {
        ArgumentNullException.ThrowIfNull(pluginId);

        var last = pluginId[(pluginId.LastIndexOf('.') + 1)..];
        return last.Length == 0 ? pluginId : char.ToUpperInvariant(last[0]) + last[1..];
    }

    /// <summary>Whether a typed code is a whole one: six digits, which is every authenticator's.</summary>
    public static bool IsCode(string? code) => code is { Length: 6 } && code.All(char.IsAsciiDigit);
}
