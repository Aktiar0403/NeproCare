// frontend/js/db.js
import { db, auth } from "./firebase.js";
import {
  collection, doc, setDoc, addDoc, getDoc, getDocs,
  serverTimestamp, query, where, orderBy, limit, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ---------- Utilities ----------
function requireAuth() {
  if (!auth?.currentUser?.uid) throw new Error("Not authenticated");
  return auth.currentUser.uid;
}

// ---------- Patients (optional, you can skip using it for now) ----------
export async function savePatient(patient) {
  const uid = requireAuth();
  // If you want deterministic docs by name: use doc(collection(db,"patients"), patient.name)
  const ref = await addDoc(collection(db, "patients"), {
    ...patient,
    owner: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function getPatient(id) {
  const snap = await getDoc(doc(db, "patients", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ---------- Visits ----------
export async function saveVisit(visit) {
  const uid = requireAuth();
  const ref = await addDoc(collection(db, "visits"), {
    ...visit,
    owner: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    deleted: false
  });
  return ref.id;
}

export async function updateVisit(id, patch) {
  const ref = doc(db, "visits", id);
  await updateDoc(ref, { ...patch, updatedAt: serverTimestamp() });
}

export async function getVisit(id) {
  const snap = await getDoc(doc(db, "visits", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listRecentVisits(max = 50) {
  // For true server-side ordering, add an index if console suggests it.
  const q = query(collection(db, "visits"), orderBy("createdAt"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse(); // newest first
}

export async function listVisitsByPatient(patientName, max = 50) {
  const q = query(
    collection(db, "visits"),
    where("patient.name", "==", patientName),
    orderBy("createdAt"),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
}
