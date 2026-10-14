import { NextResponse } from "next/server";
import { executeSSHCommand } from "@/lib/ssh";
import { SSHCredentials } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { host, port, username, authType, password, privateKey, passphrase, command, cwd, sessionId } = body;

    if (!host || !username) {
      return NextResponse.json(
        { success: false, error: "Host and Username are required.", stdout: "", stderr: "" },
        { status: 400 }
      );
    }

    if (!command || typeof command !== "string" || !command.trim()) {
      return NextResponse.json(
        { success: false, error: "Command cannot be empty.", stdout: "", stderr: "" },
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

    const targetCwd = typeof cwd === "string" && cwd.trim() ? cwd.trim() : undefined;
    const targetSessionId = typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : undefined;

    const result = await executeSSHCommand(creds, command.trim(), targetCwd, targetSessionId, 45000);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      {
        success: false,
        stdout: "",
        stderr: message,
        exitCode: -1,
        durationMs: 0,
        error: message,
      },
      { status: 500 }
    );
  }
}
