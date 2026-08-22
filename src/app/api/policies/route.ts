import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb, listPolicies, insertPolicy, appendAudit } from "@/lib/db";
import { assertAllowPolicyInput, type Policy } from "@/lib/policy";
import { isResponse, requireAdmin } from "@/lib/http";

export async function GET() {
  const auth = await requireAdmin("policies.view");
  if (isResponse(auth)) return auth;
  return NextResponse.json(listPolicies(getDb()));
}

export async function POST(req: Request) {
  const auth = await requireAdmin("policies.manage");
  if (isResponse(auth)) return auth;
  const body = (await req.json()) as Partial<Policy>;
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
  if (bindType === "group" && !body.bindId) {
    return NextResponse.json({ error: "group bind requires bindId" }, { status: 400 });
  }
  const policy: Policy = {
    id: randomUUID(),
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
  const db = getDb();
  insertPolicy(db, policy);
  appendAudit(db, auth.session.email, "policy.create", policy.id, { name: policy.name });
  return NextResponse.json(policy, { status: 201 });
}
