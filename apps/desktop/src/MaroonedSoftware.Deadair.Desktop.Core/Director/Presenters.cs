using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Director;

/// <summary>Which characters can present a broadcast.</summary>
/// <remarks>
/// <c>GET /personas</c> answers with the whole roster, hosts and callers in one list, so every picker
/// that offers a presenter narrows it here. A caller phones IN; the web console once listed them in
/// its on-air menu, and a caller picked there presented the show in a character whose whole premise
/// is that it is ringing somebody else's. The station now refuses it, and this keeps the offer honest.
/// </remarks>
public static class Presenters
{
    /// <summary>Absent on the wire means a host, which is what every persona was before callers.</summary>
    public static bool Presents(Persona persona)
    {
        ArgumentNullException.ThrowIfNull(persona);
        return (persona.Kind ?? PersonaKind.Host) == PersonaKind.Host;
    }

    /// <summary>The hosts, in the order the station listed them.</summary>
    public static IReadOnlyList<Persona> Of(IEnumerable<Persona> personas) => [.. personas.Where(Presents)];
}
