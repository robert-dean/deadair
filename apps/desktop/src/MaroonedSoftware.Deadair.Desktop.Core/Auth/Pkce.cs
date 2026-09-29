using System.Security.Cryptography;
using System.Text;

namespace MaroonedSoftware.Deadair.Desktop.Core.Auth;

/// <summary>
/// The one-time secret an enrolment starts with, and the hash the station is handed first.
/// </summary>
/// <remarks>
/// The console's <c>pkce.ts</c>: the station is given the SHA-256 of a secret when an enrolment starts
/// and the secret itself when it finishes, so an enrolment begun here cannot be finished from anywhere
/// else. 32 random bytes as base64url, which is 43 characters.
/// </remarks>
public static class Pkce
{
    public static string Verifier() => Base64Url(RandomNumberGenerator.GetBytes(32));

    public static string Challenge(string verifier)
    {
        ArgumentNullException.ThrowIfNull(verifier);
        return Base64Url(SHA256.HashData(Encoding.UTF8.GetBytes(verifier)));
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');
}
