// frontend/js/diagnosis.js
// Works with Google Sheets Option A (compiled rules JSON in Firebase Storage)

import { loadCompiledRules } from "./diagnosis-loader.js";

/* ----------------------------- Utilities ----------------------------- */

function getValueByPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split(".").reduce((acc, k) => (acc && k in acc ? acc[k] : undefined), obj);
}

function compare(op, a, b) {
  // Graceful handling of undefined/missing
  if (a === undefined || a === null) return false;

  switch (op) {
    case "==": return a === b;
    case "!=": return a !== b;
    case ">":  return typeof a === "number" && a > b;
    case "<":  return typeof a === "number" && a < b;
    case ">=": return typeof a === "number" && a >= b;
    case "<=": return typeof a === "number" && a <= b;
    case "in":
      if (Array.isArray(b)) return b.includes(a);
      // allow CSV in rule accidentally
      if (typeof b === "string") return b.split(",").map(x=>x.trim()).includes(String(a));
      return false;
    default:   return false;
  }
}

function toArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ----------------------- Rule loading (cached) ----------------------- */

let _rulesCache = null;

export async function loadDiagnosisRulesFromFirestore(force = false) {
  if (_rulesCache && !force) return _rulesCache;
  const ns = localStorage.getItem("NC_NAMESPACE") || "core";
  const rules = await loadCompiledRules(ns);
  // Optional local filtering: only active rules (publisher already does this)
  _rulesCache = rules.filter(r => r.active !== false);
  return _rulesCache;
}

/* ----------------------- Validators & Flags -------------------------- */

function runValidators(visit, rules) {
  const validators = rules.filter(r => r.type === "validator");
  const hits = [];
  const messages = [];

  for (const vr of validators) {
    const checks = toArray(vr.checks);
    if (!checks.length) continue;

    const failures = [];
    for (const c of checks) {
      const v = getValueByPath(visit, c.path);
      const n = numOrNull(v);
      // If value is missing, skip (don’t flag as error)
      if (v === undefined || v === null) continue;

      if (n === null) {
        failures.push({ path: c.path, reason: "non-numeric", value: v });
        continue;
      }
      if (c.min !== undefined && n < c.min) {
        failures.push({ path: c.path, reason: "below-min", min: c.min, value: n });
      }
      if (c.max !== undefined && n > c.max) {
        failures.push({ path: c.path, reason: "above-max", max: c.max, value: n });
      }
    }

    if (failures.length) {
      hits.push({
        id: vr.id,
        label: vr.label || "Validator",
        doctorReason: vr.doctorReason || "Validator triggered.",
        failures
      });
      messages.push(`${vr.label || vr.id}: ${vr.doctorReason || "One or more fields outside plausible range."}`);
    }
  }

  return { validatorHits: hits, validatorMessages: messages };
}

function runFlags(visit, rules) {
  const flags = rules.filter(r => r.type === "flag");
  const hits = [];

  for (const fr of flags) {
    const conds = toArray(fr.conditions);
    if (!conds.length) continue;

    let satisfied = 0;
    const missingFields = [];
    for (const c of conds) {
      const a = getValueByPath(visit, `${c.section}.${c.field}`);
      if (a === undefined || a === null) {
        missingFields.push({ section: c.section, field: c.field });
        continue;
      }
      if (compare(c.operator, a, c.value)) satisfied++;
    }
    // All conditions must be satisfied for a flag (strict)
    if (satisfied === conds.length && conds.length > 0) {
      hits.push({
        id: fr.id,
        label: fr.label || "Flag",
        severity: fr.severity || "info",
        doctorReason: fr.doctorReason || "",
        recommendedTests: toArray(fr.recommendedTests)
      });
    }
  }

  return { flagHits: hits };
}

/* --------------------------- Diagnosis core -------------------------- */

function evaluateDiagnosisRules(visit, rules) {
  const diagRules = rules.filter(r => r.type === "single" || r.type === "multi");

  const matches = [];
  const allMissing = [];

  for (const rule of diagRules) {
    const conds = toArray(rule.conditions);
    if (!conds.length) continue;

    let satisfied = 0;
    let score = Number(rule.baseScore || 0);
    const missing = [];

    for (const c of conds) {
      const a = getValueByPath(visit, `${c.section}.${c.field}`);
      if (a === undefined || a === null) {
        // record missing but don't fail the rule; it just won't satisfy this condition
        missing.push({ section: c.section, field: c.field });
        continue;
      }
      const ok = compare(c.operator, a, c.value);
      if (ok) {
        satisfied++;
        score += Number(c.weight || 0.2); // default contribution if weight not provided
      }
    }

    allMissing.push(...missing);

    const minSat = Math.max(1, Number(rule.minSatisfied || (rule.type === "single" ? 1 : Math.ceil(conds.length / 2))));
    if (satisfied >= minSat) {
      // Clamp score to [0, 1.0]
      const clamped = Math.max(0, Math.min(1, score));
      matches.push({
        id: rule.id,
        label: rule.label,
        type: rule.type,
        mutexGroup: rule.mutexGroup || null,
        score: clamped,
        priority: Number(rule.priority || 0),
        satisfied,
        minSatisfied: minSat,
        doctorReason: rule.doctorReason || "",
        patientExplanation: rule.patientExplanation || "",
        recommendedTests: toArray(rule.recommendedTests),
        suggestedMedicines: toArray(rule.suggestedMedicines),
        followUpAdvice: rule.followUpAdvice || "",
      });
    }
  }

  // Resolve mutex groups: keep best as "primary", others as "consider"
  const primary = [];
  const consider = [];

  const groups = new Map();
  for (const m of matches) {
    const key = m.mutexGroup || `__solo_${m.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }

  for (const [key, arr] of groups.entries()) {
    if (key.startsWith("__solo_")) {
      primary.push(...arr);
      continue;
    }
    // sort by score desc, then priority desc
    arr.sort((a, b) => (b.score - a.score) || (b.priority - a.priority));
    // winner
    if (arr.length) primary.push({ ...arr[0], decision: "primary" });
    // others get downgraded but kept as “consider”
    for (let i = 1; i < arr.length; i++) {
      consider.push({ ...arr[i], decision: "consider", score: Math.max(0, arr[i].score - 0.15) });
    }
  }

  // Sort primary diagnoses for display
  primary.sort((a, b) => (b.score - a.score) || (b.priority - a.priority));

  return { primary, consider, missingFields: mergeMissing(allMissing) };
}

function mergeMissing(missingList) {
  const seen = new Set();
  const out = [];
  for (const m of missingList) {
    const key = `${m.section}.${m.field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/* ---------------------------- Public API ----------------------------- */

/**
 * Generate diagnoses, flags, and validator messages from a visit.
 * @param {Object} visit - The full visit object with sections: info, vitals, symptoms, labs, history, imaging, advanced, etc.
 * @param {Object} [opts]
 *   - forceReload: boolean (bypass rules cache)
 *   - namespace: override namespace (otherwise uses localStorage NC_NAMESPACE or "core")
 * @returns {Promise<{
 *   diagnoses: {primary: Array, consider: Array},
 *   flags: Array,
 *   validators: Array,
 *   missingFields: Array
 * }>}
 */
export async function generateDiagnosis(visit, opts = {}) {
  // Load rules (compiled from Google Sheets → Storage)
  const rules = await loadDiagnosisRulesFromFirestore(Boolean(opts.forceReload));

  // Run validators first (plausibility / out-of-range)
  const { validatorHits, validatorMessages } = runValidators(visit, rules);

  // Run flags (alerts, emergency cues)
  const { flagHits } = runFlags(visit, rules);

  // Run diagnosis rules
  const { primary, consider, missingFields } = evaluateDiagnosisRules(visit, rules);

  return {
    diagnoses: { primary, consider },
    flags: flagHits,
    validators: validatorHits,
    missingFields
  };
}

/* ---------------------- Convenience for UI hooks --------------------- */

/**
 * Small helper to render missing fields as nice labels (optional).
 */
export function formatMissingFields(missingFields) {
  return missingFields.map(m => `${m.section}.${m.field}`);
}

/**
 * Merge suggested tests and medicines from selected diagnoses.
 * @param {Array} dxList - array of diagnoses (primary/consider)
 */
export function collectOrdersFromDiagnoses(dxList = []) {
  const tests = new Set();
  const meds = new Set();
  for (const d of dxList) {
    (d.recommendedTests || []).forEach(t => tests.add(String(t)));
    (d.suggestedMedicines || []).forEach(m => meds.add(String(m)));
  }
  return { tests: Array.from(tests), medicines: Array.from(meds) };
}
