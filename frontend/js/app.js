import { loadDiagnosisRulesFromFirestore, getMatchedDiagnoses, getMissingFields } from "./diagnosis.js";
import { setupAutocomplete } from "./medicines.js";

let visitData = { patient:{}, vitals:{}, symptoms:{}, labs:{}, history:{}, imaging:{}, advanced:{} };

window.addEventListener("DOMContentLoaded", async () => {
  await loadDiagnosisRulesFromFirestore();

  const byId = id => document.getElementById(id);
  const set = (path, val) => {
    const parts = path.split('.');
    let obj = visitData;
    for (let i=0;i<parts.length-1;i++) obj = obj[parts[i]];
    obj[parts.at(-1)] = val;
  };

  const binds = [
    ["patient.name","patient_name"],["patient.age","patient_age"],["patient.sex","patient_sex"],
    ["labs.egfr","egfr"]
  ];
  binds.forEach(([path,id])=>{
    byId(id)?.addEventListener("input", e => set(path, e.target.value || ""));
  });

  setupAutocomplete("#add-medicine", "#medicine-output", "medicine");
  setupAutocomplete("#add-test", "#test-output", "test");

  const doctorOut = byId("doctor-diagnosis");
  const patientOut = byId("patient-diagnosis");
  const missingEl = byId("missing-fields");

  async function generate() {
    const rules = await loadDiagnosisRulesFromFirestore();
    const missing = getMissingFields(visitData, rules);
    const matches = getMatchedDiagnoses(visitData, rules);
    if (missing.length && matches.length===0){
      missingEl.textContent = "Add: " + missing.join(", ");
      doctorOut.textContent = "";
      patientOut.textContent = "";
    } else {
      missingEl.textContent = "";
      const top = matches[0];
      doctorOut.textContent = top ? `• ${top.label}\nWhy: ${top.doctorReason}` : "No strong diagnosis";
      patientOut.textContent = top ? (top.patientExplanation || top.label) : "We need more data.";
    }
  }

  document.addEventListener("input", (e)=>{
    if (e.target.closest("section")) generate();
  });
});
