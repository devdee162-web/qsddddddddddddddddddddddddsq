/*
 * ZcordUpdater — affiche le statut MAJ auto (main process)
 */

import { Settings } from "@api/Settings";
import definePlugin from "@utils/types";
import { waitFor } from "@webpack";
import { React, useEffect, useState } from "@webpack/common";

type UpdatePhase = "idle" | "checking" | "downloading" | "installing" | "restarting" | "error";

let updatePhase: UpdatePhase = "idle";
let updateDetail = "";
let listeners: Array<() => void> = [];

function notify() { listeners.forEach(f => f()); }

function UpdateBanner() {
    const [phase, setPhase] = useState<UpdatePhase>(updatePhase);
    const [detail, setDetail] = useState(updateDetail);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        const fn = () => { setPhase(updatePhase); setDetail(updateDetail); };
        listeners.push(fn);
        return () => { listeners = listeners.filter(f => f !== fn); };
    }, []);

    if (phase === "idle" || dismissed) return null;

    const labels: Record<UpdatePhase, string> = {
        idle: "",
        checking: "Verification des mises a jour...",
        downloading: `Telechargement${detail ? ` (${detail})` : ""}...`,
        installing: "Installation — redemarrage imminent...",
        restarting: "Redemarrage de Zcord...",
        error: detail || "Erreur MAJ"
    };

    return React.createElement("div", {
        style: {
            position: "fixed",
            top: 0, left: 0, right: 0,
            zIndex: 999999,
            background: phase === "error"
                ? "linear-gradient(90deg, #8f1a1a 0%, #c44343 100%)"
                : "linear-gradient(90deg, #1a3d8f 0%, #5865f2 100%)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 16px",
            fontSize: 13,
            fontFamily: "var(--font-primary, sans-serif)",
            boxShadow: "0 2px 16px rgba(0,0,0,0.5)",
            gap: 12,
        }
    },
        React.createElement("div", { style: { flex: 1, minWidth: 0 } },
            React.createElement("span", { style: { fontWeight: 700 } },
                phase === "error" ? "Mise a jour Zcord" : "Mise a jour Zcord automatique"
            ),
            React.createElement("span", {
                style: { marginLeft: 10, opacity: 0.9, fontSize: 12 }
            }, labels[phase])
        ),
        phase === "error" && React.createElement("button", {
            onClick: () => { updatePhase = "idle"; updateDetail = ""; setDismissed(true); notify(); },
            style: {
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.7)",
                cursor: "pointer",
                fontSize: 18,
            },
            title: "Fermer"
        }, "×")
    );
}

let bannerRoot: any = null;
let bannerContainer: HTMLDivElement | null = null;

function mountBanner() {
    if (bannerContainer || document.getElementById("zcord-updater-root")) return;
    waitFor(["createRoot", "render"], (ReactDOM: any) => {
        if (bannerContainer) return;
        bannerContainer = document.createElement("div");
        bannerContainer.id = "zcord-updater-root";
        document.body.appendChild(bannerContainer);
        try {
            if (ReactDOM?.createRoot) {
                bannerRoot = ReactDOM.createRoot(bannerContainer);
                bannerRoot.render(React.createElement(UpdateBanner));
            }
        } catch (e) {
            console.error("[ZcordUpdater] mount:", e);
            bannerContainer?.remove();
            bannerContainer = null;
        }
    });
}

function unmountBanner() {
    try { bannerRoot?.unmount(); } catch { }
    bannerContainer?.remove();
    bannerContainer = null;
    bannerRoot = null;
}

export default definePlugin({
    name: "ZcordUpdater",
    enabledByDefault: true,
    required: true,
    description: "MAJ 100% automatique depuis GitHub (sans retélécharger le Setup).",
    authors: [{ name: "Zcord", id: 0n }],

    start() {
        if (Settings.disableAutoUpdate) return;

        const mountWhenReady = () => setTimeout(mountBanner, 2000);
        if (document.readyState === "complete") mountWhenReady();
        else window.addEventListener("load", mountWhenReady, { once: true });

        VencordNative.zcord.onUpdateStatus((status, detail) => {
            if (status === "checking") updatePhase = "checking";
            else if (status === "downloading") updatePhase = "downloading";
            else if (status === "installing") updatePhase = "installing";
            else if (status === "error") { updatePhase = "error"; updateDetail = detail; }
            else updatePhase = "idle";
            if (status !== "error") updateDetail = detail;
            notify();
        });
    },

    stop() {
        unmountBanner();
        listeners = [];
        updatePhase = "idle";
    },
});
