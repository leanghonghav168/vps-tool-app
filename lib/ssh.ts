import { Client, ConnectConfig } from "ssh2";
import { SSHCredentials, SSHExecResult, SSHSystemInfo, SSHTestResult } from "./types";

interface ActiveSession {
  id: string;
  client: Client;
  creds: SSHCredentials;
  lastUsed: number;
  timer?: NodeJS.Timeout;
}

// Global session map across requests
const sessions = new Map<string, ActiveSession>();
const SESSION_IDLE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

function getOrCreateSessionId(creds: SSHCredentials, requestedSessionId?: string): string {
  if (requestedSessionId && requestedSessionId.trim()) {
    return requestedSessionId.trim();
  }
  // Generate consistent or unique ID
  return `${creds.username}@${creds.host}:${creds.port || 22}_${Math.random().toString(36).substring(2, 9)}`;
}

function resetSessionTimer(session: ActiveSession) {
  if (session.timer) clearTimeout(session.timer);
  session.lastUsed = Date.now();
  session.timer = setTimeout(() => {
    try {
      session.client.end();
    } catch {
      // ignore
    }
    sessions.delete(session.id);
  }, SESSION_IDLE_TIMEOUT_MS);
}

export function closeSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (session) {
    if (session.timer) clearTimeout(session.timer);
    try {
      session.client.end();
    } catch {
      // ignore
    }
    sessions.delete(sessionId);
  }
}

function buildConnectConfig(creds: SSHCredentials, timeoutMs = 10000): ConnectConfig {
  const config: ConnectConfig = {
    host: creds.host.trim(),
    port: creds.port || 22,
    username: creds.username.trim(),
    readyTimeout: timeoutMs,
    keepaliveInterval: 10000,
    keepaliveCountMax: 5,
  };

  if (creds.authType === "privateKey") {
    if (!creds.privateKey) {
      throw new Error("Private key is required for key-based authentication.");
    }
    config.privateKey = creds.privateKey;
    if (creds.passphrase) {
      config.passphrase = creds.passphrase;
    }
  } else {
    config.password = creds.password ?? "";
  }

  return config;
}

function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message || "";
    if (msg.includes("All configured authentication methods failed")) {
      return "Authentication failed: Please check your username and password or private key.";
    }
    if (msg.includes("ENOTFOUND")) {
      return "Host not found: Unable to resolve the server hostname or IP address.";
    }
    if (msg.includes("ECONNREFUSED")) {
      return "Connection refused: The server refused SSH connection on this port. Check if SSH is running and port is open.";
    }
    if (msg.includes("ETIMEDOUT") || msg.includes("timed out")) {
      return "Connection timed out: The server did not respond in time. Check firewall/network settings.";
    }
    return msg;
  }
  return String(err);
}

// Ensure an authenticated client is ready (reuse existing or establish new)
async function getConnectedClient(
  creds: SSHCredentials,
  sessionId?: string
): Promise<{ client: Client; sessionId: string; latencyMs: number; isNew: boolean }> {
  const actualId = getOrCreateSessionId(creds, sessionId);
  const existing = sessions.get(actualId);

  // If already connected and ready, return immediately (0ms login!)
  if (existing) {
    resetSessionTimer(existing);
    return { client: existing.client, sessionId: actualId, latencyMs: 0, isNew: false };
  }

  const startTime = Date.now();
  const client = new Client();

  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          client.end();
        } catch {}
        reject(new Error("Connection timed out waiting for server handshake."));
      }
    }, 12000);

    client.on("ready", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const latencyMs = Date.now() - startTime;
        const newSession: ActiveSession = {
          id: actualId,
          client,
          creds,
          lastUsed: Date.now(),
        };
        resetSessionTimer(newSession);
        sessions.set(actualId, newSession);

        client.on("close", () => {
          sessions.delete(actualId);
        });

        resolve({ client, sessionId: actualId, latencyMs, isNew: true });
      }
    });

    client.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        sessions.delete(actualId);
        reject(new Error(formatErrorMessage(err)));
      }
    });

    try {
      const config = buildConnectConfig(creds, 10000);
      client.connect(config);
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(formatErrorMessage(err)));
      }
    }
  });
}

export async function testSSHConnection(
  creds: SSHCredentials,
  sessionId?: string
): Promise<SSHTestResult> {
  try {
    const { client, sessionId: activeSessionId, latencyMs } = await getConnectedClient(creds, sessionId);

    // Probe initial system info and working directory
    const probeCmd = `echo "HOSTNAME=$(hostname 2>/dev/null || cat /etc/hostname 2>/dev/null)"; echo "USER=$(whoami)"; echo "OS=$(uname -srmo 2>/dev/null || uname -a)"; echo "UPTIME=$(uptime -p 2>/dev/null || uptime)"; echo "PWD=$(pwd)"; echo "HOME=$HOME"`;

    return new Promise((resolve) => {
      client.exec(probeCmd, (err, stream) => {
        if (err) {
          resolve({
            success: true,
            sessionId: activeSessionId,
            latencyMs,
            systemInfo: {
              hostname: creds.host,
              os: "Linux",
              uptime: "Unknown",
              user: creds.username,
              currentCwd: "~",
              homeDir: "~",
            },
          });
          return;
        }

        let output = "";
        stream.on("data", (data: Buffer) => {
          output += data.toString("utf8");
        });

        stream.on("close", () => {
          const sysInfo: SSHSystemInfo = {
            hostname: creds.host,
            os: "Linux",
            uptime: "Unknown",
            user: creds.username,
            currentCwd: "~",
            homeDir: "~",
          };

          output.split("\n").forEach((line) => {
            const trimmed = line.trim();
            if (trimmed.startsWith("HOSTNAME=")) {
              const val = trimmed.replace("HOSTNAME=", "").trim();
              if (val) sysInfo.hostname = val;
            } else if (trimmed.startsWith("USER=")) {
              const val = trimmed.replace("USER=", "").trim();
              if (val) sysInfo.user = val;
            } else if (trimmed.startsWith("OS=")) {
              const val = trimmed.replace("OS=", "").trim();
              if (val) sysInfo.os = val;
            } else if (trimmed.startsWith("UPTIME=")) {
              const val = trimmed.replace("UPTIME=", "").trim();
              if (val) sysInfo.uptime = val;
            } else if (trimmed.startsWith("PWD=")) {
              const val = trimmed.replace("PWD=", "").trim();
              if (val) sysInfo.currentCwd = val;
            } else if (trimmed.startsWith("HOME=")) {
              const val = trimmed.replace("HOME=", "").trim();
              if (val) sysInfo.homeDir = val;
            }
          });

          resolve({
            success: true,
            sessionId: activeSessionId,
            latencyMs,
            systemInfo: sysInfo,
          });
        });
      });
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to connect to VPS.",
    };
  }
}

export async function executeSSHCommand(
  creds: SSHCredentials,
  command: string,
  cwd?: string,
  sessionId?: string,
  timeoutMs = 45000
): Promise<SSHExecResult> {
  const startTime = Date.now();
  const sentinel = `__VPSTOOL_PWD_${Math.random().toString(36).substring(2, 9)}__`;

  try {
    const { client } = await getConnectedClient(creds, sessionId);

    return new Promise((resolve) => {
      let resolved = false;

      const fail = (errMsg: string) => {
        if (!resolved) {
          resolved = true;
          resolve({
            success: false,
            stdout: "",
            stderr: errMsg,
            exitCode: -1,
            durationMs: Date.now() - startTime,
            error: errMsg,
          });
        }
      };

      const timer = setTimeout(() => {
        fail(`Command timed out after ${timeoutMs / 1000} seconds.`);
      }, timeoutMs);

      const cdTarget = cwd && cwd.trim() ? cwd.trim() : "~";
      const wrappedScript = `
cd ${JSON.stringify(cdTarget)} 2>/dev/null || cd ~
[ -f /etc/profile ] && . /etc/profile 2>/dev/null
[ -f ~/.profile ] && . ~/.profile 2>/dev/null
[ -f ~/.bash_profile ] && . ~/.bash_profile 2>/dev/null
[ -f ~/.bashrc ] && . ~/.bashrc 2>/dev/null
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" 2>/dev/null
export PATH="$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin:$PATH:/usr/local/bin:/usr/bin:/bin"

${command}
__CMD_EXIT__=$?

printf "\n%s\n" "${sentinel}"
pwd
exit $__CMD_EXIT__
`;

      client.exec(wrappedScript, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          fail(formatErrorMessage(err));
          return;
        }

        let rawStdout = "";
        let rawStderr = "";

        stream.on("data", (data: Buffer) => {
          rawStdout += data.toString("utf8");
        });

        stream.stderr.on("data", (data: Buffer) => {
          rawStderr += data.toString("utf8");
        });

        stream.on("close", (code: number) => {
          clearTimeout(timer);
          if (!resolved) {
            resolved = true;

            let cleanStdout = rawStdout;
            let newCwd: string | undefined = undefined;

            const sentinelIdx = rawStdout.lastIndexOf(sentinel);
            if (sentinelIdx !== -1) {
              cleanStdout = rawStdout.substring(0, sentinelIdx).replace(/\r?\n$/, "");
              const trailing = rawStdout.substring(sentinelIdx + sentinel.length).trim();
              const firstLine = trailing.split(/\r?\n/)[0]?.trim();
              if (firstLine) {
                newCwd = firstLine;
              }
            }

            resolve({
              success: code === 0,
              stdout: cleanStdout,
              stderr: rawStderr,
              exitCode: code ?? 0,
              durationMs: Date.now() - startTime,
              newCwd: newCwd || cwd,
            });
          }
        });
      });
    });
  } catch (err) {
    return {
      success: false,
      stdout: "",
      stderr: formatErrorMessage(err),
      exitCode: -1,
      durationMs: Date.now() - startTime,
      error: formatErrorMessage(err),
    };
  }
}
