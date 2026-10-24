
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
  recovery: false
};

const titles = {
  dashboard: ["OPERATIONS OVERVIEW", "Dashboard"],
  trips: ["TRIP MANAGEMENT", "My trips"],
  scanner: ["PASSENGER CHECK-IN", "QR scanner"],
  chats: ["TEAM COMMUNICATIONS", "Team chats"],
  bookings: ["PASSENGER REQUESTS", "Booking requests"],
  team: ["ACCESS MANAGEMENT", "Manage team"]
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

  if ($("profileName")) {
    $("profileName").textContent = state.name;
    const initials = state.name
      .split(/\s+/)
      .map((part) => part[0] || "")
      .join("")
      .slice(0, 2)
      .toUpperCase();

    if ($("profileAvatar")) $("profileAvatar").textContent = initials || "RR";
  }

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
  if ((view === "team" || view === "bookings") && state.role !== "admin") {
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
  if (view === "bookings" && state.user) loadBookings();
  if (view === "chats" && state.user) initChat(); else stopChatPolling();
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
    <article class="panel trip-card"
      style="margin-bottom:16px;padding:20px;">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <p class="eyebrow">ROGO RIDE TRIP</p>
          <h3>${escapeHTML(trip.route || "Route not specified")}</h3>
        </div>
        <span class="trip-status">${escapeHTML(
          String(trip.status || "scheduled").replace(/[_-]+/g, " ")
        )}</span>
      </div>
      <p><strong>Departure:</strong> ${escapeHTML(formatDate(trip.departure_at))}</p>
      <p><strong>Seat capacity:</strong> ${escapeHTML(trip.seat_capacity)}</p>
      <p><strong>Fare:</strong> FREE</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;">
        <button class="primary" type="button" data-open-trip="${escapeHTML(trip.id)}">Passengers &amp; tickets</button>
        ${state.role === "admin" ? `
          <button class="secondary" type="button" data-edit-trip="${escapeHTML(trip.id)}">Edit trip</button>
          <button class="secondary" type="button" data-delete-trip="${escapeHTML(trip.id)}">Delete trip</button>` : ""}
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

function showTicketDialog(ticket, trip) {
  if (!ticket) return;
  const dialog = $("ticketDialog");
  if (!dialog) return;

  const svg = qrSvg(ticket.qr_value || ticket.ticket_number);
  $("ticketDialogBody").innerHTML = `
    <p class="eyebrow">ROGO RIDE TICKET</p>
    <div class="qr-box">${svg || '<p class="muted">QR library did not load. Use the ticket number.</p>'}</div>
    <h3><code>${escapeHTML(ticket.ticket_number)}</code></h3>
    <p>${escapeHTML(ticket.passenger_name || "")}</p>
    <p class="muted tiny">${escapeHTML(trip?.route || "")}${trip ? " · " + escapeHTML(formatDate(trip.departure_at)) : ""}</p>`;

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

function openProfileDialog(forPasswordReset = false) {
  const dialog = $("profileDialog");
  if (!dialog || !state.user) return;

  const roleLabel = state.role === "admin" ? "Administrator"
    : state.role === "coordinator" ? "Coordinator" : "Passenger";

  $("pfName").textContent = state.name;
  $("pfMeta").textContent = (state.user.email || "") + " · " + roleLabel +
    (forPasswordReset ? " · Choose your new password below." : "");
  $("passwordForm").reset();

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
$("pProfileBtn")?.addEventListener("click", () => openProfileDialog());
$("pfClose")?.addEventListener("click", () => $("profileDialog").close());

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

  hideAllShells();
  $("passengerShell")?.classList.remove("hidden");
  if ($("pName")) $("pName").textContent = state.name;

  showPassengerTab("trips");
  loadOpenTrips();
  loadMyBookings();
}

function showPassengerTab(tab) {
  $("pTrips")?.classList.toggle("hidden", tab !== "trips");
  $("pBookings")?.classList.toggle("hidden", tab !== "bookings");
  document.querySelectorAll("[data-ptab]").forEach((b) =>
    b.classList.toggle("active", b.dataset.ptab === tab));
  if (tab === "bookings") loadMyBookings();
}

document.querySelectorAll("[data-ptab]").forEach((b) =>
  b.addEventListener("click", () => showPassengerTab(b.dataset.ptab)));
$("pRefreshTrips")?.addEventListener("click", loadOpenTrips);
$("pRefreshBookings")?.addEventListener("click", loadMyBookings);

async function loadOpenTrips() {
  const box = $("pTripsList");
  if (!box || !state.supabase) return;
  box.innerHTML = '<p class="muted tiny">Loading trips...</p>';

  const { data, error } = await state.supabase.rpc("rr_open_trips");
  if (error) {
    console.error("Open trips failed:", error);
    box.innerHTML = `<div class="result-box bad">Could not load trips: ${escapeHTML(error.message)}</div>`;
    return;
  }

  state.openTrips = data || [];

  if (!state.openTrips.length) {
    box.innerHTML = '<div class="empty-state"><h3>No trips are open right now</h3><p>New trips appear here as soon as they are scheduled. Check back soon.</p></div>';
    return;
  }

  box.innerHTML = state.openTrips.map((t) => `
    <article class="panel trip-card" style="margin-bottom:16px;padding:20px;">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <p class="eyebrow">FREE RIDE</p>
          <h3>${escapeHTML(t.route)}</h3>
        </div>
        <span class="trip-status">${t.seats_left > 0 ? t.seats_left + " seat" + (t.seats_left === 1 ? "" : "s") + " left" : "Full"}</span>
      </div>
      <p><strong>Departure:</strong> ${escapeHTML(formatDate(t.departure_at))}</p>
      <p><strong>Fare:</strong> FREE</p>
      <div style="margin-top:16px;">
        <button class="primary" type="button" data-book-trip="${escapeHTML(t.id)}" ${t.seats_left > 0 ? "" : "disabled"}>
          ${t.seats_left > 0 ? "Book this trip" : "Trip is full"}</button>
      </div>
    </article>`).join("");

  box.querySelectorAll("[data-book-trip]").forEach((b) =>
    b.addEventListener("click", () => openBookDialog(b.dataset.bookTrip)));
}

function updateBookingFormForCategory() {
  const cat = $("bkCategory").value;
  $("bkInstitutionWrap").classList.toggle("hidden", cat !== "student");
  $("bkInstitution").required = cat === "student";
  $("bkDocHelp").textContent = (DOCUMENT_HELP[cat] || "Choose a category first.") +
    " Photos (JPG, PNG) or PDF, up to 5 MB. Only you and ROGO RIDE administrators can see it.";
}

function openBookDialog(tripId) {
  const trip = state.openTrips.find((t) => t.id === tripId);
  const dialog = $("bookDialog");
  if (!trip || !dialog) return;

  state.bookingTrip = trip;
  $("bookForm").reset();
  $("bkName").value = state.name && state.name.includes("@") ? "" : (state.name || "");
  $("bookTripTitle").textContent = trip.route;
  $("bookTripWhen").textContent = formatDate(trip.departure_at) + " · Free ride";
  updateBookingFormForCategory();

  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

$("bkCategory")?.addEventListener("change", updateBookingFormForCategory);
$("bkCancel")?.addEventListener("click", () => $("bookDialog").close());

$("bookForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const trip = state.bookingTrip;
  if (!trip || !state.user) return;

  const file = $("bkDocument").files[0];
  const allowed = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };

  if (!file) { toast("Upload your supporting document."); return; }
  if (!allowed[file.type]) { toast("The document must be a JPG, PNG or PDF."); return; }
  if (file.size > 5 * 1024 * 1024) { toast("The document is larger than 5 MB."); return; }

  const button = $("bkSubmit");
  button.disabled = true;
  button.textContent = "Submitting...";

  try {
    const rand = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    const path = `${state.user.id}/${rand}.${allowed[file.type]}`;

    const up = await state.supabase.storage.from("rr-documents")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) throw new Error("Document upload failed: " + up.error.message);

    const { data, error } = await state.supabase.rpc("rr_create_booking", {
      p_trip_id: trip.id,
      p_full_name: $("bkName").value,
      p_phone: $("bkPhone").value,
      p_institution: $("bkInstitution").value || null,
      p_category: $("bkCategory").value,
      p_document_path: path
    });
    if (error) throw error;
    if (!data.ok) throw new Error(data.message);

    $("bookDialog").close();
    toast("Request sent. An administrator will review it.");
    showPassengerTab("bookings");
    loadOpenTrips();
  } catch (err) {
    console.error("Booking failed:", err);
    toast(err.message || "Could not submit the request.");
  } finally {
    button.disabled = false;
    button.textContent = "Submit request";
  }
});

async function loadMyBookings() {
  const box = $("pBookingsList");
  if (!box || !state.supabase) return;
  box.innerHTML = '<p class="muted tiny">Loading your bookings...</p>';

  const { data, error } = await state.supabase.rpc("rr_my_bookings");
  if (error) {
    console.error("My bookings failed:", error);
    box.innerHTML = `<div class="result-box bad">Could not load your bookings: ${escapeHTML(error.message)}</div>`;
    return;
  }

  state.myBookings = data || [];

  if (!state.myBookings.length) {
    box.innerHTML = '<div class="empty-state"><h3>No bookings yet</h3><p>Choose a trip under Available trips to request a free seat.</p></div>';
    return;
  }

  box.innerHTML = state.myBookings.map((b) => {
    const [cls, label] = BOOKING_STATUS[b.status] || ["pending", b.status];
    const canCancel = ["pending", "approved"].includes(b.status) && !b.checked_in_at;
    return `
    <article class="panel trip-card" style="margin-bottom:16px;padding:20px;">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <p class="eyebrow">${escapeHTML((CATEGORY_LABELS[b.category] || b.category).toUpperCase())}</p>
          <h3>${escapeHTML(b.route)}</h3>
        </div>
        <span class="badge ${cls}">${escapeHTML(b.checked_in_at ? "Checked in" : label)}</span>
      </div>
      <p><strong>Departure:</strong> ${escapeHTML(formatDate(b.departure_at))}</p>
      <p><strong>Passenger:</strong> ${escapeHTML(b.full_name)}</p>
      ${b.status === "rejected" && b.review_note ? `<p><strong>Note from administrator:</strong> ${escapeHTML(b.review_note)}</p>` : ""}
      ${b.status === "approved" ? `<p><strong>Ticket:</strong> <code>${escapeHTML(b.ticket_number || "")}</code></p>` : ""}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;">
        ${b.status === "approved" ? `<button class="primary" type="button" data-view-ticket="${escapeHTML(b.id)}">View ticket</button>` : ""}
        ${canCancel ? `<button class="secondary" type="button" data-cancel-booking="${escapeHTML(b.id)}">Cancel booking</button>` : ""}
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
  if (!window.confirm("Cancel this booking? Your seat will be released.")) return;
  const { data, error } = await state.supabase.rpc("rr_cancel_booking", { p_booking_id: bookingId });
  if (error || !data?.ok) {
    toast(error?.message || data?.message || "Could not cancel the booking.");
    return;
  }
  toast("Booking cancelled.");
  loadMyBookings();
  loadOpenTrips();
}

/* BOOKING REQUESTS (admin) */

async function loadPendingCount() {
  if (state.role !== "admin" || !state.supabase) return;
  const { data, error } = await state.supabase.rpc("rr_list_bookings", { p_status: "pending" });
  if ($("statPending")) $("statPending").textContent = error ? "–" : String((data || []).length);
}

async function loadBookings() {
  const box = $("bookingsContainer");
  if (!box || state.role !== "admin") return;
  box.innerHTML = '<p class="muted tiny">Loading requests...</p>';

  const status = $("bookingFilter")?.value || null;
  const { data, error } = await state.supabase.rpc("rr_list_bookings", { p_status: status });

  if (error) {
    console.error("Bookings failed:", error);
    box.innerHTML = `<div class="result-box bad">Could not load requests: ${escapeHTML(error.message)}.
      Run the latest rogo-ride-setup.sql in Supabase if this mentions a missing function.</div>`;
    return;
  }

  const rows = data || [];
  if ($("statPending") && status === "pending") $("statPending").textContent = String(rows.length);

  if (!rows.length) {
    box.innerHTML = '<div class="empty-state"><h3>No requests here</h3><p>Passenger booking requests will appear in this list.</p></div>';
    return;
  }

  box.innerHTML = rows.map((b) => {
    const [cls, label] = BOOKING_STATUS[b.status] || ["pending", b.status];
    return `
    <article class="panel trip-card" style="margin-bottom:16px;padding:20px;">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <p class="eyebrow">${escapeHTML((CATEGORY_LABELS[b.category] || b.category).toUpperCase())}</p>
          <h3>${escapeHTML(b.full_name)}</h3>
        </div>
        <span class="badge ${cls}">${escapeHTML(label)}</span>
      </div>
      <p><strong>Trip:</strong> ${escapeHTML(b.route)} · ${escapeHTML(formatDate(b.departure_at))}</p>
      <p><strong>Phone:</strong> ${escapeHTML(b.phone)} · <strong>Email:</strong> ${escapeHTML(b.email || "—")}</p>
      ${b.institution ? `<p><strong>Institution:</strong> ${escapeHTML(b.institution)}</p>` : ""}
      <p class="muted tiny">Requested ${escapeHTML(formatDate(b.created_at))}${b.ticket_number ? " · Ticket " + escapeHTML(b.ticket_number) : ""}</p>
      ${b.review_note ? `<p><strong>Note:</strong> ${escapeHTML(b.review_note)}</p>` : ""}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;">
        ${b.document_path ? `<button class="secondary" type="button" data-doc="${escapeHTML(b.document_path)}">View document</button>` : ""}
        ${b.status === "pending" ? `
          <button class="primary" type="button" data-approve="${escapeHTML(b.id)}">Approve</button>
          <button class="secondary" type="button" data-reject="${escapeHTML(b.id)}">Reject</button>` : ""}
      </div>
    </article>`;
  }).join("");

  box.querySelectorAll("[data-doc]").forEach((b) =>
    b.addEventListener("click", () => openDocument(b.dataset.doc)));
  box.querySelectorAll("[data-approve]").forEach((b) =>
    b.addEventListener("click", () => reviewBooking(b.dataset.approve, true)));
  box.querySelectorAll("[data-reject]").forEach((b) =>
    b.addEventListener("click", () => reviewBooking(b.dataset.reject, false)));
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

async function reviewBooking(bookingId, approve) {
  let note = null;
  if (!approve) {
    note = window.prompt("Reason for rejecting (shown to the passenger):", "");
    if (note === null) return;
  } else if (!window.confirm("Approve this request and issue a ticket?")) {
    return;
  }

  const { data, error } = await state.supabase.rpc("rr_review_booking", {
    p_booking_id: bookingId, p_approve: approve, p_note: note
  });
  if (error || !data?.ok) {
    toast(error?.message || data?.message || "Could not update the request.");
    return;
  }
  toast(approve ? "Approved. Ticket " + data.ticket_number + " issued." : "Request rejected.");
  loadBookings();
  loadPendingCount();
}

$("refreshBookings")?.addEventListener("click", loadBookings);
$("bookingFilter")?.addEventListener("change", loadBookings);

/* TEAM CHAT (admins and coordinators) */

function stopChatPolling() {
  if (state.chat?.timer) clearInterval(state.chat.timer);
  if (state.chat) state.chat.timer = null;
}

async function initChat() {
  stopChatPolling();

  if (!state.team.length) {
    const { data, error } = await state.supabase.rpc("rr_list_team");
    if (error) {
      $("chatMessages").innerHTML = `<div class="result-box bad">Could not load the team: ${escapeHTML(error.message)}.
        Run the latest rogo-ride-setup.sql in Supabase.</div>`;
      return;
    }
    state.team = data || [];
  }

  renderChatList();
  await selectConversation(state.chat.peer);

  state.chat.timer = setInterval(() => {
    if (state.currentView === "chats" && !document.hidden) loadMessages();
  }, 4000);
}

function renderChatList() {
  const box = $("chatList");
  if (!box) return;

  const others = state.team.filter((m) => m.user_id !== state.user?.id);

  box.innerHTML = `
    <button type="button" class="chat-item ${state.chat.peer === null ? "active" : ""}" data-peer="">
      <span class="avatar">#</span><span><strong>Team channel</strong><small>Everyone on the team</small></span>
    </button>
    ${others.map((m) => `
    <button type="button" class="chat-item ${state.chat.peer === m.user_id ? "active" : ""}" data-peer="${escapeHTML(m.user_id)}">
      <span class="avatar">${escapeHTML((m.full_name || "?").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase())}</span>
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
  $("chatMessages").innerHTML = '<p class="muted tiny" style="padding:16px">Loading messages...</p>';
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

    // The user may have switched conversation while this request was running.
    if (peer !== state.chat.peer) return;

    const rows = (data || []).slice().reverse();
    const sig = rows.length + ":" + (rows.length ? rows[rows.length - 1].id : 0);
    if (sig === state.chat.sig) return;
    state.chat.sig = sig;

    renderMessages(rows);
  } catch (err) {
    console.error("Chat load failed:", err);
    if (!state.chat.sig) {
      $("chatMessages").innerHTML = `<div class="result-box bad">Could not load messages: ${escapeHTML(err.message || "Unknown error")}</div>`;
    }
  } finally {
    state.chat.loading = false;
  }
}

function renderMessages(rows) {
  const box = $("chatMessages");
  if (!box) return;

  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const names = new Map(state.team.map((m) => [m.user_id, m.full_name || "Unnamed"]));

  box.innerHTML = rows.length ? rows.map((m) => {
    const mine = m.sender_id === state.user.id;
    const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })
      .format(new Date(m.created_at));
    return `<div class="msg ${mine ? "mine" : "theirs"}">
      ${!mine && state.chat.peer === null ? `<small class="who">${escapeHTML(names.get(m.sender_id) || "Team member")}</small>` : ""}
      <p>${escapeHTML(m.body)}</p><small class="when">${escapeHTML(time)}</small></div>`;
  }).join("") : '<p class="muted tiny" style="padding:16px">No messages yet. Say hello.</p>';

  if (nearBottom) box.scrollTop = box.scrollHeight;
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

/* START */

initializeApp();
