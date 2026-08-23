import { getSession } from "@/lib/auth";
import { subscribeConsole } from "@/lib/realtime/bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new Response("unauthenticated", { status: 401 });

  const encoder = new TextEncoder();
  let ping: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("hello", { ok: true });
      unsubscribe = subscribeConsole((event) => send("mutate", event));
      ping = setInterval(() => send("ping", {}), 15_000);
      req.signal.addEventListener("abort", () => {
        if (ping) clearInterval(ping);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      if (ping) clearInterval(ping);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
