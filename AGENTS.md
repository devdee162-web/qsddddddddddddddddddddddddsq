.rules

# ShowHiddenChannels (critique)
- Ne jamais forcer OFF `ShowHiddenChannels` / `showhiddenchannels` (perf, restore-plugins, force-perf-off).
- Garder l’opt-out expérience Discord `2026-02-private-channel-hiding` (bucket -1) + patches obfuscation.
- Règle détaillée : `.cursor/rules/show-hidden-channels.mdc` + `ZCORD_NEVER_FORCE_OFF_PLUGINS`.