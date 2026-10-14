import { NextResponse } from "next/server";
import { testSSHConnection } from "@/lib/ssh";
import { SSHCredentials } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { host, port, username, authType, password, privateKey, passphrase, sessionId } = body;

    if (!host || !username) {
      return NextResponse.json(
        { success: false, error: "Host and Username are required." },
        { status: 400 }
      );
    }

    const creds: SSHCredentials = {
      host: String(host).trim(),
      port: Number(port) || 22,
      username: String(username).trim(),
      authType: authType === "privateKey" ? "privateKey" : "password",
      password: password ? String(password) : undefined,
      privateKey: privateKey ? String(privateKey) : undefined,
      passphrase: passphrase ? String(passphrase) : undefined,
    };

    const result = await testSSHConnection(creds, typeof sessionId === "string" ? sessionId : undefined);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
