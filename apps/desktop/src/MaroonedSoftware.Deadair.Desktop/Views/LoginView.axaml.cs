using Avalonia.Controls;

namespace MaroonedSoftware.Deadair.Desktop.Views;

public partial class LoginView : UserControl
{
    public LoginView()
    {
        InitializeComponent();

        RevealToggle.IsCheckedChanged += (_, _) =>
            PasswordBox.RevealPassword = RevealToggle.IsChecked is true;
    }

    /// <summary>
    /// Readies the form for somebody arriving at it: the password hidden, and the caret in the email.
    /// </summary>
    /// <remarks>
    /// Called by the setup screen every time its sign-in step shows, not once when this is built.
    /// The form stays in the tree while the step is hidden, and the password survives a visit that
    /// ended in Not now (it is only cleared on success), so a toggle left on would put that password
    /// back on screen for whoever opens it next. It was reset on attach while the form lived in a
    /// flyout, which attached it afresh on every opening; a hidden step is never detached.
    /// </remarks>
    public void Prepare()
    {
        RevealToggle.IsChecked = false;
        (NeedsCodeBox.IsEffectivelyVisible ? NeedsCodeBox : EmailBox).Focus();
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
