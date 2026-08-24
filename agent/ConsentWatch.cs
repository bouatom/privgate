namespace PrivGate.Agent;

/// <summary>
/// Detects when stock UAC (<c>consent.exe</c>) has left this session so the tray
/// can offer a PrivGate request on the interactive desktop. Does not read, hook,
/// or dismiss the UAC dialog.
/// </summary>
sealed class ConsentWatch
{
    bool _uacWasVisible;

    /// <summary>
    /// True once when session consent PIDs go from non-empty to empty (UAC closed:
    /// cancel, timeout, or an administrator approved the Windows prompt).
    /// </summary>
    internal bool ShouldPrompt(IReadOnlyCollection<int> sessionConsentPids)
    {
        if (sessionConsentPids.Count > 0)
        {
            _uacWasVisible = true;
            return false;
        }
        if (!_uacWasVisible) return false;
        _uacWasVisible = false;
        return true;
    }
}
