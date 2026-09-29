using Avalonia.Controls;

namespace MaroonedSoftware.Deadair.Desktop.Views;

public partial class StepUpDialogView : UserControl
{
    public StepUpDialogView()
    {
        InitializeComponent();

        // The only thing to do here is type six digits, so the box has the keyboard from the start.
        // On Loaded rather than on attach: a focus asked for before the layer is shown is refused.
        Loaded += (_, _) => CodeBox.Focus();
    }
}
