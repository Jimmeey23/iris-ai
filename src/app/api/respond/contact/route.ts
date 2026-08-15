import { NextResponse } from "next/server";
import { getRespondContact, listRespondMessages } from "@/lib/respond-templates";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const identifier = searchParams.get("identifier");
  if (!identifier) return NextResponse.json({ error: "identifier is required" }, { status: 400 });

  const [contact, messages] = await Promise.all([
    getRespondContact(identifier),
    listRespondMessages(identifier, 20),
  ]);
  return NextResponse.json({ contact, messages });
}
