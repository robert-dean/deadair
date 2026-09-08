namespace MaroonedSoftware.Deadair.Desktop.PluginSdk;

/// <summary>How much a line matters.</summary>
public enum PluginLogLevel
{
    Info,
    Warning,
    Error,
}

/// <summary>
/// Where a plugin says what happened.
/// </summary>
/// <remarks>
/// Kept, and shown on the settings page beside the plugin that wrote it. "Why can it not see my
/// speaker" is the entire diagnosis story for a device plugin, and it is a question nobody can
/// answer from a phase enum: the useful facts are which addresses were tried, what answered and
/// what did not.
/// </remarks>
public interface IPluginLogger
{
    void Log(PluginLogLevel level, string message, Exception? exception = null);
}

/// <summary>The three levels, spelled.</summary>
public static class PluginLoggerExtensions
{
    public static void Info(this IPluginLogger logger, string message) =>
        logger.Log(PluginLogLevel.Info, message);

    public static void Warn(this IPluginLogger logger, string message, Exception? exception = null) =>
        logger.Log(PluginLogLevel.Warning, message, exception);

    public static void Error(this IPluginLogger logger, string message, Exception? exception = null) =>
        logger.Log(PluginLogLevel.Error, message, exception);
}
