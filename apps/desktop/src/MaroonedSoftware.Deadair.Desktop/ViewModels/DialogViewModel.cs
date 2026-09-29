using CommunityToolkit.Mvvm.ComponentModel;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// Something the app asks over the page, and waits for.
/// </summary>
/// <remarks>
/// <para>
/// A dialog is a view model with a matching view named after it (<c>FooDialogViewModel</c> draws as
/// <c>FooDialogView</c>, found by <c>DialogLocator</c>), shown by <see cref="DialogsViewModel"/> and
/// answered with its accept button or Escape.
/// </para>
/// <para>
/// Accepting runs <see cref="AcceptAsync"/>, which is where a dialog that saves something calls the
/// station. It stays open when that answers false, and a refusal the station gives while it is
/// running is shown on the dialog rather than behind it, because the page behind is not where
/// somebody is looking.
/// </para>
/// </remarks>
public abstract partial class DialogViewModel : ObservableObject
{
    /// <summary>The question, in a few words.</summary>
    public abstract string Title { get; }

    /// <summary>What the accept button says. A verb, so the button says what pressing it does.</summary>
    public virtual string AcceptLabel => "Save";

    /// <summary>What the other button says.</summary>
    public virtual string CancelLabel => "Cancel";

    /// <summary>Whether accepting removes something or changes what airs, which colours the button.</summary>
    public virtual bool Destructive => false;

    /// <summary>What went wrong the last time accept was pressed, shown under the fields.</summary>
    [ObservableProperty]
    private string? _problem;

    /// <summary>Whether accepting is running, so it is not pressed twice.</summary>
    [ObservableProperty]
    private bool _busy;

    /// <summary>Whether what is in the fields can be sent at all. Raise a change of it when a field moves.</summary>
    public virtual bool CanAccept => true;

    /// <summary>Does what accepting means, and answers whether the dialog is finished.</summary>
    public virtual Task<bool> AcceptAsync(CancellationToken cancellationToken) => Task.FromResult(true);

    /// <summary>Tells the view the accept button's state may have changed.</summary>
    protected void Revalidate() => OnPropertyChanged(nameof(CanAccept));
}
