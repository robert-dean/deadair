using CommunityToolkit.Mvvm.ComponentModel;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// Declining a listener's request, with what to tell them.
/// </summary>
/// <remarks>
/// A confirmation with one field rather than a bare one, because the listener is told, and the reason
/// is the only part of that the operator writes. Empty sends none.
/// </remarks>
public sealed partial class DeclineRequestDialogViewModel(
    string record,
    string told,
    Func<string, CancellationToken, Task<bool>> decline) : DialogViewModel
{
    /// <summary>The longest reason the web console lets somebody type.</summary>
    public const int ReasonMax = 400;

    public override string Title => $"Decline {record}?";

    public override string AcceptLabel => "Decline";

    public override bool Destructive => true;

    /// <summary>Who is told, and where.</summary>
    public string Told => told;

    [ObservableProperty]
    private string _reason = string.Empty;

    public override Task<bool> AcceptAsync(CancellationToken cancellationToken) => decline(Reason, cancellationToken);
}
