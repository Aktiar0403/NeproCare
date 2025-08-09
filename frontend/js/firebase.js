// For Firebase JS SDK v7.20.0 and later, measurementId is optional
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getStorage }     from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCWhUZtbVdP777Uzsmc_Rf4Vbiiq48sBFw",
  authDomain: "nephrocare-3e13e.firebaseapp.com",
  projectId: "nephrocare-3e13e",
  storageBucket: "nephrocare-3e13e.firebasestorage.app",
  messagingSenderId: "499296554331",
  appId: "1:499296554331:web:5cfa4606ba029e8eef5e7e",
  measurementId: "G-M78DZ0VJRD"
};
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
export const storage = getStorage(app);