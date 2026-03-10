/* ========================================
   VIGÍA JALISCO — Waze-style map app
   ======================================== */

/* global supabase */

// Supabase config
const SUPABASE_URL = "https://hcpfhqbcjgdwfqoympni.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjcGZocWJjamdkd2Zxb3ltcG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4NzA5NDQsImV4cCI6MjA4NzQ0Njk0NH0.8pIzPhDXDRWeoJVxc3adomW-XXpIleO07dRV5-hmC2k";

const MINUTES = 60 * 1000;

const INCIDENT_TYPES = {
  FIRE: { label: "Incendio" },
  VEHICLEFIRE: { label: "Incendio vehicular" },
  ROADBLOCK: { label: "Bloqueo en vialidad" },
  TIRESPIKES: { label: "Poncha llantas / clavos" },
  SHOOTING: { label: "Balacera / enfrentamiento" },
  CRIME: { label: "Robo / secuestro / extorsión" },
  OTHER: { label: "Otro peligro" },
  BLOCK: { label: "Bloqueo en vialidad" },
  ROBBERY: { label: "Robo" },
};

const TYPE_EMOJIS = {
  FIRE: "🔥", VEHICLEFIRE: "🔥", ROADBLOCK: "🛑",
  TIRESPIKES: "🛞", SHOOTING: "💥", CRIME: "🕵️",
  OTHER: "⚠️", BLOCK: "🛑", ROBBERY: "🕵️",
};

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ========== STATE ==========
const state = {
  map: null,
  markersLayer: null,
  allIncidents: [],
  filteredIncidents: [],
  filterMins: 240,
  userLat: null,
  userLng: null,
  userMarker: null,
  userAccuracyCircle: null,
  watchId: null,
  tracking: false,
  lastSubmitTs: 0,
  selectedReportType: null,
  pickMode: false,
  selectedLat: null,
  selectedLng: null,
  tempPickMarker: null,
  alertedIncidents: new Set(),
  alertDismissed: new Set(),
  sheetState: "peek", // peek | half | full
};

// ========== DOM REFS ==========
const dom = {};

function cacheDom() {
  dom.disclaimerOverlay = document.getElementById("disclaimer-overlay");
  dom.disclaimerBtn = document.getElementById("disclaimer-accept-btn");
  dom.liveUpdated = document.getElementById("live-updated");
  dom.incidentCount = document.getElementById("incident-count");
  dom.alertBanner = document.getElementById("alert-banner");
  dom.alertBannerIcon = document.getElementById("alert-banner-icon");
  dom.alertBannerTitle = document.getElementById("alert-banner-title");
  dom.alertBannerDesc = document.getElementById("alert-banner-desc");
  dom.alertBannerDist = document.getElementById("alert-banner-dist");
  dom.alertBannerClose = document.getElementById("alert-banner-close");
  dom.btnLocate = document.getElementById("btn-locate");
  dom.btnZoomIn = document.getElementById("btn-zoom-in");
  dom.btnZoomOut = document.getElementById("btn-zoom-out");
  dom.reportFab = document.getElementById("report-fab");
  dom.radialMenu = document.getElementById("radial-menu");
  dom.radialBackdrop = document.getElementById("radial-backdrop");
  dom.radialCancel = document.getElementById("radial-cancel");
  dom.reportDetailModal = document.getElementById("report-detail-modal");
  dom.reportDetailBackdrop = document.getElementById("report-detail-backdrop");
  dom.reportDetailClose = document.getElementById("report-detail-close");
  dom.reportDetailTypeLabel = document.getElementById("report-detail-type-label");
  dom.reportDesc = document.getElementById("report-desc");
  dom.reportEvidence = document.getElementById("report-evidence");
  dom.reportLocationText = document.getElementById("report-location-text");
  dom.reportSubmitBtn = document.getElementById("report-submit-btn");
  dom.reportStatusMsg = document.getElementById("report-status-msg");
  dom.bottomSheet = document.getElementById("bottom-sheet");
  dom.sheetHandle = document.getElementById("sheet-handle");
  dom.sheetBody = document.getElementById("sheet-body");
  dom.sheetCount = document.getElementById("sheet-count");
  dom.incidentsList = document.getElementById("incidents-list");
  dom.filterBar = document.getElementById("filter-bar");
  dom.sheetToggle = document.getElementById("sheet-toggle");
  dom.sheetToggleCount = document.getElementById("sheet-toggle-count");
  dom.pickOverlay = document.getElementById("pick-overlay");
  dom.pickBackdrop = document.getElementById("pick-backdrop");
}

// ========== HELPERS ==========
function getEmoji(type) { return TYPE_EMOJIS[type] || "⚠️"; }
function getLabel(type) { return (INCIDENT_TYPES[type] || INCIDENT_TYPES.OTHER).label; }
function getTypeLabel(type) { return getEmoji(type) + " " + getLabel(type); }

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / MINUTES);
  if (mins < 1) return "Ahora";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return h === 1 ? "1 h" : `${h} h`;
}

function isExpired(inc) {
  if (!inc.created_at) return false;
  return Date.now() - new Date(inc.created_at).getTime() > 24 * 60 * MINUTES;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDist(km) {
  if (km < 1) return Math.round(km * 1000) + " m";
  return km.toFixed(1) + " km";
}

function formatUpdatedTime(d) {
  const dia = d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
  const hora = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  return `${dia}, ${hora}`;
}

function updateLiveBar() {
  if (dom.liveUpdated) {
    dom.liveUpdated.textContent = formatUpdatedTime(new Date());
  }
}

// ========== MAP INIT ==========
function initMap() {
  const map = L.map("map", {
    zoomControl: false,
    attributionControl: false,
  });
  state.map = map;

  const jaliscoBounds = L.latLngBounds([19.2, -105.8], [22.1, -101.9]);
  map.fitBounds(jaliscoBounds, { maxZoom: 8 });

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    { maxZoom: 19 }
  ).addTo(map);

  state.markersLayer = L.layerGroup().addTo(map);

  map.on("click", handleMapClick);
}

// ========== GPS TRACKING ==========
function startTracking() {
  if (!navigator.geolocation) return;

  state.tracking = true;
  dom.btnLocate.classList.add("tracking");

  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      state.userLat = latitude;
      state.userLng = longitude;

      updateUserMarker(latitude, longitude, accuracy);
      checkProximityAlerts();
    },
    (err) => {
      console.warn("GPS error:", err.message);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

function updateUserMarker(lat, lng, accuracy) {
  const map = state.map;

  if (!state.userMarker) {
    const icon = L.divIcon({
      className: "",
      html: '<div class="user-marker"><div class="user-marker-pulse"></div><div class="user-marker-dot"></div></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    state.userMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map);

    // First fix: center on user
    map.setView([lat, lng], 14);
  } else {
    state.userMarker.setLatLng([lat, lng]);
  }

  if (accuracy && accuracy < 500) {
    if (!state.userAccuracyCircle) {
      state.userAccuracyCircle = L.circle([lat, lng], {
        radius: accuracy,
        color: "rgba(79,195,247,0.3)",
        fillColor: "rgba(79,195,247,0.08)",
        fillOpacity: 1,
        weight: 1,
      }).addTo(map);
    } else {
      state.userAccuracyCircle.setLatLng([lat, lng]);
      state.userAccuracyCircle.setRadius(accuracy);
    }
  }
}

function locateMe() {
  if (state.tracking && state.userLat != null) {
    state.map.setView([state.userLat, state.userLng], 15, { animate: true });
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      state.userLat = latitude;
      state.userLng = longitude;
      state.map.setView([latitude, longitude], 15, { animate: true });
      if (!state.tracking) startTracking();
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ========== PROXIMITY ALERTS ==========
function checkProximityAlerts() {
  if (state.userLat == null) return;

  const ALERT_RADIUS_KM = 2;
  let closest = null;
  let closestDist = Infinity;

  for (const inc of state.filteredIncidents) {
    const lat = Number(inc.lat);
    const lng = Number(inc.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (state.alertDismissed.has(inc.id)) continue;

    const dist = haversineKm(state.userLat, state.userLng, lat, lng);
    if (dist < ALERT_RADIUS_KM && dist < closestDist) {
      closest = inc;
      closestDist = dist;
    }
  }

  if (closest && !state.alertedIncidents.has(closest.id)) {
    state.alertedIncidents.add(closest.id);
    showAlertBanner(closest, closestDist);
  }
}

function showAlertBanner(inc, distKm) {
  dom.alertBannerIcon.textContent = getEmoji(inc.type);
  dom.alertBannerTitle.textContent = getLabel(inc.type);
  dom.alertBannerDesc.textContent = (inc.description && inc.description !== "EMPTY")
    ? inc.description
    : "Reportado " + timeAgo(inc.created_at);
  dom.alertBannerDist.textContent = formatDist(distKm);
  dom.alertBanner.classList.add("visible");

  // Auto-hide after 10s
  setTimeout(() => {
    dom.alertBanner.classList.remove("visible");
  }, 10000);
}

// ========== LOAD & RENDER ==========
async function loadIncidents() {
  const { data, error } = await supabaseClient
    .from("incidents")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("Error cargando incidentes:", error);
    return;
  }

  state.allIncidents = data || [];
  applyFilter();
  updateLiveBar();
}

function applyFilter() {
  const mins = state.filterMins;
  const now = Date.now();

  state.filteredIncidents = state.allIncidents
    .map((inc) => ({ ...inc, lat: Number(inc.lat), lng: Number(inc.lng) }))
    .filter((inc) => {
      if (!Number.isFinite(inc.lat) || !Number.isFinite(inc.lng)) return false;
      if (isExpired(inc)) return false;
      if (mins > 0) {
        const age = now - new Date(inc.created_at).getTime();
        if (age > mins * MINUTES) return false;
      }
      return true;
    });

  renderIncidents();
}

function renderIncidents() {
  const list = dom.incidentsList;
  state.markersLayer.clearLayers();
  if (list) list.innerHTML = "";

  const visible = state.filteredIncidents;

  if (dom.incidentCount) dom.incidentCount.textContent = visible.length;
  if (dom.sheetCount) dom.sheetCount.textContent = visible.length;
  if (dom.sheetToggleCount) dom.sheetToggleCount.textContent = visible.length;

  if (visible.length === 0 && list) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🛰️</div>Sin incidentes en este periodo</div>';
  }

  visible.forEach((inc) => {
    // List item
    if (list) list.appendChild(buildIncidentItem(inc));

    // Map marker
    const icon = L.divIcon({
      className: "",
      html: `<div class="incident-marker">${getEmoji(inc.type)}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });

    const marker = L.marker([inc.lat, inc.lng], { icon });

    let popupHtml = `<div style="font-weight:700;margin-bottom:4px;">${getTypeLabel(inc.type)}</div>`;
    if (inc.description && inc.description !== "EMPTY") {
      popupHtml += `<div style="font-size:12px;color:#aaa;margin-bottom:4px;">${inc.description}</div>`;
    }
    popupHtml += `<div style="font-size:11px;color:#666;">${timeAgo(inc.created_at)}</div>`;
    if (inc.photo_url) {
      popupHtml += `<div style="margin-top:6px;"><img src="${inc.photo_url}" alt="Foto" style="max-width:200px;border-radius:6px;" /></div>`;
    }
    if (inc.evidence_link) {
      popupHtml += `<div style="margin-top:4px;font-size:11px;"><a href="${inc.evidence_link}" target="_blank" rel="noopener noreferrer" style="color:#4fc3f7;">Ver evidencia ↗</a></div>`;
    }

    marker.bindPopup(popupHtml, { maxWidth: 260 });
    marker.addTo(state.markersLayer);
  });
}

function buildIncidentItem(inc) {
  const item = document.createElement("div");
  item.className = "incident-item";

  const emoji = document.createElement("div");
  emoji.className = "incident-emoji";
  emoji.textContent = getEmoji(inc.type);
  item.appendChild(emoji);

  const info = document.createElement("div");
  info.className = "incident-info";

  const title = document.createElement("div");
  title.className = "incident-title";
  title.textContent = getLabel(inc.type);
  info.appendChild(title);

  if (inc.description && inc.description !== "EMPTY") {
    const desc = document.createElement("div");
    desc.className = "incident-desc";
    desc.textContent = inc.description;
    info.appendChild(desc);
  }

  const meta = document.createElement("div");
  meta.className = "incident-meta";

  const time = document.createElement("span");
  time.className = "incident-time";
  time.textContent = timeAgo(inc.created_at);
  meta.appendChild(time);

  const confTag = document.createElement("span");
  confTag.className = "incident-tag " + (inc.confidence === "high" ? "tag-confidence-high" : "tag-confidence-low");
  confTag.textContent = inc.confidence === "high" ? "Confirmado" : "Sin confirmar";
  meta.appendChild(confTag);

  if (inc.photo_url || inc.evidence_link) {
    const evTag = document.createElement("span");
    evTag.className = "incident-tag tag-evidence";
    evTag.textContent = "Evidencia";
    meta.appendChild(evTag);
  }

  info.appendChild(meta);
  item.appendChild(info);

  // Distance from user
  if (state.userLat != null) {
    const dist = haversineKm(state.userLat, state.userLng, inc.lat, inc.lng);
    const distEl = document.createElement("div");
    distEl.className = "incident-distance";
    distEl.textContent = formatDist(dist);
    item.appendChild(distEl);
  }

  item.addEventListener("click", () => {
    if (Number.isFinite(inc.lat) && Number.isFinite(inc.lng)) {
      state.map.setView([inc.lat, inc.lng], 15, { animate: true });
      // On mobile, collapse sheet
      setSheetState("peek");
    }
  });

  return item;
}

// ========== FILTER ==========
function setupFilters() {
  if (!dom.filterBar) return;
  dom.filterBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    dom.filterBar.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.filterMins = parseInt(btn.dataset.mins, 10);
    applyFilter();
  });
}

// ========== BOTTOM SHEET DRAG ==========
function setupSheet() {
  const handle = dom.sheetHandle;
  if (!handle) return;

  let startY = 0;
  let startTransform = 0;
  let dragging = false;

  function getSheetOffset() {
    const transform = window.getComputedStyle(dom.bottomSheet).transform;
    if (transform === "none") return 0;
    const matrix = new DOMMatrixReadOnly(transform);
    return matrix.m42;
  }

  handle.addEventListener("touchstart", (e) => {
    dragging = true;
    startY = e.touches[0].clientY;
    startTransform = getSheetOffset();
    dom.bottomSheet.style.transition = "none";
  }, { passive: true });

  handle.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    const dy = e.touches[0].clientY - startY;
    const newY = startTransform + dy;
    const maxY = dom.bottomSheet.offsetHeight - 48;
    const clamped = Math.max(0, Math.min(newY, maxY));
    dom.bottomSheet.style.transform = `translateY(${clamped}px)`;
  }, { passive: true });

  handle.addEventListener("touchend", (e) => {
    if (!dragging) return;
    dragging = false;
    dom.bottomSheet.style.transition = "";

    const currentY = getSheetOffset();
    const sheetH = dom.bottomSheet.offsetHeight;
    const peekY = sheetH - 48;
    const halfY = sheetH * 0.55;

    if (currentY > peekY * 0.7) {
      setSheetState("peek");
    } else if (currentY > halfY * 0.4) {
      setSheetState("half");
    } else {
      setSheetState("full");
    }
  }, { passive: true });

  // Click on handle toggles
  handle.addEventListener("click", () => {
    if (state.sheetState === "peek") setSheetState("half");
    else if (state.sheetState === "half") setSheetState("full");
    else setSheetState("peek");
  });
}

function setSheetState(s) {
  state.sheetState = s;
  dom.bottomSheet.classList.remove("peek", "half", "full");
  dom.bottomSheet.classList.add(s);
  dom.bottomSheet.style.transform = "";
}

// ========== REPORT FLOW ==========
function openRadialMenu() {
  dom.radialMenu.classList.add("open");
}

function closeRadialMenu() {
  dom.radialMenu.classList.remove("open");
}

function openReportDetail(type) {
  state.selectedReportType = type;
  dom.reportDetailTypeLabel.textContent = getTypeLabel(type);
  dom.reportDesc.value = "";
  dom.reportEvidence.value = "";
  dom.reportStatusMsg.textContent = "";
  dom.reportSubmitBtn.disabled = false;

  // Use current location or let them pick
  if (state.userLat != null) {
    state.selectedLat = state.userLat;
    state.selectedLng = state.userLng;
    dom.reportLocationText.textContent = "Usando tu ubicación actual";
  } else {
    state.selectedLat = null;
    state.selectedLng = null;
    dom.reportLocationText.textContent = "Toca el mapa para elegir ubicación";
    state.pickMode = true;
    if (dom.pickOverlay) dom.pickOverlay.style.display = "block";
    if (dom.pickBackdrop) dom.pickBackdrop.style.display = "block";
  }

  dom.reportDetailModal.classList.add("open");
}

function closeReportDetail() {
  dom.reportDetailModal.classList.remove("open");
  state.pickMode = false;
  if (dom.pickOverlay) dom.pickOverlay.style.display = "none";
  if (dom.pickBackdrop) dom.pickBackdrop.style.display = "none";
  if (state.tempPickMarker) {
    state.map.removeLayer(state.tempPickMarker);
    state.tempPickMarker = null;
  }
}

function handleMapClick(e) {
  if (!state.pickMode) return;

  state.selectedLat = e.latlng.lat;
  state.selectedLng = e.latlng.lng;

  if (state.tempPickMarker) {
    state.tempPickMarker.setLatLng(e.latlng);
  } else {
    state.tempPickMarker = L.marker(e.latlng).addTo(state.map);
  }

  state.pickMode = false;
  if (dom.pickOverlay) dom.pickOverlay.style.display = "none";
  if (dom.pickBackdrop) dom.pickBackdrop.style.display = "none";
  dom.reportLocationText.textContent = "Ubicación seleccionada en el mapa";
}

async function submitReport() {
  const now = Date.now();
  if (now - state.lastSubmitTs < 15000) {
    dom.reportStatusMsg.textContent = "Espera unos segundos antes de enviar otro.";
    dom.reportStatusMsg.className = "status-msg status-err";
    return;
  }

  if (!state.selectedReportType) {
    dom.reportStatusMsg.textContent = "Selecciona el tipo de incidente.";
    dom.reportStatusMsg.className = "status-msg status-err";
    return;
  }

  if (!Number.isFinite(state.selectedLat) || !Number.isFinite(state.selectedLng)) {
    dom.reportStatusMsg.textContent = "Necesitamos tu ubicación. Activa el GPS o toca el mapa.";
    dom.reportStatusMsg.className = "status-msg status-err";
    return;
  }

  const payload = {
    type: state.selectedReportType,
    description: dom.reportDesc.value.trim() || "EMPTY",
    lat: state.selectedLat,
    lng: state.selectedLng,
    evidence_link: dom.reportEvidence.value.trim() || null,
    confidence: "low",
  };

  dom.reportSubmitBtn.disabled = true;
  dom.reportStatusMsg.textContent = "Enviando…";
  dom.reportStatusMsg.className = "status-msg";

  const { data, error } = await supabaseClient
    .from("incidents")
    .insert(payload)
    .select()
    .single();

  dom.reportSubmitBtn.disabled = false;

  if (error) {
    console.error("Error enviando:", error);
    dom.reportStatusMsg.textContent = "Error al enviar. Intenta de nuevo.";
    dom.reportStatusMsg.className = "status-msg status-err";
    return;
  }

  state.lastSubmitTs = now;
  state.allIncidents.unshift(data);
  applyFilter();
  updateLiveBar();

  dom.reportStatusMsg.textContent = "Reporte enviado. Gracias.";
  dom.reportStatusMsg.className = "status-msg status-ok";

  setTimeout(() => closeReportDetail(), 1500);
}

// ========== DISCLAIMER ==========
function setupDisclaimer() {
  if (!dom.disclaimerOverlay || !dom.disclaimerBtn) return;
  dom.disclaimerBtn.addEventListener("click", () => {
    dom.disclaimerOverlay.style.display = "none";
    // Start GPS after disclaimer accepted
    startTracking();
  });
}

// ========== EVENT LISTENERS ==========
function setupEvents() {
  // Locate button
  dom.btnLocate.addEventListener("click", locateMe);

  // Zoom
  dom.btnZoomIn.addEventListener("click", () => state.map.zoomIn());
  dom.btnZoomOut.addEventListener("click", () => state.map.zoomOut());

  // Report FAB → open radial
  dom.reportFab.addEventListener("click", openRadialMenu);

  // Radial menu items
  document.querySelectorAll(".radial-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeRadialMenu();
      openReportDetail(btn.dataset.type);
    });
  });

  // Radial cancel
  dom.radialCancel.addEventListener("click", closeRadialMenu);
  dom.radialBackdrop.addEventListener("click", closeRadialMenu);

  // Report detail modal
  dom.reportDetailClose.addEventListener("click", closeReportDetail);
  dom.reportDetailBackdrop.addEventListener("click", closeReportDetail);
  dom.reportSubmitBtn.addEventListener("click", submitReport);

  // Alert banner close
  dom.alertBannerClose.addEventListener("click", () => {
    dom.alertBanner.classList.remove("visible");
    // Dismiss all currently alerted
    state.alertedIncidents.forEach((id) => state.alertDismissed.add(id));
  });

  // Alert banner click → fly to incident
  dom.alertBanner.addEventListener("click", (e) => {
    if (e.target === dom.alertBannerClose) return;
    // Find the alerted incident and fly to it
    for (const inc of state.filteredIncidents) {
      if (state.alertedIncidents.has(inc.id) && !state.alertDismissed.has(inc.id)) {
        state.map.setView([inc.lat, inc.lng], 15, { animate: true });
        break;
      }
    }
    dom.alertBanner.classList.remove("visible");
  });

  // Sheet toggle (mobile)
  dom.sheetToggle.addEventListener("click", () => {
    if (state.sheetState === "peek") setSheetState("half");
    else setSheetState("peek");
  });
}

// ========== REALTIME ==========
function setupRealtime() {
  supabaseClient
    .channel("incidents-changes")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "incidents" },
      (payload) => {
        state.allIncidents.unshift(payload.new);
        applyFilter();
        updateLiveBar();
      }
    )
    .subscribe();
}

// ========== INIT ==========
async function init() {
  cacheDom();
  initMap();
  setupDisclaimer();
  setupFilters();
  setupSheet();
  setupEvents();

  await loadIncidents();
  setupRealtime();

  // Refresh list every 30 seconds
  setInterval(() => {
    renderIncidents();
    updateLiveBar();
  }, 30000);
}

document.addEventListener("DOMContentLoaded", init);
