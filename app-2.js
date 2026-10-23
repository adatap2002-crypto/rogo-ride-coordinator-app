
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
  verifying: false
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

    const avatar = $("profileAvatar");
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
  state.detailTripId = null;
  $("tripDetail")?.remove();

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
    if (button.closest(".mobile-nav")) {
      button.classList.toggle("active", button.dataset.go === view);
    }
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

/* TRIP DETAIL: COORDINATORS, TICKETS, QR */

function qrSvg(text) {
  if (typeof window.qrcode !== "function") return "";
  const qr = window.qrcode(0, "M");
  qr.addData(String(text));
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

function ticketState(t) {
  if (t.status === "cancelled") return ["cancelled", "Cancelled"];
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
      .select("ticket_number, passenger_name, passenger_phone, status, checked_in_at, created_at")
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
  const active = tickets.filter((t) => t.status !== "cancelled");
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
              ${isAdmin && t.ticket_number && !t.checked_in_at && t.status !== "cancelled"
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

  const svg = qrSvg(ticket.ticket_number);
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

/* START */

initializeApp();
