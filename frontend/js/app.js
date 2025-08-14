// frontend/js/app.js
// NephroCare Pro – main app glue
// - Auth header (email/role)
// - Build visit from form + run diagnosis engine
// - Save/Load visits to Firestore
// - PDF export (html2pdf.js)
// - Namespace toggle for rules (Sheets → compiled JSON in Storage)

import { app, db, auth } from "./firebase.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  collection, addDoc, getDoc, getDocs, doc, setDoc, serverTimestamp, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

import {
  generateDiagnosis,
  formatMissingFields,
  collectOrdersFromDiagnoses,
  loadDiagnosisRulesFromFirestore
} from "./diagnosis.js";

/* ------------------------------------------------------------------ */
/*                         CONFIGURE YOUR IDS                          */
/* ------------------------------------------------------------------ */
/** If your form element IDs differ, adjust here (mapping -> DOM id). */
const IDS = {
  // Header / status badges
  email: "hdr-email",
  role: "hdr-role",
  nsSelect: "hdr-namespace",

  // Buttons
  btnGenerate: "btn-generate",
  btnSave: "btn-save-visit",
  btnNew: "btn-new-visit",
  btnLoadLast: "btn-load-last",
  btnPDF: "btn-export-pdf",
  btnReloadRules: "btn-reload-rules",

  // Output areas
  doctorDx: "doctor-diagnosis",
  patientDx: "patient-diagnosis",
  alerts: "alerts",
  missing: "missing-fields",
  medsOut: "medicine-output",
  testsOut: "test-output",
  toast: "toast-area",

  // Printable wrapper for PDF
  printArea: "print-area",

  // Visit meta
  visitId: "visit-id",
  patientId: "patient-id",
  patientName: "info_name",
  patientAge: "info_age",
  patientSex: "info_sex",

  // Vital inputs
  bpSys: "vitals_bp_sys",
  bpDia: "vitals_bp_dia",
  hr: "vitals_hr",
  spo2: "vitals_spo2",

  // Symptoms
  dysuria: "symptoms_dysuria",
  fever: "symptoms_fever",
  flankPain: "symptoms_flank_pain",
  oliguria: "symptoms_oliguria",
  edema: "symptoms_edema",
  hematuria: "symptoms_hematuria", // select: No/Microscopic/Macroscopic

  // Labs
  egfr: "labs_egfr",
  k: "labs_k",
  na: "labs_na",
  creatinine: "labs_creatinine",
  hb: "labs_hb",
  bicarb: "labs_bicarb",
  acr: "labs_acr",
  ca: "labs_ca",
  ferritin: "labs_ferritin",
  ck: "labs_ck",

  // History
  dm: "history_dm",
  htn: "history_htn",
  nephrotoxins: "history_nephrotoxins", // Yes/No or CSV
  trauma: "history_trauma",
  contrast: "history_contrast",

  // Imaging
  obstruction: "imaging_obstruction", // Yes/No
  echo: "imaging_echogenicity",       // Increased/Normal
  kidneySize: "imaging_size",         // cm number

  // Advanced
  ana: "advanced_ana",                // Positive/Negative
  ecg: "advanced_ecg"                 // Normal/Abnormal
};

/* ------------------------------------------------------------------ */
/*                              HELPERS                                */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const textVal = (id) => (($(id)?.value ?? "").trim());
const numVal = (id) => {
  const s = textVal(id);
  const n = Number(s);
  return Number.isFinite(n) ? n : (s === "" ? null : s);
};
const boolVal = (id) => {
  const el = $(id);
  if (!el) return null;
  if (el.type === "checkbox") return !!el.checked;
  const v = (el.value || "").trim().toLowerCase();
  if (["yes", "true", "y"].includes(v)) return true;
  if (["no", "false", "n"].includes(v)) return false;
  return el.checked ?? null;
};

function toast(msg, type = "info") {
  const el = $(IDS.toast);
  if (!el) return;
  el.textContent = msg;
  el.className = "";
  el.classList.add(
    "mt-2", "px-3", "py-2", "rounded",
    type === "error" ? "bg-red-100" : type === "success" ? "bg-green-100" : "bg-gray-100",
    "text-sm"
  );
  setTimeout(() => { el.textContent = ""; el.className = ""; }, 4000);
}

/** Serialize the whole visit from form inputs into a structured object. */
function buildVisitFromForm() {
  const info = {
    patientId: textVal(IDS.patientId) || undefined,
    name: textVal(IDS.patientName) || undefined,
    age: numVal(IDS.patientAge),
    sex: textVal(IDS.patientSex) || undefined,
  };

  const vitals = {
    bp_sys: numVal(IDS.bpSys),
    bp_dia: numVal(IDS.bpDia),
    hr: numVal(IDS.hr),
    spo2: numVal(IDS.spo2),
  };

  const symptoms = {
    dysuria: boolVal(IDS.dysuria) ? "Yes" : "No",
    fever: boolVal(IDS.fever) ? "Yes" : "No",
    flank_pain: boolVal(IDS.flankPain) ? "Yes" : "No",
    oliguria: boolVal(IDS.oliguria) ? "Yes" : "No",
    edema: boolVal(IDS.edema) ? "Yes" : "No",
    hematuria: textVal(IDS.hematuria) || "No",
  };

  const labs = {
    egfr: numVal(IDS.egfr),
    k: numVal(IDS.k),
    na: numVal(IDS.na),
    creatinine: numVal(IDS.creatinine),
    hb: numVal(IDS.hb),
    bicarb: numVal(IDS.bicarb),
    acr: numVal(IDS.acr),
    ca: numVal(IDS.ca),
    ferritin: numVal(IDS.ferritin),
    ck: numVal(IDS.ck),
  };

  const history = {
    dm: boolVal(IDS.dm) ? "Yes" : "No",
    htn: boolVal(IDS.htn) ? "Yes" : "No",
    nephrotoxins: textVal(IDS.nephrotoxins) || "No", // allow "NSAID" etc.
    trauma: boolVal(IDS.trauma) ? "Yes" : "No",
    contrast: boolVal(IDS.contrast) ? "Yes" : "No",
  };

  const imaging = {
    obstruction: textVal(IDS.obstruction) || "No", // "Yes"/"No"
    echogenicity: textVal(IDS.echo) || "",         // "Increased"/"Normal"
    size: numVal(IDS.kidneySize),                  // cm
  };

  const advanced = {
    ana: textVal(IDS.ana) || "",                   // "Positive"/"Negative"
    ecg: textVal(IDS.ecg) || "",                   // "Normal"/"Abnormal"
  };

  return { info, vitals, symptoms, labs, history, imaging, advanced };
}

/** Fill form from a visit object (for loading saved visits). */
function populateFormFromVisit(v) {
  if (!v) return;
  const set = (id, val) => { if ($(id)) $(id).value = val ?? ""; };
  const setBool = (id, val) => { if ($(id) && $(id).type === "checkbox") $(id).checked = !!val; };

  set(IDS.patientId, v.info?.patientId);
  set(IDS.patientName, v.info?.name);
  set(IDS.patientAge, v.info?.age);
  set(IDS.patientSex, v.info?.sex);

  set(IDS.bpSys, v.vitals?.bp_sys);
  set(IDS.bpDia, v.vitals?.bp_dia);
  set(IDS.hr, v.vitals?.hr);
  set(IDS.spo2, v.vitals?.spo2);

  setBool(IDS.dysuria, (v.symptoms?.dysuria || "").toLowerCase()==="yes");
  setBool(IDS.fever, (v.symptoms?.fever || "").toLowerCase()==="yes");
  setBool(IDS.flankPain, (v.symptoms?.flank_pain || "").toLowerCase()==="yes");
  setBool(IDS.oliguria, (v.symptoms?.oliguria || "").toLowerCase()==="yes");
  setBool(IDS.edema, (v.symptoms?.edema || "").toLowerCase()==="yes");
  set(IDS.hematuria, v.symptoms?.hematuria || "No");

  set(IDS.egfr, v.labs?.egfr);
  set(IDS.k, v.labs?.k);
  set(IDS.na, v.labs?.na);
  set(IDS.creatinine, v.labs?.creatinine);
  set(IDS.hb, v.labs?.hb);
  set(IDS.bicarb, v.labs?.bicarb);
  set(IDS.acr, v.labs?.acr);
  set(IDS.ca, v.labs?.ca);
  set(IDS.ferritin, v.labs?.ferritin);
  set(IDS.ck, v.labs?.ck);

  set(IDS.dm, (v.history?.dm || "").toLowerCase()==="yes" ? "Yes" : "No");
  set(IDS.htn, (v.history?.htn || "").toLowerCase()==="yes" ? "Yes" : "No");
  set(IDS.nephrotoxins, v.history?.nephrotoxins || "No");
  set(IDS.trauma, (v.history?.trauma || "").toLowerCase()==="yes" ? "Yes" : "No");
  set(IDS.contrast, (v.history?.contrast || "").toLowerCase()==="yes" ? "Yes" : "No");

  set(IDS.obstruction, v.imaging?.obstruction || "No");
  set(IDS.echo, v.imaging?.echogenicity || "");
  set(IDS.kidneySize, v.imaging?.size);

  set(IDS.ana, v.advanced?.ana || "");
  set(IDS.ecg, v.advanced?.ecg || "");
}

/* ------------------------------------------------------------------ */
/*                           AUTH & HEADER                            */
/* ------------------------------------------------------------------ */

async function fetchUserRole(uid) {
  // roles are stored in users/{uid}.role
  const uref = doc(db, "users", uid);
  const snap = await getDoc(uref);
  return snap.exists() ? (snap.data().role || null) : null;
}

onAuthStateChanged(getAuth(app), async (user) => {
  if (!user) {
    if ($(IDS.email)) $(IDS.email).textContent = "Not signed in";
    if ($(IDS.role)) $(IDS.role).textContent = "-";
    return;
  }
  if ($(IDS.email)) $(IDS.email).textContent = user.email || "(no email)";
  const role = await fetchUserRole(user.uid);
  if ($(IDS.role)) $(IDS.role).textContent = role || "no-role";

  // Init namespace selector (if present)
  if ($(IDS.nsSelect)) {
    const ns = localStorage.getItem("NC_NAMESPACE") || "core";
    $(IDS.nsSelect).value = ns;
  }
});

/* ------------------------------------------------------------------ */
/*                        DIAGNOSIS GENERATION                         */
/* ------------------------------------------------------------------ */

async function handleGenerate() {
  try {
    const visit = buildVisitFromForm();
    const { diagnoses, flags, validators, missingFields } = await generateDiagnosis(visit);

    // Doctor view
    const docText = diagnoses.primary
      .map(d => `• ${d.label} — ${(d.score * 100).toFixed(0)}%\n  ${d.doctorReason}`)
      .join("\n\n");
    $(IDS.doctorDx).textContent = docText || "No primary diagnosis yet. Please add more data.";

    // Patient view
    const patText = diagnoses.primary
      .map(d => `• ${d.label}: ${d.patientExplanation}`)
      .join("\n");
    $(IDS.patientDx).textContent = patText || "We need a few more tests or information to be sure.";

    // Alerts/flags + validators
    const flagsTxt = (flags || []).map(f => `${(f.severity || "info").toUpperCase()}: ${f.label}`).join(" | ");
    const valTxt = (validators || []).map(v => `VALIDATOR: ${v.label}`).join(" | ");
    $(IDS.alerts).textContent = flagsTxt || valTxt || "";

    // Missing fields prompt
    $(IDS.missing).textContent = formatMissingFields(missingFields).join(", ");

    // Suggest tests/meds
    const { tests, medicines } = collectOrdersFromDiagnoses([...diagnoses.primary, ...diagnoses.consider]);
    $(IDS.testsOut).textContent = tests.join(", ");
    $(IDS.medsOut).textContent = medicines.join(", ");

    toast("Diagnosis generated", "success");
  } catch (e) {
    console.error(e);
    toast("Failed to generate diagnosis: " + e.message, "error");
  }
}

/* ------------------------------------------------------------------ */
/*                            FIRESTORE I/O                            */
/* ------------------------------------------------------------------ */

async function handleSaveVisit() {
  try {
    const user = getAuth(app).currentUser;
    if (!user) throw new Error("Please sign in.");

    const visit = buildVisitFromForm();

    // snapshot current text outputs for audit
    const summary = {
      doctorDiagnosis: $(IDS.doctorDx)?.textContent || "",
      patientDiagnosis: $(IDS.patientDx)?.textContent || "",
      alerts: $(IDS.alerts)?.textContent || "",
      missing: $(IDS.missing)?.textContent || "",
      tests: $(IDS.testsOut)?.textContent || "",
      medicines: $(IDS.medsOut)?.textContent || "",
    };

    const payload = {
      visit,
      summary,
      doctorUid: user.uid,
      createdAt: serverTimestamp(),
      namespace: localStorage.getItem("NC_NAMESPACE") || "core"
    };

    const docRef = await addDoc(collection(db, "visits"), payload);
    if ($(IDS.visitId)) $(IDS.visitId).value = docRef.id;

    toast("Visit saved", "success");
  } catch (e) {
    console.error(e);
    toast("Save failed: " + e.message, "error");
  }
}

async function handleLoadLastVisit() {
  try {
    const user = getAuth(app).currentUser;
    if (!user) throw new Error("Sign in to load visits.");

    const q1 = query(
      collection(db, "visits"),
      where("doctorUid", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(1)
    );
    const snap = await getDocs(q1);
    if (snap.empty) {
      toast("No previous visits found.", "info");
      return;
    }
    const d = snap.docs[0].data();
    populateFormFromVisit(d.visit);
    if ($(IDS.visitId)) $(IDS.visitId).value = snap.docs[0].id;

    // Refresh diagnosis with loaded values
    await handleGenerate();
    toast("Loaded last visit", "success");
  } catch (e) {
    console.error(e);
    toast("Load failed: " + e.message, "error");
  }
}

function handleNewVisit() {
  // Clear the form quickly (only known fields)
  const allIds = Object.values(IDS);
  for (const id of allIds) {
    const el = $(id);
    if (!el) continue;
    if (["btn-generate","btn-save-visit","btn-new-visit","btn-load-last","btn-export-pdf","btn-reload-rules","hdr-email","hdr-role","hdr-namespace","toast-area","print-area","alerts","doctor-diagnosis","patient-diagnosis","missing-fields","medicine-output","test-output"].includes(id)) {
      continue;
    }
    if (el.type === "checkbox") el.checked = false;
    else el.value = "";
  }
  $(IDS.doctorDx).textContent = "";
  $(IDS.patientDx).textContent = "";
  $(IDS.alerts).textContent = "";
  $(IDS.missing).textContent = "";
  $(IDS.testsOut).textContent = "";
  $(IDS.medsOut).textContent = "";
  toast("New visit started");
}

/* ------------------------------------------------------------------ */
/*                              PDF EXPORT                             */
/* ------------------------------------------------------------------ */

async function handleExportPDF() {
  try {
    // html2pdf must be loaded in your HTML (CDN script)
    if (!window.html2pdf) {
      toast("html2pdf not loaded", "error");
      return;
    }
    const el = $(IDS.printArea) || document.body;
    const patientName = textVal(IDS.patientName) || "Prescription";
    const opt = {
      margin:       10,
      filename:     `${patientName.replace(/\s+/g,"_")}_NephroCare.pdf`,
      image:        { type: "jpeg", quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: "mm", format: "a4", orientation: "portrait" }
    };
    await window.html2pdf().set(opt).from(el).save();
    toast("PDF exported", "success");
  } catch (e) {
    console.error(e);
    toast("PDF export failed: " + e.message, "error");
  }
}

/* ------------------------------------------------------------------ */
/*                        RULES: NAMESPACE SWITCH                      */
/* ------------------------------------------------------------------ */

function initNamespaceSelector() {
  const sel = $(IDS.nsSelect);
  if (!sel) return;
  // load from localStorage
  const saved = localStorage.getItem("NC_NAMESPACE") || "core";
  sel.value = saved;
  sel.addEventListener("change", async () => {
    localStorage.setItem("NC_NAMESPACE", sel.value);
    await loadDiagnosisRulesFromFirestore(true);
    toast(`Rules namespace switched to "${sel.value}".`);
  });
}

async function handleReloadRules() {
  await loadDiagnosisRulesFromFirestore(true);
  toast("Rules reloaded from Storage", "success");
}

/* ------------------------------------------------------------------ */
/*                           EVENT WIRING                              */
/* ------------------------------------------------------------------ */

function wireEvents() {
  $(IDS.btnGenerate)?.addEventListener("click", handleGenerate);
  $(IDS.btnSave)?.addEventListener("click", handleSaveVisit);
  $(IDS.btnLoadLast)?.addEventListener("click", handleLoadLastVisit);
  $(IDS.btnNew)?.addEventListener("click", handleNewVisit);
  $(IDS.btnPDF)?.addEventListener("click", handleExportPDF);
  $(IDS.btnReloadRules)?.addEventListener("click", handleReloadRules);

  initNamespaceSelector();
}

/* ------------------------------------------------------------------ */
/*                              BOOT                                   */
/* ------------------------------------------------------------------ */

document.addEventListener("DOMContentLoaded", async () => {
  wireEvents();
  // Warm rules cache (optional)
  try {
    await loadDiagnosisRulesFromFirestore(false);
  } catch (e) {
    console.warn("Rules prefetch failed:", e.message);
  }
});
