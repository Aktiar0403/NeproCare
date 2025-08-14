import functions from "firebase-functions";
import admin from "firebase-admin";
import { google } from "googleapis";
import { Storage } from "@google-cloud/storage";

admin.initializeApp();
const storage = new Storage();

// ========= EDIT THESE =========
const SPREADSHEET_ID = "PUT_YOUR_SHEET_ID_HERE"; // from the Sheet URL
const NAMESPACES = ["core"];                      // add more tabs later
const BUCKET_PATH_PREFIX = "rules";               // Storage folder
// Secure your HTTP endpoint with a token you set once:
const PUBLISH_TOKEN = functions.config().rules?.token || ""; // set with: firebase functions:config:set rules.token="XYZ"
// ==============================

function csvToArray(str) {
  return (str || "").split(",").map(s => s.trim()).filter(Boolean);
}
function parseMaybeJSON(s) {
  if (!s || !String(s).trim()) return null;
  return JSON.parse(s);
}
function toNumberOrRaw(v) {
  if (v === "" || v == null) return v;
  const n = Number(v);
  return isNaN(n) ? v : n;
}

function normalizeRule(row) {
  const r = {
    id: String(row.id || "").trim(),
    label: String(row.label || "").trim(),
    type: String(row.type || "multi").trim(),
    mutexGroup: String(row.mutexGroup || "").trim() || undefined,
    priority: toNumberOrRaw(row.priority) ?? 0,
    baseScore: toNumberOrRaw(row.baseScore) ?? 0,
    minSatisfied: toNumberOrRaw(row.minSatisfied) ?? 1,
    active: String(row.active || "TRUE").toLowerCase() !== "false",
    namespace: String(row.namespace || "core").trim(),
    tags: csvToArray(row.tags),
    doctorReason: row.doctorReason || "",
    patientExplanation: row.patientExplanation || "",
    recommendedTests: csvToArray(row.recommendedTests),
    suggestedMedicines: csvToArray(row.suggestedMedicines),
    followUpAdvice: row.followUpAdvice || ""
  };

  const conds = parseMaybeJSON(row.conditionsJSON);
  const checks = parseMaybeJSON(row.checksJSON);

  if (r.type === "validator") {
    if (!checks || !checks.length) throw new Error(`validator ${r.id}: checksJSON required`);
    r.checks = checks;
  } else if (r.type === "flag" || r.type === "single" || r.type === "multi") {
    if (!conds || !conds.length) throw new Error(`${r.type} ${r.id}: conditionsJSON required`);
    r.conditions = conds;
  } else {
    throw new Error(`Unknown type for ${r.id}`);
  }

  if (!r.id) throw new Error("Missing id");
  if (!r.label) throw new Error(`Rule ${r.id} missing label`);
  return r;
}

async function readSheetTab(auth, spreadsheetId, tab) {
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A1:Z9999`
  });
  const values = res.data.values || [];
  if (values.length < 2) return [];
  const headers = values[0].map(h => (h || "").trim());
  const rows = values.slice(1).map(arr => {
    const o = {};
    headers.forEach((h, i) => o[h] = arr[i]);
    return o;
  });
  return rows;
}

function compileRules(rows, ns) {
  const list = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || !row.id) continue;
    const r = normalizeRule(row);
    // keep namespace from row; tab name is also ns
    if (seen.has(r.id)) throw new Error(`Duplicate id: ${r.id}`);
    seen.add(r.id);
    list.push(r);
  }
  list.sort((a,b)=> (b.priority||0) - (a.priority||0) || (a.label||"").localeCompare(b.label||""));
  return list;
}

async function writeToStorage(namespace, jsonObj) {
  const bucketName = admin.app().options.storageBucket;
  if (!bucketName) throw new Error("No default storage bucket configured");
  const bucket = storage.bucket(bucketName);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const currentPath = `${BUCKET_PATH_PREFIX}/${namespace}.json`;
  const versionedPath = `${BUCKET_PATH_PREFIX}/${namespace}_${timestamp}.json`;
  const buf = Buffer.from(JSON.stringify(jsonObj, null, 2));

  await bucket.file(currentPath).save(buf, {
    contentType: "application/json",
    cacheControl: "public, max-age=300, s-maxage=600"
  });
  await bucket.file(versionedPath).save(buf, { contentType: "application/json" });

  return { bucket: bucketName, currentPath, versionedPath };
}

// Secure HTTP trigger
export const publishRules = functions.https.onRequest(async (req, res) => {
  try {
    if (!PUBLISH_TOKEN || req.query.token !== PUBLISH_TOKEN) {
      return res.status(401).json({ ok:false, error:"unauthorized" });
    }
    const auth = await google.auth.getClient({
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    });

    const out = {};
    for (const ns of NAMESPACES) {
      const rows = await readSheetTab(auth, SPREADSHEET_ID, ns);
      const compiled = compileRules(rows, ns);
      const info = await writeToStorage(ns, {
        namespace: ns,
        generatedAt: new Date().toISOString(),
        rules: compiled
      });
      out[ns] = info;
    }
    res.status(200).json({ ok:true, result: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

// Optional: scheduled refresh every 12 hours
export const publishRulesSchedule = functions.pubsub
  .schedule("every 12 hours")
  .timeZone("Asia/Kolkata")
  .onRun(async () => {
    const auth = await google.auth.getClient({
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    });
    for (const ns of NAMESPACES) {
      const rows = await readSheetTab(auth, SPREADSHEET_ID, ns);
      const compiled = compileRules(rows, ns);
      await writeToStorage(ns, {
        namespace: ns,
        generatedAt: new Date().toISOString(),
        rules: compiled
      });
    }
  });
