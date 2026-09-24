/*
 * Zcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChildProcess, execFile, spawn } from "child_process";
import type { IpcMainInvokeEvent } from "electron";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface SmtcSession {
    app: string;
    title: string;
    artist: string;
    album: string;
    status: string;
    position: number;
    duration: number;
}

export interface SmtcResponse {
    ok: boolean;
    sessions: SmtcSession[];
    error?: string;
}

export interface CoverLookup {
    ok: boolean;
    artUrl?: string;
    album?: string;
    error?: string;
}

const WORK_DIR = join(tmpdir(), "zcord-ytm");
const STATE_FILE = join(WORK_DIR, "smtc-state.json");
const LOOP_PS1 = join(WORK_DIR, "smtc-loop.ps1");
const PID_FILE = join(WORK_DIR, "smtc-worker.pid");

const SMTC_LOOP_PS1 = `
$ErrorActionPreference = "Continue"
$outPath = $args[0]
$intervalSec = 12
if ($args.Count -ge 2) { $intervalSec = [Math]::Max(8, [int]$args[1]) }
Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue | Out-Null
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
function Await($WinRtTask, $ResultType) {
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
  })[0]
  $netTask = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($WinRtTask))
  $netTask.Result
}
while ($true) {
  try {
    $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $list = @()
    foreach ($s in $mgr.GetSessions()) {
      $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      if (-not $props.Title) { continue }
      $tl = $s.GetTimelineProperties()
      $pb = $s.GetPlaybackInfo()
      $list += @{
        app = [string]$s.SourceAppUserModelId
        title = [string]$props.Title
        artist = [string]$props.Artist
        album = [string]$props.AlbumTitle
        status = [string]$pb.PlaybackStatus
        position = [int][math]::Floor($tl.Position.TotalSeconds)
        duration = [int][math]::Floor($tl.EndTime.TotalSeconds)
      }
    }
    $json = (@{ ok = $true; sessions = $list } | ConvertTo-Json -Depth 5 -Compress)
    [System.IO.File]::WriteAllText($outPath, $json, [System.Text.UTF8Encoding]::new($false))
  } catch {
    $json = (@{ ok = $false; sessions = @(); error = $_.Exception.Message } | ConvertTo-Json -Compress)
    [System.IO.File]::WriteAllText($outPath, $json, [System.Text.UTF8Encoding]::new($false))
  }
  Start-Sleep -Seconds $intervalSec
}
`.trim();

let smtcWorker: ChildProcess | null = null;
let smtcPaused = false;
let lastCache: SmtcResponse | null = null;
let lastCacheAt = 0;
const coverCache = new Map<string, CoverLookup>();

function ensureWorkDir() {
    mkdirSync(WORK_DIR, { recursive: true });
    writeFileSync(LOOP_PS1, SMTC_LOOP_PS1, "utf8");
}

function isAlive() {
    return !!(smtcWorker && smtcWorker.exitCode == null && !smtcWorker.killed);
}

async function killOrphans() {
    if (process.platform !== "win32") return;
    try {
        if (existsSync(PID_FILE)) {
            const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
            if (pid) try { process.kill(pid); } catch { /* */ }
            try { unlinkSync(PID_FILE); } catch { /* */ }
        }
    } catch { /* */ }
    try {
        await execFileAsync("powershell.exe", [
            "-NoProfile", "-NonInteractive", "-Command",
            "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*smtc-loop*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }",
        ], { windowsHide: true, timeout: 4000 });
    } catch { /* */ }
}

function startWorker() {
    if (process.platform !== "win32" || smtcPaused || isAlive()) return;
    ensureWorkDir();
    try {
        smtcWorker = spawn("powershell.exe", [
            "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
            "-WindowStyle", "Hidden", "-File", LOOP_PS1, STATE_FILE, "15",
        ], { windowsHide: true, stdio: "ignore" });
        if (smtcWorker.pid) writeFileSync(PID_FILE, String(smtcWorker.pid), "utf8");
        smtcWorker.unref?.();
        smtcWorker.on("exit", () => {
            smtcWorker = null;
            try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch { /* */ }
        });
        smtcWorker.on("error", () => { smtcWorker = null; });
    } catch {
        smtcWorker = null;
    }
}

function stopWorker() {
    if (!smtcWorker) return;
    try { smtcWorker.kill(); } catch { /* */ }
    smtcWorker = null;
    try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch { /* */ }
}

export async function setSmtcPaused(_e: IpcMainInvokeEvent, paused: boolean) {
    // Flag only — ne kill/spawn PAS le worker (évite lag)
    smtcPaused = !!paused;
    if (!smtcPaused) startWorker();
    return { ok: true as const };
}

export async function shutdownSmtcWorker(_e?: IpcMainInvokeEvent) {
    smtcPaused = true;
    stopWorker();
    return { ok: true as const };
}

export async function initSmtcWorker(_e?: IpcMainInvokeEvent) {
    await killOrphans();
    smtcPaused = false;
    startWorker();
    return { ok: true as const };
}

process.once("exit", stopWorker);

function readState(): SmtcResponse | null {
    try {
        if (!existsSync(STATE_FILE)) return null;
        const json = JSON.parse(readFileSync(STATE_FILE, "utf8").trim());
        return {
            ok: json?.ok !== false,
            sessions: Array.isArray(json?.sessions) ? json.sessions : [],
            error: json?.error,
        };
    } catch {
        return null;
    }
}

export async function getSmtcSessions(_e?: IpcMainInvokeEvent): Promise<SmtcResponse> {
    if (process.platform !== "win32") {
        return { ok: false, sessions: [], error: "Windows only" };
    }
    if (smtcPaused) return lastCache ?? { ok: true, sessions: [] };
    if (!isAlive()) startWorker();
    if (lastCache && Date.now() - lastCacheAt < 3000) return lastCache;
    const fromFile = readState();
    if (fromFile) {
        lastCache = fromFile;
        lastCacheAt = Date.now();
        return fromFile;
    }
    return lastCache ?? { ok: true, sessions: [] };
}

function clean(s: string) {
    return s
        .replace(/\s*[\(\[][^)\]]*(official|video|audio|radio\s*edit|clip|lyrics|hd|4k|remaster)[^)\]]*[\)\]]/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

export async function lookupCoverArt(
    _e: IpcMainInvokeEvent,
    req: { title: string; artist?: string; album?: string; }
): Promise<CoverLookup> {
    const title = clean(req?.title || "");
    const artist = clean(req?.artist || "");
    if (!title) return { ok: false, error: "no title" };
    const key = `${artist}|${title}`.toLowerCase();
    const cached = coverCache.get(key);
    if (cached) return cached;

    try {
        const q = encodeURIComponent([artist, title].filter(Boolean).join(" "));
        const deezer = await fetch(`https://api.deezer.com/search?q=${q}&limit=3`);
        if (deezer.ok) {
            const data = (await deezer.json() as any)?.data?.[0];
            const artUrl = data?.album?.cover_xl || data?.album?.cover_big;
            if (artUrl) {
                const hit = { ok: true, artUrl, album: data?.album?.title || req.album };
                coverCache.set(key, hit);
                return hit;
            }
        }
        const itunes = await fetch(`https://itunes.apple.com/search?term=${q}&media=music&entity=song&limit=3`);
        if (itunes.ok) {
            const hit0 = (await itunes.json() as any)?.results?.[0];
            const raw = hit0?.artworkUrl100;
            if (raw) {
                const hit = {
                    ok: true,
                    artUrl: String(raw).replace(/\/\d+x\d+bb\./, "/600x600bb."),
                    album: hit0?.collectionName || req.album,
                };
                coverCache.set(key, hit);
                return hit;
            }
        }
        const miss = { ok: false, error: "not found" };
        coverCache.set(key, miss);
        return miss;
    } catch (e: any) {
        return { ok: false, error: e?.message || "lookup failed" };
    }
}
