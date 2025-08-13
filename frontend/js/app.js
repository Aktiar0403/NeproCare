// frontend/js/app.js
import { auth } from "./firebase.js";
import { saveVisit } from "./db.js";
import { loadDiagnosisRulesFromFirestore, getMatchedDiagnoses, getMissingFields } from "./diagnosis.js";
import { getMedicinesForDiagnosis, setupAutocomplete } from "./medicines.js";
import { exportToPDF } from "./html2pdf.js";
// ML can stay as-is; we won’t block saves on ML
import { suggestWithModel, ensureModel } from "./ml.js";

let visitData = { patient:{}, vitals:{}, symptoms:{}, labs:{}, history:{}, imaging:{}, advanced:{} };

window.addEventListener("DOMContentLoaded", async () => {
  // Ensure rules are loaded (Day 5 will make them dynamic from Firestore collection "rules")
  try { await loadDiagnosisRulesFromFirestore(); } catch(e) { console.warn("Rules load warning:", e); }

  const byId = id => document.getElementById(id);
  const set = (path, val) => {
    const parts = path.split('.');
    let obj = visitData;
    for (let i=0;i<parts.length-1;i++) obj = obj[parts[i]];
    obj[parts.at(-1)] = val;
  };

  // --- Bind inputs to visitData (add more as needed) ---
  const binds = [
    ["patient.name","patient_name"],["patient.age","patient_age"],["patient.sex","patient_sex"],
    ["vitals.bp_sys","bp_sys"],["vitals.bp_dia","bp_dia"],["vitals.hr","hr"],["vitals.spo2","spo2"],
    ["symptoms.edema","sym_edema"],["symptoms.oliguria","sym_oliguria"],["symptoms.hematuria","sym_hematuria"],
    ["labs.creatinine","creatinine"],["labs.egfr","egfr"],["labs.acr","acr"],["labs.k","k"],
    ["history.dm","hx_dm"],["history.htn","hx_htn"],["history.nephrotoxins","hx_drugs"],
    ["imaging.size","usg_size"],["imaging.echogenicity","usg_echo"],["imaging.obstruction","usg_obstruction"],
    ["advanced.ana","adv_ana"],["advanced.c3","adv_c3"],["advanced.biopsy","adv_biopsy"]
  ];
  binds.forEach(([path,id])=>{
    byId(id)?.addEventListener("input", e => set(path, e.target.value || ""));
  });

  // --- Autocomplete for meds/tests ---
  setupAutocomplete("#add-medicine", "#medicine-output", "medicine");
  setupAutocomplete("#add-test", "#test-output", "test");

  // --- Outputs ---
  const doctorOut = byId("doctor-diagnosis");
  const patientOut = byId("patient-diagnosis");
  const missingEl = byId("missing-fields");

  async function generate() {
    const rules = await loadDiagnosisRulesFromFirestore();
    const missing = getMissingFields(visitData, rules);
    const matches = getMatchedDiagnoses(visitData, rules);

    if (missing.length && matches.length === 0) {
      missingEl.textContent = "Add more data: " + missing.join(", ");
      doctorOut.textContent = "";
      patientOut.textContent = "";
    } else {
      missingEl.textContent = "";
      const medsFromRules = [];
      const top = matches.slice(0,3).map(m => {
        // collect suggested meds from your rules if present
        if (Array.isArray(m.suggestedMedicines)) medsFromRules.push(...m.suggestedMedicines);
        return `• ${m.label}\nWhy: ${m.doctorReason || m.reason || "—"}`;
      }).join("\n\n");
      doctorOut.textContent = top || "No strong diagnosis found.";
      const pf = matches.slice(0,3).map(m => m.patientExplanation || m.label).join("\n");
      patientOut.textContent = pf || "We need more tests to be sure.";

      // Optional: preload medicine suggestions as pills (once)
      if (medsFromRules.length) {
        const box = document.getElementById("medicine-output");
        const current = new Set([...box.querySelectorAll(".pill")].map(p=>p.dataset.value));
        medsFromRules.forEach(m => {
          if (!current.has(m)) {
            const pill = document.createElement("span");
            pill.className = "pill"; pill.dataset.value = m; pill.textContent = m + " ";
            const x = document.createElement("span");
            x.textContent = "❌"; x.className="remove"; x.addEventListener("click", ()=>pill.remove());
            pill.appendChild(x); box.appendChild(pill);
          }
        });
      }

      // ML (non-blocking)
      try {
        await ensureModel();
        const ml = await suggestWithModel(visitData);
        document.getElementById("ml-suggestions").textContent = ml;
      } catch(e) {
        console.warn("ML suggestion skipped:", e.message);
      }
    }
  }

  document.addEventListener("input", (e)=> {
    if (e.target.closest("section")) generate();
  });

  // --- Save Visit ---
  const saveBtn = byId("save-visit");
  saveBtn?.addEventListener("click", async ()=> {
    if (!auth.currentUser) return alert("Please login first (doctor/admin).");

    // Ensure outputs updated before saving
    await generate();

    // Collect meds/tests pills
    const meds = [...document.querySelectorAll("#medicine-output .pill")].map(p=>p.dataset.value);
    const tests = [...document.querySelectorAll("#test-output .pill")].map(p=>p.dataset.value);

    // Build payload
    const payload = {
      patient: visitData.patient,
      vitals: visitData.vitals,
      symptoms: visitData.symptoms,
      labs: visitData.labs,
      history: visitData.history,
      imaging: visitData.imaging,
      advanced: visitData.advanced,
      outputs: {
        doctor: doctorOut.textContent,
        patient: patientOut.textContent,
        medicines: meds,
        tests: tests
      },
      tag: "clinic",
      date: new Date().toISOString()
    };

    // UX: disable button while saving
    saveBtn.disabled = true;
    const originalText = saveBtn.textContent;
    saveBtn.textContent = "Saving…";
    try {
      const id = await saveVisit(payload);
      alert("Visit saved: " + id);
      console.log("Saved visit payload:", payload);
    } catch (e) {
      console.error(e);
      alert("Save failed: " + e.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = originalText;
    }
  });

  // --- Print (already wired) ---
  byId("print-prescription")?.addEventListener("click", ()=>{
    // populate printable
    byId("print-date").textContent = new Date().toLocaleString();
    byId("print-patient-name").textContent = visitData.patient.name || "";
    byId("print-patient-age").textContent = visitData.patient.age || "";
    byId("print-doctor-diagnosis").textContent = doctorOut.textContent;

    const meds = byId("print-medicines"); meds.innerHTML = "";
    [...document.querySelectorAll("#medicine-output .pill")].forEach(p=>{
      const li = document.createElement("li"); li.textContent = p.dataset.value; meds.appendChild(li);
    });
    const tests = byId("print-tests"); tests.innerHTML = "";
    [...document.querySelectorAll("#test-output .pill")].forEach(p=>{
      const li = document.createElement("li"); li.textContent = p.dataset.value; tests.appendChild(li);
    });

    import("./html2pdf.js").then(({exportToPDF})=>exportToPDF());
  });
});
