/* Build step (run by Vercel): writes config.js from environment variables so
   the public Supabase config reaches the static client without a bundler.
   Run locally too:  SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/build-config.mjs */

import { writeFile } from "node:fs/promises";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

const banner = "/* AUTO-GENERATED at build time by scripts/build-config.mjs — do not edit. */\n";
const body = `window.__CALDERA_CONFIG__ = ${JSON.stringify({ supabaseUrl, supabaseAnonKey }, null, 2)};\n`;

await writeFile(new URL("../config.js", import.meta.url), banner + body);

console.log(
  supabaseUrl && supabaseAnonKey
    ? `config.js written — Supabase configured (${supabaseUrl})`
    : "config.js written — no Supabase env set; leaderboard runs offline"
);
