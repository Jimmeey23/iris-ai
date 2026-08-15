import { createServer } from "node:net";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const nextBin = join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "0.0.0.0");
  });
}

/** PID(s) currently listening on this port, if any (macOS/Linux only). */
function pidsListeningOn(port) {
  if (process.platform === "win32") return [];
  try {
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: "utf8" });
    return out.split("\n").map((p) => Number(p.trim())).filter(Boolean);
  } catch {
    return []; // lsof exits non-zero when nothing matches
  }
}

/** Whether a PID's working directory is inside this project — i.e. safe to treat as "our" stray server. */
function belongsToThisProject(pid) {
  try {
    const out = execSync(`lsof -a -p ${pid} -d cwd -Fn`, { encoding: "utf8" });
    const line = out.split("\n").find((l) => l.startsWith("n"));
    const cwd = line?.slice(1);
    return !!cwd && (cwd === projectRoot || projectRoot.startsWith(cwd));
  } catch {
    return false;
  }
}

/**
 * If a port is occupied by a leftover dev server from a previous, un-stopped
 * run of THIS project, kill it and free the port. Never touches processes
 * belonging to other projects or unrelated apps.
 */
function reclaimIfStale(port) {
  for (const pid of pidsListeningOn(port)) {
    if (pid === process.pid) continue;
    if (!belongsToThisProject(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
      console.log(`Port ${port} was held by a leftover dev server (PID ${pid}) from a previous run — stopped it.`);
    } catch {
      // already gone
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findFreePort(startPort) {
  let port = startPort;
  for (let attempts = 0; attempts < 50; attempts += 1) {
    if (await isPortFree(port)) return port;
    reclaimIfStale(port);
    // Give the OS a moment to actually release the socket after SIGKILL.
    for (let wait = 0; wait < 10; wait += 1) {
      if (await isPortFree(port)) return port;
      await sleep(100);
    }
    port += 1;
  }
  return port;
}

const [command, ...extraArgs] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node run-with-free-port.mjs <next-subcommand> [...args]");
  process.exit(1);
}

const startPort = Number(process.env.PORT) || 3000;
const port = await findFreePort(startPort);
if (port !== startPort) {
  console.log(`Port ${startPort} is in use, using ${port} instead.`);
}

const child = spawn(nextBin, [command, "-p", String(port), ...extraArgs], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code) => process.exit(code ?? 0));
