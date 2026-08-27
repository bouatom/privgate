import { NextResponse } from "next/server";
import { getDb, deletePolicy, updatePolicy, appendAudit } from "@/lib/db";
import { assertAllowPolicyInput, type Policy } from "@/lib/policy";
import { argumentPatternError, effectError } from "@/lib/policy-draft-preview";
import { isResponse, requireAdmin } from "@/lib/http";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("policies.manage");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const db = getDb();
  if (!deletePolicy(db, id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  appendAudit(db, auth.session.email, "policy.delete", id, {});
  return new NextResponse(null, { status: 204 });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("policies.manage");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const body = (await req.json()) as Partial<Policy>;
  const badEffect = effectError(body.effect);
  if (badEffect) return NextResponse.json({ error: badEffect }, { status: 400 });
  const badPattern = argumentPatternError(body.argumentPattern);
  if (badPattern) return NextResponse.json({ error: badPattern }, { status: 400 });
  const error = assertAllowPolicyInput({
    effect: (body.effect as Policy["effect"]) || "allow",
    fileHash: body.fileHash || "",
    publisher: body.publisher || "",
    fileName: body.fileName,
    highRiskException: body.highRiskException,
  });
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const bindType = body.bindType || "all";
  if ((bindType === "group" || bindType === "device" || bindType === "user") && !body.bindId) {
    return NextResponse.json({ error: `${bindType} bind requires bindId` }, { status: 400 });
  }
  const db = getDb();
  const policy: Policy = {
    id,
    name: body.name,
    effect: body.effect || "allow",
    fileHash: body.fileHash!,
    publisher: body.publisher!,
    fileName: body.fileName,
    argumentPattern: body.argumentPattern,
    bindType,
    bindId: body.bindId,
    childProcesses: body.childProcesses || "deny",
    highRiskException: Boolean(body.highRiskException),
  };
  if (!updatePolicy(db, id, policy)) return NextResponse.json({ error: "not found" }, { status: 404 });
  appendAudit(db, auth.session.email, "policy.update", id, { name: policy.name });
  return NextResponse.json(policy);
}
