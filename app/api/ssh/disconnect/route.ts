import { NextResponse } from "next/server";
import { closeSession } from "@/lib/ssh";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sessionId } = body;
    if (sessionId && typeof sessionId === "string") {
      closeSession(sessionId);
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
