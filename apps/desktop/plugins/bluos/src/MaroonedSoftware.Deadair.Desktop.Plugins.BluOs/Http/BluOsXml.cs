using System.Globalization;
using System.Xml;
using System.Xml.Linq;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Http;

/// <summary>
/// Reads what a player answered, which is XML.
/// </summary>
/// <remarks>
/// <para>
/// Every read goes through a reader with <c>DtdProcessing</c> prohibited and no resolver. The parser
/// is pointed at whatever answers on the local network, which is exactly the situation where a
/// document type definition can make a parser go and fetch something, or expand until it runs out
/// of memory. Nothing legitimate on this wire has one.
/// </para>
/// <para>
/// Missing elements are missing rather than defaulted. A player that did not say how loud it is has
/// not said it is silent.
/// </para>
/// </remarks>
public static class BluOsXml
{
    /// <summary>Reads a <c>/Status</c> answer.</summary>
    public static BluOsStatus ParseStatus(string xml)
    {
        var root = Root(xml);

        return new BluOsStatus(
            Attribute(root, "etag"),
            Element(root, "state"),
            Number(root, "secs"),
            Number(root, "volume"),
            Element(root, "streamUrl"),
            Element(root, "service"),
            Element(root, "title1"),
            Element(root, "title2"));
    }

    /// <summary>Reads a <c>/SyncStatus</c> answer, whose facts are attributes rather than elements.</summary>
    public static BluOsSyncStatus ParseSyncStatus(string xml)
    {
        var root = Root(xml);

        return new BluOsSyncStatus(
            Attribute(root, "name"),
            Attribute(root, "brand"),
            Attribute(root, "model"),
            Attribute(root, "modelName"),
            Attribute(root, "mac"),
            NumberAttribute(root, "volume"));
    }

    /// <summary>
    /// Reads what <c>/Play</c> and <c>/Stop</c> answer, which is a bare state.
    /// </summary>
    /// <remarks>
    /// The element and the root itself are both accepted, because those two calls answer
    /// <c>&lt;state&gt;stream&lt;/state&gt;</c> while <c>/Status</c> carries the same word nested.
    /// </remarks>
    public static string? ParseState(string xml)
    {
        var root = Root(xml);

        return root.Name.LocalName == "state" ? Text(root) : Element(root, "state");
    }

    /// <summary>Reads what <c>/Volume</c> answers: the level as the element's own text.</summary>
    public static int? ParseVolume(string xml)
    {
        var root = Root(xml);

        return root.Name.LocalName == "volume" ? ToNumber(Text(root)) : Number(root, "volume");
    }

    private static XElement Root(string xml)
    {
        ArgumentNullException.ThrowIfNull(xml);

        var settings = new XmlReaderSettings
        {
            // The parser is pointed at whatever answered on the network. A DTD is how that becomes a
            // fetch this app did not intend, or an expansion that does not stop.
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            CloseInput = true,
        };

        using var reader = XmlReader.Create(new StringReader(xml), settings);

        return XDocument.Load(reader).Root
            ?? throw new XmlException("the player answered an empty document");
    }

    private static string? Text(XElement element)
    {
        var text = element.Value.Trim();

        return text.Length == 0 ? null : text;
    }

    private static string? Element(XElement root, string name) =>
        root.Element(name) is { } element ? Text(element) : null;

    private static string? Attribute(XElement root, string name) =>
        root.Attribute(name)?.Value is { Length: > 0 } value ? value : null;

    private static int? Number(XElement root, string name) => ToNumber(Element(root, name));

    private static int? NumberAttribute(XElement root, string name) => ToNumber(Attribute(root, name));

    private static int? ToNumber(string? text) =>
        int.TryParse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var value) ? value : null;
}
