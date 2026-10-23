const $ = (id) => document.getElementById(id);
const state = { role: "coordinator", name: "Coordinator", scanning: false, stream: null, detector: null, raf: null };
const titles = {
  dashboard: ["OPERATIONS OVERVIEW", "Dashboard"],
  trips: ["TRIP MANAGEMENT", "My trips"],
  scanner: ["PASSENGER CHECK-IN", "QR scanner"],
  chats: ["TEAM COMMUNICATIONS", "Team chats"],
  team: ["ACCESS MANAGEMENT", "Manage team"]
};
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}
function showView(view) {
  if (view === "team" && state.role !== "admin") {
    toast("Administrator access is required for team management.");
    return;
  }
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  const target = $("view-" + view);
  if (target) target.classList.remove("hidden");
  document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  const t = titles[view] || titles.dashboard;
  $("pageEyebrow").textContent = t[0];
  $("pageTitle").textContent = t[1];
  if (view !== "scanner") stopScanner();
}
function enterApp(name, role) {
  state.name = name || "Coordinator";
  state.role = role;
  $("profileName").textContent = state.name;
  $("profileRole").textContent = role === "admin" ? "Administrator" : "Coordinator";
  $("profileName").previousElementSibling.textContent = (state.name.split(/\s+/).map(x => x[0]).join("").slice(0,2) || "RR").toUpperCase();
  document.querySelectorAll(".admin-only").forEach(el => el.classList.toggle("hidden", role !== "admin"));
  $("loginScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  showView("dashboard");
}
$("loginForm").addEventListener("submit", e => {
  e.preventDefault();
  // Deliberately a preview only. Never treat this client-side check as real authentication.
  const account = $("account").value.trim();
  if (!account || !$("password").value) return;
  toast("Preview mode: secure server sign-in is not connected yet.");
  enterApp(account.includes("@") ? account.split("@")[0] : account, "coordinator");
});
$("logoutBtn").addEventListener("click", () => {
  stopScanner();
  $("appShell").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  $("password").value = "";
});
document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => showView(b.dataset.go)));
$("profileMenu").addEventListener("click", () => toast("Account settings will be available after authentication is connected."));
$("refreshTrips").addEventListener("click", () => toast("Trip API is not connected yet."));
$("newChatBtn").addEventListener("click", () => toast("Private messaging API is not connected yet."));
$("startConversation").addEventListener("click", () => toast("Private messaging API is not connected yet."));
$("inviteBtn").addEventListener("click", () => toast("Coordinator management API is not connected yet."));
$("verifyTicket").addEventListener("click", () => {
  const code = $("ticketCode").value.trim();
  const box = $("scanResult");
  if (!code) { box.className = "result-box warn"; box.textContent = "Enter a ticket number or scan a QR code first."; return; }
  box.className = "result-box warn";
  box.textContent = "Not verified: the server ticket-validation API is not connected. No check-in was recorded.";
});
$("startScan").addEventListener("click", startScanner);
$("stopScan").addEventListener("click", stopScanner);
async function startScanner() {
  if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
    toast("Camera access is not supported here. Open the app over HTTPS in a supported browser.");
    return;
  }
  if (!("BarcodeDetector" in window)) {
    toast("This browser lacks built-in QR detection. A compatible QR library will be added for production.");
    return;
  }
  try {
    state.detector = new BarcodeDetector({formats:["qr_code"]});
    state.stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});
    $("cameraVideo").srcObject = state.stream;
    await $("cameraVideo").play();
    state.scanning = true;
    $("cameraPlaceholder").classList.add("hidden");
    document.querySelector(".scan-corners").style.display = "block";
    $("startScan").disabled = true;
    $("stopScan").disabled = false;
    scanFrame();
  } catch (err) {
    toast("Could not start the camera. Check browser permission and HTTPS.");
    stopScanner();
  }
}
async function scanFrame() {
  if (!state.scanning) return;
  try {
    const codes = await state.detector.detect($("cameraVideo"));
    if (codes.length && codes[0].rawValue) {
      $("ticketCode").value = codes[0].rawValue;
      $("scanResult").className = "result-box warn";
      $("scanResult").textContent = "QR captured. Select Verify ticket to send it to the server once connected; no check-in has been recorded.";
      toast("QR captured. Server verification is still required.");
      stopScanner();
      return;
    }
  } catch (_) {}
  state.raf = requestAnimationFrame(scanFrame);
}
function stopScanner() {
  state.scanning = false;
  if (state.raf) cancelAnimationFrame(state.raf);
  if (state.stream) state.stream.getTracks().forEach(track => track.stop());
  state.stream = null;
  const video = $("cameraVideo");
  if (video) video.srcObject = null;
  const placeholder = $("cameraPlaceholder");
  if (placeholder) placeholder.classList.remove("hidden");
  const corners = document.querySelector(".scan-corners");
  if (corners) corners.style.display = "none";
  if ($("startScan")) $("startScan").disabled = false;
  if ($("stopScan")) $("stopScan").disabled = true;
}
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
