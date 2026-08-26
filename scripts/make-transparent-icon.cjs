const { readFileSync, writeFileSync, copyFileSync, existsSync } = require("fs");
const { join } = require("path");

/** Build a .ico that embeds PNG payloads (Vista+). */
function pngsToIco(pngBuffers) {
    const count = pngBuffers.length;
    const headerSize = 6 + count * 16;
    let offset = headerSize;
    const entries = [];

    for (const png of pngBuffers) {
        // IHDR width/height
        const w = png[16] === 0 && png[17] === 0 && png[18] === 0 ? 256 : png[18] || png[19];
        const h = png[20] === 0 && png[21] === 0 && png[22] === 0 ? 256 : png[22] || png[23];
        // Better: read 4-byte big-endian at 16 and 20
        const width = png.readUInt32BE(16);
        const height = png.readUInt32BE(20);
        entries.push({
            width: width >= 256 ? 0 : width,
            height: height >= 256 ? 0 : height,
            size: png.length,
            offset,
            png
        });
        offset += png.length;
    }

    const buf = Buffer.alloc(offset);
    buf.writeUInt16LE(0, 0); // reserved
    buf.writeUInt16LE(1, 2); // type icon
    buf.writeUInt16LE(count, 4);

    let entryOffset = 6;
    for (const e of entries) {
        buf[entryOffset] = e.width;
        buf[entryOffset + 1] = e.height;
        buf[entryOffset + 2] = 0; // color palette
        buf[entryOffset + 3] = 0;
        buf.writeUInt16LE(1, entryOffset + 4); // planes
        buf.writeUInt16LE(32, entryOffset + 6); // bitcount
        buf.writeUInt32LE(e.size, entryOffset + 8);
        buf.writeUInt32LE(e.offset, entryOffset + 12);
        entryOffset += 16;
    }

    for (const e of entries) {
        e.png.copy(buf, e.offset);
    }
    return buf;
}

const root = join(__dirname, "..");
const sizes = [16, 32, 48, 64, 128, 256];
const pngs = sizes.map(s => {
    const p = join(root, "static", `icon-${s}.png`);
    if (!existsSync(p)) throw new Error("missing " + p);
    return readFileSync(p);
});

const ico = pngsToIco(pngs);
writeFileSync(join(root, "static", "icon.ico"), ico);
writeFileSync(join(root, "zcord.ico"), ico);
writeFileSync(join(root, "release", "zcord-dist", "app.ico"), ico);
copyFileSync(join(root, "static", "icon-transparent.png"), join(root, "static", "icon.png"));
copyFileSync(join(root, "static", "icon.png"), join(root, "release", "zcord-dist", "app.png"));
console.log("ico ok", ico.length);
