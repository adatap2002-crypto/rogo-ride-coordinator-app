
"use strict";

/* ROGO RIDE Coordinator App
   Supabase authentication, trip management and QR capture.
   This frontend does not modify the Telegram bot.
   Ticket validation and check-in require a secure backend.
*/

const SUPABASE_URL = "https://phvuffbriqwimzyrafia.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_iRbBrraZX6w7MLmb_EDUuw_4z8DnSF4";

const $ = (id) => document.getElementById(id);

const state = {
  role: "coordinator",
  name: "Coordinator",
  user: null,
  supabase: null,
  signingIn: false,
  authListener: null,
  trips: [],
  tripsLoading: false,
  stream: null,
  detector: null,
  scanTimer: null,
  detailTripId: null,
  verifying: false,
  currentView: "dashboard",
  openTrips: [],
  myBookings: [],
  bookingTrip: null,
  team: [],
  chat: { peer: null, timer: null, sig: "", loading: false },
  recovery: false,
  verification: null,
  me: null,
  chatTab: "team"
};

const titles = {
  dashboard: ["Operations overview", "Dashboard"],
  trips: ["Trip management", "Trips"],
  scanner: ["Passenger check-in", "QR scanner"],
  chats: ["Conversations", "Chats"],
  reviews: ["Rider feedback", "Reviews"],
  verifications: ["Passenger access", "Verifications"],
  team: ["Access management", "Manage team"]
};

function toast(message) {
  const el = $("toast");
  if (!el) {
    console.log(message);
    return;
  }

  el.textContent = String(message);
  el.classList.add("show");

  clearTimeout(window.__rogoToastTimer);
  window.__rogoToastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 6000);
}

function showLoginError(message) {
  let box = $("loginError");

  if (!box) {
    box = document.createElement("div");
    box.id = "loginError";
    box.className = "notice";
    box.setAttribute("role", "alert");
    $("loginForm")?.prepend(box);
  }

  box.textContent = message;
  box.classList.remove("ok", "hidden");
}

function clearLoginError() {
  const box = $("loginError");
  if (box) {
    box.textContent = "";
    box.classList.remove("ok");
    box.classList.add("hidden");
  }
}

function showLoginInfo(message) {
  showLoginError(message);
  $("loginError")?.classList.add("ok");
}

function showAuthTab(tab) {
  document.querySelectorAll("[data-auth-tab]").forEach((b) =>
    b.classList.toggle("active", b.dataset.authTab === tab));
  $("loginForm")?.classList.toggle("hidden", tab !== "signin");
  $("signupForm")?.classList.toggle("hidden", tab !== "signup");
  clearLoginError();
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

/* ICONS, AVATARS AND SMALL HELPERS */

const ICON_PATHS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
  bus: '<rect x="4" y="3" width="16" height="14" rx="3.5"/><path d="M4 11h16M8 21v-4M16 21v-4"/><path d="M8.5 14h.01M15.5 14h.01"/>',
  ticket: '<path d="M3 9a2.5 2.5 0 0 0 0 6v3h18v-3a2.5 2.5 0 0 1 0-6V6H3z"/><path d="M14 6v12" stroke-dasharray="2 2.4"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.3-4.4A8 8 0 1 1 21 12z"/>',
  star: '<path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2l-5.4 2.9 1-6.1L3.2 9.7l6.1-.9z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0M16 4.6a3.5 3.5 0 0 1 0 6.8M22 20a6 6 0 0 0-4-5.6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M7 12h10"/>',
  send: '<path d="M21.5 2.5L10.5 13.5"/><path d="M21.5 2.5l-7 19-4-8.5-8.5-4z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  printer: '<path d="M7 9V4h10v5M7 17H5v-6h14v6h-2M7 14h10v6H7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-3.5M4 4v4h4M4 13a8 8 0 0 0 14.5 3.5M20 20v-4h-4"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'
};

function icon(name, size = 20) {
  return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;
}

function decorateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    if (el.dataset.iconDone) return;
    el.dataset.iconDone = "1";
    let size = 20;
    if (el.closest(".camera-placeholder")) size = 34;
    else if (el.closest(".file-drop")) size = 26;
    else if (el.classList.contains("group-badge")) size = 22;
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon, size));
  });
}

function nameHue(name) {
  let h = 0;
  for (const ch of String(name || "?")) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function initialsOf(name) {
  return String(name || "?").trim().split(/\s+/).map((p) => p[0] || "").join("").slice(0, 2).toUpperCase() || "?";
}

function avatarUrl(path) {
  return `${SUPABASE_URL}/storage/v1/object/public/rr-avatars/${String(path).split("/").map(encodeURIComponent).join("/")}`;
}

function avatarHTML(person, size = 40) {
  const name = person?.name || "?";
  const img = person?.avatar_path
    ? `<img alt="" loading="lazy" src="${escapeHTML(avatarUrl(person.avatar_path))}" onerror="this.remove()">` : "";
  return `<span class="av" style="--s:${size}px;--h:${nameHue(name)}">${escapeHTML(initialsOf(name))}${img}</span>`;
}

function capFirst(s) {
  s = String(s || "").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function splitRoute(route) {
  const parts = String(route || "").split(/\s*(?:→|->|–|—|\bto\b)\s*/i).map((s) => s.trim()).filter(Boolean);
  return parts.length === 2 ? parts.map(capFirst) : null;
}

function routeHTML(route) {
  const p = splitRoute(route);
  if (!p) {
    return `<div class="route single" style="grid-template-columns:1fr"><div class="route-names"><strong>${escapeHTML(route || "Route not set")}</strong></div></div>`;
  }
  return `<div class="route"><div class="route-rail"><i></i><b></b><i></i></div>
    <div class="route-names"><div><small>From</small><strong>${escapeHTML(p[0])}</strong></div>
    <div><small>To</small><strong>${escapeHTML(p[1])}</strong></div></div></div>`;
}

function starsHTML(n, size = 16) {
  return `<span class="stars" aria-label="${n} out of 5">${[1, 2, 3, 4, 5].map((i) =>
    `<span class="${i <= Math.round(n) ? "on" : ""}">${icon("star", size)}</span>`).join("")}</span>`;
}

function dayLabel(d) {
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
}

function clockTime(d) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
}

function formatDate(value) {
  if (!value) return "Not specified";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatInputDate(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const local = new Date(
    date.getTime() - date.getTimezoneOffset() * 60000
  );

  return local.toISOString().slice(0, 16);
}

function setTripsMessage(title, message, type = "info") {
  const box = $("tripsMessage");
  if (!box) return;

  const symbol = type === "error" ? "!" : type === "success" ? "✓" : "i";

  box.className = "notice";
  box.innerHTML = `
    <span>${symbol}</span>
    <div>
      <strong>${escapeHTML(title)}</strong>
      <p>${escapeHTML(message)}</p>
    </div>
  `;
  box.classList.toggle("hidden", !message);
}

/* SUPABASE INITIALIZATION */

async function loadSupabaseLibrary() {
  if (window.supabase?.createClient) return;

  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.onload = resolve;
    script.onerror = () => reject(
      new Error("Could not load Supabase. Check your internet connection and reload.")
    );
    document.head.appendChild(script);
  });

  if (!window.supabase?.createClient) {
    throw new Error("Supabase failed to initialize. Please reload the page.");
  }
}

async function loadProfile(user) {
  const { data, error } = await state.supabase
    .from("coordinator_profiles")
    .select("user_id, full_name, role, active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error("Could not verify your profile: " + error.message);
  }

  // No staff record: an ordinary passenger account.
  if (!data) return null;

  if (data.active !== true) {
    throw new Error("This staff account has been deactivated. Contact the administrator.");
  }

  if (!["admin", "coordinator"].includes(data.role)) {
    throw new Error("This account does not have an authorized role.");
  }

  return data;
}

async function openAuthenticatedSession(user) {
  const profile = await loadProfile(user);
  if (profile) enterApp(profile, user);
  else enterPassengerApp(user);
}

function hideAllShells() {
  $("loginScreen")?.classList.add("hidden");
  $("appShell")?.classList.add("hidden");
  $("passengerShell")?.classList.add("hidden");
}

function enterApp(profile, user) {
  state.user = user;
  state.name = profile.full_name || user.email || "Coordinator";
  state.role = profile.role;

  state.me = null;
  if ($("profileName")) $("profileName").textContent = state.name;
  refreshMyAvatar();
  loadMyPerson(state.name);

  if ($("profileRole")) {
    $("profileRole").textContent =
      state.role === "admin" ? "Administrator" : "Coordinator";
  }

  document.querySelectorAll(".admin-only").forEach((el) => {
    el.classList.toggle("hidden", state.role !== "admin");
  });

  hideAllShells();
  $("appShell")?.classList.remove("hidden");

  showView("dashboard");
  loadTrips();
  if (state.role === "admin") loadPendingCount();
  else if ($("statPending")) $("statPending").textContent = "–";
}

function showLogin() {
  stopScanner();
  stopChatPolling();

  state.user = null;
  state.name = "Coordinator";
  state.role = "coordinator";
  state.trips = [];
  state.tripsLoading = false;
  state.detailTripId = null;
  state.openTrips = [];
  state.myBookings = [];
  state.team = [];
  state.me = null;
  state.verification = null;
  state.chatTab = "team";
  state.chat = { peer: null, timer: null, sig: "", loading: false };
  $("tripDetail")?.remove();

  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  hideAllShells();
  $("loginScreen")?.classList.remove("hidden");

  renderTrips();
}

async function initializeApp() {
  const button = $("loginForm")?.querySelector('button[type="submit"]');

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Connecting...";
    }

    state.recovery = /type=recovery/.test(window.location.hash);

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
        if (state.recovery) openProfileDialog(true);
      } catch (err) {
        console.error("Saved session profile check failed:", err);
        await state.supabase.auth.signOut({ scope: "local" });
        showLogin();
        showLoginError(err.message || "Account approval could not be verified.");
      }
    }

    const { data: listener } = state.supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "SIGNED_OUT") {
          showLogin();
        }
        if (event === "PASSWORD_RECOVERY") {
          state.recovery = true;
        }
      }
    );

    state.authListener = listener;
    console.info("ROGO RIDE initialized.");
  } catch (err) {
    console.error("ROGO RIDE initialization failed:", err);
    showLoginError(err.message || "Could not initialize the app.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Sign in securely";
    }
  }
}

/* LOGIN
   Register the handler before initialization begins so a slow
   network connection cannot leave the form without a handler.
*/

document.querySelectorAll("[data-auth-tab]").forEach((b) =>
  b.addEventListener("click", () => showAuthTab(b.dataset.authTab)));

$("loginForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearLoginError();

  if (state.signingIn) return;

  if (!state.supabase) {
    showLoginError(
      "The connection is still initializing. Wait a moment and try again. If this persists, reload the page."
    );
    return;
  }

  const email = $("account")?.value.trim();
  const password = $("password")?.value;
  const button = $("loginForm")?.querySelector('button[type="submit"]');

  if (!email || !password) {
    showLoginError("Enter your email address and password.");
    return;
  }

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
    if (!data.user) throw new Error("Supabase did not return a user.");

    await openAuthenticatedSession(data.user);
    $("password").value = "";
    clearLoginError();
  } catch (err) {
    console.error("ROGO RIDE sign-in failed:", err);

    showLoginError(err.message || "Sign-in failed. Check your credentials and account approval.");

    // If authentication succeeded but the profile check failed,
    // clear the unapproved session.
    try {
      const { data } = await state.supabase.auth.getSession();
      if (data.session?.user) {
        await state.supabase.auth.signOut({ scope: "local" });
      }
    } catch (signOutError) {
      console.error("Session cleanup failed:", signOutError);
    }

    showLogin();
    showLoginError(err.message || "Sign-in failed. Check your credentials and account approval.");
  } finally {
    state.signingIn = false;

    if (button) {
      button.disabled = false;
      button.textContent = "Sign in securely";
    }
  }
});

$("signupForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearLoginError();

  if (!state.supabase) {
    showLoginError("The connection is still initializing. Wait a moment and try again.");
    return;
  }

  const name = $("suName").value.trim();
  const email = $("suEmail").value.trim().toLowerCase();
  const password = $("suPassword").value;
  const button = $("signupForm").querySelector('button[type="submit"]');

  if (name.length < 2) { showLoginError("Enter your full name."); return; }
  if (password.length < 8) { showLoginError("Your password must be at least 8 characters."); return; }

  button.disabled = true;
  button.textContent = "Creating account...";

  try {
    const { data, error } = await state.supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: window.location.origin + window.location.pathname
      }
    });
    if (error) throw error;

    if (data.session?.user) {
      await openAuthenticatedSession(data.session.user);
      $("suPassword").value = "";
    } else if (Array.isArray(data.user?.identities) && data.user.identities.length === 0) {
      showLoginError("An account with this email already exists. Use Sign in instead.");
    } else {
      $("suPassword").value = "";
      showAuthTab("signin");
      $("account").value = email;
      showLoginInfo("Account created. Open the confirmation link we emailed you, then sign in here.");
    }
  } catch (err) {
    console.error("Sign-up failed:", err);
    showLoginError(err.message || "Could not create the account.");
  } finally {
    button.disabled = false;
    button.textContent = "Create passenger account";
  }
});

$("forgotPassword")?.addEventListener("click", async () => {
  clearLoginError();
  const email = $("account")?.value.trim();
  if (!email) {
    showLoginError("Type your email address above first, then tap Forgot password.");
    return;
  }
  if (!state.supabase) return;

  const { error } = await state.supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });
  if (error) showLoginError(error.message);
  else showLoginInfo("If that email has an account, a password reset link is on its way.");
});

async function signOutAll() {
  stopScanner();
  stopChatPolling();

  try {
    if (state.supabase) {
      // "local" always clears this device's session, even if the network is down.
      const { error } = await state.supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
    }
  } catch (err) {
    console.error("Sign-out failed:", err);
  }

  if ($("password")) $("password").value = "";
  showLogin();
  showAuthTab("signin");
  toast("You have signed out.");
}

["logoutBtn", "topLogout", "pLogout", "pfSignOut"].forEach((id) =>
  $(id)?.addEventListener("click", signOutAll));

/* NAVIGATION */

function showView(view) {
  if ((view === "team" || view === "verifications") && state.role !== "admin") {
    toast("Administrator access is required.");
    return;
  }

  state.currentView = view;

  document.querySelectorAll(".view").forEach((el) => {
    el.classList.add("hidden");
  });

  $("view-" + view)?.classList.remove("hidden");

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  document.querySelectorAll("[data-go]").forEach((button) => {
    button.setAttribute("aria-current", button.dataset.go === view ? "page" : "false");
    if (button.closest(".mobile-nav")) {
      button.classList.toggle("active", button.dataset.go === view);
    }
  });

  const title = titles[view] || titles.dashboard;
  if ($("pageEyebrow")) $("pageEyebrow").textContent = title[0];
  if ($("pageTitle")) $("pageTitle").textContent = title[1];

  if (view !== "scanner") stopScanner();
  if (view === "trips" && state.user) loadTrips();
  if (view === "team" && state.user) loadStaff();
  if (view === "reviews" && state.user) loadReviews("sr");
  if (view === "verifications" && state.user) loadVerifications();
  if (view === "chats" && state.user) showChatTab(state.chatTab || "team"); else stopChatPolling();
  if (view === "dashboard" && state.user && state.role === "admin") loadPendingCount();
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.go));
});

/* TRIP MANAGEMENT */

function renderTrips() {
  const container = $("tripsContainer");
  if (!container) return;

  if (!state.user) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Sign in to view trips</h3>
        <p>Your assigned trips will appear here after authentication.</p>
      </div>`;
    return;
  }

  if (state.tripsLoading) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Loading trips...</h3>
        <p>Connecting to the operations database.</p>
      </div>`;
    return;
  }

  if (!state.trips.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No trips found</h3>
        <p>${
          state.role === "admin"
            ? "Create a trip to get started."
            : "No trips are currently assigned to your account."
        }</p>
      </div>`;
    return;
  }

  const keepDetail = $("tripDetail");
  container.innerHTML = state.trips.map((trip) => `
    <article class="ride-card">
      <div class="ride-top">
        ${routeHTML(trip.route)}
        <span class="trip-status">${escapeHTML(String(trip.status || "scheduled").replace(/[_-]+/g, " "))}</span>
      </div>
      <div class="ride-meta">
        <div><small>Departs</small><b>${escapeHTML(formatDate(trip.departure_at))}</b></div>
        <div><small>Seats</small><b>${escapeHTML(trip.seat_capacity)}</b></div>
        <div><small>Fare</small><b>Free</b></div>
      </div>
      <div class="ride-actions">
        <button class="primary" type="button" data-open-trip="${escapeHTML(trip.id)}">${icon("users", 18)} Passengers &amp; tickets</button>
        ${state.role === "admin" ? `
          <button class="secondary" type="button" data-edit-trip="${escapeHTML(trip.id)}">Edit</button>
          <button class="ghost" type="button" data-delete-trip="${escapeHTML(trip.id)}">${icon("trash", 18)} Delete</button>` : ""}
      </div>
    </article>
  `).join("");

  if (keepDetail) container.prepend(keepDetail);

  container.querySelectorAll("[data-open-trip]").forEach((button) => {
    button.addEventListener("click", () => openTripDetail(button.dataset.openTrip));
  });

  container.querySelectorAll("[data-edit-trip]").forEach((button) => {
    button.addEventListener("click", () => {
      const trip = state.trips.find((item) => item.id === button.dataset.editTrip);
      if (trip) showTripForm(trip);
    });
  });

  container.querySelectorAll("[data-delete-trip]").forEach((button) => {
    button.addEventListener("click", () => deleteTrip(button.dataset.deleteTrip));
  });
}

function renderTripAdminControls() {
  if (state.role !== "admin") return;

  const heading = $("view-trips")?.querySelector(".section-heading");
  if (!heading || $("createTripBtn")) return;

  const button = document.createElement("button");
  button.id = "createTripBtn";
  button.type = "button";
  button.className = "primary";
  button.textContent = "+ Create trip";
  button.addEventListener("click", () => showTripForm());
  heading.appendChild(button);
}

async function loadTrips() {
  if (!state.supabase || !state.user || state.tripsLoading) return;

  state.tripsLoading = true;
  setTripsMessage("Loading trips", "Retrieving trip records.");
  renderTrips();

  try {
    const { data, error } = await state.supabase
      .from("trips")
      .select("id, route, departure_at, seat_capacity, status, created_at")
      .order("departure_at", { ascending: true });

    if (error) throw error;

    state.trips = data || [];
    if ($("statTrips")) $("statTrips").textContent = String(state.trips.length);

    state.tripsLoading = false;
    renderTrips();
    renderTripAdminControls();

    setTripsMessage(
      state.trips.length ? "Trips loaded" : "No trips available",
      state.trips.length
        ? "Trip records were retrieved using your account permissions."
        : state.role === "admin"
          ? "Create a trip to get started."
          : "Ask an administrator to assign a trip to your account.",
      state.trips.length ? "success" : "info"
    );
  } catch (err) {
    console.error("Trip loading failed:", err);
    state.trips = [];
    state.tripsLoading = false;
    renderTrips();

    setTripsMessage(
      "Could not load trips",
      err.message || "Unknown database error.",
      "error"
    );
  }
}

function showTripForm(trip = null) {
  if (state.role !== "admin") {
    toast("Only an administrator can manage trips.");
    return;
  }

  $("tripEditor")?.remove();

  const container = $("tripsContainer");
  if (!container) return;

  const form = document.createElement("form");
  form.id = "tripEditor";
  form.className = "panel";
  form.style.cssText = "padding:20px;margin-bottom:20px;";

  form.innerHTML = `
    <h3>${trip ? "Edit trip" : "Create a trip"}</h3>
    <label for="tripRoute">Route</label>
    <input id="tripRoute" required maxlength="200"
      placeholder="e.g. Bauchi → Misau"
      value="${escapeHTML(trip?.route || "")}">
    <label for="tripDeparture">Departure date and time</label>
    <input id="tripDeparture" type="datetime-local" required
      value="${escapeHTML(formatInputDate(trip?.departure_at))}">
    <label for="tripCapacity">Seat capacity</label>
    <input id="tripCapacity" type="number" min="1" max="100000"
      step="1" required value="${escapeHTML(trip?.seat_capacity ?? 25)}">
    <label for="tripStatus">Trip status</label>
    <select id="tripStatus" required>
      ${["scheduled", "boarding", "departed", "completed", "cancelled"].map((status) => `
        <option value="${status}" ${
          String(trip?.status || "scheduled").toLowerCase() === status ? "selected" : ""
        }>${status.charAt(0).toUpperCase() + status.slice(1)}</option>
      `).join("")}
    </select>
    <p class="tiny muted">All ROGO RIDE trips are FREE.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;">
      <button class="primary" type="submit">${trip ? "Save changes" : "Create trip"}</button>
      <button class="secondary" type="button" id="cancelTripForm">Cancel</button>
    </div>`;

  container.prepend(form);
  $("cancelTripForm").addEventListener("click", () => form.remove());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const route = $("tripRoute").value.trim();
    const departureLocal = $("tripDeparture").value;
    const capacity = Number($("tripCapacity").value);
    const status = $("tripStatus").value;
    const departure = new Date(departureLocal);

    if (!route || !departureLocal || !Number.isInteger(capacity) || capacity < 1 ||
        Number.isNaN(departure.getTime())) {
      toast("Enter a valid route, departure time, and seat capacity.");
      return;
    }

    const saveButton = form.querySelector('button[type="submit"]');
    saveButton.disabled = true;
    saveButton.textContent = "Saving...";

    try {
      const payload = {
        route,
        departure_at: departure.toISOString(),
        seat_capacity: capacity,
        status
      };

      const result = trip
        ? await state.supabase.from("trips").update(payload)
            .eq("id", trip.id).select("id").maybeSingle()
        : await state.supabase.from("trips").insert(payload)
            .select("id").single();

      if (result.error) throw result.error;
      if (!result.data) throw new Error("No trip returned. Check database permissions.");

      form.remove();
      toast(trip ? "Trip updated successfully." : "Trip created successfully.");
      await loadTrips();
    } catch (err) {
      console.error("Trip save failed:", err);
      toast("Could not save trip: " + (err.message || "Unknown error"));
      saveButton.disabled = false;
      saveButton.textContent = trip ? "Save changes" : "Create trip";
    }
  });

  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteTrip(tripId) {
  if (state.role !== "admin") {
    toast("Only an administrator can delete trips.");
    return;
  }

  const trip = state.trips.find((item) => item.id === tripId);
  if (!trip) return;

  if (!window.confirm(
    `Delete the trip "${trip.route}"?\n\nRelated tickets or assignments may prevent deletion.`
  )) return;

  try {
    const { error } = await state.supabase
      .from("trips")
      .delete()
      .eq("id", tripId);

    if (error) throw error;

    toast("Trip deletion request completed.");
    await loadTrips();
  } catch (err) {
    console.error("Trip deletion failed:", err);
    toast("Could not delete trip: " + (err.message || "Unknown error"));
  }
}

$("refreshTrips")?.addEventListener("click", loadTrips);

/* OTHER WORKSPACE CONTROLS */

/* COORDINATOR MANAGEMENT (admin only) */

async function loadStaff() {
  const box = $("teamContainer");
  if (!box || state.role !== "admin") return;

  box.innerHTML = '<p class="muted tiny">Loading team...</p>';

  const { data, error } = await state.supabase.rpc("rr_list_staff");
  if (error) {
    console.error("Staff load failed:", error);
    box.innerHTML = `<div class="result-box bad">Could not load the team: ${escapeHTML(error.message)}.
      Run the latest rogo-ride-setup.sql in Supabase if this mentions a missing function.</div>`;
    return;
  }

  state.staff = data || [];
  renderStaff();
}

function renderStaff() {
  const box = $("teamContainer");
  if (!box) return;

  if (!state.staff?.length) {
    box.innerHTML = '<div class="empty-state"><h3>No team members</h3><p>Add a coordinator to get started.</p></div>';
    return;
  }

  box.innerHTML = `<div class="panel"><div class="table-wrap"><table>
    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
    <tbody>${state.staff.map((m) => `
      <tr>
        <td>${escapeHTML(m.full_name || "Unnamed")}${m.user_id === state.user?.id ? ' <span class="muted tiny">(you)</span>' : ""}</td>
        <td>${escapeHTML(m.email || "—")}</td>
        <td>${m.role === "admin" ? "Administrator" : "Coordinator"}</td>
        <td><span class="badge ${m.active ? "checked" : "cancelled"}">${m.active ? "Active" : "Deactivated"}</span></td>
        <td class="actions">
          <button class="secondary" type="button" data-edit-staff="${escapeHTML(m.user_id)}">Edit</button>
          <button class="secondary" type="button" data-toggle-staff="${escapeHTML(m.user_id)}">${m.active ? "Deactivate" : "Activate"}</button>
        </td>
      </tr>`).join("")}</tbody></table></div></div>`;

  box.querySelectorAll("[data-edit-staff]").forEach((b) =>
    b.addEventListener("click", () => showStaffForm(state.staff.find((m) => m.user_id === b.dataset.editStaff))));
  box.querySelectorAll("[data-toggle-staff]").forEach((b) =>
    b.addEventListener("click", () => toggleStaff(state.staff.find((m) => m.user_id === b.dataset.toggleStaff))));
}

function showStaffForm(member = null) {
  if (state.role !== "admin") return;
  $("staffForm")?.remove();

  const form = document.createElement("form");
  form.id = "staffForm";
  form.className = "panel detail-panel";
  form.innerHTML = `
    <h3>${member ? "Edit team member" : "Add a coordinator"}</h3>
    <label for="sfName">Full name</label>
    <input id="sfName" required minlength="2" maxlength="120" value="${escapeHTML(member?.full_name || "")}">
    ${member ? `<p class="muted tiny">Email: ${escapeHTML(member.email || "—")}</p>` : `
      <label for="sfEmail">Email address</label>
      <input id="sfEmail" type="email" required autocomplete="off">
      <label for="sfPassword">Temporary password (min. 8 characters)</label>
      <input id="sfPassword" type="text" required minlength="8" autocomplete="off">
      <p class="muted tiny">Give this password to the coordinator privately. They sign in with their email and this password.</p>`}
    <label for="sfRole">Role</label>
    <select id="sfRole">
      <option value="coordinator" ${member?.role !== "admin" ? "selected" : ""}>Coordinator</option>
      <option value="admin" ${member?.role === "admin" ? "selected" : ""}>Administrator</option>
    </select>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;">
      <button class="primary" type="submit">${member ? "Save changes" : "Create account"}</button>
      <button class="secondary" type="button" id="sfCancel">Cancel</button>
    </div>`;

  $("teamContainer").prepend(form);
  $("sfCancel").addEventListener("click", () => form.remove());
  form.scrollIntoView({ behavior: "smooth", block: "start" });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;

    try {
      if (member) {
        const { data, error } = await state.supabase.rpc("rr_update_staff", {
          p_user_id: member.user_id,
          p_full_name: $("sfName").value,
          p_role: $("sfRole").value
        });
        if (error) throw error;
        if (!data.ok) throw new Error(data.message);
        toast("Profile updated.");
      } else {
        const { data, error } = await state.supabase.functions.invoke("create-coordinator", {
          body: {
            full_name: $("sfName").value,
            email: $("sfEmail").value,
            password: $("sfPassword").value,
            role: $("sfRole").value
          }
        });
        if (error) {
          let detail = error.message;
          try { detail = (await error.context.json()).message || detail; } catch { /* keep default */ }
          throw new Error(detail);
        }
        if (!data?.ok) throw new Error(data?.message || "Account was not created.");
        toast("Account created. Share the email and temporary password privately.");
      }

      form.remove();
      loadStaff();
    } catch (err) {
      console.error("Staff save failed:", err);
      toast("Could not save: " + (err.message || "Unknown error"));
      submit.disabled = false;
    }
  });
}

async function toggleStaff(member) {
  if (!member) return;
  const next = !member.active;

  if (!window.confirm(`${next ? "Activate" : "Deactivate"} ${member.full_name || member.email}?` +
      (next ? "" : "\n\nThey will lose access to the app immediately."))) return;

  const { data, error } = await state.supabase.rpc("rr_set_staff_active", {
    p_user_id: member.user_id, p_active: next
  });
  if (error || !data?.ok) {
    toast("Could not update: " + (error?.message || data?.message || "Unknown error"));
    return;
  }
  toast(next ? "Account activated." : "Account deactivated.");
  loadStaff();
}

$("inviteBtn")?.addEventListener("click", () => {
  if (state.role !== "admin") {
    toast("Administrator access is required.");
    return;
  }
  showStaffForm();
});

/* TRIP DETAIL: COORDINATORS, TICKETS, QR */

function qrSvg(text) {
  if (typeof window.qrcode !== "function") return "";
  const qr = window.qrcode(0, "M");
  qr.addData(String(text));
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

function isVoid(t) {
  return Boolean(t.cancelled_at) || ["cancelled", "canceled"].includes(String(t.status || "").toLowerCase());
}

function ticketState(t) {
  if (isVoid(t)) return ["cancelled", "Cancelled"];
  if (t.checked_in_at) return ["checked", "Checked in " + formatDate(t.checked_in_at)];
  return ["pending", "Not checked in"];
}

async function openTripDetail(tripId) {
  const container = $("tripsContainer");
  if (!container || !state.trips.some((t) => t.id === tripId)) return;

  $("tripDetail")?.remove();
  state.detailTripId = tripId;

  const panel = document.createElement("section");
  panel.id = "tripDetail";
  panel.className = "panel detail-panel";
  panel.innerHTML = '<p class="muted">Loading trip details...</p>';
  container.prepend(panel);
  panel.scrollIntoView({ behavior: "smooth", block: "start" });

  await refreshTripDetail();
}

function closeTripDetail() {
  $("tripDetail")?.remove();
  state.detailTripId = null;
}

async function refreshTripDetail() {
  const panel = $("tripDetail");
  const trip = state.trips.find((t) => t.id === state.detailTripId);
  if (!panel || !trip) return;

  try {
    const ticketsReq = state.supabase
      .from("ride_tickets")
      .select("ticket_number, passenger_name, passenger_phone, status, cancelled_at, checked_in_at, created_at")
      .eq("trip_id", trip.id)
      .order("created_at", { ascending: true });

    const [ticketsRes, assignedRes, profilesRes] = await Promise.all([
      ticketsReq,
      state.role === "admin"
        ? state.supabase.from("trip_coordinators").select("coordinator_id").eq("trip_id", trip.id)
        : Promise.resolve({ data: [] }),
      state.role === "admin"
        ? state.supabase.from("coordinator_profiles").select("user_id, full_name, role, active")
        : Promise.resolve({ data: [] })
    ]);

    if (ticketsRes.error) throw ticketsRes.error;
    if (assignedRes.error) throw assignedRes.error;
    if (profilesRes.error) throw profilesRes.error;

    renderTripDetail(panel, trip, ticketsRes.data || [], assignedRes.data || [], profilesRes.data || []);
  } catch (err) {
    console.error("Trip detail failed:", err);
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;">
        <h3>${escapeHTML(trip.route)}</h3>
        <button class="secondary" type="button" id="closeDetail">Close</button>
      </div>
      <div class="result-box bad">Could not load details: ${escapeHTML(err.message || "Unknown error")}.
      If this mentions a missing table or column, run rogo-ride-setup.sql in Supabase.</div>`;
    $("closeDetail")?.addEventListener("click", closeTripDetail);
  }
}

function renderTripDetail(panel, trip, tickets, assigned, profiles) {
  const isAdmin = state.role === "admin";
  const active = tickets.filter((t) => !isVoid(t));
  const checked = active.filter((t) => t.checked_in_at).length;
  const nameOf = new Map(profiles.map((p) => [p.user_id, p.full_name || "Unnamed"]));
  const assignedIds = new Set(assigned.map((a) => a.coordinator_id));
  const candidates = profiles.filter(
    (p) => p.active === true && p.role === "coordinator" && !assignedIds.has(p.user_id)
  );

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;">
      <div>
        <p class="eyebrow">TRIP DETAILS</p>
        <h3>${escapeHTML(trip.route)}</h3>
        <p class="muted tiny">${escapeHTML(formatDate(trip.departure_at))}</p>
      </div>
      <button class="secondary" type="button" id="closeDetail">Close</button>
    </div>

    <div class="mini-stats">
      <div><strong>${active.length}/${escapeHTML(trip.seat_capacity)}</strong><span>Tickets issued</span></div>
      <div><strong>${checked}</strong><span>Checked in</span></div>
      <div><strong>${active.length - checked}</strong><span>Still to board</span></div>
    </div>

    ${isAdmin ? `
      <h4>Coordinators on this trip</h4>
      <div class="chips">
        ${assigned.length ? assigned.map((a) => `
          <span class="chip">${escapeHTML(nameOf.get(a.coordinator_id) || a.coordinator_id)}
            <button type="button" aria-label="Remove" data-unassign="${escapeHTML(a.coordinator_id)}">×</button>
          </span>`).join("") : '<span class="muted tiny">No coordinator assigned yet.</span>'}
      </div>
      <div class="inline-form">
        <select id="assignSelect" ${candidates.length ? "" : "disabled"}>
          ${candidates.length
            ? candidates.map((p) => `<option value="${escapeHTML(p.user_id)}">${escapeHTML(p.full_name || p.user_id)}</option>`).join("")
            : "<option>No unassigned coordinators</option>"}
        </select>
        <button class="primary" type="button" id="assignBtn" ${candidates.length ? "" : "disabled"}>Assign</button>
      </div>

      <h4>Issue a ticket</h4>
      <form id="issueForm" class="inline-form">
        <input id="issueName" placeholder="Passenger name" required maxlength="120">
        <input id="issuePhone" placeholder="Phone (optional)" maxlength="30" inputmode="tel">
        <button class="primary" type="submit">Issue ticket</button>
      </form>

      <details class="import-box">
        <summary>Import existing tickets (e.g. from the Telegram bot)</summary>
        <p class="tiny muted">One per line: <code>ticket_number, name, phone</code>. Numbers already in the system are skipped, nothing is overwritten.</p>
        <textarea id="importText" rows="5" placeholder="TG-1001, Aisha Bello, 08012345678"></textarea>
        <button class="secondary" type="button" id="importBtn">Import to this trip</button>
      </details>` : ""}

    <h4>Passengers</h4>
    ${tickets.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Passenger</th><th>Ticket</th><th>Status</th><th></th></tr></thead>
        <tbody>
        ${tickets.map((t) => {
          const [cls, label] = ticketState(t);
          return `<tr>
            <td>${escapeHTML(t.passenger_name || "—")}<br><span class="muted tiny">${escapeHTML(t.passenger_phone || "")}</span></td>
            <td><code>${escapeHTML(t.ticket_number || "—")}</code></td>
            <td><span class="badge ${cls}">${escapeHTML(label)}</span></td>
            <td class="actions">
              ${t.ticket_number ? `<button class="secondary" type="button" data-qr="${escapeHTML(t.ticket_number)}">QR</button>` : ""}
              ${isAdmin && t.ticket_number && !t.checked_in_at && !isVoid(t)
                ? `<button class="secondary" type="button" data-cancel="${escapeHTML(t.ticket_number)}">Cancel</button>` : ""}
            </td></tr>`;
        }).join("")}
        </tbody></table></div>`
      : '<div class="empty-state"><h3>No passengers yet</h3><p>Tickets issued for this trip will be listed here.</p></div>'}
  `;

  const byNumber = new Map(tickets.map((t) => [t.ticket_number, t]));

  $("closeDetail")?.addEventListener("click", closeTripDetail);

  panel.querySelectorAll("[data-qr]").forEach((b) =>
    b.addEventListener("click", () => showTicketDialog(byNumber.get(b.dataset.qr), trip)));

  panel.querySelectorAll("[data-cancel]").forEach((b) =>
    b.addEventListener("click", () => cancelTicket(b.dataset.cancel)));

  panel.querySelectorAll("[data-unassign]").forEach((b) =>
    b.addEventListener("click", () => unassignCoordinator(trip.id, b.dataset.unassign)));

  $("assignBtn")?.addEventListener("click", () => assignCoordinator(trip.id, $("assignSelect").value));
  $("issueForm")?.addEventListener("submit", (e) => { e.preventDefault(); issueTicket(trip.id); });
  $("importBtn")?.addEventListener("click", () => importTickets(trip.id));
}

async function assignCoordinator(tripId, userId) {
  if (!userId) return;
  const { error } = await state.supabase.from("trip_coordinators")
    .insert({ trip_id: tripId, coordinator_id: userId, assigned_by: state.user.id });
  if (error) { toast("Could not assign: " + error.message); return; }
  toast("Coordinator assigned.");
  refreshTripDetail();
}

async function unassignCoordinator(tripId, userId) {
  if (!window.confirm("Remove this coordinator from the trip?")) return;
  const { error } = await state.supabase.from("trip_coordinators")
    .delete().eq("trip_id", tripId).eq("coordinator_id", userId);
  if (error) { toast("Could not remove: " + error.message); return; }
  toast("Coordinator removed.");
  refreshTripDetail();
}

async function issueTicket(tripId) {
  const name = $("issueName").value.trim();
  const phone = $("issuePhone").value.trim();
  const button = $("issueForm").querySelector('button[type="submit"]');
  button.disabled = true;

  try {
    const { data, error } = await state.supabase.rpc("rr_issue_ticket", {
      p_trip_id: String(tripId), p_name: name, p_phone: phone || null
    });
    if (error) throw error;
    if (!data.ok) throw new Error(data.message);

    toast("Ticket " + data.ticket_number + " issued.");
    await refreshTripDetail();
    const trip = state.trips.find((t) => t.id === tripId);
    showTicketDialog({ ticket_number: data.ticket_number, passenger_name: name }, trip);
  } catch (err) {
    toast("Could not issue ticket: " + (err.message || "Unknown error"));
    button.disabled = false;
  }
}

async function importTickets(tripId) {
  const rows = $("importText").value.split(/\r?\n/).map((line) => {
    const [ticket_number, name, phone] = line.split(",").map((x) => (x || "").trim());
    return { ticket_number, name, phone };
  }).filter((r) => r.ticket_number);

  if (!rows.length) { toast("Paste at least one line first."); return; }

  const { data, error } = await state.supabase.rpc("rr_import_tickets", {
    p_trip_id: String(tripId), p_rows: rows
  });
  if (error || !data?.ok) {
    toast("Import failed: " + (error?.message || data?.message || "Unknown error"));
    return;
  }
  toast(`Imported ${data.added} ticket(s), skipped ${data.skipped} already present.`);
  refreshTripDetail();
}

async function cancelTicket(ticketNumber) {
  if (!window.confirm("Cancel ticket " + ticketNumber + "? This cannot be undone here.")) return;
  const { data, error } = await state.supabase.rpc("rr_cancel_ticket", { p_ticket_number: ticketNumber });
  if (error || !data?.ok) {
    toast("Could not cancel: " + (error?.message || data?.message || "Unknown error"));
    return;
  }
  toast("Ticket cancelled.");
  refreshTripDetail();
}

function showTicketDialog(ticket, trip, opts = {}) {
  if (!ticket) return;
  const dialog = $("ticketDialog");
  if (!dialog) return;

  const svg = qrSvg(ticket.qr_value || ticket.ticket_number);
  const parts = splitRoute(trip?.route);
  $("ticketDialogBody").innerHTML = `
    <div class="pass">
      <div class="pass-top"><span class="pass-brand">ROGO RIDE</span><span class="pass-free">Free ride</span></div>
      ${opts.fresh ? `<div style="text-align:center;padding:14px 18px 0"><span class="pass-state ok">${icon("check", 16)} Seat booked</span></div>` : ""}
      <div class="pass-route">
        <div><small>From</small><strong>${escapeHTML(parts ? parts[0] : (trip?.route || "Route"))}</strong></div>
        <span class="pass-arrow">${icon("arrow", 22)}</span>
        <div><small>To</small><strong>${escapeHTML(parts ? parts[1] : "")}</strong></div>
      </div>
      <div class="pass-meta">
        <div><small>Passenger</small><b>${escapeHTML(ticket.passenger_name || "")}</b></div>
        <div><small>Departs</small><b>${escapeHTML(trip ? formatDate(trip.departure_at) : "")}</b></div>
      </div>
      <div class="pass-perf"></div>
      <div class="pass-qr">
        <div class="qr-box">${svg || '<p class="muted">QR library did not load. Use the ticket number.</p>'}</div>
        <small>Reference number</small>
        <code>${escapeHTML(ticket.ticket_number)}</code>
        <small>Show this code to the coordinator when boarding.</small>
      </div>
    </div>`;

  $("downloadQr").onclick = () => {
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = ticket.ticket_number + ".svg";
    a.click();
    URL.revokeObjectURL(url);
  };
  $("printTicket").onclick = () => {
    const w = window.open("", "_blank");
    if (!w) { toast("Allow pop-ups to print the ticket."); return; }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>ROGO RIDE ticket</title>
      <body style="font-family:system-ui,sans-serif;text-align:center;padding:24px">
      <h2>ROGO RIDE TICKET</h2><div style="width:260px;margin:16px auto">${svg}</div>
      <h3>${escapeHTML(ticket.ticket_number)}</h3><p>${escapeHTML(ticket.passenger_name || "")}</p>
      <p>${escapeHTML(trip?.route || "")}${trip ? " · " + escapeHTML(formatDate(trip.departure_at)) : ""}</p>
      <p><strong>FREE RIDE</strong></p></body>`);
    w.document.close();
    w.focus();
    w.print();
  };
  $("copyTicket").onclick = async () => {
    try { await navigator.clipboard.writeText(ticket.ticket_number); toast("Ticket number copied."); }
    catch { toast("Copy failed. Select the number manually."); }
  };

  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

$("closeTicketDialog")?.addEventListener("click", () => $("ticketDialog").close());

/* TICKET VERIFICATION
   Intentionally disabled until secure server-side validation
   and one-time check-in have been implemented.
*/

async function verifyTicketCode(rawCode) {
  const result = $("scanResult");
  const code = String(rawCode || "").trim();
  if (!result) return;

  if (!code) {
    result.className = "result-box warn";
    result.textContent = "Enter a ticket number or scan a QR code first.";
    return;
  }

  if (state.verifying) return;
  state.verifying = true;

  const button = $("verifyTicket");
  if (button) button.disabled = true;
  result.className = "result-box neutral";
  result.textContent = "Checking ticket...";

  try {
    const { data, error } = await state.supabase.rpc("rr_check_in_ticket", {
      p_ticket_number: code
    });
    if (error) throw error;

    const name = data.passenger_name ? " " + data.passenger_name : "";

    if (data.ok) {
      result.className = "result-box ok";
      result.innerHTML = `<strong>✓ Checked in${escapeHTML(name ? " —" + name : "")}</strong><br>
        Ticket ${escapeHTML(data.ticket_number)}${data.route ? " · " + escapeHTML(data.route) : ""}`;
      if ($("ticketCode")) $("ticketCode").value = "";
      if (state.detailTripId) refreshTripDetail();
    } else {
      result.className = "result-box bad";
      const when = data.checked_in_at ? "<br>First checked in: " + escapeHTML(formatDate(data.checked_in_at)) : "";
      result.innerHTML = `<strong>✕ ${escapeHTML(data.message || "Ticket rejected.")}</strong>${
        data.passenger_name ? "<br>" + escapeHTML(data.passenger_name) : ""}${when}`;
    }
  } catch (err) {
    console.error("Check-in failed:", err);
    result.className = "result-box bad";
    result.textContent = "Could not check in: " + (err.message || "Unknown error") +
      ". If this mentions a missing function, run rogo-ride-setup.sql in Supabase.";
  } finally {
    state.verifying = false;
    if ($("verifyTicket")) $("verifyTicket").disabled = false;
  }
}

$("verifyTicket")?.addEventListener("click", () => verifyTicketCode($("ticketCode")?.value));
$("ticketCode")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") verifyTicketCode(event.target.value);
});

/* CAMERA AND QR CAPTURE */

function setScannerUI(active) {
  $("startScan")?.classList.toggle("hidden", active);
  $("stopScan")?.classList.toggle("hidden", !active);
  $("scanVideo")?.classList.toggle("hidden", !active);
  $("scanPlaceholder")?.classList.toggle("hidden", active);
  const corners = $("scanCorners");
  if (corners) corners.style.display = active ? "block" : "none";
}

function stopScanner() {
  if (state.scanTimer) {
    clearInterval(state.scanTimer);
    state.scanTimer = null;
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  const video = $("scanVideo");
  if (video) video.srcObject = null;

  setScannerUI(false);
}

async function startScanner() {
  if (state.stream) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Camera access is not supported in this browser.");
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });

    const video = $("scanVideo");
    video.srcObject = state.stream;
    await video.play();
    setScannerUI(true);

    if ("BarcodeDetector" in window) {
      state.detector = state.detector || new window.BarcodeDetector({ formats: ["qr_code"] });

      state.scanTimer = setInterval(async () => {
        try {
          const codes = await state.detector.detect(video);
          if (codes.length && codes[0].rawValue) {
            $("ticketCode").value = codes[0].rawValue;
            stopScanner();

            verifyTicketCode(codes[0].rawValue);
          }
        } catch (err) {
          console.warn("QR detection error:", err);
        }
      }, 400);
    } else {
      toast("This browser cannot read QR codes automatically. Type the ticket number instead.");
    }
  } catch (err) {
    console.error("Camera start failed:", err);
    stopScanner();
    toast(
      err.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access and try again."
        : "Could not start the camera: " + (err.message || "Unknown error")
    );
  }
}

$("startScan")?.addEventListener("click", startScanner);
$("stopScan")?.addEventListener("click", stopScanner);

/* PROFILE AND SETTINGS (everyone) */

function myName() {
  return state.me?.display_name || state.name || "Account";
}

function refreshMyAvatar() {
  const person = { name: myName(), avatar_path: state.me?.avatar_path };
  if ($("pAvatarBtn")) $("pAvatarBtn").innerHTML = avatarHTML(person, 38);
  if ($("profileAvatar")) $("profileAvatar").innerHTML = avatarHTML(person, 40);
  if ($("pfAvatar")) $("pfAvatar").innerHTML = avatarHTML(person, 68);
  if (state.role !== "passenger" && $("profileName")) $("profileName").textContent = myName();
}

async function loadMyPerson(defaultName) {
  if (!state.supabase || !state.user) return;
  try {
    await state.supabase.rpc("rr_ensure_person", { p_name: defaultName });
    const { data } = await state.supabase.from("rr_people")
      .select("display_name, avatar_path").eq("user_id", state.user.id).maybeSingle();
    if (data) state.me = data;
  } catch (err) {
    console.warn("Could not load profile:", err);
  }
  refreshMyAvatar();
}

function openProfileDialog(forPasswordReset = false) {
  const dialog = $("profileDialog");
  if (!dialog || !state.user) return;

  const roleLabel = state.role === "admin" ? "Administrator"
    : state.role === "coordinator" ? "Coordinator" : "Passenger";

  $("pfName").textContent = myName();
  $("pfMeta").textContent = (state.user.email || "") + " · " + roleLabel +
    (forPasswordReset ? " · Choose your new password below." : "");
  $("pfNameInput").value = myName();
  $("passwordForm").reset();
  refreshMyAvatar();

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
  if (forPasswordReset) $("pfNew")?.focus();
}

$("profileMenu")?.addEventListener("click", () => openProfileDialog());
$("profileMenu")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProfileDialog(); }
});
$("pAvatarBtn")?.addEventListener("click", () => openProfileDialog());
$("pfClose")?.addEventListener("click", () => $("profileDialog").close());

$("profileForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("pfNameInput").value.trim();
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    const { data, error } = await state.supabase.rpc("rr_save_my_profile", { p_name: name });
    if (error) throw error;
    if (!data.ok) throw new Error(data.message);
    state.me = { ...state.me, display_name: name };
    $("pfName").textContent = name;
    refreshMyAvatar();
    toast("Name saved.");
    if (state.role === "passenger") renderHero();
  } catch (err) {
    toast(err.message || "Could not save your name.");
  } finally {
    button.disabled = false;
  }
});

async function squareJpeg(file, size = 320) {
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { bitmap = await createImageBitmap(file); }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d").drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
}

$("pfPhotoBtn")?.addEventListener("click", () => $("pfPhoto").click());

$("pfPhoto")?.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || !state.user) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast("Choose a JPG, PNG or WebP photo."); return; }

  const button = $("pfPhotoBtn");
  button.disabled = true;
  try {
    const blob = await squareJpeg(file);
    const path = `${state.user.id}/avatar-${Date.now()}.jpg`;
    const up = await state.supabase.storage.from("rr-avatars").upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (up.error) throw new Error("Upload failed: " + up.error.message);

    const old = state.me?.avatar_path;
    const { data, error } = await state.supabase.rpc("rr_save_my_profile", { p_name: myName(), p_avatar_path: path });
    if (error) throw error;
    if (!data.ok) throw new Error(data.message);

    state.me = { ...state.me, avatar_path: path };
    if (old) state.supabase.storage.from("rr-avatars").remove([old]).catch(() => {});
    refreshMyAvatar();
    toast("Photo updated.");
  } catch (err) {
    console.error("Photo failed:", err);
    toast(err.message || "Could not update your photo.");
  } finally {
    button.disabled = false;
  }
});

$("pfRemovePhoto")?.addEventListener("click", async () => {
  if (!state.me?.avatar_path) return;
  const old = state.me.avatar_path;
  const { data, error } = await state.supabase.rpc("rr_save_my_profile", { p_name: myName(), p_clear_avatar: true });
  if (error || !data?.ok) { toast(error?.message || data?.message || "Could not remove the photo."); return; }
  state.me = { ...state.me, avatar_path: null };
  state.supabase.storage.from("rr-avatars").remove([old]).catch(() => {});
  refreshMyAvatar();
  toast("Photo removed.");
});

$("passwordForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const a = $("pfNew").value;
  const b = $("pfNew2").value;

  if (a.length < 8) { toast("Use at least 8 characters."); return; }
  if (a !== b) { toast("The two passwords do not match."); return; }

  const button = event.target.querySelector("button");
  button.disabled = true;

  try {
    const { error } = await state.supabase.auth.updateUser({ password: a });
    if (error) throw error;
    event.target.reset();
    toast("Password changed.");
    $("profileDialog").close();
  } catch (err) {
    toast("Could not change password: " + (err.message || "Unknown error"));
  } finally {
    button.disabled = false;
  }
});

/* PASSENGER AREA */

const CATEGORY_LABELS = {
  student: "Student",
  pregnant: "Pregnant passenger",
  disability: "Person with a disability"
};

const DOCUMENT_HELP = {
  student: "Upload your student ID card or admission letter.",
  pregnant: "Upload your antenatal card or a note from your doctor or clinic.",
  disability: "Upload your disability card or an official or medical letter."
};

const BOOKING_STATUS = {
  pending: ["pending", "Awaiting review"],
  approved: ["checked", "Confirmed"],
  rejected: ["cancelled", "Not approved"],
  cancelled: ["cancelled", "Cancelled"]
};

function enterPassengerApp(user) {
  state.user = user;
  state.role = "passenger";
  state.name = user.user_metadata?.full_name || user.email || "Passenger";
  state.verification = null;

  hideAllShells();
  $("passengerShell")?.classList.remove("hidden");
  refreshMyAvatar();
  renderHero();

  loadMyPerson(state.name).then(renderHero);
  showPassengerTab("trips");
  loadMyBookings();
}

function showPassengerTab(tab) {
  ["trips", "tickets", "community", "reviews"].forEach((t) => {
    const id = { trips: "pTrips", tickets: "pTickets", community: "pCommunity", reviews: "pReviews" }[t];
    $(id)?.classList.toggle("hidden", t !== tab);
  });
  document.querySelectorAll("[data-ptab]").forEach((b) => b.classList.toggle("active", b.dataset.ptab === tab));
  window.scrollTo({ top: 0 });

  if (tab === "community") startCommunity("pc"); else stopCommunity();
  if (tab === "trips") { loadVerification().then(loadOpenTrips); }
  if (tab === "tickets") loadMyBookings();
  if (tab === "reviews") loadVerification().then(() => loadReviews("pr"));
}

document.querySelectorAll("[data-ptab]").forEach((b) =>
  b.addEventListener("click", () => showPassengerTab(b.dataset.ptab)));
$("pRefreshTrips")?.addEventListener("click", () => loadVerification().then(loadOpenTrips));
$("pRefreshBookings")?.addEventListener("click", loadMyBookings);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.role === "passenger" && state.user && state.verification?.status === "pending") {
    loadVerification().then(loadOpenTrips);
  }
});

async function loadVerification() {
  if (!state.supabase || state.role !== "passenger") return;
  const { data, error } = await state.supabase.rpc("rr_my_verification");
  if (error) { console.error("Verification load failed:", error); }
  else state.verification = (data && data[0]) || null;
  renderHero();
}

function renderHero() {
  const box = $("pHero");
  if (!box || state.role !== "passenger") return;
  const v = state.verification;
  const first = (myName() || "").split(/\s+/)[0] || "there";
  let html;

  if (v?.status === "verified") {
    html = `<div class="hero"><div class="state ok">${icon("shield", 16)} Verified ${escapeHTML((CATEGORY_LABELS[v.category] || "").toLowerCase())}</div>
      <h1>Hi ${escapeHTML(first)}, where to today?</h1>
      <p>Pick a trip below and confirm. Your ticket appears the moment you do.</p></div>`;
  } else if (v?.status === "pending") {
    html = `<div class="hero warn"><div class="state">${icon("clock", 16)} Under review</div>
      <h1>We're checking your document</h1>
      <p>An administrator will approve it soon. You can browse trips while you wait, and booking opens as soon as you're verified.</p></div>`;
  } else if (v?.status === "rejected") {
    html = `<div class="hero bad"><div class="state">${icon("x", 16)} Not approved</div>
      <h1>Your document needs another look</h1>
      <p>${v.review_note ? "Reason: " + escapeHTML(v.review_note) : "The administrator could not approve this document."}</p>
      <button id="heroVerifyBtn" class="sun" type="button">Upload again</button></div>`;
  } else {
    html = `<div class="hero"><h1>Hi ${escapeHTML(first)}, verify once and ride free</h1>
      <p>Upload your student ID, antenatal card or disability document. You do this one time only. After approval you can book any open trip in a tap.</p>
      <button id="heroVerifyBtn" class="sun" type="button">Verify my account</button></div>`;
  }

  box.innerHTML = html;
  $("heroVerifyBtn")?.addEventListener("click", openVerifyDialog);
}

async function loadOpenTrips() {
  const box = $("pTripsList");
  if (!box || !state.supabase) return;

  const { data, error } = await state.supabase.rpc("rr_open_trips");
  if (error) {
    console.error("Open trips failed:", error);
    box.innerHTML = `<div class="result-box bad">Could not load trips: ${escapeHTML(error.message)}</div>`;
    return;
  }

  state.openTrips = data || [];

  if (!state.openTrips.length) {
    box.innerHTML = '<div class="empty-state"><h3>No trips are open right now</h3><p>New trips show up here as soon as they are scheduled. Check back soon.</p></div>';
    return;
  }

  const vStatus = state.verification?.status;

  box.innerHTML = state.openTrips.map((t) => {
    const left = t.seats_left;
    const pct = Math.max(4, Math.round((left / Math.max(t.seat_capacity, 1)) * 100));
    let cta;
    if (left <= 0) cta = '<button class="secondary" type="button" disabled>Trip is full</button>';
    else if (vStatus === "verified") cta = `<button class="sun" type="button" data-book-trip="${escapeHTML(t.id)}">Book this seat</button>`;
    else if (vStatus === "pending") cta = '<button class="secondary" type="button" disabled>Waiting for approval</button>';
    else cta = '<button class="secondary" type="button" data-need-verify="1">Verify to book</button>';

    return `<article class="ride-card">
      <div class="ride-top">${routeHTML(t.route)}<span class="trip-status">Free</span></div>
      <div class="ride-meta">
        <div><small>Departs</small><b>${escapeHTML(formatDate(t.departure_at))}</b></div>
        <div style="flex:1;min-width:150px"><small>${left > 0 ? left + " of " + t.seat_capacity + " seats left" : "No seats left"}</small>
          <div class="meter ${left <= 3 ? "low" : ""}"><i style="width:${pct}%"></i></div></div>
      </div>
      <div class="ride-actions">${cta}</div>
    </article>`;
  }).join("");

  box.querySelectorAll("[data-book-trip]").forEach((b) =>
    b.addEventListener("click", () => openConfirmDialog(b.dataset.bookTrip)));
  box.querySelectorAll("[data-need-verify]").forEach((b) =>
    b.addEventListener("click", openVerifyDialog));
}

/* One-time verification */

function updateVerifyFormForCategory() {
  const cat = $("vfCategory").value;
  $("vfInstitutionWrap").classList.toggle("hidden", cat !== "student");
  $("vfInstitution").required = cat === "student";
  $("vfHelp").textContent = (DOCUMENT_HELP[cat] || "Choose who you are first.") +
    " Only you and ROGO RIDE administrators can see it.";
}

function openVerifyDialog() {
  const dialog = $("verifyDialog");
  if (!dialog) return;
  const v = state.verification;

  $("vfForm").reset();
  $("vfFileName").textContent = "Choose a photo or PDF";
  if (v) {
    $("vfCategory").value = v.category || "";
    $("vfName").value = v.full_name || "";
    $("vfPhone").value = v.phone || "";
    $("vfInstitution").value = v.institution || "";
  } else {
    $("vfName").value = state.name && !state.name.includes("@") ? state.name : "";
  }
  updateVerifyFormForCategory();

  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

$("vfCategory")?.addEventListener("change", updateVerifyFormForCategory);
$("vfCancel")?.addEventListener("click", () => $("verifyDialog").close());
$("vfDocument")?.addEventListener("change", (e) => {
  $("vfFileName").textContent = e.target.files[0]?.name || "Choose a photo or PDF";
});

$("vfForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.user) return;

  const file = $("vfDocument").files[0];
  const allowed = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };

  if (!file) { toast("Upload your document."); return; }
  if (!allowed[file.type]) { toast("The document must be a JPG, PNG or PDF."); return; }
  if (file.size > 5 * 1024 * 1024) { toast("The document is larger than 5 MB."); return; }

  const button = $("vfSubmit");
  button.disabled = true;
  button.textContent = "Submitting...";

  try {
    const rand = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    const path = `${state.user.id}/verify-${rand}.${allowed[file.type]}`;

    const up = await state.supabase.storage.from("rr-documents")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) throw new Error("Upload failed: " + up.error.message);

    const { data, error } = await state.supabase.rpc("rr_submit_verification", {
      p_full_name: $("vfName").value,
      p_phone: $("vfPhone").value,
      p_institution: $("vfInstitution").value || null,
      p_category: $("vfCategory").value,
      p_document_path: path
    });
    if (error) throw error;
    if (!data.ok) throw new Error(data.message);

    $("verifyDialog").close();
    toast("Submitted. An administrator will review it soon.");
    await loadVerification();
    loadOpenTrips();
  } catch (err) {
    console.error("Verification failed:", err);
    toast(err.message || "Could not submit your document.");
  } finally {
    button.disabled = false;
    button.textContent = "Submit for review";
  }
});

/* Instant booking */

function openConfirmDialog(tripId) {
  const trip = state.openTrips.find((t) => t.id === tripId);
  const dialog = $("confirmDialog");
  if (!trip || !dialog) return;

  state.bookingTrip = trip;
  const p = splitRoute(trip.route);
  $("cbTitle").textContent = p ? `${p[0]} to ${p[1]}` : trip.route;
  $("cbWhen").textContent = "Departs " + formatDate(trip.departure_at);

  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

$("cbCancel")?.addEventListener("click", () => $("confirmDialog").close());

$("cbSubmit")?.addEventListener("click", async () => {
  const trip = state.bookingTrip;
  if (!trip) return;

  const button = $("cbSubmit");
  button.disabled = true;
  button.textContent = "Booking...";

  try {
    const { data, error } = await state.supabase.rpc("rr_create_booking", { p_trip_id: trip.id });
    if (error) throw error;

    if (!data.ok) {
      $("confirmDialog").close();
      toast(data.message || "Could not book this trip.");
      if (data.code === "not_verified") await loadVerification();
      loadOpenTrips();
      return;
    }

    $("confirmDialog").close();
    showTicketDialog(
      { ticket_number: data.ticket_number, qr_value: data.qr_value, passenger_name: data.passenger_name },
      { route: data.route, departure_at: data.departure_at },
      { fresh: true }
    );
    toast("Seat booked. Your ticket is ready.");
    loadOpenTrips();
    loadMyBookings();
  } catch (err) {
    console.error("Booking failed:", err);
    toast(err.message || "Could not book this trip.");
  } finally {
    button.disabled = false;
    button.textContent = "Confirm booking";
  }
});

async function loadMyBookings() {
  const box = $("pBookingsList");
  if (!box || !state.supabase) return;

  const { data, error } = await state.supabase.rpc("rr_my_bookings");
  if (error) {
    console.error("My bookings failed:", error);
    box.innerHTML = `<div class="result-box bad">Could not load your tickets: ${escapeHTML(error.message)}</div>`;
    return;
  }

  state.myBookings = data || [];

  if (!state.myBookings.length) {
    box.innerHTML = '<div class="empty-state"><h3>No tickets yet</h3><p>Book a seat under Trips and your ticket will be saved here.</p></div>';
    return;
  }

  box.innerHTML = state.myBookings.map((b) => {
    const [cls, label] = BOOKING_STATUS[b.status] || ["pending", b.status];
    const canCancel = ["pending", "approved"].includes(b.status) && !b.checked_in_at;
    return `<article class="ride-card">
      <div class="ride-top">${routeHTML(b.route)}
        <span class="badge ${cls}">${escapeHTML(b.checked_in_at ? "Checked in" : label)}</span></div>
      <div class="ride-meta">
        <div><small>Departs</small><b>${escapeHTML(formatDate(b.departure_at))}</b></div>
        ${b.ticket_number ? `<div><small>Ticket</small><b><code>${escapeHTML(b.ticket_number)}</code></b></div>` : ""}
      </div>
      ${b.review_note && b.status === "rejected" ? `<p class="tiny muted" style="margin-top:10px">Note: ${escapeHTML(b.review_note)}</p>` : ""}
      <div class="ride-actions">
        ${b.status === "approved" ? `<button class="primary" type="button" data-view-ticket="${escapeHTML(b.id)}">${icon("ticket", 18)} Show ticket</button>` : ""}
        ${canCancel ? `<button class="secondary" type="button" data-cancel-booking="${escapeHTML(b.id)}">Cancel seat</button>` : ""}
      </div>
    </article>`;
  }).join("");

  box.querySelectorAll("[data-view-ticket]").forEach((b) =>
    b.addEventListener("click", () => viewMyTicket(b.dataset.viewTicket)));
  box.querySelectorAll("[data-cancel-booking]").forEach((b) =>
    b.addEventListener("click", () => cancelMyBooking(b.dataset.cancelBooking)));
}

async function viewMyTicket(bookingId) {
  const { data, error } = await state.supabase.rpc("rr_my_ticket", { p_booking_id: bookingId });
  if (error || !data?.ok) {
    toast(error?.message || data?.message || "Could not open the ticket.");
    return;
  }
  showTicketDialog(
    { ticket_number: data.ticket_number, qr_value: data.qr_value, passenger_name: data.passenger_name },
    { route: data.route, departure_at: data.departure_at }
  );
}

async function cancelMyBooking(bookingId) {
  if (!window.confirm("Cancel this seat? It will be released for other riders.")) return;
  const { data, error } = await state.supabase.rpc("rr_cancel_booking", { p_booking_id: bookingId });
  if (error || !data?.ok) {
    toast(error?.message || data?.message || "Could not cancel the seat.");
    return;
  }
  toast("Seat cancelled.");
  loadMyBookings();
  loadOpenTrips();
}

/* VERIFICATIONS (admin) */

async function loadPendingCount() {
  if (state.role !== "admin" || !state.supabase) return;
  const { data, error } = await state.supabase.rpc("rr_list_verifications", { p_status: "pending" });
  const n = error ? null : (data || []).length;
  if ($("statPending")) $("statPending").textContent = n === null ? "–" : String(n);
  const badge = $("navPending");
  if (badge) {
    badge.textContent = n ? String(n) : "";
    badge.classList.toggle("hidden", !n);
  }
}

async function loadVerifications() {
  const box = $("verifContainer");
  if (!box || state.role !== "admin") return;
  box.innerHTML = '<p class="muted tiny">Loading...</p>';

  const status = $("verifFilter")?.value || null;
  const { data, error } = await state.supabase.rpc("rr_list_verifications", { p_status: status });

  if (error) {
    console.error("Verifications failed:", error);
    box.innerHTML = `<div class="result-box bad">Could not load verifications: ${escapeHTML(error.message)}.
      Run the latest rogo-ride-setup SQL (part 4) in Supabase if this mentions a missing function.</div>`;
    return;
  }

  const rows = data || [];
  if (status === "pending" && $("statPending")) $("statPending").textContent = String(rows.length);

  if (!rows.length) {
    box.innerHTML = '<div class="empty-state"><h3>Nothing here</h3><p>When passengers upload their ID, they will appear in this list.</p></div>';
    return;
  }

  const LABEL = { pending: ["pending", "Waiting"], verified: ["checked", "Verified"], rejected: ["cancelled", "Declined"] };

  box.innerHTML = rows.map((v) => {
    const [cls, label] = LABEL[v.status] || ["pending", v.status];
    return `<article class="vf-card">
      <div class="vf-head">
        <div style="display:flex;align-items:center;gap:12px">
          ${avatarHTML({ name: v.full_name }, 44)}
          <div><h3>${escapeHTML(v.full_name)}</h3><span class="muted tiny">${escapeHTML(CATEGORY_LABELS[v.category] || v.category)}</span></div>
        </div>
        <span class="badge ${cls}">${label}</span>
      </div>
      <div class="vf-grid">
        <div><small>Phone</small><b>${escapeHTML(v.phone)}</b></div>
        <div><small>Email</small><b>${escapeHTML(v.email || "–")}</b></div>
        ${v.institution ? `<div><small>Institution</small><b>${escapeHTML(v.institution)}</b></div>` : ""}
        <div><small>Submitted</small><b>${escapeHTML(formatDate(v.submitted_at))}</b></div>
      </div>
      ${v.review_note ? `<p class="tiny muted">Note: ${escapeHTML(v.review_note)}</p>` : ""}
      <div class="ride-actions">
        <button class="secondary" type="button" data-doc="${escapeHTML(v.document_path)}">${icon("file", 18)} View document</button>
        ${v.status !== "verified" ? `<button class="primary" type="button" data-approve="${escapeHTML(v.user_id)}">${icon("check", 18)} Verify</button>` : ""}
        ${v.status !== "rejected" ? `<button class="secondary" type="button" data-reject="${escapeHTML(v.user_id)}">Decline</button>` : ""}
      </div>
    </article>`;
  }).join("");

  box.querySelectorAll("[data-doc]").forEach((b) =>
    b.addEventListener("click", () => openDocument(b.dataset.doc)));
  box.querySelectorAll("[data-approve]").forEach((b) =>
    b.addEventListener("click", () => reviewVerification(b.dataset.approve, true)));
  box.querySelectorAll("[data-reject]").forEach((b) =>
    b.addEventListener("click", () => reviewVerification(b.dataset.reject, false)));
}

async function openDocument(path) {
  const tab = window.open("", "_blank");
  const { data, error } = await state.supabase.storage.from("rr-documents").createSignedUrl(path, 120);
  if (error || !data?.signedUrl) {
    tab?.close();
    toast("Could not open the document: " + (error?.message || "Unknown error"));
    return;
  }
  if (tab) tab.location.href = data.signedUrl;
  else toast("Allow pop-ups to view the document.");
}

async function reviewVerification(userId, approve) {
  let note = null;
  if (!approve) {
    note = window.prompt("Why is this document declined? The passenger will see your reason.", "");
    if (note === null) return;
  } else if (!window.confirm("Verify this passenger? They will be able to book seats without checking again.")) {
    return;
  }

  const { data, error } = await state.supabase.rpc("rr_review_verification", {
    p_user_id: userId, p_approve: approve, p_note: note
  });
  if (error || !data?.ok) {
    toast(error?.message || data?.message || "Could not update the verification.");
    return;
  }
  toast(approve ? "Passenger verified." : "Verification declined.");
  loadVerifications();
  loadPendingCount();
}

$("refreshVerifs")?.addEventListener("click", loadVerifications);
$("verifFilter")?.addEventListener("change", loadVerifications);

/* CHAT: shared message renderer (WhatsApp-style bubbles) */

function renderThread(box, rows, opts = {}) {
  if (!box) return;
  const me = state.user?.id;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
  let html = "";
  let lastDay = "";
  let prev = null;

  rows.forEach((m) => {
    const d = new Date(m.created_at);
    if (d.toDateString() !== lastDay) {
      html += `<div class="day-chip">${escapeHTML(dayLabel(d))}</div>`;
      lastDay = d.toDateString();
      prev = null;
    }

    const mine = m.sender_id === me;
    const first = !prev || prev.sender_id !== m.sender_id || (d - new Date(prev.created_at)) > 5 * 60000;
    prev = m;

    const person = { name: m.name, avatar_path: m.avatar_path };
    const avatar = mine ? "" : (first ? avatarHTML(person, 32) : '<span class="av ghost-av" style="--s:32px"></span>');
    const who = (!mine && first && opts.showNames) ? `<div class="who" style="color:hsl(${nameHue(m.name)} 55% 30%)">
        <span>${escapeHTML(m.name)}</span>
        ${m.badge ? `<span class="tag ${m.badge === "Admin" ? "admin" : ""}">${escapeHTML(m.badge)}</span>` : ""}
        ${m.verified && !m.badge ? `<span class="tick" title="Verified rider">${icon("shield", 13)}</span>` : ""}
      </div>` : "";
    const del = opts.canDelete?.(m)
      ? `<button class="msg-del" type="button" data-del="${escapeHTML(m.id)}" aria-label="Delete message">${icon("trash", 13)}</button>` : "";

    html += `<div class="msg-row ${mine ? "mine" : "theirs"} ${first ? "first" : ""}">
      ${avatar}
      <div class="bubble">${del}${who}<p>${escapeHTML(m.body)}</p><span class="time">${escapeHTML(clockTime(d))}</span></div>
    </div>`;
  });

  box.innerHTML = rows.length ? html
    : '<p class="muted tiny" style="text-align:center;padding:30px 16px">No messages yet. Say hello and start the conversation.</p>';

  if (opts.onDelete) {
    box.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", () => opts.onDelete(b.dataset.del)));
  }
  if (nearBottom) box.scrollTop = box.scrollHeight;
}

/* COMMUNITY CHAT (everyone) */

const community = { timer: null, prefix: null, sig: "", loading: false };

function startCommunity(prefix) {
  stopCommunity();
  community.prefix = prefix;
  community.sig = "";
  $(prefix + "Messages").innerHTML = '<p class="muted tiny" style="text-align:center;padding:30px">Loading...</p>';
  loadCommunity();
  community.timer = setInterval(() => { if (!document.hidden) loadCommunity(); }, 4000);
}

function stopCommunity() {
  if (community.timer) clearInterval(community.timer);
  community.timer = null;
  community.prefix = null;
}

async function loadCommunity(force = false) {
  const prefix = community.prefix;
  if (!prefix || community.loading || !state.user) return;
  community.loading = true;

  try {
    const { data, error } = await state.supabase.rpc("rr_community_feed", { p_limit: 150 });
    if (error) throw error;
    if (prefix !== community.prefix) return;

    const rows = (data || []).map((m) => ({
      id: m.id, sender_id: m.sender_id, name: m.display_name, avatar_path: m.avatar_path,
      badge: m.badge, verified: m.verified, body: m.body, created_at: m.created_at
    }));
    const sig = rows.length + ":" + (rows.length ? rows[rows.length - 1].id : 0);
    if (sig === community.sig && !force) return;
    community.sig = sig;

    renderThread($(prefix + "Messages"), rows, {
      showNames: true,
      canDelete: (m) => m.sender_id === state.user.id || state.role === "admin",
      onDelete: deleteCommunityMessage
    });
  } catch (err) {
    console.error("Community load failed:", err);
    if (!community.sig) {
      $(prefix + "Messages").innerHTML = `<div class="result-box bad" style="margin:14px">Could not load the community: ${escapeHTML(err.message || "Unknown error")}.
        Run the latest SQL (part 4) in Supabase.</div>`;
    }
  } finally {
    community.loading = false;
  }
}

async function deleteCommunityMessage(id) {
  if (!window.confirm("Delete this message?")) return;
  const { data, error } = await state.supabase.rpc("rr_delete_community_message", { p_id: Number(id) });
  if (error || !data?.ok) { toast(error?.message || data?.message || "Could not delete the message."); return; }
  loadCommunity(true);
}

function wireCommunityForm(prefix) {
  $(prefix + "Form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $(prefix + "Input");
    const body = input.value.trim();
    if (!body || !state.user) return;

    const button = event.target.querySelector("button");
    button.disabled = true;
    try {
      const { data, error } = await state.supabase.rpc("rr_post_community", { p_body: body });
      if (error) throw error;
      if (!data.ok) throw new Error(data.message);
      input.value = "";
      community.sig = "";
      await loadCommunity(true);
      const box = $(prefix + "Messages");
      box.scrollTop = box.scrollHeight;
    } catch (err) {
      toast(err.message || "Message not sent.");
    } finally {
      button.disabled = false;
      input.focus();
    }
  });
}
wireCommunityForm("pc");
wireCommunityForm("sc");

/* STAFF TEAM CHAT (admins and coordinators) */

function stopChatPolling() {
  if (state.chat?.timer) clearInterval(state.chat.timer);
  if (state.chat) state.chat.timer = null;
  stopCommunity();
}

function showChatTab(tab) {
  state.chatTab = tab;
  document.querySelectorAll("[data-chattab]").forEach((b) => b.classList.toggle("active", b.dataset.chattab === tab));
  $("teamChatPane")?.classList.toggle("hidden", tab !== "team");
  $("communityPane")?.classList.toggle("hidden", tab !== "community");
  stopChatPolling();
  if (tab === "community") startCommunity("sc"); else initChat();
}

document.querySelectorAll("[data-chattab]").forEach((b) =>
  b.addEventListener("click", () => showChatTab(b.dataset.chattab)));

async function initChat() {
  if (state.chat.timer) clearInterval(state.chat.timer);

  if (!state.team.length) {
    const { data, error } = await state.supabase.rpc("rr_list_team");
    if (error) {
      $("chatMessages").innerHTML = `<div class="result-box bad" style="margin:14px">Could not load the team: ${escapeHTML(error.message)}.
        Run the latest SQL in Supabase.</div>`;
      return;
    }
    state.team = data || [];
  }

  renderChatList();
  await selectConversation(state.chat.peer);

  state.chat.timer = setInterval(() => {
    if (state.currentView === "chats" && state.chatTab === "team" && !document.hidden) loadMessages();
  }, 4000);
}

function renderChatList() {
  const box = $("chatList");
  if (!box) return;

  const others = state.team.filter((m) => m.user_id !== state.user?.id);

  box.innerHTML = `
    <button type="button" class="chat-item ${state.chat.peer === null ? "active" : ""}" data-peer="">
      <span class="av" style="--s:42px;--h:150;background:var(--forest);color:var(--sun)">${icon("users", 20)}</span>
      <span><strong>Team channel</strong><small>Everyone on the team</small></span>
    </button>
    ${others.map((m) => `
    <button type="button" class="chat-item ${state.chat.peer === m.user_id ? "active" : ""}" data-peer="${escapeHTML(m.user_id)}">
      ${avatarHTML({ name: m.full_name, avatar_path: m.avatar_path }, 42)}
      <span><strong>${escapeHTML(m.full_name || "Unnamed")}</strong><small>${m.role === "admin" ? "Administrator" : "Coordinator"}</small></span>
    </button>`).join("")}`;

  box.querySelectorAll("[data-peer]").forEach((b) =>
    b.addEventListener("click", async () => {
      await selectConversation(b.dataset.peer || null);
      renderChatList();
    }));
}

async function selectConversation(peerId) {
  state.chat.peer = peerId;
  state.chat.sig = "";
  const who = peerId ? state.team.find((m) => m.user_id === peerId) : null;
  $("chatHeader").textContent = peerId ? (who?.full_name || "Private message") : "Team channel";
  $("chatMessages").innerHTML = '<p class="muted tiny" style="text-align:center;padding:30px">Loading messages...</p>';
  await loadMessages();
}

async function loadMessages() {
  if (state.chat.loading || !state.user) return;
  state.chat.loading = true;

  try {
    const me = state.user.id;
    const peer = state.chat.peer;

    let query = state.supabase
      .from("rr_messages")
      .select("id, sender_id, recipient_id, body, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    query = peer
      ? query.or(`and(sender_id.eq.${me},recipient_id.eq.${peer}),and(sender_id.eq.${peer},recipient_id.eq.${me})`)
      : query.is("recipient_id", null);

    const { data, error } = await query;
    if (error) throw error;

    if (peer !== state.chat.peer) return;

    const rows = (data || []).slice().reverse();
    const sig = rows.length + ":" + (rows.length ? rows[rows.length - 1].id : 0);
    if (sig === state.chat.sig) return;
    state.chat.sig = sig;

    const byId = new Map(state.team.map((m) => [m.user_id, m]));
    renderThread($("chatMessages"), rows.map((m) => {
      const p = byId.get(m.sender_id);
      return {
        id: m.id, sender_id: m.sender_id, name: p?.full_name || "Team member", avatar_path: p?.avatar_path,
        badge: p?.role === "admin" ? "Admin" : null, verified: false, body: m.body, created_at: m.created_at
      };
    }), { showNames: peer === null });
  } catch (err) {
    console.error("Chat load failed:", err);
    if (!state.chat.sig) {
      $("chatMessages").innerHTML = `<div class="result-box bad" style="margin:14px">Could not load messages: ${escapeHTML(err.message || "Unknown error")}</div>`;
    }
  } finally {
    state.chat.loading = false;
  }
}

$("chatForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("chatInput");
  const body = input.value.trim();
  if (!body || !state.user) return;

  const button = event.target.querySelector("button");
  button.disabled = true;

  try {
    const { error } = await state.supabase.from("rr_messages").insert({
      sender_id: state.user.id,
      recipient_id: state.chat.peer,
      body
    });
    if (error) throw error;
    input.value = "";
    state.chat.sig = "";
    await loadMessages();
    const box = $("chatMessages");
    box.scrollTop = box.scrollHeight;
  } catch (err) {
    console.error("Send failed:", err);
    toast("Message not sent: " + (err.message || "Unknown error"));
  } finally {
    button.disabled = false;
    input.focus();
  }
});

/* REVIEWS */

const reviewDraft = { rating: 0, kind: "experience" };

async function loadReviews(prefix) {
  const summaryBox = $(prefix + "Summary");
  const listBox = $(prefix + "List");
  if (!summaryBox || !listBox || !state.supabase) return;

  const [sumRes, listRes] = await Promise.all([
    state.supabase.rpc("rr_review_summary"),
    state.supabase.rpc("rr_list_reviews", { p_limit: 100 })
  ]);

  if (listRes.error || sumRes.error) {
    const msg = (listRes.error || sumRes.error).message;
    listBox.innerHTML = `<div class="result-box bad">Could not load reviews: ${escapeHTML(msg)}. Run the latest SQL (part 4) in Supabase.</div>`;
    return;
  }

  const s = sumRes.data || { total: 0, average: 0, counts: {} };
  summaryBox.innerHTML = s.total ? `
    <div class="rv-summary">
      <div class="rv-score"><strong>${Number(s.average).toFixed(1)}</strong>${starsHTML(s.average, 16)}<small>${s.total} review${s.total === 1 ? "" : "s"}</small></div>
      <div class="rv-bars">${[5, 4, 3, 2, 1].map((n) => {
        const c = Number(s.counts?.[n] || 0);
        return `<div class="rv-bar"><span>${n}</span><span class="track"><i style="width:${Math.round((c / s.total) * 100)}%"></i></span><span>${c}</span></div>`;
      }).join("")}</div>
    </div>` : "";

  if (prefix === "pr") renderReviewCompose();

  const rows = listRes.data || [];
  listBox.innerHTML = rows.length ? rows.map((r) => `
    <article class="rv-card">
      <div class="rv-head">
        ${avatarHTML({ name: r.display_name, avatar_path: r.avatar_path }, 42)}
        <div class="grow">
          <strong>${escapeHTML(r.display_name)} ${r.verified ? `<span class="tick" style="color:var(--leaf);display:inline-flex" title="Verified rider">${icon("shield", 14)}</span>` : ""}</strong>
          <small>${escapeHTML(formatDate(r.created_at))}</small>
        </div>
        ${starsHTML(r.rating, 15)}
      </div>
      <p class="rv-body"><span class="rv-kind ${r.kind}" style="margin:0 6px 0 0">${r.kind === "expectation" ? "What I expect" : "My experience"}</span>${escapeHTML(r.body)}</p>
      ${(r.mine || state.role === "admin") ? `<div class="ride-actions" style="margin-top:10px"><button class="ghost sm" type="button" data-del-review="${escapeHTML(r.id)}">${icon("trash", 16)} Delete</button></div>` : ""}
    </article>`).join("")
    : '<div class="empty-state"><h3>No reviews yet</h3><p>Verified riders can share how their trips went and what they would like to see next.</p></div>';

  listBox.querySelectorAll("[data-del-review]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!window.confirm("Delete this review?")) return;
      const { data, error } = await state.supabase.rpc("rr_delete_review", { p_id: Number(b.dataset.delReview) });
      if (error || !data?.ok) { toast(error?.message || data?.message || "Could not delete."); return; }
      loadReviews(prefix);
    }));
}

function renderReviewCompose() {
  const box = $("prCompose");
  if (!box) return;

  if (state.verification?.status !== "verified") {
    box.innerHTML = `<div class="rv-compose"><h3>Share your experience</h3>
      <p class="muted" style="font-size:14px">Reviews come from verified riders, so everyone can trust them. Verify your account to write one.</p>
      ${state.verification?.status === "pending" ? '<p class="tiny muted">Your document is being reviewed.</p>'
        : '<button id="rvVerifyBtn" class="secondary sm" type="button">Verify my account</button>'}</div>`;
    $("rvVerifyBtn")?.addEventListener("click", openVerifyDialog);
    return;
  }

  if ($("rvBody")) return;   // keep what the person is typing

  box.innerHTML = `<form id="rvForm" class="rv-compose">
    <h3>Share your experience</h3>
    <p class="muted tiny">Tell other riders and the ROGO RIDE team how it went, or what you would like next.</p>
    <div class="star-pick" id="rvStars" role="radiogroup" aria-label="Rating">
      ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n} star${n === 1 ? "" : "s"}">${icon("star", 30)}</button>`).join("")}
    </div>
    <div class="kind-pick">
      <button type="button" data-kind="experience" class="on">My experience</button>
      <button type="button" data-kind="expectation">What I expect</button>
    </div>
    <textarea id="rvBody" maxlength="1000" required minlength="5" placeholder="Write your review"></textarea>
    <button id="rvSubmit" class="primary" type="submit" style="margin-top:10px">Post review</button>
  </form>`;

  reviewDraft.rating = 0;
  reviewDraft.kind = "experience";

  box.querySelectorAll("[data-star]").forEach((b) => b.addEventListener("click", () => {
    reviewDraft.rating = Number(b.dataset.star);
    box.querySelectorAll("[data-star]").forEach((x) => x.classList.toggle("on", Number(x.dataset.star) <= reviewDraft.rating));
  }));
  box.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => {
    reviewDraft.kind = b.dataset.kind;
    box.querySelectorAll("[data-kind]").forEach((x) => x.classList.toggle("on", x === b));
  }));

  $("rvForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!reviewDraft.rating) { toast("Tap a star to rate your ride."); return; }

    const button = $("rvSubmit");
    button.disabled = true;
    try {
      const { data, error } = await state.supabase.rpc("rr_post_review", {
        p_rating: reviewDraft.rating, p_kind: reviewDraft.kind, p_body: $("rvBody").value
      });
      if (error) throw error;
      if (!data.ok) throw new Error(data.message);
      toast("Thanks for sharing.");
      box.innerHTML = "";
      loadReviews("pr");
    } catch (err) {
      toast(err.message || "Could not post your review.");
    } finally {
      button.disabled = false;
    }
  });
}

/* START */

decorateIcons();
initializeApp();
