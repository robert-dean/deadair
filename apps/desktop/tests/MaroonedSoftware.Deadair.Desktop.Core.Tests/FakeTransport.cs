using System.Collections.Concurrent;
using System.Net;
using System.Text;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>What one request looked like by the time it reached the wire.</summary>
public sealed record SeenRequest(string Path, string? Authorization, string? Body);

/// <summary>
/// A station, for tests: it answers token exchanges and hands back whatever was asked of it.
/// </summary>
/// <remarks>
/// Deliberately not a mock of the SDK. What these tests are about is the HTTP layer — which header
/// went out, whether a body survived a replay, how many exchanges happened — and none of that is
/// visible from above the client.
/// </remarks>
public sealed class FakeTransport : HttpMessageHandler
{
    private readonly ConcurrentQueue<HttpStatusCode> _oneOffs = new();
    private int _exchanges;

    public List<SeenRequest> Seen { get; } = [];

    /// <summary>What the token endpoint answers. 200 unless a test says otherwise.</summary>
    public HttpStatusCode RefreshAnswers { get; set; } = HttpStatusCode.OK;

    /// <summary>Makes a rotation answer without a new refresh token, which is allowed.</summary>
    public bool RefreshOmitsRefreshToken { get; set; }

    /// <summary>Makes sign-in answer the second-factor arm, which is a 200.</summary>
    public bool RequiresSecondFactor { get; set; }

    /// <summary>Makes `GET /auth/session` refuse, as it does for an account holding no role.</summary>
    public bool SessionIsForbidden { get; set; }

    /// <summary>How many token exchanges have happened.</summary>
    public int Exchanges => _exchanges;

    /// <summary>Makes the next ordinary request answer with this, once.</summary>
    public void AnswerOnce(HttpStatusCode status) => _oneOffs.Enqueue(status);

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var path = request.RequestUri?.AbsolutePath ?? string.Empty;
        var body = request.Content is null
            ? null
            : await request.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        lock (Seen)
        {
            Seen.Add(new SeenRequest(path, request.Headers.Authorization?.ToString(), body));
        }

        // Before the path handling, so a test can make ANY request fail once — including one to a
        // path the handler treats as exempt, which is the only way to prove it is exempt.
        if (_oneOffs.TryDequeue(out var once))
        {
            return new HttpResponseMessage(once) { Content = new StringContent("{}") };
        }

        if (path.EndsWith("/auth/token", StringComparison.Ordinal))
        {
            return Token(body);
        }

        if (path.EndsWith("/auth/session", StringComparison.Ordinal))
        {
            return SessionIsForbidden
                ? new HttpResponseMessage(HttpStatusCode.Forbidden) { Content = new StringContent("{}") }
                : Json("""{"actorId":"2f6c1e9a-0000-4000-8000-000000000001","roles":["admin"]}""");
        }

        return Json("{}");
    }

    private HttpResponseMessage Token(string? body)
    {
        var isRefresh = body?.Contains("grant_type=refresh_token", StringComparison.Ordinal) == true;
        var isPassword = body?.Contains("grant_type=password", StringComparison.Ordinal) == true;

        if (RequiresSecondFactor && isPassword)
        {
            return Json("""
                {
                  "result": "mfa_required",
                  "challenge_id": "c_0193f2a1",
                  "expires_at": "2026-09-07T18:41:00.000Z",
                  "factors": [
                    { "method": "authenticator", "method_id": "f_1", "kind": "knowledge" }
                  ]
                }
                """);
        }

        if (isRefresh && RefreshAnswers != HttpStatusCode.OK)
        {
            return new HttpResponseMessage(RefreshAnswers) { Content = new StringContent("{}") };
        }

        // Each exchange issues a distinguishable token, so a test can tell the replay's header from
        // the original's.
        var which = isRefresh ? Interlocked.Increment(ref _exchanges) + 1 : 1;
        var name = which switch
        {
            1 => "first",
            2 => "second",
            _ => $"n{which}",
        };

        if (isRefresh && RefreshOmitsRefreshToken)
        {
            return Json($$"""
                {
                  "result": "token",
                  "access_token": "{{name}}-access",
                  "expires_in": 900,
                  "token_type": "Bearer",
                  "scope": ""
                }
                """);
        }

        return Json($$"""
            {
              "result": "token",
              "access_token": "{{name}}-access",
              "refresh_token": "{{name}}-refresh",
              "expires_in": 900,
              "token_type": "Bearer",
              "scope": ""
            }
            """);
    }

    private static HttpResponseMessage Json(string body) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json"),
    };
}
