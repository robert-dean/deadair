using Avalonia.Controls;
using MaroonedSoftware.Deadair.Desktop.ViewModels;

namespace MaroonedSoftware.Deadair.Desktop.Views;

public partial class Sidebar : UserControl
{
    private ShellViewModel? _shell;

    public Sidebar()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
    }

    /// <remarks>
    /// The flyout does not close itself when the sign-in succeeds: it closes when somebody clicks
    /// away, which after signing in means the panel sits there still showing the form they have
    /// already finished with.
    /// </remarks>
    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        if (_shell is not null)
        {
            _shell.Login.SignedIn -= Close;
        }

        _shell = DataContext as ShellViewModel;

        if (_shell is not null)
        {
            _shell.Login.SignedIn += Close;
        }
    }

    private void Close() => SignIn.Flyout?.Hide();
}
