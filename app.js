// Configuración de Supabase (backend de datos)
const SUPABASE_URL = "https://hcpfhqbcjgdwfqoympni.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjcGZocWJjamdkd2Zxb3ltcG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4NzA5NDQsImV4cCI6MjA4NzQ0Njk0NH0.8pIzPhDXDRWeoJVxc3adomW-XXpIleO07dRV5-hmC2k";

// Constante para trabajar tiempos en minutos
const MINUTES = 60 * 1000;

// Catálogo de tipos de incidente
const INCIDENT_TYPES = {
  FIRE: { label: "Incendio" },
  VEHICLEFIRE: { label: "Incendio" },
  ROADBLOCK: { label: "Bloqueo en vialidad" },
  TIRESPIKES: { label: "Poncha llantas / clavos" },
  SHOOTING: { label: "Balacera / enfrentamiento" },
  CRIME: { label: "Robo / secuestro / extorsión" },
  OTHER: { label: "Otro peligro" },
  BLOCK: { label: "Bloqueo en vialidad" },
  ROBBERY: { label: "Robo" },
};

// Emoji asociado a cada tipo
const TYPE_EMOJIS = {
  FIRE: "🔥",
  VEHICLEFIRE: "🔥",
  ROADBLOCK: "🛑",
  TIRESPIKES: "🛞",
  SHOOTING: "💥",
  CRIME: "🕵️‍♂️",
  OTHER: "⚠️",
  BLOCK: "🛑",
  ROBBERY: "🕵️‍♂️",
};

// Cliente de Supabase
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Estado global de la app
const appState = {
  map: null,
  markersLayer: null,
  allIncidents: [],
  pickMode: false,
  selectedLat: null,
  selectedLng: null,
  lastSubmitTs: 0,
  tempPickMarker: null,
  userLocationMarker: null,
};

// Referencias a elementos del DOM
const ui = {};

function cacheElements() {
  ui.pickOverlay = document.getElementById("pick-overlay");
  ui.pickBackdrop = document.getElementById("pick-backdrop");
  ui.liveUpdated = document.getElementById("live-updated");
  ui.incidentsListDesktop = document.getElementById("incidents-list");
  ui.incidentsListMobile = document.getElementById("mobile-incidents-list");
  ui.incidentCount = document.getElementById("incident-count");

  ui.submitBtnDesktop = document.getElementById("submit-btn");
  ui.submitBtnMobile = document.getElementById("submit-btn-mobile");
  ui.statusDesktop = document.getElementById("status-msg");
  ui.statusMobile = document.getElementById("status-msg-mobile");

  ui.typeDesktop = document.getElementById("incident-type");
  ui.descDesktop = document.getElementById("incident-desc");
  ui.evidenceDesktop = document.getElementById("incident-evidence");
  ui.photoDesktop = document.getElementById("incident-photo");

  ui.typeMobile = document.getElementById("incident-type-mobile");
  ui.descMobile = document.getElementById("incident-desc-mobile");
  ui.evidenceMobile = document.getElementById("incident-evidence-mobile");
  ui.photoMobile = document.getElementById("incident-photo-mobile");

  ui.mapPickDesktop = document.getElementById("map-pick-btn");
  ui.mapPickMobile = document.getElementById("map-pick-btn-mobile");

  ui.tabList = document.getElementById("tab-list");
  ui.tabReport = document.getElementById("tab-report");
  ui.reportPanel = document.getElementById("report-panel");

  ui.reportSheet = document.getElementById("report-sheet");
  ui.reportFab = document.getElementById("report-fab");
  ui.reportSheetClose = document.getElementById("report-sheet-close");
  ui.sheetTabMap = document.getElementById("sheet-tab-map");
  ui.sheetTabReport = document.getElementById("sheet-tab-report");
  ui.sheetViewMap = document.getElementById("sheet-view-map");
  ui.sheetViewReport = document.getElementById("sheet-view-report");

  ui.disclaimerOverlay = document.getElementById("disclaimer-overlay");
  ui.disclaimerBtn = document.getElementById("disclaimer-accept-btn");
}

// Convierte una marca de tiempo a texto “hace X min/h”
function formatTimeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / MINUTES);
  if (mins < 1) return "Hace instantes";
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return "Hace 1 h";
  return `Hace ${hours} h`;
}

// Emoji por tipo, con fallback
function getTypeEmoji(type) {
  return TYPE_EMOJIS[type] || TYPE_EMOJIS.OTHER;
}

// Texto “emoji + etiqueta” para mostrar tipo de incidente
function getTypeLabel(type) {
  const info = INCIDENT_TYPES[type] || INCIDENT_TYPES.OTHER;
  const emoji = TYPE_EMOJIS[type] || TYPE_EMOJIS.OTHER;
  return `${emoji} ${info.label}`;
}

// Incidente se considera expirado después de 24 horas
function isExpired(incident) {
  if (!incident.created_at) return false;
  const created = new Date(incident.created_at).getTime();
  const DAY_24H = 24 * 60 * 60 * 1000;
  return Date.now() - created > DAY_24H;
}

// Formatea fecha/hora para la barra “Actualizado”
function formatUpdatedTime(date) {
  const d = date;
  const dia = d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const hora = d.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dia}, ${hora}`;
}

// Actualiza texto de la barra EN VIVO
function updateLiveBar() {
  if (!ui.liveUpdated) return;
  ui.liveUpdated.textContent = "Actualizado · " + formatUpdatedTime(new Date());
}

// Inicializa Leaflet, capa base y controles de geolocalización
function initMap() {
  const map = L.map("map");
  appState.map = map;

  const jaliscoBounds = L.latLngBounds(
    [19.2, -105.8],
    [22.1, -101.9]
  );
  map.fitBounds(jaliscoBounds, { maxZoom: 8 });

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
      maxZoom: 19,
      attribution: "© OpenStreetMap, © Carto",
    }
  ).addTo(map);

  appState.markersLayer = L.layerGroup().addTo(map);

  const locateControl = L.control({ position: "topright" });
  locateControl.onAdd = function () {
    const container = L.DomUtil.create(
      "div",
      "leaflet-bar leaflet-control"
    );
    const button = L.DomUtil.create("a", "locate-button", container);
    button.href = "#";
    button.title = "Ir a mi ubicación";
    button.innerHTML = "📍";
    L.DomEvent.on(button, "click", function (e) {
      L.DomEvent.stopPropagation(e);
      L.DomEvent.preventDefault(e);
      map.locate({
        setView: true,
        maxZoom: 15,
        enableHighAccuracy: true,
      });
    });
    return container;
  };
  locateControl.addTo(map);

  map.on("locationfound", (e) => {
    if (!appState.userLocationMarker) {
      appState.userLocationMarker = L.marker(e.latlng).addTo(map);
    } else {
      appState.userLocationMarker.setLatLng(e.latlng);
    }
    appState.userLocationMarker.bindPopup("Estás aquí").openPopup();
  });

  map.on("locationerror", (e) => {
    alert("No se pudo obtener tu ubicación: " + e.message);
  });

  map.on("click", handleMapClick);
}

// Click en el mapa para elegir ubicación del incidente
function handleMapClick(e) {
  if (!appState.pickMode) return;

  appState.selectedLat = e.latlng.lat;
  appState.selectedLng = e.latlng.lng;

  const incidentIcon = new L.Icon({
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });

  if (!appState.tempPickMarker) {
    appState.tempPickMarker = L.marker(
      [appState.selectedLat, appState.selectedLng],
      { icon: incidentIcon }
    ).addTo(appState.map);
  } else {
    appState.tempPickMarker.setLatLng([
      appState.selectedLat,
      appState.selectedLng,
    ]);
  }

  hidePickMode();
}

// Mostrar/ocultar modo de selección en el mapa
function showPickMode() {
  appState.pickMode = true;
  if (ui.pickOverlay) ui.pickOverlay.style.display = "block";
  if (ui.pickBackdrop) ui.pickBackdrop.style.display = "block";
}

function hidePickMode() {
  appState.pickMode = false;
  if (ui.pickOverlay) ui.pickOverlay.style.display = "none";
  if (ui.pickBackdrop) ui.pickBackdrop.style.display = "none";
  if (ui.mapPickDesktop) ui.mapPickDesktop.classList.add("picked");
  if (ui.mapPickMobile) ui.mapPickMobile.classList.add("picked");
}

// Construye un item de incidente para la lista
function buildIncidentItem(inc) {
  const item = document.createElement("div");
  item.className = "incident-item";

  const title = document.createElement("div");
  title.className = "incident-title";
  title.textContent = getTypeLabel(inc.type);
  item.appendChild(title);

  if (inc.description && inc.description !== "EMPTY") {
    const desc = document.createElement("div");
    desc.textContent = inc.description;
    desc.style.fontSize = "11px";
    desc.style.color = "#ccc";
    item.appendChild(desc);
  }

  const time = document.createElement("div");
  time.className = "incident-time";
  time.textContent = formatTimeAgo(inc.created_at);
  item.appendChild(time);

  const tags = document.createElement("div");
  tags.className = "incident-tags";

  const typeTag = document.createElement("span");
  typeTag.className = "tag-pill tag-type";
  typeTag.textContent = getTypeLabel(inc.type);
  tags.appendChild(typeTag);

  const confTag = document.createElement("span");
  confTag.className =
    "tag-pill " +
    (inc.confidence === "high"
      ? "tag-confidence-high"
      : "tag-confidence-low");
  confTag.textContent =
    inc.confidence === "high" ? "Alta confianza" : "Sin confirmar";
  tags.appendChild(confTag);

  if (inc.photo_url || inc.evidence_link) {
    const evTag = document.createElement("span");
    evTag.className = "tag-pill";
    evTag.textContent = "Con evidencia";
    tags.appendChild(evTag);
  }

  item.appendChild(tags);

  item.addEventListener("click", () => {
    if (Number.isFinite(inc.lat) && Number.isFinite(inc.lng)) {
      appState.map.setView([inc.lat, inc.lng], 13);
    }
  });

  return item;
}

// Renderiza incidentes en mapa + listas
function renderIncidents() {
  const listDesktop = ui.incidentsListDesktop;
  const listMobile = ui.incidentsListMobile;
  const countEl = ui.incidentCount;

  appState.markersLayer.clearLayers();
  if (listDesktop) listDesktop.innerHTML = "";
  if (listMobile) listMobile.innerHTML = "";

  const visible = (appState.allIncidents || [])
    .map((inc) => ({
      ...inc,
      lat: Number(inc.lat),
      lng: Number(inc.lng),
    }))
    .filter(
      (inc) =>
        Number.isFinite(inc.lat) &&
        Number.isFinite(inc.lng) &&
        !isExpired(inc)
    );

  if (countEl) countEl.textContent = visible.length.toString();

  visible.forEach((inc) => {
    if (listDesktop) listDesktop.appendChild(buildIncidentItem(inc));
    if (listMobile) listMobile.appendChild(buildIncidentItem(inc));

    const emojiIcon = L.divIcon({
      className: "",
      html:
        `<div style="font-size:20px;text-align:center;">${getTypeEmoji(
          inc.type
        )}</div>`,
    });

    const marker = L.marker([inc.lat, inc.lng], { icon: emojiIcon });
    let popupHtml = `<div style="font-size:13px;font-weight:600;margin-bottom:4px;">${getTypeLabel(
      inc.type
    )}</div>`;

    if (inc.description && inc.description !== "EMPTY") {
      popupHtml += `<div style="font-size:12px;margin-bottom:4px;">${
        inc.description
      }</div>`;
    }

    popupHtml += `<div style="font-size:11px;color:#aaa;margin-bottom:4px;">${formatTimeAgo(
      inc.created_at
    )}</div>`;

    if (inc.photo_url) {
      popupHtml += `<div style="margin-top:4px;"><img src="${
        inc.photo_url
      }" alt="Foto" style="max-width:220px;border-radius:4px;" /></div>`;
    }

    if (inc.evidence_link) {
      popupHtml += `<div style="margin-top:4px;font-size:11px;"><a href="${
        inc.evidence_link
      }" target="_blank" rel="noopener noreferrer">Ver evidencia</a></div>`;
    }

    marker.bindPopup(popupHtml);
    marker.addTo(appState.markersLayer);
  });
}

// Carga incidentes desde Supabase
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

  appState.allIncidents = data || [];
  renderIncidents();
  updateLiveBar();
}

// Envía un incidente nuevo
async function submitIncident(isMobile) {
  const now = Date.now();
  if (now - appState.lastSubmitTs < 15 * 1000) {
    const uiStatus = isMobile ? ui.statusMobile : ui.statusDesktop;
    if (uiStatus) {
      uiStatus.textContent =
        "Espera unos segundos antes de enviar otro reporte.";
      uiStatus.className = "status-msg status-err";
    }
    return;
  }

  const src = isMobile
    ? { type: ui.typeMobile, desc: ui.descMobile, evidence: ui.evidenceMobile }
    : { type: ui.typeDesktop, desc: ui.descDesktop, evidence: ui.evidenceDesktop };

  const typeValue = src.type && src.type.value;
  const description = (src.desc && src.desc.value.trim()) || "EMPTY";
  const evidenceLink = (src.evidence && src.evidence.value.trim()) || null;

  if (!typeValue) {
    const statusEl = isMobile ? ui.statusMobile : ui.statusDesktop;
    if (statusEl) {
      statusEl.textContent = "Selecciona el tipo de incidente.";
      statusEl.className = "status-msg status-err";
    }
    return;
  }

  if (!Number.isFinite(appState.selectedLat) || !Number.isFinite(appState.selectedLng)) {
    const statusEl = isMobile ? ui.statusMobile : ui.statusDesktop;
    if (statusEl) {
      statusEl.textContent = "Elige la ubicación en el mapa.";
      statusEl.className = "status-msg status-err";
    }
    return;
  }

  const payload = {
    type: typeValue,
    description,
    lat: appState.selectedLat,
    lng: appState.selectedLng,
    evidence_link: evidenceLink,
    confidence: "low",
  };

  const btn = isMobile ? ui.submitBtnMobile : ui.submitBtnDesktop;
  const statusEl = isMobile ? ui.statusMobile : ui.statusDesktop;

  if (btn) btn.disabled = true;
  if (statusEl) {
    statusEl.textContent = "Enviando reporte…";
    statusEl.className = "status-msg";
  }

  const { data, error } = await supabaseClient
    .from("incidents")
    .insert(payload)
    .select()
    .single();

  if (btn) btn.disabled = false;

  if (error) {
    console.error("Error enviando incidente:", error);
    if (statusEl) {
      statusEl.textContent = "Error al enviar. Intenta de nuevo.";
      statusEl.className = "status-msg status-err";
    }
    return;
  }

  appState.lastSubmitTs = now;
  appState.allIncidents.unshift(data);
  renderIncidents();
  updateLiveBar();

  if (statusEl) {
    statusEl.textContent = "Reporte enviado. Gracias por contribuir.";
    statusEl.className = "status-msg status-ok";
  }
}

// UI: pestañas sidebar escritorio
function setupDesktopTabs() {
  if (!ui.tabList || !ui.tabReport || !ui.reportPanel) return;

  ui.tabList.addEventListener("click", () => {
    ui.tabList.classList.add("active");
    ui.tabReport.classList.remove("active");
    ui.reportPanel.classList.remove("visible");
  });

  ui.tabReport.addEventListener("click", () => {
    ui.tabReport.classList.add("active");
    ui.tabList.classList.remove("active");
    ui.reportPanel.classList.add("visible");
  });
}

// UI: botón elegir punto en mapa
function setupMapPickButtons() {
  if (ui.mapPickDesktop) {
    ui.mapPickDesktop.addEventListener("click", () => {
      showPickMode();
    });
  }
  if (ui.mapPickMobile) {
    ui.mapPickMobile.addEventListener("click", () => {
      showPickMode();
    });
  }
}

// UI: envío formularios
function setupSubmitButtons() {
  if (ui.submitBtnDesktop) {
    ui.submitBtnDesktop.addEventListener("click", () => submitIncident(false));
  }
  if (ui.submitBtnMobile) {
    ui.submitBtnMobile.addEventListener("click", () => submitIncident(true));
  }
}

// UI: sheet móvil tabs
function setupMobileSheetTabs() {
  const tabMap = ui.sheetTabMap;
  const tabReport = ui.sheetTabReport;
  const viewMap = ui.sheetViewMap;
  const viewReport = ui.sheetViewReport;

  if (!tabMap || !tabReport || !viewMap || !viewReport) return;

  tabMap.addEventListener("click", () => {
    tabMap.classList.add("active");
    tabReport.classList.remove("active");
    viewMap.style.display = "block";
    viewReport.style.display = "none";
  });

  tabReport.addEventListener("click", () => {
    focusMobileReportTab();
  });
}

// UI: FAB sheet móvil
function setupMobileSheetFab() {
  const sheet = ui.reportSheet;
  const fab = ui.reportFab;
  const closeBtn = ui.reportSheetClose;

  if (!sheet || !fab || !closeBtn) return;

  fab.addEventListener("click", () => {
    sheet.classList.add("open");
  });

  closeBtn.addEventListener("click", () => {
    sheet.classList.remove("open");
  });
}

// NUEVO: grid tipos móvil
function setupMobileTypeGrid() {
  const grid = document.getElementById("incident-type-mobile-grid");
  const hiddenInput = document.getElementById("incident-type-mobile");
  if (!grid || !hiddenInput) return;

  grid.addEventListener("click", (ev) => {
    const chip = ev.target.closest(".incident-type-chip");
    if (!chip) return;

    grid
      .querySelectorAll(".incident-type-chip.selected")
      .forEach((el) => el.classList.remove("selected"));

    chip.classList.add("selected");
    hiddenInput.value = chip.dataset.value || "";
  });
}

// NUEVO: pestaña Reportar móvil + geolocalización
function focusMobileReportTab() {
  const tabMap = ui.sheetTabMap;
  const tabReport = ui.sheetTabReport;
  const viewMap = ui.sheetViewMap;
  const viewReport = ui.sheetViewReport;

  if (!tabMap || !tabReport || !viewMap || !viewReport) return;

  tabMap.classList.remove("active");
  tabReport.classList.add("active");
  viewMap.style.display = "none";
  viewReport.style.display = "block";

  if (navigator.geolocation && appState.map) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        appState.selectedLat = latitude;
        appState.selectedLng = longitude;
        appState.map.setView([latitude, longitude], 14);

        if (ui.mapPickMobile) ui.mapPickMobile.classList.add("picked");
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }
}

// NUEVO: disclaimer
function setupDisclaimer() {
  if (!ui.disclaimerOverlay || !ui.disclaimerBtn) return;
  ui.disclaimerBtn.addEventListener("click", () => {
    ui.disclaimerOverlay.style.display = "none";
  });
}

// Inicialización principal
async function init() {
  cacheElements();
  initMap();
  setupDesktopTabs();
  setupMapPickButtons();
  setupSubmitButtons();
  setupMobileSheetTabs();
  setupMobileSheetFab();
  setupMobileTypeGrid();
  setupDisclaimer();

  await loadIncidents();

  // Suscripción en tiempo real (opcional)
  supabaseClient
    .channel("incidents-changes")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "incidents",
      },
      (payload) => {
        appState.allIncidents.unshift(payload.new);
        renderIncidents();
        updateLiveBar();
      }
    )
    .subscribe();
}

document.addEventListener("DOMContentLoaded", init);
