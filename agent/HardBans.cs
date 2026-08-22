namespace PrivGate.Agent;

public static class HardBans
{
    public static readonly HashSet<string> Names = new(StringComparer.OrdinalIgnoreCase)
    {
        "cmd.exe", "powershell.exe", "pwsh.exe", "wscript.exe", "mshta.exe", "reg.exe"
    };

    public static bool IsBanned(string filePath)
    {
        var name = Path.GetFileName(filePath);
        return Names.Contains(name);
    }
}
