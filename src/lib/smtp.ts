import net from "node:net";
import tls from "node:tls";

export type SmtpMessage = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
};

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

async function connect(host: string, port: number, secure: boolean): Promise<net.Socket> {
  return await new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host }, () => resolve(socket))
      : net.connect({ host, port }, () => resolve(socket));
    socket.setTimeout(12_000);
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("SMTP timeout"));
    });
  });
}

async function readReply(socket: net.Socket): Promise<{ code: number; lines: string }> {
  return await new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const lines = buf.replaceAll("\r\n", "\n").split("\n").filter(Boolean);
      const last = lines.at(-1) ?? "";
      if (/^\d{3} /.test(last) || /^\d{3}-/.test(last) && lines.some((l) => /^\d{3} /.test(l))) {
        const done = lines.filter((l) => /^\d{3} /.test(l)).at(-1);
        if (done) {
          socket.off("data", onData);
          resolve({ code: Number(done.slice(0, 3)), lines: buf });
        }
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

async function cmd(socket: net.Socket, line: string) {
  socket.write(`${line}\r\n`);
  const reply = await readReply(socket);
  if (reply.code >= 400) throw new Error(reply.lines.trim() || `SMTP ${reply.code}`);
  return reply;
}

export async function sendSmtp(message: SmtpMessage) {
  if (!message.host || !message.from || !message.to.length) {
    throw new Error("SMTP host, from, and recipients are required");
  }
  const socket = await connect(message.host, message.port, message.secure);
  await readReply(socket);
  await cmd(socket, `EHLO privgate`);
  if (message.user) {
    await cmd(socket, "AUTH LOGIN");
    await cmd(socket, encode(message.user));
    await cmd(socket, encode(message.pass || ""));
  }
  await cmd(socket, `MAIL FROM:<${message.from}>`);
  for (const rcpt of message.to) await cmd(socket, `RCPT TO:<${rcpt}>`);
  await cmd(socket, "DATA");
  const body = [
    `From: ${message.from}`,
    `To: ${message.to.join(", ")}`,
    `Subject: ${message.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    message.text,
    ".",
  ].join("\r\n");
  socket.write(`${body}\r\n`);
  await readReply(socket);
  try {
    socket.write("QUIT\r\n");
  } catch {
    /* ignore */
  }
  socket.end();
}

export async function probeHost(host: string, port: number, useTls: boolean, timeoutMs = 5000) {
  if (!host) throw new Error("Host is required");
  await new Promise<void>((resolve, reject) => {
    const socket = useTls
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
          socket.end();
          resolve();
        })
      : net.connect({ host, port }, () => {
          socket.end();
          resolve();
        });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`No response from ${host}:${port}`));
    }, timeoutMs);
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.once("close", () => clearTimeout(timer));
  });
}
