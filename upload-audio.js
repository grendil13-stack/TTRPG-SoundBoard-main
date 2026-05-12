/**
 * Uploads audio from ./Sounds to Supabase Storage (music, ambient, sfx buckets).
 * Usage: node upload-audio.js
 * Requires SUPABASE_URL and SUPABASE_ANON_KEY in .env at project root.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AUDIO_EXT = new Set([".ogg", ".mp3", ".wav"]);
const VALID_BUCKETS = new Set(["music", "ambient", "sfx"]);

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    throw new Error(`Missing .env file at ${envPath}`);
  }
  const out = {};
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function contentTypeForExt(ext) {
  switch (ext.toLowerCase()) {
    case ".ogg":
      return "audio/ogg";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
}

/** @param {unknown} err */
function isAlreadyExistsError(err) {
  if (!err || typeof err !== "object") {
    return false;
  }
  const o = /** @type {Record<string, unknown>} */ (err);
  const msg = String(o.message ?? o.error ?? "").toLowerCase();
  const status = String(o.statusCode ?? o.status ?? "");
  if (status === "409") {
    return true;
  }
  if (msg.includes("already exists") || msg.includes("duplicate")) {
    return true;
  }
  return false;
}

/**
 * Public-bucket HEAD check (avoids re-uploading large files when object is already there).
 */
async function publicObjectExists(supabaseUrl, bucket, objectPath) {
  const base = supabaseUrl.replace(/\/+$/, "");
  const pathEncoded = objectPath
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const url = `${base}/storage/v1/object/public/${bucket}/${pathEncoded}`;
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

function collectAudioFiles(soundsDir) {
  /** @type {string[]} */
  const files = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (AUDIO_EXT.has(ext)) {
          files.push(full);
        }
      }
    }
  }
  walk(soundsDir);
  return files.sort();
}

function parseBucketAndObjectPath(soundsDir, absoluteFilePath) {
  const rel = path.relative(soundsDir, absoluteFilePath);
  const relPosix = rel.split(path.sep).join("/");
  const parts = relPosix.split("/").filter(Boolean);
  if (parts.length < 2) {
    return {
      ok: false,
      reason: `expected Sounds/<bucket>/…, got "${relPosix}"`,
    };
  }
  const bucketRaw = parts[0];
  const bucket = bucketRaw.toLowerCase();
  if (!VALID_BUCKETS.has(bucket)) {
    return {
      ok: false,
      reason: `unknown bucket folder "${bucketRaw}" (expected music, ambient, or sfx)`,
    };
  }
  const objectPath = parts.slice(1).join("/");
  if (!objectPath) {
    return { ok: false, reason: "empty object path" };
  }
  return { ok: true, bucket, objectPath };
}

async function main() {
  const envPath = path.join(__dirname, ".env");
  const env = loadEnvFile(envPath);
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const supabaseAnonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      ".env must define SUPABASE_URL and SUPABASE_ANON_KEY (see vite.config.js).",
    );
  }

  const soundsDir = path.join(__dirname, "Sounds");
  if (!fs.existsSync(soundsDir) || !fs.statSync(soundsDir).isDirectory()) {
    throw new Error(`Sounds folder not found at ${soundsDir}`);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const files = collectAudioFiles(soundsDir);

  let totalUploaded = 0;
  let totalSkipped = 0;
  /** @type {{ file: string; bucket: string; objectPath: string; error: string }[]} */
  const failures = [];
  let skippedUnrecognized = 0;

  console.log(`Found ${files.length} audio file(s) under Sounds/. Starting upload…\n`);

  for (const filePath of files) {
    const filename = path.basename(filePath);
    const parsed = parseBucketAndObjectPath(soundsDir, filePath);
    if (!parsed.ok) {
      skippedUnrecognized += 1;
      console.log(
        `[skip] ${filename} — ${parsed.reason}`,
      );
      continue;
    }
    const { bucket, objectPath } = parsed;

    try {
      const exists = await publicObjectExists(supabaseUrl, bucket, objectPath);
      if (exists) {
        totalSkipped += 1;
        console.log(`[skip] ${filename} → ${bucket}/${objectPath} (already in bucket)`);
        continue;
      }

      const body = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = contentTypeForExt(ext);

      const { error } = await supabase.storage.from(bucket).upload(objectPath, body, {
        contentType,
        upsert: false,
      });

      if (error) {
        if (isAlreadyExistsError(error)) {
          totalSkipped += 1;
          console.log(`[skip] ${filename} → ${bucket}/${objectPath} (already exists)`);
        } else {
          const msg = error.message || String(error);
          failures.push({ file: filePath, bucket, objectPath, error: msg });
          console.log(`[fail] ${filename} → ${bucket}/${objectPath} — ${msg}`);
        }
      } else {
        totalUploaded += 1;
        console.log(`[ok]   ${filename} → ${bucket}/${objectPath}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ file: filePath, bucket, objectPath, error: msg });
      console.log(`[fail] ${filename} → ${bucket}/${objectPath} — ${msg}`);
    }
  }

  const totalFound = files.length;
  console.log("\n--- Summary ---");
  console.log(`Total audio files found:     ${totalFound}`);
  console.log(`Total uploaded:              ${totalUploaded}`);
  console.log(`Total skipped (in bucket):   ${totalSkipped}`);
  if (skippedUnrecognized) {
    console.log(`Skipped (bad path layout):   ${skippedUnrecognized}`);
  }
  console.log(`Failures:                    ${failures.length}`);
  if (failures.length) {
    console.log("\nFailed uploads:");
    for (const f of failures) {
      console.log(`  • ${f.file}`);
      console.log(`    ${f.bucket}/${f.objectPath}: ${f.error}`);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
