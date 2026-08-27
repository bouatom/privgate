import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb, listPolicies, insertPolicy, appendAudit } from "@/lib/db";
import { assertAllowPolicyInput, assertPolicyTargetfield, type Policy } from "@/lib/policy";
import { argumentPatternError, effectError } from "@/lib/policy-draft-preview";
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
  const badEffect = effectError(body.effect);
  if (badEffect) return NextResponse.json({ error: badEffect }, { status: 400 });
  // Advanced-mode argument patterns are raw regexes; reject broken ones here
  // so a rule that could never match never reaches the store.
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
  const targetError = assertPolicyTargetfield({
    name: body.name,
    bindType,
    bindId: body.bindId,
    fileName: body.fileName,
    fileHash: body.fileHash,
    publisher: body.publisher,
    argumentPattern: body.argumentPattern,
  });
  if (targetError) return NextResponse.json({ error: targetError }, { status: 400 });
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
