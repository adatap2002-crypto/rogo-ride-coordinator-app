
const SUPABASE_URL = "PASTE_YOUR_SUPABASE_PROJECT_URL";
const SUPABASE_PUBLISHABLE_KEY = "PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY";

const $ = (id) => document.getElementById(id);

const state = {
  role: "coordinator",
  name: "Coordinator",
  user: null,
  supabase: null,
  scanning: false,
  stream: null,
  detector: null,
  raf: null
};

const titles = {
  dashboard: ["OPERATIONS OVERVIEW", "Dashboard"],
  trips: ["TRIP MANAGEMENT", "My trips"],
  scanner: ["PASSENGER CHECK-IN", "QR scanner"],
  chats: ["TEAM COMMUNICATIONS", "Team chats"],
  team: ["ACCESS MANAGEMENT", "Manage team"]
};

function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(
    () => el.classList.remove("show"), 3500
  );
}

function showView(view) {
  if (view === "team" && state.role !== "admin") {
    toast("Administrator access is required.");
    return;
  }

  document.querySelectorAll(".view").forEach(v =>
    v.classList.add("hidden")
  );

  const target = $("view-" + view);
  if (target) target.classList.remove("hidden");

  document.querySelectorAll("[data-view]").forEach(b =>
    b.classList.toggle("active", b.dataset.view === view)
  );

  const t = titles[view] || titles.dashboard;
  $("pageEyebrow").textContent = t[0];
  $("pageTitle").textContent = t[1];

  if (view !== "scanner") stopScanner();
}

function enterApp(profile, user) {
  state.user = user;
  state.name = profile.full_name || user.email || "Coordinator";
  state.role = profile.role;

  $("profileName").textContent = state.name;
  $("profileRole").textContent =
    state.role === "admin" ? "Administrator" : "Coordinator";

  const initials = state.name
    .split(/\s+/)
    .map(x => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  $("profileName").previousElementSibling.textContent =
    initials || "RR";

  document.querySelectorAll(".admin-only").forEach(el =>
    el.classList.toggle("hidden", state.role !== "admin")
  );

  $("loginScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  showView("dashboard");
}

function showLogin() {
  stopScanner();
  state.user = null;
  state.role = "coordinator";
  $("appShell").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
}

async function loadSupabaseLibrary() {
  if (window.supabase?.createClient) return;

  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.onload = resolve;
    script.onerror = () =>
      reject(new Error("Could not load the Supabase library."));
    document.head.appendChild(script);
  });
}

async function loadProfile(user) {
  const { data, error } = await state.supabase
    .from("coordinator_profiles")
    .select("user_id, full_name, role, active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;

  if (!data || data.active !== true) {
    await state.supabase.auth.signOut();
    throw new Error(
      "Your account has no active coordinator approval. Contact the administrator."
    );
  }

  if (!["admin", "coordinator"].includes(data.role)) {
    await state.supabase.auth.signOut();
    throw new Error("Your account role is not authorized.");
  }

  return data;
}

async function openAuthenticatedSession(user) {
  const profile = await loadProfile(user);
  enterApp(profile, user);
}

async function initializeApp() {
  if (
    SUPABASE_URL.includes("PASTE_") ||
    SUPABASE_PUBLISHABLE_KEY.includes("PASTE_")
  ) {
    toast("Add your Supabase URL and publishable key in app.js.");
    return;
  }

  try {
    await loadSupabaseLibrary();

    state.supabase = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

    const { data, error } =
      await state.supabase.auth.getSession();

    if (error) throw error;

    if (data.session?.user) {
      try {
        await openAuthenticatedSession(data.session.user);
      } catch (err) {
        showLogin();
        toast(err.message || "Account access could not be verified.");
      }
    }

    state.supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        showLogin();
      } else if (event === "SIGNED_IN" && session?.user) {
        // Defer database access until after the auth callback completes.
        setTimeout(async () => {
          try {
            await openAuthenticatedSession(session.user);
          } catch (err) {
            showLogin();
            toast(err.message || "Account approval could not be verified.");
          }
        }, 0);
      }
    });
  } catch (err) {
    toast(err.message || "Supabase could not be initialized.");
  }
}

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();

  if (!state.supabase) {
    toast("Supabase is not ready. Check your configuration and reload.");
    return;
  }

  const email = $("account").value.trim();
  const password = $("password").value;

  if (!email || !password) {
    toast("Enter your email and password.");
    return;
  }

  const submitButton = $("loginForm").querySelector(
    'button[type="submit"]'
  );
  submitButton.disabled = true;
  submitButton.textContent = "Signing in...";

  try {
    const { data, error } = await state.supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    await openAuthenticatedSession(data.user);
    $("password").value = "";
  } catch (err) {
    toast(err.message || "Sign-in failed. Check your credentials.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Sign in securely";
  }
});

$("logoutBtn").addEventListener("click", async () => {
  stopScanner();

  if (!state.supabase) {
    showLogin();
    return;
  }

  const { error } = await state.supabase.auth.signOut();

  if (error) {
    toast("Sign-out failed. Please try again.");
    return;
  }

  $("password").value = "";
  showLogin();
  toast("You have signed out.");
});

document.querySelectorAll("[data-view]").forEach(b =>
  b.addEventListener("click", () => showView(b.dataset.view))
);

document.querySelectorAll("[data-go]").forEach(b =>
  b.addEventListener("click", () => showView(b.dataset.go))
);

$("profileMenu").addEventListener("click", () =>
  toast("Account settings are not connected yet.")
);

$("refreshTrips").addEventListener("click", () =>
  toast("Trip data API is not connected yet.")
);

$("newChatBtn").addEventListener("click", () =>
  toast("Private messaging API is not connected yet.")
);

$("startConversation").addEventListener("click", () =>
  toast("Private messaging API is not connected yet.")
);

$("inviteBtn").addEventListener("click", () => {
  if (state.role !== "admin") {
    toast("Administrator access is required.");
    return;
  }
  toast("Secure coordinator management is not connected yet.");
});

$("verifyTicket").addEventListener("click", () => {
  const code = $("ticketCode").value.trim();
  const box = $("scanResult");

  if (!code) {
    box.className = "result-box warn";
    box.textContent = "Enter a ticket number or scan a QR code first.";
    return;
  }

  box.className = "result-box warn";
  box.textContent =
    "Not verified. The secure ticket-validation API is not connected. No check-in was recorded.";
});

$("startScan").addEventListener("click", startScanner);
$("stopScan").addEventListener("click", stopScanner);

async function startScanner() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Camera access requires HTTPS and a supported browser.");
    return;
  }

  if (!("BarcodeDetector" in window)) {
    toast("QR detection is not supported by this browser.");
    return;
  }

  try {
    state.detector = new BarcodeDetector({
      formats: ["qr_code"]
    });

    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });

    $("cameraVideo").srcObject = state.stream;
    await $("cameraVideo").play();

    state.scanning = true;
    $("cameraPlaceholder").classList.add("hidden");
    document.querySelector(".scan-corners").style.display = "block";
    $("startScan").disabled = true;
    $("stopScan").disabled = false;

    scanFrame();
  } catch (err) {
    toast("Could not start camera. Check camera permission.");
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
      $("scanResult").textContent =
        "QR captured. Server verification is still required; no check-in was recorded.";

      toast("QR captured.");
      stopScanner();
      return;
    }
  } catch (_) {}

  if (state.scanning) {
    state.raf = requestAnimationFrame(scanFrame);
  }
}

function stopScanner() {
  state.scanning = false;

  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = null;

  if (state.stream) {
    state.stream.getTracks().forEach(track => track.stop());
  }

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

if ("serviceWorker" in navigator &&
    location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

initializeApp();
                    
