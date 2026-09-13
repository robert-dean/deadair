using System.Diagnostics;
using System.Text.Json;

namespace MaroonedSoftware.Deadair.Desktop.Core.Updates;

/// <summary>
/// Asks GitHub, once, whether there is a newer desktop release.
/// </summary>
/// <remarks>
/// <para>
/// Handed its own <see cref="HttpClient"/>, never the station's. The station's client carries the
/// operator's bearer token on every request, which must not go to GitHub, and the one-client rule
/// exists so the STATION counts this app as one listener; GitHub is not the station. The same
/// reasoning gives each plugin its own client.
/// </para>
/// <para>
/// Every failure answers nothing and writes a line to the log. An update notice is a convenience,
/// and a GitHub that is down, rate-limiting (60 unauthenticated requests an hour, against one a
/// launch) or unreachable from a studio with no internet must never be something the app reports.
/// </para>
/// </remarks>
public sealed class UpdateChecker(HttpClient http, Version current)
{
    public async Task<UpdateAvailable?> CheckAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, UpdateCheck.Endpoint);
            request.Headers.Accept.ParseAdd("application/vnd.github+json");
            request.Headers.TryAddWithoutValidation("X-GitHub-Api-Version", "2022-11-28");

            using var response = await http.SendAsync(request, cancellationToken).ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                Trace.WriteLine($"updates: GitHub answered {(int)response.StatusCode}");
                return null;
            }

            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            var found = UpdateCheck.Newest(current, body);

            Trace.WriteLine(found is null
                ? $"updates: {current} is the newest desktop release"
                : $"updates: {found.Version} is available");

            return found;
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or JsonException)
        {
            Trace.WriteLine($"updates: could not ask GitHub: {error.Message}");
            return null;
        }
    }
}
