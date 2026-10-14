"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Server,
  Terminal as TerminalIcon,
  KeyRound,
  Shield,
  Activity,
  Play,
  RotateCw,
  Copy,
  Check,
  Trash2,
  Lock,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle2,
  HardDrive,
  Cpu,
  Clock,
  User,
  Hash,
  Globe,
  ArrowRight,
  PowerOff,
  FolderTree,
} from "lucide-react";
import { SSHCredentials, SSHSystemInfo } from "@/lib/types";

interface TerminalLog {
  id: string;
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timestamp: string;
}

const QUICK_COMMANDS = [
  { label: "PM2 Status", cmd: "pm2 status", icon: Activity },
  { label: "List Files", cmd: "ls -la", icon: FolderTree },
  { label: "Current Dir", cmd: "pwd", icon: TerminalIcon },
  { label: "Disk Usage", cmd: "df -h", icon: HardDrive },
  { label: "Memory Usage", cmd: "free -h 2>/dev/null || free -m", icon: Cpu },
  { label: "Uptime & Load", cmd: "uptime", icon: Clock },
  { label: "Docker", cmd: "docker ps", icon: Server },
];

export default function Home() {
  const [formData, setFormData] = useState<SSHCredentials>({
    host: "",
    port: 22,
    username: "root",
    authType: "password",
    password: "",
    privateKey: "",
    passphrase: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [rememberServer, setRememberServer] = useState(true);

  // Connection status
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [systemInfo, setSystemInfo] = useState<SSHSystemInfo | null>(null);

  // Terminal & Directory tracking
  const [currentCwd, setCurrentCwd] = useState<string>("~");
  const [command, setCommand] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [logs, setLogs] = useState<TerminalLog[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const terminalEndRef = useRef<HTMLDivElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  // Format directory for realistic terminal display (e.g. /root -> ~)
  const formatDirectory = (dir: string, homeDir?: string) => {
    if (!dir) return "~";
    const home = homeDir || (formData.username === "root" ? "/root" : `/home/${formData.username}`);
    if (dir === "~" || dir === home) return "~";
    if (home && dir.startsWith(home + "/")) {
      return "~" + dir.slice(home.length);
    }
    return dir;
  };

  // Load saved credentials
  useEffect(() => {
    try {
      const saved = localStorage.getItem("vps_ssh_config");
      if (saved) {
        const parsed = JSON.parse(saved);
        setFormData((prev) => ({
          ...prev,
          host: parsed.host || "",
          port: parsed.port || 22,
          username: parsed.username || "root",
          authType: parsed.authType || "password",
          password: parsed.password || "",
          privateKey: parsed.privateKey || "",
          passphrase: parsed.passphrase || "",
        }));
      }
    } catch {
      // ignore
    }
  }, []);

  // Auto-scroll terminal to bottom
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleInputChange = (field: keyof SSHCredentials, value: string | number) => {
    setFormData((prev) => ({
      ...prev,
      [field]: field === "port" ? Number(value) || 22 : value,
    }));
    setConnectionError(null);
  };

  const saveToStorageIfNeeded = () => {
    if (rememberServer) {
      try {
        localStorage.setItem(
          "vps_ssh_config",
          JSON.stringify({
            host: formData.host,
            port: formData.port,
            username: formData.username,
            authType: formData.authType,
            password: formData.password,
            privateKey: formData.privateKey,
            passphrase: formData.passphrase,
          })
        );
      } catch {
        // ignore
      }
    }
  };

  // Connect & Probe VPS
  const handleConnect = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!formData.host.trim()) {
      setConnectionError("Please provide a Hostname or IP address.");
      return;
    }
    if (!formData.username.trim()) {
      setConnectionError("Please provide an SSH username.");
      return;
    }

    setIsConnecting(true);
    setConnectionError(null);

    try {
      const res = await fetch("/api/ssh/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setConnectionError(data.error || "Failed to establish SSH connection.");
        setIsConnected(false);
      } else {
        setIsConnected(true);
        if (data.sessionId) {
          setSessionId(data.sessionId);
        }
        setLatency(data.latencyMs ?? null);
        setSystemInfo(data.systemInfo || null);

        const initialDir = data.systemInfo?.currentCwd || "~";
        setCurrentCwd(initialDir);
        saveToStorageIfNeeded();

        const timeStr = new Date().toLocaleTimeString();
        setLogs([
          {
            id: String(Date.now()),
            command: "ssh connection established (session cached)",
            cwd: initialDir,
            stdout: `Connected to ${formData.username}@${formData.host}:${formData.port}\nHostname: ${data.systemInfo?.hostname || formData.host}\nOS Kernel: ${data.systemInfo?.os || "Linux"}\nServer Uptime: ${data.systemInfo?.uptime || "N/A"}\nWorking Directory: ${initialDir}\n\n✓ Persistent SSH session active: Commands execute instantly without re-logging in.`,
            stderr: "",
            exitCode: 0,
            durationMs: data.latencyMs ?? 0,
            timestamp: timeStr,
          },
        ]);

        setTimeout(() => {
          commandInputRef.current?.focus();
        }, 150);
      }
    } catch (err) {
      setConnectionError(
        err instanceof Error ? err.message : "Network request failed while testing SSH connection."
      );
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (sessionId) {
      try {
        await fetch("/api/ssh/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
      } catch {
        // ignore
      }
    }
    setIsConnected(false);
    setSessionId(null);
    setSystemInfo(null);
    setLatency(null);
    setCurrentCwd("~");
  };

  // Execute terminal command
  const handleExecuteCommand = async (cmdToRun?: string) => {
    const rawCmd = (cmdToRun ?? command).trim();
    if (!rawCmd || isExecuting) return;

    // Handle local clear/cls command
    if (rawCmd.toLowerCase() === "clear" || rawCmd.toLowerCase() === "cls") {
      setLogs([]);
      setCommand("");
      setCommandHistory((prev) => [...prev, rawCmd]);
      return;
    }

    setIsExecuting(true);
    const timeStr = new Date().toLocaleTimeString();
    const commandCwd = currentCwd;

    // Add to history
    setCommandHistory((prev) => [...prev, rawCmd]);
    setHistoryIndex(-1);
    if (!cmdToRun) {
      setCommand("");
    }

    try {
      const res = await fetch("/api/ssh/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          command: rawCmd,
          cwd: currentCwd,
          sessionId: sessionId || undefined,
        }),
      });

      const data = await res.json();

      // Update current working directory if cd changed it
      if (data.newCwd) {
        setCurrentCwd(data.newCwd);
      }

      setLogs((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          command: rawCmd,
          cwd: commandCwd,
          stdout: data.stdout || "",
          stderr: data.stderr || (data.error ? String(data.error) : ""),
          exitCode: data.exitCode ?? (data.success ? 0 : 1),
          durationMs: data.durationMs || 0,
          timestamp: timeStr,
        },
      ]);
    } catch (err) {
      setLogs((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          command: rawCmd,
          cwd: commandCwd,
          stdout: "",
          stderr: err instanceof Error ? err.message : "Command execution failed",
          exitCode: 1,
          durationMs: 0,
          timestamp: timeStr,
        },
      ]);
    } finally {
      setIsExecuting(false);
      setTimeout(() => {
        commandInputRef.current?.focus();
      }, 50);
    }
  };

  // History navigation with Up/Down arrows
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const nextIndex = historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setCommand(commandHistory[nextIndex]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex === -1) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= commandHistory.length) {
        setHistoryIndex(-1);
        setCommand("");
      } else {
        setHistoryIndex(nextIndex);
        setCommand(commandHistory[nextIndex]);
      }
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const displayCwd = formatDirectory(currentCwd, systemInfo?.homeDir);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 p-[1px] shadow-lg shadow-emerald-500/20">
            <div className="h-full w-full bg-zinc-950 rounded-[11px] flex items-center justify-center">
              <Server className="w-5 h-5 text-emerald-400" />
            </div>
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-white flex items-center gap-2">
              VPS Remote SSH Manager
              <span className="text-[10px] font-mono uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-md">
                v1.1
              </span>
            </h1>
            <p className="text-xs text-zinc-400">
              Interactive terminal with persistent directory navigation (`cd`) & shell environment
            </p>
          </div>
        </div>

        {/* Status Indicator */}
        <div className="flex items-center gap-3">
          {isConnected ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>
                {formData.username}@{formData.host}:{displayCwd}
              </span>
              {latency !== null && (
                <span className="text-zinc-400 font-mono text-[11px] ml-1 pl-1.5 border-l border-emerald-500/30">
                  {latency}ms
                </span>
              )}
              <button
                onClick={handleDisconnect}
                title="Disconnect from server"
                className="ml-1 text-zinc-400 hover:text-red-400 transition-colors p-0.5"
              >
                <PowerOff className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs">
              <span className="h-2 w-2 rounded-full bg-zinc-600"></span>
              <span>Disconnected</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {connectionError && (
          <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-200 flex items-start gap-3 shadow-lg shadow-red-950/20 animate-in fade-in slide-in-from-top-2 duration-200">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-red-300">Connection Failed</p>
              <p className="text-red-300/90 mt-0.5">{connectionError}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* SSH Configuration Card */}
          <div
            className={`transition-all duration-300 ${
              isConnected ? "lg:col-span-4" : "lg:col-span-6 lg:col-start-4"
            }`}
          >
            <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/60 backdrop-blur-xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

              <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-800/80">
                <div className="flex items-center gap-2.5">
                  <Server className="w-5 h-5 text-emerald-400" />
                  <h2 className="text-base font-semibold text-white">SSH Connection</h2>
                </div>
                {isConnected && (
                  <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Online
                  </span>
                )}
              </div>

              <form onSubmit={handleConnect} className="space-y-4">
                {/* Hostname & Port */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label htmlFor="host name" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Hostname / IP
                    </label>
                    <div className="relative">
                      <Globe className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        id="host name"
                        value={formData.host}
                        onChange={(e) => handleInputChange("host", e.target.value)}
                        placeholder="e.g. 104.207.95.99"
                        className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all font-mono"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="port" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Port
                    </label>
                    <div className="relative">
                      <Hash className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="number"
                        id="port"
                        value={formData.port}
                        onChange={(e) => handleInputChange("port", e.target.value)}
                        placeholder="22"
                        className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl pl-8 pr-2 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Username */}
                <div>
                  <label htmlFor="username" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Username
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      id="username"
                      value={formData.username}
                      onChange={(e) => handleInputChange("username", e.target.value)}
                      placeholder="e.g. root"
                      className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all font-mono"
                      required
                    />
                  </div>
                </div>

                {/* Auth Mode Toggle */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-zinc-300">Authentication Method</label>
                  <div className="grid grid-cols-2 p-1 bg-zinc-950/90 rounded-xl border border-zinc-800/90 text-xs">
                    <button
                      type="button"
                      onClick={() => handleInputChange("authType", "password")}
                      className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-all font-medium ${
                        formData.authType === "password"
                          ? "bg-zinc-800 text-white shadow"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <Lock className="w-3.5 h-3.5" /> Password
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInputChange("authType", "privateKey")}
                      className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-all font-medium ${
                        formData.authType === "privateKey"
                          ? "bg-zinc-800 text-white shadow"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <KeyRound className="w-3.5 h-3.5" /> SSH Key
                    </button>
                  </div>
                </div>

                {/* Password / Key Inputs */}
                {formData.authType === "password" ? (
                  <div>
                    <label htmlFor="password" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type={showPassword ? "text" : "password"}
                        id="password"
                        value={formData.password}
                        onChange={(e) => handleInputChange("password", e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl pl-9 pr-10 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="privateKey" className="block text-xs font-medium text-zinc-300 mb-1.5">
                        Private Key (OpenSSH / RSA PEM)
                      </label>
                      <textarea
                        id="privateKey"
                        rows={4}
                        value={formData.privateKey}
                        onChange={(e) => handleInputChange("privateKey", e.target.value)}
                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
                        className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl p-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all font-mono resize-none leading-relaxed"
                      />
                    </div>
                    <div>
                      <label htmlFor="passphrase" className="block text-xs font-medium text-zinc-300 mb-1.5">
                        Passphrase (optional)
                      </label>
                      <input
                        type="password"
                        id="passphrase"
                        value={formData.passphrase}
                        onChange={(e) => handleInputChange("passphrase", e.target.value)}
                        placeholder="Passphrase if key is encrypted"
                        className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* Remember credentials */}
                <div className="flex items-center justify-between text-xs text-zinc-400 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberServer}
                      onChange={(e) => setRememberServer(e.target.checked)}
                      className="rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500/40"
                    />
                    <span>Remember on this browser</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.removeItem("vps_ssh_config");
                      setFormData({
                        host: "",
                        port: 22,
                        username: "root",
                        authType: "password",
                        password: "",
                        privateKey: "",
                        passphrase: "",
                      });
                    }}
                    className="text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    Clear saved
                  </button>
                </div>

                {/* Connect button */}
                <button
                  type="submit"
                  disabled={isConnecting}
                  className="w-full relative group overflow-hidden rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 p-px font-semibold text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <div className="relative px-4 py-2.5 rounded-[11px] bg-gradient-to-r from-emerald-600 to-teal-600 group-hover:from-emerald-500 group-hover:to-teal-500 transition-all flex items-center justify-center gap-2 text-sm">
                    {isConnecting ? (
                      <>
                        <RotateCw className="w-4 h-4 animate-spin text-white" />
                        <span>Connecting to VPS...</span>
                      </>
                    ) : (
                      <>
                        <span>{isConnected ? "Reconnect / Refresh" : "Connect via SSH"}</span>
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                      </>
                    )}
                  </div>
                </button>
              </form>

              {/* System Diagnostics Card */}
              {isConnected && systemInfo && (
                <div className="mt-5 pt-4 border-t border-zinc-800/80 space-y-3 text-xs">
                  <div className="flex items-center gap-2 font-medium text-zinc-300">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    <span>Host Diagnostics</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-zinc-400">
                    <div className="p-2 rounded-lg bg-zinc-950/70 border border-zinc-800/60">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono">Hostname</p>
                      <p className="text-zinc-200 font-mono font-medium truncate mt-0.5">
                        {systemInfo.hostname}
                      </p>
                    </div>
                    <div className="p-2 rounded-lg bg-zinc-950/70 border border-zinc-800/60">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono">User</p>
                      <p className="text-emerald-400 font-mono font-medium truncate mt-0.5">
                        {systemInfo.user}
                      </p>
                    </div>
                    <div className="col-span-2 p-2 rounded-lg bg-zinc-950/70 border border-zinc-800/60">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono">Current Working Dir</p>
                      <p className="text-emerald-300 font-mono truncate mt-0.5 font-medium">
                        {currentCwd}
                      </p>
                    </div>
                    <div className="col-span-2 p-2 rounded-lg bg-zinc-950/70 border border-zinc-800/60">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono">Server Uptime</p>
                      <p className="text-zinc-200 font-mono truncate mt-0.5">
                        {systemInfo.uptime}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Interactive Terminal Window */}
          <div className={`transition-all duration-300 ${isConnected ? "lg:col-span-8" : "lg:col-span-12"}`}>
            <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/60 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden min-h-[580px]">
              {/* Terminal Window Header */}
              <div className="px-4 py-3 bg-zinc-950/90 border-b border-zinc-800/80 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-red-500/80 inline-block border border-red-600/50"></span>
                    <span className="w-3 h-3 rounded-full bg-yellow-500/80 inline-block border border-yellow-600/50"></span>
                    <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block border border-emerald-600/50"></span>
                  </div>
                  <div className="h-4 w-px bg-zinc-800" />
                  <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
                    <TerminalIcon className="w-3.5 h-3.5 text-emerald-400" />
                    <span>
                      {isConnected
                        ? `${formData.username}@${formData.host || "vps"}:${displayCwd}`
                        : "terminal (disconnected)"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setLogs([])}
                    title="Clear console output (or type 'clear')"
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Clear</span>
                  </button>
                </div>
              </div>

              {/* Quick Commands Bar */}
              <div className="px-3 py-2 bg-zinc-900/40 border-b border-zinc-800/60 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono px-1 shrink-0">
                  Quick:
                </span>
                {QUICK_COMMANDS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.label}
                      onClick={() => handleExecuteCommand(item.cmd)}
                      disabled={!isConnected || isExecuting}
                      className="px-2.5 py-1 rounded-lg bg-zinc-950/80 border border-zinc-800/80 text-zinc-300 hover:text-white hover:border-emerald-500/40 hover:bg-zinc-800/50 text-xs font-mono transition-all flex items-center gap-1.5 shrink-0 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
                    >
                      <Icon className="w-3 h-3 text-emerald-400" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Terminal Logs Output */}
              <div className="flex-1 p-4 bg-zinc-950/95 font-mono text-xs overflow-y-auto space-y-4 max-h-[500px] select-text">
                {logs.length === 0 ? (
                  <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-zinc-600 space-y-3 select-none">
                    <TerminalIcon className="w-12 h-12 text-zinc-700/60" />
                    <div className="text-center">
                      <p className="text-sm font-medium text-zinc-400">
                        {isConnected ? "Terminal Active" : "Connect to your server to begin"}
                      </p>
                      <p className="text-xs text-zinc-600 mt-1 max-w-sm">
                        {isConnected
                          ? "Run commands like `cd <folder>`, `pm2 status`, `ls -la`, etc. Directory changes persist across commands."
                          : "Enter your VPS credentials in the form and click 'Connect via SSH'."}
                      </p>
                    </div>
                  </div>
                ) : (
                  logs.map((log) => {
                    const logDir = formatDirectory(log.cwd, systemInfo?.homeDir);
                    return (
                      <div
                        key={log.id}
                        className="rounded-lg bg-zinc-900/40 border border-zinc-800/60 p-3 space-y-2 group transition-colors hover:border-zinc-700"
                      >
                        {/* Prompt Line */}
                        <div className="flex items-center justify-between text-zinc-400 pb-1.5 border-b border-zinc-800/50">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-emerald-400 font-bold">
                              {formData.username}@{formData.host || "vps"}:{logDir}$
                            </span>
                            <span className="text-zinc-100 font-semibold">{log.command}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                log.exitCode === 0
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                  : "bg-red-500/10 text-red-400 border border-red-500/20"
                              }`}
                            >
                              exit: {log.exitCode}
                            </span>
                            <span className="text-[10px] text-zinc-500">{log.durationMs}ms</span>
                            <button
                              onClick={() =>
                                copyToClipboard(`${log.stdout}\n${log.stderr}`.trim(), log.id)
                              }
                              title="Copy output"
                              className="text-zinc-500 hover:text-zinc-300 p-0.5 transition-colors cursor-pointer"
                            >
                              {copiedId === log.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Stdout */}
                        {log.stdout && (
                          <pre className="text-zinc-200 whitespace-pre-wrap leading-relaxed overflow-x-auto text-[11px] sm:text-xs">
                            {log.stdout}
                          </pre>
                        )}

                        {/* Stderr */}
                        {log.stderr && (
                          <pre className="text-red-400/90 whitespace-pre-wrap leading-relaxed overflow-x-auto text-[11px] sm:text-xs bg-red-950/20 p-2 rounded border border-red-900/30">
                            {log.stderr}
                          </pre>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={terminalEndRef} />
              </div>

              {/* Command Input Bar */}
              <div className="p-3 bg-zinc-950 border-t border-zinc-800/80">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleExecuteCommand();
                  }}
                  className="flex items-center gap-2"
                >
                  <div className="relative flex-1 flex items-center">
                    <span className="absolute left-3 text-emerald-400 font-mono font-bold text-xs select-none">
                      {isConnected ? `${displayCwd} $` : "$"}
                    </span>
                    <input
                      ref={commandInputRef}
                      type="text"
                      disabled={!isConnected || isExecuting}
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      onKeyDown={handleKeyDown}
                      style={{
                        paddingLeft: isConnected ? `${Math.max(3.5, displayCwd.length * 0.55 + 2.5)}rem` : "2rem",
                      }}
                      placeholder={
                        isConnected
                          ? "Type command (e.g. cd /var/www, pm2 status, ls -la)... [↑/↓ for history]"
                          : "Connect to your server first to run commands..."
                      }
                      className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl pr-4 py-2.5 text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-600 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={!isConnected || isExecuting || !command.trim()}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs sm:text-sm shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
                  >
                    {isExecuting ? (
                      <RotateCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current" />
                    )}
                    <span className="hidden sm:inline">Run</span>
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
