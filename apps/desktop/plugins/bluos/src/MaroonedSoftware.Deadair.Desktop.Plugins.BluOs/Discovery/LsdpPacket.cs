using System.Buffers.Binary;
using System.Globalization;
using System.Net;
using System.Text;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Discovery;

/// <summary>
/// The bytes BluOS players use to find each other.
/// </summary>
/// <remarks>
/// <para>
/// LSDP, from the appendix of the Custom Integration API: broadcast UDP on port 11430, every node
/// announcing itself about once a minute and answering a query within three quarters of a second.
/// It is used here rather than mDNS because it is what the manufacturer's own documentation
/// recommends, saying mDNS "cannot be discovered reliably" on many home networks — and because it
/// is a page of byte packing rather than a dependency.
/// </para>
/// <para>
/// The layout, which the fixtures in the tests confirm against a real datagram. A header of
/// <c>[length][LSDP][version]</c>, where the length counts itself, then one or more messages, each
/// <c>[length][type]…</c> with the length again counting itself. An announce carries a node id and
/// an address, both length-prefixed, then a count of records; a record is a two-byte class, a count
/// of pairs, and each pair a length-prefixed key and value.
/// </para>
/// <para>
/// <b>Nothing here throws.</b> This reads datagrams from anything on the network that felt like
/// sending one, so a truncated packet, an unknown type and outright noise are all ordinary and all
/// answer with whatever could be read.
/// </para>
/// </remarks>
public static class LsdpPacket
{
    /// <summary>The port everything happens on, in both directions.</summary>
    public const int Port = 11430;

    /// <summary>A BluOS player. The mDNS equivalent, for anyone comparing, is <c>_musc._tcp</c>.</summary>
    public const ushort PlayerClass = 0x0001;

    /// <summary>A secondary zone of a multi-zone player: <c>_musp._tcp</c>.</summary>
    public const ushort SecondaryPlayerClass = 0x0003;

    /// <summary>Ask about everything.</summary>
    public const ushort AllClasses = 0xFFFF;

    private const byte Announce = (byte)'A';
    private const byte Delete = (byte)'D';
    private const byte AskBroadcast = (byte)'Q';
    private const byte AskUnicast = (byte)'R';

    private static ReadOnlySpan<byte> Magic => "LSDP"u8;

    /// <summary>
    /// Builds a question.
    /// </summary>
    /// <param name="classId">What is being asked about.</param>
    /// <param name="unicastReply">
    /// Ask for the answer to come straight back rather than to the broadcast address. Worth having
    /// when the broadcast port could not be bound, which happens if the BluOS controller app on the
    /// same machine got there first.
    /// </param>
    public static byte[] Query(ushort classId = PlayerClass, bool unicastReply = false)
    {
        // [6][L S D P][version 1] then [5][type][one class][the class]
        var packet = new byte[11];

        packet[0] = 6;
        Magic.CopyTo(packet.AsSpan(1));
        packet[5] = 1;
        packet[6] = 5;
        packet[7] = unicastReply ? AskUnicast : AskBroadcast;
        packet[8] = 1;
        BinaryPrimitives.WriteUInt16BigEndian(packet.AsSpan(9), classId);

        return packet;
    }

    /// <summary>
    /// Reads whatever a datagram turned out to hold.
    /// </summary>
    /// <returns>
    /// Every message that could be read, in order. Empty for anything that is not LSDP at all, which
    /// on a busy network is most of what arrives.
    /// </returns>
    public static IReadOnlyList<LsdpMessage> Parse(ReadOnlySpan<byte> datagram)
    {
        var messages = new List<LsdpMessage>();

        if (datagram.Length < 6 || datagram[0] < 6 || datagram[0] > datagram.Length)
        {
            return messages;
        }

        if (!datagram.Slice(1, 4).SequenceEqual(Magic))
        {
            return messages;
        }

        var at = (int)datagram[0];

        while (at < datagram.Length)
        {
            int length = datagram[at];

            // A length that does not fit is a truncated or invented packet, and there is no way to
            // find the next message without one: stop, and keep whatever was read before it.
            if (length < 2 || at + length > datagram.Length)
            {
                break;
            }

            var body = datagram.Slice(at + 2, length - 2);

            // An unknown type is skipped by its own length rather than abandoning the datagram,
            // which is what the length being on every message is for.
            LsdpMessage? message = datagram[at + 1] switch
            {
                Announce => ReadAnnounce(body),
                Delete => ReadDelete(body),
                AskBroadcast => ReadQuery(body, unicastReply: false),
                AskUnicast => ReadQuery(body, unicastReply: true),
                _ => null,
            };

            if (message is not null)
            {
                messages.Add(message);
            }

            at += length;
        }

        return messages;
    }

    private static LsdpAnnounce? ReadAnnounce(ReadOnlySpan<byte> body)
    {
        var at = 0;

        if (!ReadBytes(body, ref at, out var node) || !ReadBytes(body, ref at, out var address))
        {
            return null;
        }

        if (address.Length is not (4 or 16) || at >= body.Length)
        {
            return null;
        }

        var records = new List<LsdpRecord>();
        int count = body[at++];

        for (var index = 0; index < count; index++)
        {
            if (at + 3 > body.Length)
            {
                break;
            }

            var classId = BinaryPrimitives.ReadUInt16BigEndian(body[at..]);
            at += 2;

            int pairs = body[at++];
            var text = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            for (var pair = 0; pair < pairs; pair++)
            {
                if (!ReadBytes(body, ref at, out var key) || !ReadBytes(body, ref at, out var value))
                {
                    break;
                }

                text[Encoding.UTF8.GetString(key)] = Encoding.UTF8.GetString(value);
            }

            records.Add(new LsdpRecord(classId, text));
        }

        return new LsdpAnnounce(Hex(node), new IPAddress(address), records);
    }

    private static LsdpDelete? ReadDelete(ReadOnlySpan<byte> body)
    {
        var at = 0;

        if (!ReadBytes(body, ref at, out var node) || at >= body.Length)
        {
            return null;
        }

        var classes = new List<ushort>();
        int count = body[at++];

        for (var index = 0; index < count && at + 2 <= body.Length; index++)
        {
            classes.Add(BinaryPrimitives.ReadUInt16BigEndian(body[at..]));
            at += 2;
        }

        return new LsdpDelete(Hex(node), classes);
    }

    private static LsdpQuery? ReadQuery(ReadOnlySpan<byte> body, bool unicastReply)
    {
        if (body.Length < 1)
        {
            return null;
        }

        var at = 1;
        var classes = new List<ushort>();
        int count = body[0];

        for (var index = 0; index < count && at + 2 <= body.Length; index++)
        {
            classes.Add(BinaryPrimitives.ReadUInt16BigEndian(body[at..]));
            at += 2;
        }

        return new LsdpQuery(unicastReply, classes);
    }

    /// <summary>Reads a length-prefixed run of bytes, or says it could not.</summary>
    private static bool ReadBytes(ReadOnlySpan<byte> body, ref int at, out byte[] bytes)
    {
        bytes = [];

        if (at >= body.Length)
        {
            return false;
        }

        int length = body[at];

        if (at + 1 + length > body.Length)
        {
            return false;
        }

        bytes = body.Slice(at + 1, length).ToArray();
        at += 1 + length;
        return true;
    }

    /// <summary>A node id as somebody would write a MAC address down.</summary>
    private static string Hex(byte[] bytes) =>
        string.Join(':', bytes.Select(value => value.ToString("x2", CultureInfo.InvariantCulture)));
}
