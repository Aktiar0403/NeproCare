import { getStorage, ref, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

export async function loadCompiledRules(namespace = "core") {
  const storage = getStorage();
  const fileRef = ref(storage, `rules/${namespace}.json`);
  const url = await getDownloadURL(fileRef);     // signed url
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch compiled rules");
  const data = await res.json();
  return data.rules || [];
}
