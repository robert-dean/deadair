using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;

// The `Notice` property below shadows the type of the same name.
using StationNotice = MaroonedSoftware.Deadair.Desktop.Core.Auth.Notice;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>What asks before it acts.</summary>
public interface IDialogs
{
    /// <summary>Shows a dialog and answers whether it was accepted.</summary>
    Task<bool> ShowAsync(DialogViewModel dialog);

    /// <summary>Asks before something that cannot be undone.</summary>
    Task<bool> ConfirmAsync(string question, string consequence, string verb, bool destructive = true);
}

/// <summary>
/// The dialog over the app, if there is one, and the line at the foot of the page that says what the
/// station refused.
/// </summary>
/// <remarks>
/// <para>
/// One layer in the shell rather than second windows. A second window on macOS is a thing that can
/// end up behind the first, on another Space, or outliving the window that asked; a layer over the
/// shell is always exactly where the question was asked, and cannot be.
/// </para>
/// <para>
/// The notice line replaces the one the transport used to carry. That one sat in the Now playing
/// panel, which can be closed and is hidden below 1060, so a Library or Voice page whose write was
/// refused said nothing at all to somebody who had put the panel away.
/// </para>
/// </remarks>
public sealed partial class DialogsViewModel : ObservableObject, IDialogs
{
    /// <summary>How long a notice stays before it goes on its own.</summary>
    private static readonly TimeSpan NoticeLasts = TimeSpan.FromSeconds(8);

    private readonly IUiDispatcher _dispatcher;
    private readonly TimeProvider _time;
    private TaskCompletionSource<bool>? _pending;
    private ITimer? _clear;

    public DialogsViewModel(OperatorActions actions, IUiDispatcher dispatcher, TimeProvider? time = null)
    {
        ArgumentNullException.ThrowIfNull(actions);
        _dispatcher = dispatcher;
        _time = time ?? TimeProvider.System;
        actions.Noticed += notice => _dispatcher.Post(() => Report(notice));
    }

    /// <summary>The dialog showing, or null.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsOpen))]
    private DialogViewModel? _current;

    public bool IsOpen => Current is not null;

    /// <summary>The last thing the station refused, while it is still worth reading.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasNotice))]
    private string? _notice;

    public bool HasNotice => Notice is not null;

    public Task<bool> ShowAsync(DialogViewModel dialog)
    {
        ArgumentNullException.ThrowIfNull(dialog);

        // One question at a time. A second arriving while the first is open answers the first "no"
        // rather than stacking, because two dialogs over each other is two things asked at once.
        Close(accepted: false);

        _pending = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        Current = dialog;
        return _pending.Task;
    }

    public Task<bool> ConfirmAsync(string question, string consequence, string verb, bool destructive = true) =>
        ShowAsync(new ConfirmDialogViewModel(question, consequence, verb, destructive));

    [RelayCommand]
    private async Task AcceptAsync(CancellationToken cancellationToken)
    {
        if (Current is not { CanAccept: true, Busy: false } dialog)
        {
            return;
        }

        dialog.Problem = null;
        dialog.Busy = true;
        bool done;
        try
        {
            done = await dialog.AcceptAsync(cancellationToken).ConfigureAwait(true);
        }
        finally
        {
            dialog.Busy = false;
        }

        // Still the same dialog: pressing Escape while a save was in flight has already answered it.
        if (done && ReferenceEquals(Current, dialog))
        {
            Close(accepted: true);
        }
    }

    [RelayCommand]
    public void Cancel() => Close(accepted: false);

    [RelayCommand]
    private void DismissNotice() => Notice = null;

    private void Close(bool accepted)
    {
        var pending = _pending;
        _pending = null;
        Current = null;
        pending?.TrySetResult(accepted);
    }

    /// <summary>
    /// Shows what the station said: on the dialog, when one is saving, and at the foot of the page
    /// otherwise.
    /// </summary>
    private void Report(StationNotice notice)
    {
        var text = StationNotice.Describe(notice);

        if (Current is { Busy: true } dialog)
        {
            dialog.Problem = text;
            return;
        }

        Notice = text;
        _clear?.Dispose();
        _clear = _time.CreateTimer(
            _ => _dispatcher.Post(() =>
            {
                if (Notice == text)
                {
                    Notice = null;
                }
            }),
            null,
            NoticeLasts,
            Timeout.InfiniteTimeSpan);
    }
}
