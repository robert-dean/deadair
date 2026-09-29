using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One listener's request, as its row draws it.</summary>
public sealed record RequestRowViewModel(
    ListenerRequest Request,
    string? Dedication,
    string From,
    string State,
    StatusTone Tone,
    bool CanGrant,
    bool CanDecline)
{
    public string Record => $"{Request.Title} by {Request.Artist}";

    /// <summary>Who asked, where and when.</summary>
    public string AskedBy => $"{Request.RequesterName} · {From}";

    public bool HasDedication => Dedication is not null;

    public bool HasReason => !string.IsNullOrWhiteSpace(Request.Reason);
}

/// <summary>
/// The Requests tab: what listeners have asked for, and the operator's decision on it.
/// </summary>
/// <remarks>
/// <para>
/// A tab on Programme because a request is a record the station will play a few records from now,
/// which is what this page answers. Open requests first, since those have a decision still to make;
/// everything recent a click away. Decisions only: who may ask and how often is Settings, and taking
/// a queued one out is the desk's.
/// </para>
/// <para>
/// <b>Manage-only even to read</b>, and somebody without the role sees the web console's sentence in
/// place of the list. So a 403 here is caught before <see cref="OperatorActions"/> sees it: reported
/// the usual way it would refresh the roles and say "no longer an operator" at the foot of the page,
/// which is wrong for somebody who never was one for this.
/// </para>
/// </remarks>
public sealed partial class RequestsViewModel(OperatorActions actions, Func<DeadairSdk> sdk, IDialogs dialogs) : ObservableObject
{
    private List<ListenerRequest> _all = [];

    public ObservableCollection<RequestRowViewModel> Rows { get; } = [];

    /// <summary>Open (the default) or everything recent.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowsOpen))]
    private bool _showsAll;

    public bool ShowsOpen => !ShowsAll;

    /// <summary>The web console's sentence for somebody the station will not show the list to.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsForbidden))]
    private string? _forbidden;

    public bool IsForbidden => Forbidden is not null;

    /// <summary>What the list says when it is empty, which differs by filter.</summary>
    [ObservableProperty]
    private string? _empty;

    public async Task LoadAsync(CancellationToken cancellationToken)
    {
        var forbidden = false;
        var list = await actions.RunAsync(
            async token =>
            {
                using var client = sdk();
                try
                {
                    return await client.Requests.ListRequestsAsync(null, token).ConfigureAwait(false);
                }
                catch (SdkException failure) when (ApiError.IsForbidden(failure))
                {
                    forbidden = true;
                    return new ListenerRequestList { Requests = [] };
                }
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (forbidden)
        {
            Forbidden = Requests.Forbidden;
            _all = [];
            Show();
            return;
        }

        if (list is not null)
        {
            Present(list.Requests);
        }
    }

    /// <summary>Draws the requests the station answered with.</summary>
    public void Present(IEnumerable<ListenerRequest> requests)
    {
        Forbidden = null;
        _all = [.. requests];
        Show();
    }

    [RelayCommand]
    private void ShowOpen() => ShowsAll = false;

    [RelayCommand]
    private void ShowAll() => ShowsAll = true;

    partial void OnShowsAllChanged(bool value) => Show();

    /// <summary>The sentence replaces the list, so the empty line has to be reconsidered with it.</summary>
    partial void OnForbiddenChanged(string? value) => Show();

    [RelayCommand]
    private async Task GrantAsync(RequestRowViewModel row, CancellationToken cancellationToken)
    {
        var granted = await actions.RunAsync(
            async token =>
            {
                using var client = sdk();
                return await client.Requests.GrantRequestAsync(row.Request.Id, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (granted is not null)
        {
            Replace(granted);
        }
    }

    [RelayCommand]
    private async Task DeclineAsync(RequestRowViewModel row)
    {
        var dialog = new DeclineRequestDialogViewModel(row.Record, Requests.Told(row.Request), async (reason, token) =>
        {
            var declined = await actions.RunAsync(
                async inner =>
                {
                    using var client = sdk();
                    return await client.Requests.DeclineRequestAsync(
                        row.Request.Id,
                        new ListenerRequestDecline { Reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim() },
                        inner).ConfigureAwait(false);
                },
                cancellationToken: token).ConfigureAwait(true);

            if (declined is null)
            {
                return false;
            }

            Replace(declined);
            return true;
        });

        await dialogs.ShowAsync(dialog).ConfigureAwait(true);
    }

    /// <summary>Puts the station's answer for one request in place of the row it was.</summary>
    private void Replace(ListenerRequest request)
    {
        var index = _all.FindIndex(existing => existing.Id == request.Id);
        if (index >= 0)
        {
            _all[index] = request;
        }

        Show();
    }

    private void Show()
    {
        Rows.Clear();
        foreach (var request in _all.Where(request => ShowsAll || Requests.IsOpen(request.Status)))
        {
            Rows.Add(new RequestRowViewModel(
                request,
                Requests.Dedication(request),
                Requests.From(request.Source, request.CreatedAt.ToLocalTime().ToString("d MMM HH:mm", CultureInfo.InvariantCulture)),
                Requests.Status(request.Status),
                Requests.Tone(request.Status),
                Requests.CanGrant(request.Status),
                Requests.CanDecline(request.Status)));
        }

        Empty = IsForbidden || Rows.Count > 0
            ? null
            : ShowsAll ? "Nobody has asked for anything lately." : "Nobody is waiting on a request.";
    }
}
