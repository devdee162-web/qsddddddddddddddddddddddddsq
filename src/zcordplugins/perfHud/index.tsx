/*
 * Zcord — HUD latence saisie (ms). Léger : pas de rAF permanent, update throttlée.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const ROOT_ID = "zcord-perf-hud";
const STYLE_ID = "zcord-perf-hud-style";
const SAMPLE_MS = 2000;

const settings = definePluginSettings({
    showLegend: {
        type: OptionType.BOOLEAN,
        description: "Afficher la légende sous le compteur",
        default: true,
    },
    corner: {
        type: OptionType.SELECT,
        description: "Coin de l’écran",
        options: [
            { label: "Bas gauche", value: "bl", default: true },
            { label: "Bas droite", value: "br" },
            { label: "Haut gauche", value: "tl" },
            { label: "Haut droite", value: "tr" },
        ],
        onChange: () => placeRoot(),
    },
});

let lastInputMs: number | null = null;
let lastFrameMs = 16;
let sampleTimer: number | undefined;
let pendingRender = false;
let onKey: ((e: KeyboardEvent) => void) | undefined;
let eventObs: PerformanceObserver | undefined;

function tier(ms: number): { dot: string; label: string; color: string; } {
    if (ms < 100) return { dot: "🟢", label: "excellent, très fluide", color: "#23a559" };
    if (ms < 200) return { dot: "🟡", label: "correct", color: "#f0b232" };
    return { dot: "🔴", label: "lag", color: "#f23f43" };
}

function placeRoot() {
    const el = document.getElementById(ROOT_ID);
    if (!el) return;
    const c = settings.store.corner ?? "bl";
    el.style.top = c.startsWith("t") ? "12px" : "auto";
    el.style.bottom = c.startsWith("b") ? "12px" : "auto";
    el.style.left = c.endsWith("l") ? "12px" : "auto";
    el.style.right = c.endsWith("r") ? "12px" : "auto";
}

function ensureUi() {
    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
#${ROOT_ID}{position:fixed;z-index:2147483645;pointer-events:none;font-family:Consolas,monospace;font-size:12px;line-height:1.35;padding:8px 10px;border-radius:8px;background:rgba(0,0,0,.55);color:#fff;-webkit-app-region:no-drag;user-select:none}
#${ROOT_ID} .ms{font-weight:700;font-size:14px}
#${ROOT_ID} .sub{opacity:.85;font-size:11px;margin-top:2px}
#${ROOT_ID} .leg{opacity:.7;font-size:10px;margin-top:6px}
`;
        document.head.appendChild(style);
    }
    if (!document.getElementById(ROOT_ID)) {
        const root = document.createElement("div");
        root.id = ROOT_ID;
        root.innerHTML = `<div class="ms">…</div><div class="sub"></div><div class="leg"></div>`;
        document.body.appendChild(root);
        placeRoot();
    }
}

function render(ms: number, kind: string) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const t = tier(ms);
    const msEl = root.querySelector(".ms") as HTMLElement | null;
    const sub = root.querySelector(".sub") as HTMLElement | null;
    const leg = root.querySelector(".leg") as HTMLElement | null;
    if (msEl) {
        msEl.style.color = t.color;
        msEl.textContent = `${t.dot} ${Math.round(ms)} ms`;
    }
    if (sub) sub.textContent = `${t.label} · ${kind}`;
    if (leg) {
        leg.style.display = settings.store.showLegend ? "block" : "none";
        leg.textContent = "🟢 < 100 ms → excellent, très fluide (tape pour mesurer)";
    }
}

function scheduleRender(ms: number, kind: string) {
    if (pendingRender) return;
    pendingRender = true;
    requestAnimationFrame(() => {
        pendingRender = false;
        render(ms, kind);
    });
}

function sampleFrameOnce() {
    if (document.hidden) return;
    requestAnimationFrame(t0 => {
        requestAnimationFrame(t1 => {
            const dt = t1 - t0;
            if (dt >= 4 && dt <= 40) lastFrameMs = lastFrameMs * 0.6 + dt * 0.4;
            if (lastInputMs == null) scheduleRender(lastFrameMs, "frame");
        });
    });
}

function recordInput(ms: number) {
    // Ignore absurd spikes from background throttle
    if (!(ms >= 0) || ms > 2000) return;
    lastInputMs = ms;
    scheduleRender(ms, "saisie");
}

function isChatTarget(t: EventTarget | null) {
    if (!(t instanceof HTMLElement)) return false;
    if (t.isContentEditable) return true;
    const tag = t.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return true;
    return !!t.closest('[role="textbox"], [data-slate-editor="true"], textarea, input');
}

export default definePlugin({
    name: "PerfHud",
    description: "Latence saisie en ms (🟢 < 100 ms = excellent). Tape dans le chat pour mesurer.",
    authors: [{ name: "Zcord", id: 0n }],
    tags: ["Utility", "Performance"],
    enabledByDefault: true,
    settings,

    start() {
        ensureUi();
        lastInputMs = null;
        lastFrameMs = 16;
        pendingRender = false;

        try {
            eventObs = new PerformanceObserver(list => {
                for (const e of list.getEntries() as PerformanceEventTiming[]) {
                    if (e.name !== "keydown") continue;
                    // processing delay only (not inflated presentation)
                    const proc = Math.max(0, (e.processingEnd || e.startTime) - e.startTime);
                    const paint = typeof e.duration === "number" ? e.duration : proc;
                    recordInput(Math.min(proc, paint) || paint);
                }
            });
            eventObs.observe({ type: "event", buffered: false, durationThreshold: 16 } as PerformanceObserverInit);
        } catch { /* */ }

        // Fallback: one double-rAF per burst (not every key)
        let lastMeasure = 0;
        onKey = e => {
            if (e.repeat || e.isComposing || eventObs) return;
            if (!isChatTarget(e.target)) return;
            const now = performance.now();
            if (now - lastMeasure < 300) return;
            lastMeasure = now;
            const t0 = now;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => recordInput(performance.now() - t0));
            });
        };
        document.addEventListener("keydown", onKey, { capture: true, passive: true });

        sampleFrameOnce();
        sampleTimer = window.setInterval(sampleFrameOnce, SAMPLE_MS);
        scheduleRender(16, "attente");
    },

    stop() {
        if (sampleTimer != null) window.clearInterval(sampleTimer);
        sampleTimer = undefined;
        eventObs?.disconnect();
        eventObs = undefined;
        if (onKey) {
            document.removeEventListener("keydown", onKey, true);
            onKey = undefined;
        }
        document.getElementById(ROOT_ID)?.remove();
        document.getElementById(STYLE_ID)?.remove();
    },
});
