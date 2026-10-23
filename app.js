
const SUPABASE_URL = "https://phvuffbriqwimzyrafia.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_iRbBrraZX6w7MLmb_EDUuw_4z8DnSF4";

const $ = (id) => document.getElementById(id);

const state = {
  role: "coordinator",
  name: "Coordinator",
  user: null,
  supabase: null,
  scanning: false,
  stream: null,
  detector: null,
  raf: null,
  authListener: null,
  signingIn: false
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
  if (!el) {
    console.log(message);
    return;
  }

  el.textContent = message;
  el.classList.add("show");

  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 4500);
}

function showView(view) {
  if (view === "team" && state.role !== "admin") {
    toast("Administrator access is required.");
    return;
  }

  document.querySelectorAll(".view").forEach((v) => {
    v.classList.add("hidden");
  });

  const target = $("view-" + view);
  if (target) target.classList.remove("hidden");

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  const title = titles[view] || titles.dashboard;

  if ($("pageEyebrow")) $("pageEyebrow").textContent = title[0];
  if ($("pageTitle")) $("pageTitle").textContent = title[1];

  if (view !== "scanner") stopScanner();
}

function enterApp(profile, user) {
  state.user = user;
  state.name = profile.full_name || user.email || "Coordinator";
  state.role = profile.role;

  if ($("profileName")) {
    $("profileName").textContent = state.name;

    const initials = state.name
      .split(/\s+/)
      .map((part) => part[0] || "")
      .join("")
      .slice(0, 2)
      .toUpperCase();

    if ($("profileName").previousElementSibling) {
      $("profileName").previousElementSibling.textContent =
        initials || "RR";
    }
  }

  if ($("profileRole")) {
    $("profileRole").textContent =
      state.role === "admin" ? "Administrator" : "Coordinator";
  }

  document.querySelectorAll(".admin-only").forEach((element) => {
    element.classList.toggle("hidden", state.role !== "admin");
  });

  $("loginScreen")?.classList.add("hidden");
  $("appShell")?.classList.remove("hidden");

  showView("dashboard");
}

function showLogin() {
  stopScanner();

  state.user = null;
  state.name = "Coordinator";
  state.role = "coordinator";

  $("appShell")?.classList.add("hidden");
  $("loginScreen")?.classList.remove("hidden");
}

async function loadSupabaseLibrary() {
  if (window.supabase?.createClient) return;

  await new Promise((resolve, reject) => {
    const script = document.createElement("script");

    script.src =
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

    script.onload = resolve;
    script.onerror = () => {
      reject(new Error("Could not load Supabase. Check your internet connection."));
    };

    document.head.appendChild(script);
  });

  if (!window.supabase?.createClient) {
    throw new Error("Supabase library loaded incorrectly. Refresh the page.");
  }
}

async function loadProfile(user) {
  const { data, error } = await state.supabase
    .from("coordinator_profiles")
    .select("user_id, full_name, role, active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(
      error.code === "PGRST116"
        ? "Could not find your coordinator profile."
        : "Could not verify your profile: " + error.message
    );
  }

  if (!data || data.active !== true) {
    throw new Error(
      "Your account has no active coordinator approval. Contact the administrator."
    );
  }

  if (!["admin", "coordinator"].includes(data.role)) {
    throw new Error("Your account role is not authorized.");
  }

  return data;
}

async function openAuthenticatedSession(user) {
  const profile = await loadProfile(user);
  enterApp(profile, user);
}

async function initializeApp() {
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

    const { data, error } = await state.supabase.auth.getSession();

    if (error) throw error;

    if (data.session?.user) {
      try {
        await openAuthenticatedSession(data.session.user);
      } catch (err) {
        showLogin();
        toast(err.message || "Your account could not be verified.");
      }
    }

    const { data: listener } = state.supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_OUT") {
          showLogin();
          return;
        }

        if (event === "SIGNED_IN" && session?.user) {
          setTimeout(async () => {
            if (state.signingIn) return;

            try {
              await openAuthenticatedSession(session.user);
            } catch (err) {
              await state.supabase.auth.signOut();
              showLogin();
              toast(err.message || "Account approval could not be verified.");
            }
          }, 0);
        }
      }
    );

    state.authListener = listener;
  } catch (err) {
    console.error("Initialization error:", err);
    toast(err.message || "The app could not connect to Supabase.");
  }
}

$("loginForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!state.supabase) {
    toast("Supabase is not ready. Refresh and try again.");
    return;
  }

  if (state.signingIn) return;

  const email = $("account")?.value.trim();
  const password = $("password")?.value;

  if (!email || !password) {
    toast("Enter your email address and password.");
    return;
  }

  const button = $("loginForm").querySelector('button[type="submit"]');

  state.signingIn = true;

  if (button) {
    button.disabled = true;
    button.textContent = "Signing in...";
  }

  try {
    const { data, error } = await state.supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    if (!data.user) {
      throw new Error("Sign-in succeeded but no user was returned.");
    }

    await openAuthenticatedSession(data.user);

    $("password").value = "";
  } catch (err) {
    console.error("Sign-in error:", err);
    toast(err.message || "Sign-in failed. Check your email and password.");
  } finally {
    state.signingIn = false;

    if (button) {
      button.disabled = false;
      button.textContent = "Sign in securely";
    }
  }
});

$("logoutBtn")?.addEventListener("click", async () => {
  stopScanner();

  if (!state.supabase) {
    showLogin();
    return;
  }

  const { error } = await state.supabase.auth.signOut();

  if (error) {
    toast("Sign-out failed: " + error.message);
    return;
  }

  if ($("password")) $("password").value = "";

  showLogin();
  toast("You have signed out.");
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.go));
});

$("profileMenu")?.addEventListener("click", () => {
  toast("Account settings are not connected yet.");
});

$("refreshTrips")?.addEventListener("click", () => {
  toast("Trip data API is not connected yet.");
});

$("newChatBtn")?.addEventListener("click", () => {
  toast("Private messaging API is not connected yet.");
});

$("startConversation")?.addEventListener("click", () => {
  toast("Private messaging API is not connected yet.");
});

$("inviteBtn")?.addEventListener("click", () => {
  if (state.role !== "admin") {
    toast("Administrator access is required.");
    return;
  }

  toast("Secure coordinator management is not connected yet.");
});

$("verifyTicket")?.addEventListener("click", () => {
  const code = $("ticketCode")?.value.trim();
  const result = $("scanResult");

  if (!result) return;

  if (!code) {
    result.className = "result-box warn";
    result.textContent = "Enter a ticket number or scan a QR code first.";
    return;
  }

  result.className = "result-box warn";
  result.textContent =
    "Not verified. Secure ticket validation is not connected. No check-in was recorded.";
});

$("startScan")?.addEventListener("click", startScanner);
$("stopScan")?.addEventListener("click", stopScanner);

async function startScanner() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Camera access requires HTTPS and a supported browser.");
    return;
  }

  if (!("BarcodeDetector" in window)) {
    toast("QR detection is not supported by this browser. Try a compatible browser.");
    return;
  }

  try {
    state.detector = new BarcodeDetector({ formats: ["qr_code"] });

    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });

    $("cameraVideo").srcObject = state.stream;
    await $("cameraVideo").play();

    state.scanning = true;

    $("cameraPlaceholder")?.classList.add("hidden");

    const corners = document.querySelector(".scan-corners");
    if (corners) corners.style.display = "block";

    if ($("startScan")) $("startScan").disabled = true;
    if ($("stopScan")) $("stopScan").disabled = false;

    scanFrame();
  } catch (err) {
    console.error("Camera error:", err);
    toast("Could not start camera. Check browser camera permissions.");
    stopScanner();
  }
}

async function scanFrame() {
  if (!state.scanning) return;

  try {
    const video = $("cameraVideo");

    if (video?.readyState >= 2) {
      const codes = await state.detector.detect(video);

      if (codes.length && codes[0].rawValue) {
        $("ticketCode").value = codes[0].rawValue;

        $("scanResult").className = "result-box warn";
        $("scanResult").textContent =
          "QR captured. Server verification is still required; no check-in was recorded.";

        toast("QR captured. Verify it with the secure backend when connected.");
        stopScanner();
        return;
      }
    }
  } catch (err) {
    console.warn("QR scan attempt failed:", err);
  }

  if (state.scanning) {
    state.raf = requestAnimationFrame(scanFrame);
  }
}

function stopScanner() {
  state.scanning = false;

  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = null;

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }

  state.stream = null;

  const video = $("cameraVideo");
  if (video) video.srcObject = null;

  $("cameraPlaceholder")?.classList.remove("hidden");

  const corners = document.querySelector(".scan-corners");
  if (corners) corners.style.display = "none";

  if ($("startScan")) $("startScan").disabled = false;
  if ($("stopScan")) $("stopScan").disabled = true;
}

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

initializeApp();
  
