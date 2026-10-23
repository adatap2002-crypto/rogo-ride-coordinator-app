
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
  scanTimer: null
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
  box.classList.remove("hidden");
}

function clearLoginError() {
  const box = $("loginError");
  if (box) {
    box.textContent = "";
    box.classList.add("hidden");
  }
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

  if (!data || data.active !== true) {
    throw new Error(
      "This account has no active coordinator approval. Contact the administrator."
    );
  }

  if (!["admin", "coordinator"].includes(data.role)) {
    throw new Error("This account does not have an authorized role.");
  }

  return data;
}

async function openAuthenticatedSession(user) {
  const profile = await loadProfile(user);
  enterApp(profile, user);
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

    const avatar = $("profileName").previousElementSibling;
    if (avatar) avatar.textContent = initials || "RR";
  }

  if ($("profileRole")) {
    $("profileRole").textContent =
      state.role === "admin" ? "Administrator" : "Coordinator";
  }

  document.querySelectorAll(".admin-only").forEach((el) => {
    el.classList.toggle("hidden", state.role !== "admin");
  });

  $("loginScreen")?.classList.add("hidden");
  $("appShell")?.classList.remove("hidden");

  showView("dashboard");
  loadTrips();
}

function showLogin() {
  stopScanner();

  state.user = null;
  state.name = "Coordinator";
  state.role = "coordinator";
  state.trips = [];
  state.tripsLoading = false;

  $("appShell")?.classList.add("hidden");
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
        console.error("Saved session profile check failed:", err);
        await state.supabase.auth.signOut();
        showLogin();
        showLoginError(err.message || "Account approval could not be verified.");
      }
    }

    const { data: listener } = state.supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "SIGNED_OUT") {
          showLogin();
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
        await state.supabase.auth.signOut();
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

$("logoutBtn")?.addEventListener("click", async () => {
  stopScanner();

  try {
    if (state.supabase) {
      const { error } = await state.supabase.auth.signOut();
      if (error) throw error;
    }

    if ($("password")) $("password").value = "";
    showLogin();
    clearLoginError();
    toast("You have signed out.");
  } catch (err) {
    toast("Sign-out failed: " + err.message);
  }
});

/* NAVIGATION */

function showView(view) {
  if (view === "team" && state.role !== "admin") {
    toast("Administrator access is required.");
    return;
  }

  document.querySelectorAll(".view").forEach((el) => {
    el.classList.add("hidden");
  });

  $("view-" + view)?.classList.remove("hidden");

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  document.querySelectorAll("[data-go]").forEach((button) => {
    button.setAttribute("aria-current", button.dataset.go === view ? "page" : "false");
  });

  const title = titles[view] || titles.dashboard;
  if ($("pageEyebrow")) $("pageEyebrow").textContent = title[0];
  if ($("pageTitle")) $("pageTitle").textContent = title[1];

  if (view !== "scanner") stopScanner();
  if (view === "trips" && state.user) loadTrips();
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
      ${state.role === "admin" ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;">
          <button class="secondary" type="button" data-edit-trip="${escapeHTML(trip.id)}">Edit trip</button>
          <button class="secondary" type="button" data-delete-trip="${escapeHTML(trip.id)}">Delete trip</button>
        </div>` : ""}
    </article>
  `).join("");

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

$("profileMenu")?.addEventListener("click", () => {
  toast("Account settings are not connected yet.");
});

$("newChatBtn")?.addEventListener("click", () => {
  toast("Private messaging is not connected yet.");
});

$("startConversation")?.addEventListener("click", () => {
  toast("Private messaging is not connected yet.");
});

$("inviteBtn")?.addEventListener("click", () => {
  if (state.role !== "admin") {
    toast("Administrator access is required.");
    return;
  }
  toast("Secure coordinator management is not connected yet.");
});

/* TICKET VERIFICATION
   Intentionally disabled until secure server-side validation
   and one-time check-in have been implemented.
*/

$("verifyTicket")?.addEventListener("click", () => {
  const code = $("ticketCode")?.value.trim();
  const result = $("scanResult");
  if (!result) return;

  result.className = "result-box warn";

  result.textContent = code
    ? "Not verified. Secure ticket validation is not connected. No check-in was recorded."
    : "Enter a ticket number or scan a QR code first.";
});

/* CAMERA AND QR CAPTURE */

$("startScan")?.addEventListener("click", startScanner);
$("stopScan")?.addEv
