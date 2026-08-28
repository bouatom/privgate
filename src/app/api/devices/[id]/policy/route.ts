import { NextResponse } from "next/server";
import { appendAudit, getDb } from "@/lib/db";
import { setDeviceUpdatePolicy } from "@/lib/db/device-groups";
import { isResponse, requireAdmin } from "@/lib/http";
import { isUpdateMode, normalizeSchedule } from "@/lib/update-policy";

/**
 * PUT /api/devices/[id]/policy — set a device's update policy.
 * mode may be 'auto' | 'scheduled' | 'manual' | '' ('' clears the device-level
 * policy and makes the device inherit from its group / the default).
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("devices.update");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    mode?: unknown;
    schedule?: unknown;
  };

  if (typeof body.mode !== "string" || (body.mode !== "" && !isUpdateMode(body.mode))) {
    return NextResponse.json(
      { error: "mode must be auto | scheduled | manual | ''" },
      { status: 400 },
    );
  }
  let schedule = "";
  if (body.mode === "scheduled") {
    schedule = normalizeSchedule(body.schedule);
    if (!schedule) {
      return NextResponse.json({ error: "schedule must be HH:MM when mode is scheduled" }, { status: 400 });
    }
  }

  const result = setDeviceUpdatePolicy(getDb(), id, { mode: body.mode, schedule });
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "unknown device" }, { status: 404 });
  }
  appendAudit(getDb(), auth.session.email, "device.policy.update", id, { mode: body.mode, schedule });
  return NextResponse.json({ ok: true });
}
