using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PrivGate.Agent;

public sealed record ElevationTicket(
    string typ,
    string sub,
    string dev,
    string sha256,
    string publisher,
    string path,
    string child,
    long nbf,
    long exp,
    string nonce);

public static class TicketVerifier
{
    public static string CanonicalJson(ElevationTicket ticket)
    {
        var payload = new SortedDictionary<string, object?>
        {
            ["child"] = ticket.child,
            ["dev"] = ticket.dev,
            ["exp"] = ticket.exp,
            ["nbf"] = ticket.nbf,
            ["nonce"] = ticket.nonce,
            ["path"] = ticket.path,
            ["publisher"] = ticket.publisher,
            ["sha256"] = ticket.sha256,
            ["sub"] = ticket.sub,
            ["typ"] = ticket.typ,
        };
        return JsonSerializer.Serialize(payload);
    }

    public static string Sign(ElevationTicket ticket, string key)
    {
        var payload = Convert.ToBase64String(Encoding.UTF8.GetBytes(CanonicalJson(ticket)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var mac = Hmac(key, payload);
        return $"{payload}.{mac}";
    }

    public static ElevationTicket Verify(string packed, string key, long nowUnix)
    {
        var parts = packed.Split('.');
        if (parts.Length != 2) throw new InvalidOperationException("malformed ticket");
        var expected = Hmac(key, parts[0]);
        if (!FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(parts[1])))
        {
            throw new InvalidOperationException("bad ticket signature");
        }
        var json = Encoding.UTF8.GetString(FromBase64Url(parts[0]));
        var ticket = JsonSerializer.Deserialize<ElevationTicket>(json)
            ?? throw new InvalidOperationException("bad ticket body");
        if (ticket.nbf > nowUnix + 30) throw new InvalidOperationException("ticket not yet valid");
        if (ticket.exp <= nowUnix) throw new InvalidOperationException("ticket expired");
        return ticket;
    }

    public static string DeviceHmac(string secret, string timestamp, string method, string path, string bodySha256)
    {
        var msg = $"{timestamp}.{method.ToUpperInvariant()}.{path}.{bodySha256}";
        return Hmac(secret, msg);
    }

    static string Hmac(string key, string payload)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(key));
        return ToBase64Url(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload)));
    }

    // CryptographicOperations.FixedTimeEquals is net5+; this is the standard
    // constant-time byte comparison that avoids early-exit on mismatch.
    static bool FixedTimeEquals(byte[] left, byte[] right)
    {
        if (left.Length != right.Length) return false;
        int diff = 0;
        for (int i = 0; i < left.Length; i++)
            diff |= left[i] ^ right[i];
        return diff == 0;
    }

    static string ToBase64Url(byte[] data) =>
        Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    static byte[] FromBase64Url(string value)
    {
        var s = value.Replace('-', '+').Replace('_', '/');
        switch (s.Length % 4)
        {
            case 2: s += "=="; break;
            case 3: s += "="; break;
        }
        return Convert.FromBase64String(s);
    }
}
