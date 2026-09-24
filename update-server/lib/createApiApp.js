/**
 * API HTTP locale — uniquement pour le client C (zcord-updater.exe)
 */
const express = require("express");
const multer = require("multer");
const { join } = require("path");
const core = require("./core");

const UPLOADS = core.UPLOADS;
const upload = multer({ dest: UPLOADS });

function createApiApp() {
    const app = express();
    app.use(express.json({ limit: "2mb" }));

    app.get("/api/stats", (_req, res) => {
        try { res.json(core.getStats()); } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get("/api/updates", (_req, res) => res.json(core.getUpdates()));

    app.post("/api/updates", (req, res) => {
        try { res.json(core.createUpdate(req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
    });

    app.post("/api/updates/:id/upload", upload.single("file"), (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: "fichier manquant" });
            res.json(core.uploadReleaseFile(req.params.id, req.file.path));
        } catch (e) { res.status(400).json({ error: e.message }); }
    });

    app.post("/api/updates/:id/publish", async (req, res) => {
        try { res.json(await core.publishUpdate(req.params.id)); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post("/api/updates/:id/unpublish", (req, res) => {
        try { res.json(core.unpublishUpdate(req.params.id)); } catch (e) { res.status(404).json({ error: e.message }); }
    });

    app.get("/api/check", (req, res) => res.json(core.checkUpdate(req.query.version)));

    app.get("/api/update.json", (_req, res) => {
        const p = join(core.RELEASE_DIR, "update.json");
        const { existsSync, readFileSync } = require("fs");
        if (!existsSync(p)) return res.status(404).json({ error: "update.json absent" });
        res.type("json").send(readFileSync(p, "utf8"));
    });

    app.post("/api/report", (req, res) => res.json(core.reportClient(req.body)));
    app.get("/api/history", (_req, res) => res.json(core.getHistory()));
    app.get("/api/logs", (_req, res) => res.json(core.getLogs()));
    app.get("/api/reports", (_req, res) => res.json(core.getReports()));
    app.get("/api/settings", (_req, res) => res.json(core.getSettings()));
    app.put("/api/settings", (req, res) => res.json(core.saveSettings(req.body)));

    return app;
}

module.exports = { createApiApp };
