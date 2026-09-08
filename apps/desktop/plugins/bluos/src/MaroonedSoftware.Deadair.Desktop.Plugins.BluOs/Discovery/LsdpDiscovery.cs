using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using MaroonedSoftware.Deadair.Desktop.PluginSdk;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Discovery;

/// <summary>
/// Asks the network which BluOS players are on it, and listens for a moment.
/// </summary>
/// <remarks>
/// <para>
/// The question is asked three times because UDP loses things and a player that missed all three
/// would otherwise wait a minute for its own scheduled announcement, which is far longer than
/// anybody will hold a picker open. The window closes shortly after the last one: a discovery that
/// waits for certainty is a picker that does not open.
/// </para>
/// <para>
/// <b>The port may already be taken.</b> The BluOS controller app, running on the same machine, is
/// itself an LSDP participant. When the shared bind fails this falls back to an ephemeral port and
/// asks for the answer to be sent straight back rather than broadcast, which is what the protocol's
/// second query type is for.
/// </para>
/// </remarks>
public sealed class LsdpDiscovery(TimeProvider clock, IPluginLogger logger)
{
    /// <summary>When the last question is asked, and how long after it the door closes.</summary>
    private static readonly TimeSpan[] AskAt =
    [
        TimeSpan.Zero,
        TimeSpan.FromSeconds(1),
        TimeSpan.FromSeconds(2),
    ];

    /// <summary>A player answers within three quarters of a second, so this is generous.</summary>
    public static readonly TimeSpan Window = TimeSpan.FromSeconds(3.5);

    /// <summary>Everything that answered, including a player answering three times.</summary>
    public async Task<IReadOnlyList<LsdpAnnounce>> ListenAsync(CancellationToken cancellationToken)
    {
        using var socket = new UdpClient();
        var unicastReply = false;

        try
        {
            socket.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, optionValue: true);
            socket.Client.Bind(new IPEndPoint(IPAddress.Any, LsdpPacket.Port));
        }
        catch (SocketException error)
        {
            // Something else on this machine holds the port; the controller app is the likely one.
            // A player will still answer a question asked from anywhere, as long as it is asked to
            // reply to the asker rather than to the broadcast address nobody here is listening on.
            logger.Info($"port {LsdpPacket.Port} is in use ({error.SocketErrorCode}), so players are being asked to answer directly");
            unicastReply = true;

            socket.Client.Bind(new IPEndPoint(IPAddress.Any, 0));
        }

        socket.EnableBroadcast = true;

        var announcements = new List<LsdpAnnounce>();

        // The window is a source of its own linked to the caller's, so the clock this plugin was
        // given is what closes it: a test can then run the whole thing without waiting three and a
        // half real seconds.
        using var closing = new CancellationTokenSource(Window, clock);
        using var window = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, closing.Token);

        var asking = AskRepeatedlyAsync(socket, unicastReply, window.Token);

        try
        {
            while (!window.IsCancellationRequested)
            {
                var datagram = await socket.ReceiveAsync(window.Token).ConfigureAwait(false);

                foreach (var message in LsdpPacket.Parse(datagram.Buffer))
                {
                    if (message is LsdpAnnounce announce)
                    {
                        announcements.Add(announce);
                    }
                }
            }
        }
        catch (OperationCanceledException)
        {
            // The window closed, which is how this always ends.
        }
        catch (SocketException error)
        {
            logger.Warn($"stopped listening for players: {error.SocketErrorCode}");
        }

        await asking.ConfigureAwait(false);

        cancellationToken.ThrowIfCancellationRequested();

        return announcements;
    }

    private async Task AskRepeatedlyAsync(UdpClient socket, bool unicastReply, CancellationToken cancellationToken)
    {
        var question = LsdpPacket.Query(LsdpPacket.PlayerClass, unicastReply);
        var addresses = Broadcasts();
        var sent = TimeSpan.Zero;

        try
        {
            foreach (var at in AskAt)
            {
                if (at > sent)
                {
                    await Task.Delay(at - sent, clock, cancellationToken).ConfigureAwait(false);
                    sent = at;
                }

                foreach (var address in addresses)
                {
                    try
                    {
                        await socket.SendAsync(question, new IPEndPoint(address, LsdpPacket.Port), cancellationToken).ConfigureAwait(false);
                    }
                    catch (SocketException)
                    {
                        // An interface that will not carry a broadcast is one of several being
                        // tried, and the others may well work.
                    }
                }
            }
        }
        catch (OperationCanceledException)
        {
            // The window closed before the last question. Whatever answered still counts.
        }
    }

    /// <summary>
    /// Where to shout.
    /// </summary>
    /// <remarks>
    /// The global broadcast address, plus each interface's own. Some networks drop the first and
    /// some stacks refuse to route it out of the interface that matters, and sending both costs one
    /// datagram per interface.
    /// </remarks>
    private static List<IPAddress> Broadcasts()
    {
        var addresses = new List<IPAddress> { IPAddress.Broadcast };

        try
        {
            foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (adapter.OperationalStatus != OperationalStatus.Up
                    || adapter.NetworkInterfaceType == NetworkInterfaceType.Loopback)
                {
                    continue;
                }

                foreach (var address in adapter.GetIPProperties().UnicastAddresses)
                {
                    if (address.Address.AddressFamily != AddressFamily.InterNetwork || address.IPv4Mask is null)
                    {
                        continue;
                    }

                    var host = address.Address.GetAddressBytes();
                    var mask = address.IPv4Mask.GetAddressBytes();
                    var broadcast = new byte[4];

                    for (var index = 0; index < 4; index++)
                    {
                        broadcast[index] = (byte)(host[index] | ~mask[index]);
                    }

                    var candidate = new IPAddress(broadcast);

                    if (!addresses.Contains(candidate))
                    {
                        addresses.Add(candidate);
                    }
                }
            }
        }
        catch (NetworkInformationException)
        {
            // The global address alone, which is usually enough.
        }

        return addresses;
    }
}
