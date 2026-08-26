// Discord module_data resolution fix — prepended to dist/desktop/preload.js at build time
(function () {
    const Module = require("module");
    const path = require("path");
    const fs = require("fs");

    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming");
    const moduleDataPath = path.join(appData, "discord", "module_data");

    const _seenPaths = new Set(Module.globalPaths);
    function addGlobalPath(p) {
        if (_seenPaths.has(p)) return;
        _seenPaths.add(p);
        Module.globalPaths.push(p);
    }
    addGlobalPath(moduleDataPath);
    try {
        for (const modName of fs.readdirSync(moduleDataPath)) {
            const modDir = path.join(moduleDataPath, modName);
            try {
                if (!fs.statSync(modDir).isDirectory()) continue;
                for (const ver of fs.readdirSync(modDir)) {
                    const verDir = path.join(modDir, ver);
                    if (fs.statSync(verDir).isDirectory()) addGlobalPath(verDir);
                }
            } catch (_) { }
        }
    } catch (_) { }

    const _gpArr = Module.globalPaths.slice();
    const _gpSet = new Set(_gpArr);
    const _orig = Module._resolveLookupPaths;
    Module._resolveLookupPaths = function (request, parent) {
        if (parent) {
            if (!parent.paths || parent.paths.length === 0) {
                parent.paths = _gpArr.slice();
            } else {
                const ex = new Set(parent.paths);
                for (const p of _gpSet) { if (!ex.has(p)) parent.paths.push(p); }
            }
        }
        return _orig.call(this, request, parent);
    };
})();
