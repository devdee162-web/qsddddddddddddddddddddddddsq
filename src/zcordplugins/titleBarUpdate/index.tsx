/*
 * Zcord — icône MAJ dans la barre de titre (flèche verte, style Discord)
 */

import { Settings } from "@api/Settings";
import { openSettingsTabModal, UpdaterTab } from "@components/settings";
import definePlugin from "@utils/types";
import { checkForUpdates, isOutdated } from "@utils/updater";

const STYLE_ID = "zcord-titlebar-update-style";
const BTN_ID = "zcord-titlebar-update";

function isStealth() {
    try { return localStorage.getItem("Zcord_stealthMode") === "1"; } catch { return false; }
}

function positionButton() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;

    const winButtons = document.querySelector('[class*="winButtons"]') as HTMLElement | null;
    if (winButtons) {
        const left = winButtons.getBoundingClientRect().left;
        btn.style.right = `${Math.max(8, window.innerWidth - left + 6)}px`;
        return;
    }

    // Fallback: à gauche des boutons fenêtre (~138px)
    btn.style.right = "138px";
}

function setVisible(visible: boolean) {
    const btn = document.getElementById(BTN_ID);
    if (btn) btn.style.display = visible ? "flex" : "none";
}

async function refreshAvailability() {
    if (Settings.disableAutoUpdate || IS_UPDATER_DISABLED || isStealth()) {
        setVisible(false);
        return;
    }

    try {
        await checkForUpdates();
        if (IS_DISCORD_DESKTOP) VencordNative.tray.setUpdateState(isOutdated);
        setVisible(isOutdated);
    } catch {
        setVisible(false);
    }
}

function injectButton() {
    if (document.getElementById(BTN_ID) || !IS_DISCORD_DESKTOP) return;

    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            #${BTN_ID} {
                position: fixed;
                top: 0;
                height: 32px;
                width: 28px;
                z-index: 2147483646;
                display: none;
                align-items: center;
                justify-content: center;
                -webkit-app-region: no-drag !important;
                pointer-events: all !important;
                cursor: pointer;
                color: #23a559;
                border: none;
                background: transparent;
                padding: 0;
                border-radius: 4px;
            }
            #${BTN_ID}:hover {
                background: rgba(255, 255, 255, 0.08);
                color: #2dc770;
            }
            #${BTN_ID}.zcord-updating {
                color: #5865f2;
                animation: zcord-titlebar-update-pulse 1.2s ease-in-out infinite;
            }
            @keyframes zcord-titlebar-update-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.4; }
            }
        `;
        document.head.appendChild(style);
    }

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.title = "Mise a jour Zcord disponible";
    btn.setAttribute("aria-label", "Mise a jour Zcord");
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 4h14v2H5v-2z"/></svg>`;
    btn.addEventListener("click", e => {
        e.stopPropagation();
        openSettingsTabModal(UpdaterTab!);
    });
    document.body.appendChild(btn);
    positionButton();
    window.addEventListener("resize", positionButton);
}

export default definePlugin({
    name: "TitleBarUpdate",
    description: "Affiche la fleche verte de MAJ dans la barre de titre quand Zcord a une nouvelle version.",
    authors: [{ name: "Zcord", id: 0n }],
    enabledByDefault: true,
    required: true,

    start() {
        if (!IS_DISCORD_DESKTOP || IS_WEB || IS_UPDATER_DISABLED) return;

        const init = () => {
            injectButton();
            void refreshAvailability();
            setInterval(() => void refreshAvailability(), 30 * 60 * 1000);
        };

        if (document.readyState === "complete") init();
        else window.addEventListener("load", init, { once: true });

        window.addEventListener("zcord-update-checked", () => void refreshAvailability());

        window.addEventListener("zcord-update-status", e => {
            const { status } = (e as CustomEvent<{ status: string; }>).detail ?? {};
            const btn = document.getElementById(BTN_ID);
            if (!btn) return;

            if (status === "checking" || status === "downloading" || status === "installing" || status === "restarting") {
                btn.classList.add("zcord-updating");
                setVisible(true);
                positionButton();
            } else if (status === "idle" || status === "error") {
                btn.classList.remove("zcord-updating");
                void refreshAvailability();
            }
        });
    },

    stop() {
        document.getElementById(BTN_ID)?.remove();
        document.getElementById(STYLE_ID)?.remove();
    }
});
