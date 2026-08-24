import { execFile } from "node:child_process";
import { networkInterfaces, cpus, totalmem } from "node:os";
import { promisify } from "node:util";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const execFileAsync = promisify(execFile);

export type HardwareScan = {
  gpuName: string | null;
  vramMb: number | null;
  cpuCores: number;
  ramGb: number;
};

/**
 * Whether a resolved endpoint address belongs to the machine this app runs
 * on. Pure so the interesting part is testable without touching real
 * interfaces — `own` comes from networkInterfaces() at the call site.
 *
 * This is the whole point of the locality check: Justin runs the app on a
 * laptop and whisper on a desktop over Tailscale, so a hardware scan
 * usually describes the wrong machine. A confidently wrong model
 * recommendation is worse than none.
 */
export function isOwnAddress(resolved: string[], own: string[]): boolean {
  const ownSet = new Set(own.map((a) => a.toLowerCase()));
  return resolved.some((raw) => {
    const addr = raw.toLowerCase();
    // Loopback is this machine by definition, whatever the interface list says.
    if (addr === "::1" || addr.startsWith("127.")) return true;
    // Node reports IPv4-mapped IPv6 in a few places; compare the v4 tail too.
    const unmapped = addr.startsWith("::ffff:") ? addr.slice(7) : addr;
    return ownSet.has(addr) || ownSet.has(unmapped);
  });
}

/** Does the configured transcription URL point at this machine? */
export async function isLocalEndpoint(url: string): Promise<boolean> {
  try {
    const hostname = new URL(url).hostname;
    if (hostname === "localhost") return true;
    const resolved = isIP(hostname)
      ? [hostname]
      : (await lookup(hostname, { all: true })).map((e) => e.address);
    const own = Object.values(networkInterfaces())
      .flat()
      .filter((i) => i !== undefined)
      .map((i) => i.address);
    return isOwnAddress(resolved, own);
  } catch {
    // An unparseable/unresolvable host is not something we can claim is
    // local — fall back to hiding the scan rather than guessing.
    return false;
  }
}

/**
 * Picks the best available model id for a recommended size. The size names
 * below are generic ("large-v3"); real ids vary by server
 * (`Systran/faster-whisper-large-v3`, `whisper-1`, ...), so match against
 * what the endpoint actually reported when we have it.
 */
export function pickModelId(preferences: string[], available: string[]): string {
  for (const size of preferences) {
    const match = available.find((id) => id.toLowerCase().includes(size.toLowerCase()));
    if (match) return match;
  }
  return preferences[0];
}

export type ModelRecommendation = { preferences: string[]; reason: string };

/**
 * Maps a hardware scan to Whisper model sizes, best first. Deliberately a
 * suggestion with its reasoning attached rather than something applied
 * automatically — the thresholds are rules of thumb about keeping up with
 * real-time audio, not measurements of this machine.
 */
export function recommendWhisperModel(scan: HardwareScan): ModelRecommendation {
  const { gpuName, vramMb, cpuCores, ramGb } = scan;
  if (vramMb !== null && gpuName) {
    const vramGb = Math.round(vramMb / 1024);
    if (vramMb >= 10_000) {
      return {
        preferences: ["large-v3", "medium", "small"],
        reason: `Detected ${gpuName} with ~${vramGb}GB VRAM — enough to run large-v3 comfortably faster than real time.`,
      };
    }
    if (vramMb >= 5_000) {
      return {
        preferences: ["distil-large-v3", "medium", "small"],
        reason: `Detected ${gpuName} with ~${vramGb}GB VRAM — distil-large-v3 gets near-large accuracy in that budget; medium is the safe fallback.`,
      };
    }
    return {
      preferences: ["small", "base"],
      reason: `Detected ${gpuName} with only ~${vramGb}GB VRAM — small fits; anything larger will spill and crawl.`,
    };
  }
  if (cpuCores >= 8 && ramGb >= 16) {
    return {
      preferences: ["small", "base"],
      reason: `No NVIDIA GPU detected, but ${cpuCores} CPU cores and ~${ramGb}GB RAM handle small on CPU — expect roughly real time, not faster.`,
    };
  }
  return {
    preferences: ["base", "tiny"],
    reason: `No NVIDIA GPU detected and ${cpuCores} CPU cores — base is the realistic ceiling; larger models will take longer than the lecture itself.`,
  };
}

// Fixed argument list, no interpolation: nothing user-supplied goes near
// this, and execFile (not exec) means no shell to inject into either way.
const NVIDIA_SMI_ARGS = ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"];

/** Inspects the machine this app runs on. Absent nvidia-smi just means "no NVIDIA GPU", never an error. */
export async function scanHardware(): Promise<HardwareScan> {
  let gpuName: string | null = null;
  let vramMb: number | null = null;
  try {
    const { stdout } = await execFileAsync("nvidia-smi", NVIDIA_SMI_ARGS, { timeout: 5_000 });
    const [line] = stdout.trim().split("\n");
    const [name, mem] = (line ?? "").split(",").map((s) => s.trim());
    if (name) {
      gpuName = name;
      const parsed = Number.parseInt(mem ?? "", 10);
      vramMb = Number.isFinite(parsed) ? parsed : null;
    }
  } catch {
    // No binary, non-zero exit, no driver — all the same answer here.
  }
  return {
    gpuName,
    vramMb,
    cpuCores: cpus().length,
    ramGb: Math.round(totalmem() / 1024 ** 3),
  };
}
