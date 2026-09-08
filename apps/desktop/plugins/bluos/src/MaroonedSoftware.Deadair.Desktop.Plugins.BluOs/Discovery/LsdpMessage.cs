using System.Net;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Discovery;

/// <summary>Something a node said on the wire.</summary>
public abstract record LsdpMessage;

/// <summary>
/// One kind of thing a node is, and what it says about itself in that role.
/// </summary>
/// <param name="ClassId">
/// What it is. 1 is a BluOS player, which is the only one this plugin cares about; 3 is a secondary
/// zone of a multi-zone player and 4 is something else again, and both are ignored rather than
/// refused.
/// </param>
/// <param name="Text">
/// Its own key and value pairs. A player's carry <c>name</c>, <c>port</c>, <c>model</c>,
/// <c>version</c> and <c>zs</c>.
/// </param>
public sealed record LsdpRecord(ushort ClassId, IReadOnlyDictionary<string, string> Text);

/// <summary>
/// A node saying it is here.
/// </summary>
/// <param name="NodeId">
/// Its hardware address, as colon-separated hex. The one thing about a player that does not change,
/// which is why it becomes the device's id; an address is a lease and a name is whatever somebody
/// typed into an app.
/// </param>
/// <param name="Address">Where it is now.</param>
/// <param name="Records">What it is, possibly several things.</param>
public sealed record LsdpAnnounce(string NodeId, IPAddress Address, IReadOnlyList<LsdpRecord> Records) : LsdpMessage;

/// <summary>A node saying it is no longer one of these things. Read and ignored.</summary>
public sealed record LsdpDelete(string NodeId, IReadOnlyList<ushort> Classes) : LsdpMessage;

/// <summary>Somebody asking who is out there, which is what this plugin sends.</summary>
/// <param name="UnicastReply">Whether the asker wants the answer to itself rather than broadcast.</param>
public sealed record LsdpQuery(bool UnicastReply, IReadOnlyList<ushort> Classes) : LsdpMessage;
