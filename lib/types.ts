export interface SSHCredentials {
  host: string;
  port: number;
  username: string;
  authType: "password" | "privateKey";
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface SSHSystemInfo {
  hostname: string;
  os: string;
  uptime: string;
  user: string;
  homeDir?: string;
  currentCwd?: string;
}

export interface SSHTestResult {
  success: boolean;
  sessionId?: string;
  latencyMs?: number;
  systemInfo?: SSHSystemInfo;
  error?: string;
}

export interface SSHExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  newCwd?: string;
  error?: string;
}
