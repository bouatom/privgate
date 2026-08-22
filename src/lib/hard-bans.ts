export const HARD_BANS = [
  "cmd.exe",
  "powershell.exe",
  "pwsh.exe",
  "wscript.exe",
  "mshta.exe",
  "reg.exe",
] as const;

export function fileNameOf(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  const base = normalized.split("/").pop() ?? filePath;
  return base.toLowerCase();
}

export function isHardBanned(filePath: string): boolean {
  return (HARD_BANS as readonly string[]).includes(fileNameOf(filePath));
}
