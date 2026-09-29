using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// Putting somebody on the phone, now.
/// </summary>
/// <remarks>
/// <para>
/// A phone-in is two voices, and two voices is two segments, so what this asks for is a short
/// PRODUCTION: the only shape on the station that airs as several contiguous turns and enters the
/// running order whole. That is why it cannot be instant; it lands minutes later, and the dialog says
/// so rather than leaving an operator waiting for the next boundary.
/// </para>
/// <para>
/// It is presented by this show's host unless somebody chooses otherwise, which is what makes it a
/// call to THIS programme; the web console always inherits it. The broadcast's brief is deliberately
/// not passed: a brief is what the show PLAYS, and a call planned around a list of bands is callers
/// talking records on a show whose host wanted to talk about something else. Left empty, the call is
/// about whatever the host's show is about.
/// </para>
/// </remarks>
public sealed partial class TakeACallDialogViewModel : DialogViewModel
{
    /// <summary>The contract's ceiling on what a call is about.</summary>
    public const int AboutMax = 4000;

    private readonly OperatorActions _actions;
    private readonly StationUrl _station;
    private readonly HttpClient _http;

    public TakeACallDialogViewModel(
        OperatorActions actions,
        StationUrl station,
        HttpClient http,
        string? showHostId,
        string? showHostLabel,
        IReadOnlyList<Persona> hosts)
    {
        ArgumentNullException.ThrowIfNull(hosts);
        _actions = actions;
        _station = station;
        _http = http;

        // The show's own host first and chosen, whoever that is; an id of null there is the station's
        // own host, which is what the station falls back to when none is sent.
        Hosts.Add(new HostChoice(showHostId, "This show's host", showHostLabel));
        foreach (var host in hosts.Where(host => host.Id != showHostId))
        {
            Hosts.Add(new HostChoice(host.Id, host.Label, null));
        }

        _host = Hosts[0];
    }

    public override string Title => "Take a call";

    public override string AcceptLabel => "Take a call";

    [ObservableProperty]
    private string _about = string.Empty;

    public ObservableCollection<HostChoice> Hosts { get; } = [];

    [ObservableProperty]
    private HostChoice _host;

    public override async Task<bool> AcceptAsync(CancellationToken cancellationToken)
    {
        var subject = About.Trim();

        return await _actions.RunAsync(
            async token =>
            {
                using var sdk = new DeadairSdk(new SdkOptions { BaseUrl = _station.ApiBase, HttpClient = _http });
                return await sdk.Productions.RequestProductionAsync(
                    new ProductionRequest
                    {
                        // The kind decides there is a caller at all: a kind the station does not
                        // stage as dialogue produces one voice reading for three minutes.
                        Kind = "callin",

                        // No title. The station names it after its kind and the moment.
                        Brief = subject.Length == 0 ? null : subject,
                        PersonaId = Host.Id,
                    },
                    token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true) is not null;
    }
}
