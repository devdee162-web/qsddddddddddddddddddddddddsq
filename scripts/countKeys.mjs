import { readFileSync } from "fs";

const content = readFileSync("src/zcordplugins/autoTranslateZcord/index.ts", "utf8");
const matches = content.match(/"en":/g) || [];
console.log(`Total valid translated keys in autoTranslateZcord: ${matches.length}`);
