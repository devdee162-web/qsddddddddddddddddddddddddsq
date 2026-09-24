/*
 * Soft perf only — ne force presque rien OFF.
 * L’utilisateur garde ses plugins ; on évite juste le profiler global.
 */

export const ZCORD_PERF_DISABLED_PLUGINS = new Set<string>([
    "clientdiagnostics",
]);

export function isZcordPerfForcedOff(pluginKey: string, pluginName?: string) {
    const a = String(pluginKey ?? "").toLowerCase().replace(/\s+/g, "");
    const b = String(pluginName ?? "").toLowerCase().replace(/\s+/g, "");
    if (!a && !b) return false;
    return ZCORD_PERF_DISABLED_PLUGINS.has(a) || (!!b && ZCORD_PERF_DISABLED_PLUGINS.has(b));
}
