/*
 * ZcordUpdater — relais IPC MAJ auto (main process → renderer)
 */

import { Settings } from "@api/Settings";
import definePlugin from "@utils/types";

export type UpdatePhase = "idle" | "checking" | "downloading" | "installing" | "restarting" | "error";

let updatePhase: UpdatePhase = "idle";
let updateDetail = "";

export function getUpdatePhase() {
    return updatePhase;
}

export function getUpdateDetail() {
    return updateDetail;
}

export default definePlugin({
    name: "ZcordUpdater",
    enabledByDefault: true,
    required: true,
    description: "MAJ 100% automatique depuis GitHub (sans retélécharger le Setup).",
    authors: [{ name: "Zcord", id: 0n }],

    start() {
        if (Settings.disableAutoUpdate) return;

        VencordNative.zcord.onUpdateStatus((status, detail) => {
            if (status === "checking") updatePhase = "checking";
            else if (status === "downloading") updatePhase = "downloading";
            else if (status === "installing") updatePhase = "installing";
            else if (status === "restarting") updatePhase = "restarting";
            else if (status === "error") {
                updatePhase = "error";
                updateDetail = detail;
            } else {
                updatePhase = "idle";
                updateDetail = detail;
            }

            window.dispatchEvent(new CustomEvent("zcord-update-status", {
                detail: { status: updatePhase, detail: updateDetail }
            }));
        });
    },

    stop() {
        updatePhase = "idle";
        updateDetail = "";
    },
});
