using System.Security.Authentication;
using System.Text.Json;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

// `NowPlaying` is both a type in the SDK and a namespace in this project, so the bare name resolves
// to the namespace. The alias picks the type without renaming either.
using NowPlayingReading = MaroonedSoftware.Deadair.Sdk.Models.NowPlaying;

namespace MaroonedSoftware.Deadair.Desktop.Core.Station;

/// <summary>What was found at an address.</summary>
public enum StationProbeResult
{
    /// <summary>A station, answering.</summary>
    Reachable,

    /// <summary>Something answered and it was not a station.</summary>
    NotAStation,

    /// <summary>A station, answering a shape this build cannot read.</summary>
    Incompatible,

    /// <summary>Nothing answered.</summary>
    Unreachable,

    /// <summary>A station answered, but this Mac does not trust its certificate.</summary>
    Untrusted,
}

/// <param name="Result">What was found.</param>
/// <param name="Station">The station's own name, when one answered.</param>
/// <param name="Mounts">Every way to listen, so the format picker can be built without probing them.</param>
public readonly record struct StationProbeReading(
    StationProbeResult Result,
    string? Station = null,
    IReadOnlyList<NowPlayingMount>? Mounts = null);

/// <summary>
/// Asking an address whether there is a station at it.
/// </summary>
/// <remarks>
/// <para>
/// <c>GET /nowplaying</c> is the right question: it is anonymous, it is answered from memory, and it
/// carries the mount list — so one request establishes that the address is a station, what it is
/// called, and how to listen to it.
/// </para>
/// <para>
/// The five outcomes are kept apart because they need different sentences. Somebody who typed their
/// router's address wants to be told it is not a station; somebody whose station is asleep wants to
/// be told nothing answered; somebody whose station is newer than their app should be told THAT
/// rather than that their address is wrong; and somebody whose station's certificate this Mac does
/// not trust needs to hear about the certificate rather than being told nothing answered.
/// </para>
/// </remarks>
public sealed class StationProbe(HttpClient http)
{
    public async Task<StationProbeReading> ProbeAsync(StationUrl station, CancellationToken cancellationToken = default)
    {
        string body;

        try
        {
            using var response = await http
                .GetAsync(new Uri($"{station.ApiBase}/nowplaying"), cancellationToken)
                .ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                // Something is listening and it is not this. A 404 from somebody's router, a 502 from
                // an edge with nothing behind it: either way, not a station.
                return new StationProbeReading(StationProbeResult.NotAStation);
            }

            body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (HttpRequestException e) when (e.InnerException is AuthenticationException)
        {
            // Something answered, over TLS, with a certificate this Mac does not trust. Told apart
            // from "nothing answered" because the remedy is different: this one needs a certificate
            // authority added to the system keychain and trusted there, not a different address.
            return new StationProbeReading(StationProbeResult.Untrusted);
        }
        catch (Exception)
        {
            // A DNS failure, a refused connection, a timeout. All of them mean the same thing to
            // somebody typing an address: nothing answered.
            return new StationProbeReading(StationProbeResult.Unreachable);
        }

        try
        {
            var now = JsonSerializer.Deserialize<NowPlayingReading>(body, SdkJson.Options);
            if (now is null)
            {
                return new StationProbeReading(StationProbeResult.NotAStation);
            }

            return new StationProbeReading(StationProbeResult.Reachable, now.Station, now.Mounts);
        }
        catch (JsonException)
        {
            // Valid JSON of the wrong shape, or a required property this build expects and the answer
            // does not carry. Told apart from "not a station" because the remedy is different: this
            // one is a client that has fallen behind its station.
            return new StationProbeReading(
                body.TrimStart().StartsWith('{')
                    ? StationProbeResult.Incompatible
                    : StationProbeResult.NotAStation);
        }
    }
}
