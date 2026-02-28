const SUPABASE_URL = "https://hcpfhqbcjgdwfqoympni.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjcGZocWJjamdkd2Zxb3ltcG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4NzA5NDQsImV4cCI6MjA4NzQ0Njk0NH0.8pIzPhDXDRWeoJVxc3adomW-XXpIleO07dRV5-hmC2k";

const MINUTES = 60 * 1000;

const INCIDENT_TYPES = {
  FIRE: { label: "Incendio" },
  VEHICLEFIRE: { label: "Incendio" },
  ROADBLOCK: { label: "Bloqueo en vialidad" },
  TIRESPIKES: { label: "Poncha llantas / clavos" },
  SHOOTING: { label: "Balacera / enfrentamiento" },
  CRIME: { label: "Robo / secuestro / extorsión" },
  OTHER: { label: "Otro peligro" },
  BLOCK: { label: "Bloqueo en vialidad" },
  ROBBERY: { label: "Robo" }
};

const TYPE_EMOJIS = {
  FIRE: "🔥",
  VEHICLEFIRE: "🔥",
  ROADBLOCK: "🛑",
  TIRESPIKES: "🛞",
  SHOOTING: "💥",
  CRIME: "🕵️‍♂️",
  OTHER: "⚠️",
  BLOCK: "🛑",
  ROBBERY: "🕵️‍♂️"
};

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const appState = {
  map: null,
  markersLayer: null,
  allIncidents: [],
  pickMode: false,
  selectedLat: null,
  selectedLng: null,
  lastSubmitTs: 0,
  tempPickMarker: null,
  userLocationMarker: null
};

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

function getTypeEmoji(type) {
  return TYPE_EMOJIS[type] || TYPE_EMOJIS.OTHER;
}

function getTypeLabel(type) {
  const info = INCIDENT_TYPES[type] || INCIDENT_TYPES.OTHER;
  const emoji = TYPE_EMOJIS[type] || TYPE_EMOJIS.OTHER;
  return `${emoji} ${info.label}`;
}

function isExpired(incident) {
  if (!incident.created_at) return false;
  const created = new Date(incident.created_at).getTime();
  const DAY_24H = 24 * 60 * 60 * 1000;
  return Date.now() - created > DAY_24H;
}

function formatUpdatedTime(date) {
  const d = date;
  const dia = d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
  const hora = d.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit"
  });
  return `${dia}, ${hora}`;
}

function updateLiveBar() {
  if (!ui.liveUpdated) return;
  ui.liveUpdated.textContent = "Actualizado · " + formatUpdatedTime(new Date());
}

function initMap() {
  const map = L.map("map");
  appState.map = map;

  const jaliscoBounds = L.latLngBounds([19.2, -105.8], [22.1, -101.9]);
  map.fitBounds(jaliscoBounds, { maxZoom: 8 });

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap, © Carto"
    }
  ).addTo(map);

  appState.markersLayer = L.layerGroup().addTo(map);

  const locateControl = L.control({ position: "topright" });
  locateControl.onAdd = function () {
    const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
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
        enableHighAccuracy: true
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

function handleMapClick(e) {
  if (!appState.pickMode) return;

  appState.selectedLat = e.latlng.lat;
  appState.selectedLng = e.latlng.lng;

  const incidentIcon = new L.Icon({
    iconUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  if (!appState.tempPickMarker) {
    appState.tempPickMarker = L.marker([appState.selectedLat, appState.selectedLng], {
      icon: incidentIcon
    }).addTo(appState.map);
  } else {
    appState.tempPickMarker.setLatLng([appState.selectedLat, appState.selectedLng]);
    appState.tempPickMarker.setIcon(incidentIcon);
  }

  appState.pickMode = false;
  if (ui.pickOverlay) ui.pickOverlay.style.display = "none";
  if (ui.pickBackdrop) ui.pickBackdrop.style.display = "none";

  if (ui.reportSheet) {
    ui.reportSheet.classList.add("open");
  }
}

function startPick() {
  appState.pickMode = true;
  if (ui.pickOverlay) ui.pickOverlay.style.display = "block";
  if (ui.pickBackdrop) ui.pickBackdrop.style.display = "block";
}

async function loadIncidents() {
  const { data, error } = await supabaseClient
    .from("incidents")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error("Error cargando incidentes", error);
    return;
  }

  appState.allIncidents = data || [];
  renderIncidents();
  updateLiveBar();
}

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
      lng: Number(inc.lng)
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
        "<div style=\"font-size:22px; line-height:1; text-shadow:0 0 4px rgba(0,0,0,0.7); transform:translate(-50%, -50%);\">" +
        getTypeEmoji(inc.type) +
        "</div>",
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    const marker = L.marker([inc.lat, inc.lng], {
      icon: emojiIcon
    });

    let popupHtml =
      `<div class="popup-content">` +
      `<h3>${getTypeLabel(inc.type)}</h3>` +
      `<p>${inc.description && inc.description !== "EMPTY"
        ? inc.description
        : "Sin descripción"
      }</p>` +
      `<p style="font-size:11px;color:#aaa;">${formatTimeAgo(
        inc.created_at
      )}</p>`;

    if (inc.photo_url) {
      popupHtml +=
        `<p><a href="${inc.photo_url}" target="_blank" rel="noopener" style="color:#ffb300;">Ver foto</a></p>`;
    } else if (inc.evidence_link) {
      popupHtml +=
        `<p><a href="${inc.evidence_link}" target="_blank" rel="noopener" style="color:#ffb300;">Ver evidencia</a></p>`;
    }

    popupHtml += `</div>`;

    marker.bindPopup(popupHtml);
    appState.markersLayer.addLayer(marker);
  });
}

async function uploadPhoto(file) {
  if (!file) return null;

  const ext = file.name.split(".").pop();
  const fileName = `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.${ext}`;
  const filePath = `public/${fileName}`;

  const { error } = await supabaseClient.storage
    .from("incident-photos")
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false
    });

  if (error) {
    console.error("Error subiendo foto", error);
    return null;
  }

  const { data: pub } = supabaseClient.storage
    .from("incident-photos")
    .getPublicUrl(filePath);

  return (pub && pub.publicUrl) || null;
}

async function submitReport({ type, description, evidenceLink, photoFile, statusEl, buttonEl }) {
  if (!type) {
    alert("Selecciona un tipo de incidente.");
    return;
  }
  if (!appState.selectedLat || !appState.selectedLng) {
    alert("Selecciona una ubicación en el mapa.");
    return;
  }
  if (Date.now() - appState.lastSubmitTs < 15000) {
    alert("Espera unos segundos antes de enviar otro reporte.");
    return;
  }

  appState.lastSubmitTs = Date.now();
  buttonEl.disabled = true;
  statusEl.textContent = "Enviando...";
  statusEl.className = "status-msg";

  try {
    let photoUrl = null;
    if (photoFile) {
      photoUrl = await uploadPhoto(photoFile);
    }

    const { error } = await supabaseClient.from("incidents").insert({
      type,
      source: "citizen",
      description,
      lat: appState.selectedLat,
      lng: appState.selectedLng,
      confidence: "low",
      photo_url: photoUrl,
      evidence_link: evidenceLink || null
    });

    if (error) {
      console.error("Error insertando incidente", error);
      statusEl.textContent = "Error al enviar el reporte.";
      statusEl.className = "status-msg status-err";
      return;
    }

    statusEl.textContent = "Reporte enviado.";
    statusEl.className = "status-msg status-ok";

    const newLat = appState.selectedLat;
    const newLng = appState.selectedLng;

    appState.selectedLat = null;
    appState.selectedLng = null;

    if (appState.tempPickMarker) {
      appState.map.removeLayer(appState.tempPickMarker);
      appState.tempPickMarker = null;
    }

    appState.allIncidents.unshift({
      id: crypto.randomUUID(),
      type,
      source: "citizen",
      description,
      lat: newLat,
      lng: newLng,
      confidence: "low",
      photo_url: photoUrl,
      evidence_link: evidenceLink || null,
      created_at: new Date().toISOString()
    });

    renderIncidents();
    updateLiveBar();
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Error inesperado.";
    statusEl.className = "status-msg status-err";
  } finally {
    buttonEl.disabled = false;
  }
}

function bindReportForms() {
  if (ui.submitBtnDesktop) {
    ui.submitBtnDesktop.addEventListener("click", () => {
      const type = ui.typeDesktop.value;
      const desc = ui.descDesktop.value.trim().slice(0, 500);
      const evidence = ui.evidenceDesktop.value.trim();
      const photoFile = ui.photoDesktop.files[0];

      submitReport({
        type,
        description: desc,
        evidenceLink: evidence || null,
        photoFile,
        statusEl: ui.statusDesktop,
        buttonEl: ui.submitBtnDesktop
      });
    });
  }

  if (ui.submitBtnMobile) {
    ui.submitBtnMobile.addEventListener("click", () => {
      const type = ui.typeMobile.value;
      const desc = ui.descMobile.value.trim().slice(0, 500);
      const evidence = ui.evidenceMobile.value.trim();
      const photoFile = ui.photoMobile.files[0];

      submitReport({
        type,
        description: desc,
        evidenceLink: evidence || null,
        photoFile,
        statusEl: ui.statusMobile,
        buttonEl: ui.submitBtnMobile
      });
    });
  }

  if (ui.mapPickDesktop) {
    ui.mapPickDesktop.addEventListener("click", startPick);
  }

  if (ui.mapPickMobile) {
    ui.mapPickMobile.addEventListener("click", () => {
      startPick();
      if (ui.reportSheet) ui.reportSheet.classList.remove("open");
    });
  }
}

function bindTabs() {
  if (ui.tabList && ui.tabReport && ui.incidentsListDesktop && ui.reportPanel) {
    ui.tabList.addEventListener("click", () => {
      ui.tabList.classList.add("active");
      ui.tabReport.classList.remove("active");
      ui.incidentsListDesktop.style.display = "block";
      ui.reportPanel.style.display = "none";
      ui.reportPanel.classList.remove("visible");
    });

    ui.tabReport.addEventListener("click", () => {
      ui.tabReport.classList.add("active");
      ui.tabList.classList.remove("active");
      ui.incidentsListDesktop.style.display = "none";
      ui.reportPanel.style.display = "flex";
      ui.reportPanel.classList.add("visible");
    });
  }

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      renderIncidents();
    });
  });
}

function bindSheet() {
  function openSheet() {
    if (ui.reportSheet) ui.reportSheet.classList.add("open");
  }
  function closeSheet() {
    if (ui.reportSheet) ui.reportSheet.classList.remove("open");
  }

  if (ui.reportFab) ui.reportFab.addEventListener("click", openSheet);
  if (ui.reportSheetClose) ui.reportSheetClose.addEventListener("click", closeSheet);

  if (ui.sheetTabMap && ui.sheetTabReport && ui.sheetViewMap && ui.sheetViewReport) {
    ui.sheetTabMap.addEventListener("click", () => {
      ui.sheetTabMap.classList.add("active");
      ui.sheetTabReport.classList.remove("active");
      ui.sheetViewMap.style.display = "block";
      ui.sheetViewReport.style.display = "none";
    });

    ui.sheetTabReport.addEventListener("click", () => {
      ui.sheetTabReport.classList.add("active");
      ui.sheetTabMap.classList.remove("active");
      ui.sheetViewMap.style.display = "none";
      ui.sheetViewReport.style.display = "block";
    });
  }
}

function bindDisclaimer() {
  if (ui.disclaimerBtn && ui.disclaimerOverlay) {
    ui.disclaimerOverlay.style.display = "flex";
    ui.disclaimerBtn.addEventListener("click", () => {
      ui.disclaimerOverlay.style.display = "none";
    });
  }
}

function initApp() {
  cacheElements();
  initMap();
  bindReportForms();
  bindTabs();
  bindSheet();
  bindDisclaimer();
  loadIncidents();
}

document.addEventListener("DOMContentLoaded", initApp);
