import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";

const PORT = 3000;
const projectRoot = process.cwd();
const projectMarker = projectRoot.replaceAll("\\", "/").toLowerCase();

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
  } catch {
    return "";
  }
}

function normalise(value) {
  return String(value || "").replaceAll("\\", "/").toLowerCase();
}

function isSportSpotProcess(commandLine) {
  return normalise(commandLine).includes(projectMarker);
}

function isNextDevProcess(commandLine) {
  const command = normalise(commandLine);
  return command.includes("next") && /(?:^|\s)dev(?:\s|$)/.test(command) && command.includes(String(PORT));
}

function readWindowsProcessTable() {
  const output = run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
  ]);
  if (!output) return [];
  try {
    const parsed = JSON.parse(output);
    return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
      pid: Number(item.ProcessId),
      parentPid: Number(item.ParentProcessId),
      commandLine: String(item.CommandLine || ""),
    })).filter((item) => Number.isInteger(item.pid) && item.pid > 0);
  } catch {
    return [];
  }
}

function readWindowsListeners() {
  const output = run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$ErrorActionPreference='SilentlyContinue'; Get-NetTCPConnection -LocalPort ${PORT} -State Listen | Select-Object -ExpandProperty OwningProcess | ConvertTo-Json -Compress`,
  ]);
  if (!output) return [];
  try {
    const parsed = JSON.parse(output);
    return (Array.isArray(parsed) ? parsed : [parsed]).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

function stopExistingSportSpotServer() {
  if (process.platform !== "win32") return;

  const processes = readWindowsProcessTable();
  const processById = new Map(processes.map((item) => [item.pid, item]));
  const listenerPids = readWindowsListeners();
  if (!listenerPids.length) return;

  const targets = new Set();
  for (const listenerPid of listenerPids) {
    const chain = [];
    let currentPid = listenerPid;
    for (let depth = 0; depth < 8 && currentPid; depth += 1) {
      const current = processById.get(currentPid);
      if (!current) break;
      chain.push(current);
      currentPid = current.parentPid;
    }

    const hasSportSpotDev = chain.some((item) => isSportSpotProcess(item.commandLine) && isNextDevProcess(item.commandLine));
    if (!hasSportSpotDev) continue;

    for (const item of chain) {
      if (isSportSpotProcess(item.commandLine)) targets.add(item.pid);
    }
  }

  if (!targets.size) {
    console.error(`Port ${PORT} is already used by another application. SportSpot will not stop unrelated processes.`);
    process.exit(1);
  }

  const targetIds = [...targets].join(",");
  run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$ErrorActionPreference='SilentlyContinue'; Stop-Process -Id ${targetIds} -Force`,
  ]);
  console.log(`Restarting the existing SportSpot dev server on port ${PORT}...`);
}

stopExistingSportSpotServer();

const nextCli = resolve(projectRoot, "node_modules", "next", "dist", "bin", "next");
const nextProcess = spawn(process.execPath, [nextCli, "dev", "--port", String(PORT)], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: false,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => nextProcess.kill(signal));
}

nextProcess.once("error", (error) => {
  console.error(`Could not start Next.js on port ${PORT}: ${error.message}`);
  process.exit(1);
});

nextProcess.once("exit", (code, signal) => {
  process.exit(typeof code === "number" ? code : signal ? 1 : 0);
});
