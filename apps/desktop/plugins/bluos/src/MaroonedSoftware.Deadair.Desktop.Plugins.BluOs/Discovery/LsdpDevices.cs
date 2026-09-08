using System.Globalization;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Output;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Discovery;

/// <summary>
/// Turns what nodes said about themselves into devices somebody can choose.
/// </summary>
public static class LsdpDevices
{
    /// <summary>
    /// Every BluOS player among the announcements, once each.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A query is sent more than once because UDP loses things, so the same player usually answers
    /// several times. The last word wins: a player that moved between two answers is at the address
    /// it gave most recently.
    /// </para>
    /// <para>
    /// Only class 1. A secondary zone announces itself too, and a zone is not somewhere this app can
    /// send a station.
    /// </para>
    /// </remarks>
    public static IReadOnlyList<OutputDevice> From(IEnumerable<LsdpAnnounce> announcements, string pluginId)
    {
        ArgumentNullException.ThrowIfNull(announcements);

        var devices = new Dictionary<string, OutputDevice>(StringComparer.OrdinalIgnoreCase);

        foreach (var announcement in announcements)
        {
            foreach (var record in announcement.Records.Where(record => record.ClassId == LsdpPacket.PlayerClass))
            {
                var endpoint = new BluOsEndpoint(
                    announcement.Address.ToString(),
                    Port(record));

                devices[announcement.NodeId] = new OutputDevice(
                    announcement.NodeId,
                    Name(record, endpoint),
                    Model(record),
                    endpoint.ToString());
            }
        }

        return [.. devices.Values.OrderBy(device => device.Name, StringComparer.CurrentCultureIgnoreCase)];
    }

    /// <summary>
    /// The port the player itself named.
    /// </summary>
    /// <remarks>
    /// Every player is on 11000 except a CI580, whose four zones are on 11000, 11010, 11020 and
    /// 11030 — which is the whole reason a discovered player carries a port rather than assuming one.
    /// </remarks>
    private static int Port(LsdpRecord record) =>
        record.Text.TryGetValue("port", out var text)
        && int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var port)
        && port is > 0 and <= 65535
            ? port
            : BluOsEndpoint.DefaultPort;

    /// <summary>
    /// What its owner called it, or the address when it did not say.
    /// </summary>
    /// <remarks>
    /// An address is a poor name and a fine last resort: a picker row has to say something, and a
    /// player somebody can reach is worth listing under a number rather than leaving out.
    /// </remarks>
    private static string Name(LsdpRecord record, BluOsEndpoint endpoint) =>
        record.Text.TryGetValue("name", out var name) && !string.IsNullOrWhiteSpace(name)
            ? name
            : endpoint.Host;

    private static string? Model(LsdpRecord record) =>
        record.Text.TryGetValue("model", out var model) && !string.IsNullOrWhiteSpace(model) ? model : null;
}
