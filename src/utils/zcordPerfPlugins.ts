/*
 * Soft perf + stabilité UI.
 * Force OFF plugins qui cassent la titlebar / spam overlays.
 */

/**
 * Plugins that must NEVER be force-disabled by perf / restore / unlock scripts.
 * Adding any of these to ZCORD_PERF_DISABLED_PLUGINS is a bug.
 */
export const ZCORD_NEVER_FORCE_OFF_PLUGINS = new Set<string>([
    "showhiddenchannels",
    "experiments",
]);

export const ZCORD_PERF_DISABLED_PLUGINS = new Set<string>([
    "clientdiagnostics",
    "perfhud",
    "orbolaybridge",
    "discorddevbanner",
    "webrichpresence",
    "nodmwhilestreaming",
    "channeltabs",
    // NOTE: never add ShowHiddenChannels here — it was force-off by mistake and
    // silently disabled the plugin every launch (Aucun accès / empty channel list).
    "livewallpaper",
    "channelwallpaper",
    "compactmode",
    "stealthmode",
    "uioptimisations",
    "channelbadges",
    "toastnotifications",
    "messagenotifier",
    "pingnotifications",
    "keywordnotify",
    "xsoverlay",
    "notificationvolume",
    "dynamicislande",
    "themeattributes",
]);

function normalizePluginKey(value: string) {
    return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

export function isZcordNeverForceOff(pluginKey: string, pluginName?: string) {
    const a = normalizePluginKey(pluginKey);
    const b = normalizePluginKey(pluginName ?? "");
    return ZCORD_NEVER_FORCE_OFF_PLUGINS.has(a) || (!!b && ZCORD_NEVER_FORCE_OFF_PLUGINS.has(b));
}

export function isZcordPerfForcedOff(pluginKey: string, pluginName?: string) {
    if (isZcordNeverForceOff(pluginKey, pluginName)) return false;

    const a = normalizePluginKey(pluginKey);
    const b = normalizePluginKey(pluginName ?? "");
    if (!a && !b) return false;

    // Safety net: if someone re-adds a protected plugin to the set, ignore it.
    if (ZCORD_NEVER_FORCE_OFF_PLUGINS.has(a) || (!!b && ZCORD_NEVER_FORCE_OFF_PLUGINS.has(b))) {
        return false;
    }

    return ZCORD_PERF_DISABLED_PLUGINS.has(a) || (!!b && ZCORD_PERF_DISABLED_PLUGINS.has(b));
}
