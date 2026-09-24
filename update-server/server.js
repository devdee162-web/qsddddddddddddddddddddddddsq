/**
 * API locale headless — client C uniquement (sans interface)
 * Pour le panel bureau : npm start ou pnpm run update-panel
 */
const core = require("./lib/core");
const { createApiApp } = require("./lib/createApiApp");

const PORT = process.env.ZCORD_UPDATE_PORT || 8743;

core.init();
const app = createApiApp();

app.listen(PORT, "127.0.0.1", () => {
    console.log("");
    console.log("========================================");
    console.log(`  Zcord Update API → http://127.0.0.1:${PORT}`);
    console.log(`  Check → http://127.0.0.1:${PORT}/api/check?version=1.0.0`);
    console.log("  (Panel bureau : npm start)");
    console.log("========================================");
});
