// frontend/js/auth.js
import { app, db } from "./firebase.js"; // make sure firebase.js is the real one with initializeApp(...)
import {
  getAuth,               // ⬅️ use getAuth here
  signInWithEmailAndPassword,
  onAuthStateChanged,    // from modular SDK
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ✅ Create a real Auth instance from the initialized app
const auth = getAuth(app);

// (rest of your file stays the same…)

// --- DOM refs
const bar       = document.getElementById("auth-bar");
const emailEl   = document.getElementById("email");
const passEl    = document.getElementById("password");
const loginBtn  = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");

// --- Add a Google Sign-in button (programmatically to avoid HTML edits)
const googleBtn = document.createElement("button");
googleBtn.type = "button";
googleBtn.id = "google-btn";
googleBtn.textContent = "Sign in with Google";
googleBtn.className = "px-3 py-1 bg-red-500 text-white rounded";
bar?.appendChild(googleBtn);

// Small badge to show identity + role
let whoBadge = document.createElement("span");
whoBadge.id = "whoami";
whoBadge.className = "text-sm text-gray-600 ml-2";
bar?.appendChild(whoBadge);

// Optional inline note area
let note = document.createElement("span");
note.id = "auth-note";
note.className = "text-xs ml-2";
bar?.appendChild(note);

// --- Helpers
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

function setLoggedInUI(user, role) {
  loginBtn?.classList.add("hidden");
  emailEl?.classList.add("hidden");
  passEl?.classList.add("hidden");
  googleBtn?.classList.add("hidden");
  logoutBtn?.classList.remove("hidden");

  whoBadge.textContent = `Logged in: ${user.email || user.displayName || user.uid}${role ? " • Role: " + role : ""}`;
  if (!role) {
    note.textContent = " (No role set — ask admin to create users/{uid} with role: 'doctor' or 'admin')";
    note.style.color = "#b45309"; // amber-700
  } else {
    note.textContent = "";
  }

  // Expose for quick debugging in console
  window.currentUser = user;
  window.currentUserRole = role || null;
}

// --- Events
loginBtn?.addEventListener("click", async () => {
  const email = emailEl.value.trim();
  const pass  = passEl.value;
  if (!email || !pass) return alert("Enter email & password");
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    alert(e.message);
  }
});

googleBtn?.addEventListener("click", async () => {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (e) {
    // Common: popup blocked or disallowed domain
    alert(e.message);
  }
});

logoutBtn?.addEventListener("click", async () => {
  await signOut(auth);
});

// --- Auth state + role check
onAuthStateChanged(auth, async (user) => {
  if (!user) return setLoggedOutUI();
  const role = await fetchUserRole(user.uid); // requires users/{uid}.role set by admin
  setLoggedInUI(user, role);
});
