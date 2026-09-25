/*
 * Soft perf + stabilité UI.
 * Force OFF plugins qui cassent la titlebar / spam overlays.
 */

export const ZCORD_PERF_DISABLED_PLUGINS = new Set<string>([
    "clientdiagnostics",
    "perfhud",
    "orbolaybridge",
    "discorddevbanner",
]);

export function isZcordPerfForcedOff(pluginKey: string, pluginName?: string) {
    const a = String(pluginKey ?? "").toLowerCase().replace(/\s+/g, "");
    const b = String(pluginName ?? "").toLowerCase().replace(/\s+/g, "");
    if (!a && !b) return false;
    return ZCORD_PERF_DISABLED_PLUGINS.has(a) || (!!b && ZCORD_PERF_DISABLED_PLUGINS.has(b));
}
