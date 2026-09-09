using System.Globalization;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs;

/// <summary>
/// Where one player answers.
/// </summary>
/// <param name="Host">A name or an address. Whatever the operator typed, or discovery reported.</param>
/// <param name="Port">
/// 11000 for every BluOS player except the CI580, whose four zones are on 11000, 11010, 11020 and
/// 11030. Discovery reports the real one, so this default is for an address somebody typed by hand.
/// </param>
public sealed record BluOsEndpoint(string Host, int Port = BluOsEndpoint.DefaultPort)
{
    public const int DefaultPort = 11000;

    /// <summary>Reads <c>host</c> or <c>host:port</c>.</summary>
    /// <exception cref="FormatException">When it is neither.</exception>
    public static BluOsEndpoint Parse(string text)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(text);

        var trimmed = text.Trim();
        var colon = trimmed.LastIndexOf(':');

        if (colon < 0)
        {
            return new BluOsEndpoint(trimmed);
        }

        var host = trimmed[..colon];
        var port = trimmed[(colon + 1)..];

        if (host.Length == 0 || !int.TryParse(port, NumberStyles.None, CultureInfo.InvariantCulture, out var number) || number is < 1 or > 65535)
        {
            throw new FormatException($"""{text} is not an address: it should be a host, or a host and a port like "192.0.2.36:11000".""");
        }

        return new BluOsEndpoint(host, number);
    }

    /// <summary>Reads one without throwing, for text somebody is still typing.</summary>
    public static bool TryParse(string? text, out BluOsEndpoint? endpoint)
    {
        endpoint = null;

        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        try
        {
            endpoint = Parse(text);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    /// <summary>Where its API lives. Plain HTTP: v1.7 documents no TLS port at all.</summary>
    public Uri BaseAddress => new(string.Create(CultureInfo.InvariantCulture, $"http://{Host}:{Port}/"));

    /// <summary>
    /// How this is written down, and what a device's stored address looks like.
    /// </summary>
    /// <remarks>
    /// Always with the port, even the default one, so that a remembered device does not change
    /// meaning if the default ever does.
    /// </remarks>
    public override string ToString() => string.Create(CultureInfo.InvariantCulture, $"{Host}:{Port}");
}
