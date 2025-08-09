// Minimal local rules so the UI shows something Day 1–2
let _rules = [
  {
    id:"ckd3",
    label:"CKD Stage 3",
    conditions:[
      {section:"labs", field:"egfr", operator:"<", value:60},
      {section:"labs", field:"egfr", operator:">=", value:30}
    ],
    doctorReason:"eGFR 30–59 consistent with CKD stage 3.",
    patientExplanation:"Kidney function is moderately reduced."
  }
];

export async function loadDiagnosisRulesFromFirestore(){ return _rules; }

function cmp(op,a,b){
  switch(op){
    case "==": return a==b;
    case "!=": return a!=b;
    case ">": return Number(a)>Number(b);
    case "<": return Number(a)<Number(b);
    case ">=": return Number(a)>=Number(b);
    case "<=": return Number(a)<=Number(b);
    case "in": return Array.isArray(b)&&b.includes(a);
    default: return false;
  }
}
export function getMissingFields(visit, rules){
  const need = new Set();
  rules.forEach(r=> (r.conditions||[]).forEach(c=>need.add(`${c.section}.${c.field}`)));
  const miss=[];
  for (const k of need){
    const [a,b]=k.split(".");
    const v = visit[a]?.[b];
    if (v==null || v==="") miss.push(k);
  }
  return miss;
}
export function getMatchedDiagnoses(visit, rules){
  const out=[];
  for (const r of rules){
    const ok = (r.conditions||[]).every(c=>{
      const v = visit[c.section]?.[c.field];
      return cmp(c.operator, v, c.value);
    });
    if (ok) out.push(r);
  }
  return out;
}
