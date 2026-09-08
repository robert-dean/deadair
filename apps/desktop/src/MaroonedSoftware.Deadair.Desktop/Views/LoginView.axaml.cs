using Avalonia.Controls;

namespace MaroonedSoftware.Deadair.Desktop.Views;

public partial class LoginView : UserControl
{
    public LoginView()
    {
        InitializeComponent();

        RevealToggle.IsCheckedChanged += (_, _) =>
            PasswordBox.RevealPassword = RevealToggle.IsChecked is true;

        // Every time the panel is shown, not once when it is built. The password survives a flyout
        // that was opened and dismissed without signing in — it is only cleared on success — so a
        // toggle left on would put that password back on screen for whoever opens the panel next.
        AttachedToVisualTree += (_, _) => RevealToggle.IsChecked = false;
    }

    /// <summary>
    /// Poses the toggle, so both of its states can be looked at without a keyboard.
    /// </summary>
    /// <remarks>
    /// Public for the shot tool, which is a separate assembly. The alternative was
    /// <c>InternalsVisibleTo</c>, which opens the whole internal surface of the app to it for the
    /// sake of one line.
    /// </remarks>
    public void Reveal(bool revealed) => RevealToggle.IsChecked = revealed;
}
