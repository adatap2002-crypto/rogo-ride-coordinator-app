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
  signingIn: false,
  trips: [],
  tripsLoading: false
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

  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60000
  );

  return localDate.toISOString().slice(0, 16);
}

function setTripsMessage(title, message, type = "info") {
  const container = $("tripsMessage");
  if (!container) return;

  const symbol = type === "error" ? "!" : type === "success" ? "✓" : "i";

  container.className = "notice";
  container.innerHTML = `
    <span>${symbol}</span>
    <div>
      <strong>${escapeHTML(title)}</strong>
      <p>${escapeHTML(message)}</p>
    </div>
  `;

  container.classList.toggle("hidden", !message);
}

function showView(view) {
  if (view === "team" && state.role !== "admin") {
    toast("Administrator access is required.");
    return;
  }

  document.querySelectorAll(".view").forEach((element) => {
    element.classList.add("hidden");
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

  if (view === "trips" && state.user) {
    loadTrips();
  }
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
      $("profileName").previousElementSibling.textContent = initials || "RR";
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
  loadTrips();
}

function showLogin() {
  stopScanner();

  state.user = null;
  state.name = "Coordinator";
  state.role = "coordinator";
  state.trips = [];

  $("appShell")?.classList.add("hidden");
  $("loginScreen")?.classList.remove("hidden");

  renderTrips();
}

async function loadSupabaseLibrary() {
  if (window.supabase?.createClient) return;

  await new Promise((resolve, reject) => {
    const script = document.createElement("script");

    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
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
    throw new Error("Could not verify your profile: " + error.message);
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
    if (!data.user) throw new Error("No user was returned after sign-in.");

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

/* TRIP MANAGEMENT */

function renderTrips() {
  const container = $("tripsContainer");
  if (!container) return;

  if (!state.user) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Sign in to view trips</h3>
        <p>Your assigned trips will appear here after authentication.</p>
      </div>
    `;
    return;
  }

  if (state.tripsLoading) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Loading trips...</h3>
        <p>Connecting to the ROGO RIDE database.</p>
      </div>
    `;
    return;
  }

  if (!state.trips.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">↗</div>
        <h3>No trips found</h3>
        <p>${
          state.role === "admin"
            ? "Create a trip using the button above."
            : "No trips are currently assigned to your account."
        }</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.trips.map((trip) => {
    const status = String(trip.status || "scheduled");
    const statusLabel = status.replace(/[_-]+/g, " ");

    return `
      <article class="panel trip-card" data-trip-id="${escapeHTML(trip.id)}"
        style="margin-bottom:16px;padding:20px;">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <p class="eyebrow">ROGO RIDE TRIP</p>
            <h3>${escapeHTML(trip.route || "Route not specified")}</h3>
          </div>
          <span class="trip-status">${escapeHTML(statusLabel)}</span>
        </div>

        <p><strong>Departure:</strong> ${escapeHTML(formatDate(trip.departure_at))}</p>
        <p><strong>Seat capacity:</strong> ${escapeHTML(trip.seat_capacity)}</p>
        <p><strong>Fare:</strong> FREE</p>

        ${
          state.role === "admin"
            ? `
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;">
                <button class="secondary" type="button" data-edit-trip="${escapeHTML(trip.id)}">Edit trip</button>
                <button class="secondary" type="button" data-delete-trip="${escapeHTML(trip.id)}">Delete trip</button>
              </div>
            `
            : ""
        }
      </article>
    `;
  }).join("");

  if (state.role === "admin") {
    container.querySelectorAll("[data-edit-trip]").forEach((button) => {
      button.addEventListener("click", () => {
        const trip = state.trips.find((item) => item.id === button.dataset.editTrip);
        if (trip) showTripForm(trip);
      });
    });

    container.querySelectorAll("[data-delete-trip]").forEach((button) => {
      button.addEventListener("click", () => {
        deleteTrip(button.dataset.deleteTrip);
      });
    });
  }
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
  setTripsMessage("Loading trips", "Retrieving authorized trip records.");
  renderTrips();

  try {
    let query = state.supabase
      .from("trips")
      .select("id, route, departure_at, seat_capacity, status, created_at")
      .order("departure_at", { ascending: true });

    const { data, error } = await query;

    if (error) throw error;

    state.trips = data || [];

    if ($("statTrips")) {
      $("statTrips").textContent = String(state.trips.length);
    }

    state.tripsLoading = false;
    renderTrips();

    if (state.trips.length) {
      setTripsMessage(
        "Trips loaded",
        "Trip information was retrieved using your current account permissions.",
        "success"
      );
    } else {
      setTripsMessage(
        "No trips available",
        state.role === "admin"
          ? "Create a trip to get started."
          : "Ask an administrator to assign a trip to your account."
      );
    }

    renderTripAdminControls();
  } catch (err) {
    console.error("Trip loading error:", err);
    state.trips = [];
    state.tripsLoading = false;
    renderTrips();

    setTripsMessage(
      "Could not load trips",
      "Supabase returned an error: " + (err.message || "Unknown error"),
      "error"
    );
  }
}

function showTripForm(trip = null) {
  if (state.role !== "admin") {
    toast("Only an administrator can manage trips.");
    return;
  }

  const existing = $("tripEditor");
  if (existing) existing.remove();

  const container = $("tripsContainer");
  if (!container) return;

  const form = document.createElement("form");
  form.id = "tripEditor";
  form.className = "panel";
  form.style.cssText = "padding:20px;margin-bottom:20px;";

  form.innerHTML = `
    <h3>${trip ? "Edit trip" : "Create a trip"}</h3>

    <label for="tripRoute">Route</label>
    <input id="tripRoute" name="route" required maxlength="200"
      placeholder="e.g. Bauchi → Misau"
      value="${escapeHTML(trip?.route || "")}">

    <label for="tripDeparture">Departure date and time</label>
    <input id="tripDeparture" name="departure_at" type="datetime-local" required
      value="${escapeHTML(formatInputDate(trip?.departure_at))}">

    <label for="tripCapacity">Seat capacity</label>
    <input id="tripCapacity" name="seat_capacity" type="number"
      min="1" max="100000" step="1" required
      value="${escapeHTML(trip?.seat_capacity ?? 25)}">

    <label for="tripStatus">Trip status</label>
    <select id="tripStatus" name="status" required>
      ${["scheduled", "boarding", "departed", "completed", "cancelled"].map((status) => `
        <option value="${status}" ${
          String(trip?.status || "scheduled").toLowerCase() === status ? "selected" : ""
        }>${status.charAt(0).toUpperCase() + status.slice(1)}</option>
      `).join("")}
    </select>

    <p class="tiny muted">All ROGO RIDE trips are FREE. No fare is charged.</p>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;">
      <button class="primary" type="submit">${trip ? "Save changes" : "Create trip"}</button>
      <button class="secondary" type="button" id="cancelTripForm">Cancel</button>
    </div>
  `;

  container.prepend(form);

  $("cancelTripForm").addEventListener("click", () => form.remove());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const route = $("tripRoute").value.trim();
    const departureLocal = $("tripDeparture").value;
    const capacity = Number($("tripCapacity").value);
    const status = $("tripStatus").value;

    if (!route || !departureLocal || !Number.isInteger(capacity) || capacity < 1) {
      toast("Enter a valid route, departure time, and seat capacity.");
      return;
    }

    const departureDate = new Date(departureLocal);

    if (Number.isNaN(departureDate.getTime())) {
      toast("Enter a valid departure date and time.");
      return;
    }

    const saveButton = form.querySelector('button[type="submit"]');
    saveButton.disabled = true;
    saveButton.textContent = "Saving...";

    const payload = {
      route,
      departure_at: departureDate.toISOString(),
      seat_capacity: capacity,
      status
    };

    try {
      let result;

      if (trip) {
        result = await state.supabase
          .from("trips")
          .update(payload)
          .eq("id", trip.id)
          .select("id")
          .maybeSingle();
      } else {
        result = await state.supabase
          .from("trips")
          .insert(payload)
          .select("id")
          .single();
      }

      if (result.error) throw result.error;

      if (!result.data) {
        throw new Error("No trip was returned. Check your database permissions.");
      }

      form.remove();
      toast(trip ? "Trip updated successfully." : "Trip created successfully.");
      await loadTrips();
    } catch (err) {
      console.error("Saving trip failed:", err);
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

  const confirmed = window.confirm(
    `Delete the trip "${trip.route}"?\n\nThis may be blocked if related tickets or assignments exist.`
  );

  if (!confirmed) return;

  try {
    const { error } = await state.supabase
      .from("trips")
      .delete()
      .eq("id", tripId)
      .select("id")
      .single();

    if (error) throw error;

    toast("Trip deleted.");
    await loadTrips();
  } catch (err) {
    console.error("Deleting trip failed:", err);
    toast("Could not delete trip: " + (err.message || "Unknown error"));
  }
}

$("refreshTrips")?.addEventListener("click", () => {
  loadTrips();
});

$("profileMenu")?.addEventListener("click", () => {
  toast("Account settings are not connected yet.");
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

/* TICKET VERIFICATION PLACEHOLDER
   QR capture alone does not validate a ticket or record check-in.
   Secure server-side validation is still required. */

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
    "Not verified. Secure server-side ticket validation is not connected. No check-in was recorded.";
});

/* CAMERA AND QR CAPTURE */

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
    await $("cam
