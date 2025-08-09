// frontend/js/auth.js
import { app, db } from "./firebase.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// Real Auth instance
const auth = getAuth(app);

// DOM
const bar       = document.getElementById("auth-bar");
const emailEl   = document.getElementById("email");
const passEl    = document.getElementById("password");
const loginBtn  = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");

// Google button
const googleBtn = document.createElement("button");
googleBtn.type = "button";
googleBtn.id = "google-btn";
googleBtn.textContent = "Sign in with Google";
googleBtn.className = "px-3 py-1 bg-red-500 text-white rounded";
bar?.appendChild(googleBtn);

// Identity + note badges
let whoBadge = document.createElement("span");
whoBadge.id = "whoami";
whoBadge.className = "text-sm text-gray-600 ml-2";
bar?.appendChild(whoBadge);

let note = document.createElement("span");
note.id = "auth-note";
note.className = "text-xs ml-2";
bar?.appendChild(note);

// Helpers
async function fetchUserRole(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? (snap.data().role || null) : null;
  } catch (e) {
    console.warn("Role fetch failed:", e);
    return null;
  }
}

function setLoggedOutUI() {
  loginBtn?.classList.remove("hidden");
  emailEl?.classList.remove("hidden");
  passEl?.classList.remove("hidden");
  googleBtn?.classList.remove("hidden");
  logoutBtn?.classList.add("hidden");
  whoBadge.textContent = "";
  note.textContent = "";
}

function setLoggedInUI(user, userRole) {
  loginBtn?.classList.add("hidden");
  emailEl?.classList.add("hidden");
  passEl?.classList.add("hidden");
  googleBtn?.classList.add("hidden");
  logoutBtn?.classList.remove("hidden");

  whoBadge.textContent = `Logged in: ${user.email || user.displayName || user.uid}${userRole ? " • Role: " + userRole : ""}`;
  if (!userRole) {
    note.textContent = " (No role set — ask admin to create users/{uid} with role: 'doctor' or 'admin')";
    note.style.color = "#b45309";
  } else if (userRole === "user") {
    note.textContent = " Read-only access (user). Doctors can save visits.";
    note.style.color = "#2563eb";
  } else {
    note.textContent = "";
  }

  window.currentUser = user;
  window.currentUserRole = userRole || null;
}

// Events
loginBtn?.addEventListener("click", async () => {
  const email = emailEl.value.trim();
  const pass  = passEl.value;
  if (!email || !pass) return alert("Enter email & password");
  try { await signInWithEmailAndPassword(auth, email, pass); }
  catch (e) { alert(e.message); }
});

googleBtn?.addEventListener("click", async () => {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (e) { alert(e.message); }
});

logoutBtn?.addEventListener("click", async () => {
  await signOut(auth);
});

// Auth state
onAuthStateChanged(auth, async (user) => {
  if (!user) return setLoggedOutUI();
  const userRole = await fetchUserRole(user.uid); // <-- keep scoped
  setLoggedInUI(user, userRole);
});
