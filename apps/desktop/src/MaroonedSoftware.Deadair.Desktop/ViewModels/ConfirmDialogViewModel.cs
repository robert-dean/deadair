namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// "Are you sure?", said as what will happen.
/// </summary>
/// <param name="Question">The title, as a question.</param>
/// <param name="Consequence">What pressing the button does that cannot be undone, in a sentence.</param>
/// <param name="Verb">The button, as the thing it does: "Delete", "Put on air".</param>
/// <param name="IsDestructive">Whether the button is drawn in the tally colour.</param>
public sealed class ConfirmDialogViewModel(string Question, string Consequence, string Verb, bool IsDestructive = true)
    : DialogViewModel
{
    public override string Title => Question;

    public string Body => Consequence;

    public override string AcceptLabel => Verb;

    public override bool Destructive => IsDestructive;
}
