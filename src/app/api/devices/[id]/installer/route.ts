import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "Per-device zip installers were removed. Download an MSI or deployment script from Devices." },
    { status: 410 },
  );
}
