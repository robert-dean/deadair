using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.Services;

/// <summary>What the palette found: a record, an act or a character.</summary>
public abstract record JumpFound(string Label, string Detail)
{
    public sealed record Record(Guid Id, string Title, string Artists) : JumpFound(Title, Artists);

    public sealed record Act(Guid Id, string Name) : JumpFound(Name, "Act");

    public sealed record Character(string Id, string Name, bool Caller) : JumpFound(Name, Caller ? "Caller" : "Host");
}

/// <summary>
/// The palette's three searches: records and acts by the station's own search, characters by name.
/// </summary>
/// <remarks>
/// Three reads per settled query, as the web console makes. Characters are narrowed here from the
/// whole roster because the roster has no search of its own; it is one short list.
/// </remarks>
public sealed class JumpSearch(OperatorActions actions, HttpClient http)
{
    private StationUrl _station;

    public void Attach(StationUrl station) => _station = station;

    public async Task<IReadOnlyList<JumpFound>> FindAsync(string query, CancellationToken cancellationToken)
    {
        using var sdk = new DeadairSdk(new SdkOptions { BaseUrl = _station.ApiBase, HttpClient = http });
        var found = new List<JumpFound>();

        var records = await actions.RunAsync(
            token => sdk.Catalog.ListTracksAsync(new TrackQueryInput { Page = 0, PageSize = JumpTo.ResultLimit, Search = query }, token),
            cancellationToken: cancellationToken).ConfigureAwait(true);
        found.AddRange(records?.Data.Select(row => new JumpFound.Record(row.Id, row.Title, row.Artists)) ?? []);

        var acts = await actions.RunAsync(
            token => sdk.Catalog.ListArtistsAsync(new CatalogQueryInput { Page = 0, PageSize = JumpTo.ResultLimit, Search = query }, token),
            cancellationToken: cancellationToken).ConfigureAwait(true);
        found.AddRange(acts?.Data.Select(artist => new JumpFound.Act(artist.Id, artist.Name)) ?? []);

        var roster = await actions.RunAsync(token => sdk.Personas.ListPersonasAsync(token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);
        found.AddRange(roster?.Personas
            .Where(persona => persona.Label.Contains(query, StringComparison.OrdinalIgnoreCase))
            .Take(JumpTo.ResultLimit)
            .Select(persona => new JumpFound.Character(persona.Id, persona.Label, PersonaRoster.KindOf(persona) == PersonaKind.Caller)) ?? []);

        return found;
    }
}
