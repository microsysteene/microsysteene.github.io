const API_URL = "https://ticketapi.juhdd.me";
const WS_URL = "wss://ticketapi.juhdd.me";

let activeUploads = [];
const MAX_FILES = 10;
let MAX_DURING_TICKET = 1;

let cryptoKey = null;
let currentFilesList = [];

// --- Init Features (Copy link, etc) ---
function initFeatures() {
  const copyBtn = document.getElementById('copyLink');
  if (copyBtn) {
    copyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const link = window.location.href;
      navigator.clipboard.writeText(link).then(() => {
        const textSpan = document.getElementById('copyText');
        const originalText = textSpan.textContent;
        textSpan.textContent = "Copié !";
        setTimeout(() => textSpan.textContent = originalText, 2000);
      }).catch(console.error);
    });
  }
}

const codeButton = document.getElementById('codebutton');
if (codeButton) {
  codeButton.addEventListener('click', (e) => {
    e.preventDefault();
    navigator.clipboard.writeText(roomCode).then(() => {
      const textSpan = codeButton.querySelector('.text');
      const originalText = textSpan.textContent;
      textSpan.textContent = "Copié";
      setTimeout(() => textSpan.textContent = originalText, 2000);
    });
  });
}

// --- Room Code & Redirect ---
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('room');

if (roomCode) {
  localStorage.setItem('last_room', roomCode);
} else {
  window.location.href = "/";
}

// --- Globals ---
let ws = null;
let currentAnnonce = "";
let lastTicketIds = new Set();
let filterCache = [];
let isRendering = false;
let isRoomAdmin = false;
let isUploading = false;

// --- User ID ---
let userId = localStorage.getItem('userId');
if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem('userId', userId);
}

// --- Loaded Class ---
if (document.readyState === 'complete') {
  document.body.classList.add('loaded');
} else {
  window.addEventListener('load', () => document.body.classList.add('loaded'));
}

// --- Crypto ---
async function initCrypto() {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw", enc.encode(roomCode), "PBKDF2", false, ["deriveKey"]
  );
  cryptoKey = await window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("ticket-static-salt"), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptFile(file) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const buffer = await file.arrayBuffer();
  const encryptedContent = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv }, cryptoKey, buffer
  );
  return new Blob([iv, encryptedContent], { type: 'application/octet-stream' });
}

async function decryptFile(blob) {
  const buffer = await blob.arrayBuffer();
  const iv = buffer.slice(0, 12);
  const data = buffer.slice(12);
  const decryptedContent = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv }, cryptoKey, data
  );
  return new Blob([decryptedContent]);
}

// --- File Sync & Management ---
async function syncRoomFiles() {
  const data = await apiCall(`/api/files/${roomCode}`);
  const filesList = (data && data.files) ? data.files : [];
  currentFilesList = filesList;
  
  renderAnnouncement();
  updateDeleteButtonVisibility();
  renderFormFiles();
}

async function fetchFileContent(fileId) {
  const res = await fetch(`${API_URL}/api/files/download/${fileId}`);
  if (!res.ok) throw new Error('Download Error');
  return await res.blob();
}

async function handleFileDownload(fileId, fileName) {
  try {
    const blobToDecrypt = await fetchFileContent(fileId);
    const clearBlob = await decryptFile(blobToDecrypt);
    const url = URL.createObjectURL(clearBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Decryption/Download error', e);
    alert("Erreur lors du téléchargement.");
  }
}

async function deleteFile(fileId) {
  if (!confirm("Supprimer ce fichier ?")) return;
  try {
    const res = await fetch(`${API_URL}/api/files/${fileId}?userId=${userId}&roomCode=${roomCode}`, { method: 'DELETE' });
    if (res.ok) await syncRoomFiles();
    else alert("Erreur lors de la suppression.");
  } catch (e) {
    console.error('Delete error', e);
  }
}

function renderFormFiles() {
  const container = document.getElementById('fileUploadContainer');
  if (!container) return;

  let listDiv = document.getElementById('adminFilesList');
  if (!listDiv) {
    listDiv = document.createElement('div');
    listDiv.id = 'adminFilesList';
    listDiv.style.marginTop = "10px";
    listDiv.style.width = "100%";
    container.appendChild(listDiv);
  }
  listDiv.innerHTML = '';

  currentFilesList.forEach(f => {
    const item = document.createElement('div');
    item.style.display = "flex";
    item.style.justifyContent = "space-between";
    item.style.alignItems = "center";
    item.style.background = "rgba(0,0,0,0.05)";
    item.style.padding = "5px 10px";
    item.style.marginBottom = "5px";
    item.style.borderRadius = "4px";
    item.style.fontSize = "13px";

    const fName = f.originalName || f.name;
    item.innerHTML = `
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80%;">${fName}</span>
      <button class="del-btn" style="background:none;border:none;color:red;cursor:pointer;font-weight:bold;">✕</button>
    `;
    item.querySelector('.del-btn').onclick = (e) => { e.preventDefault(); deleteFile(f.id); };
    listDiv.appendChild(item);
  });
}

// --- Announcement UI ---
function renderAnnouncement() {
  const msgDiv = document.getElementById('message');
  if (!msgDiv) return;

  if (!currentAnnonce && currentFilesList.length === 0) {
    msgDiv.style.display = 'none';
    return;
  }

  msgDiv.style.display = 'block';
  msgDiv.replaceChildren(); // Efficient clear

  if (currentAnnonce) {
    const textSpan = document.createElement('div');
    textSpan.className = 'message-content';
    textSpan.textContent = currentAnnonce;
    if (currentFilesList.length === 0) textSpan.style.marginBottom = "0";
    msgDiv.appendChild(textSpan);
  }

  if (currentFilesList.length > 0) {
    const filesContainer = document.createElement('div');
    filesContainer.className = 'message-files';
    currentFilesList.forEach(file => {
      const btn = document.createElement('button');
      btn.className = 'message-file-btn';
      const fName = file.originalName || file.name;
      btn.innerHTML = `<span>📎</span> ${fName}`;
      btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); handleFileDownload(file.id, fName); };
      filesContainer.appendChild(btn);
    });
    msgDiv.appendChild(filesContainer);
  }
}

function updateDeleteButtonVisibility() {
  if (isRoomAdmin) {
    const deleteBtn = document.getElementById('deleteAnnonce');
    if (deleteBtn) {
      const hasContent = currentAnnonce || (currentFilesList && currentFilesList.length > 0);
      deleteBtn.style.display = hasContent ? 'flex' : 'none';
    }
  }
}

// --- WebSocket ---
function connectWebSocket() {
  ws = new WebSocket(`${WS_URL}?room=${roomCode}`);
  ws.onopen = () => console.log('WS connected');
  ws.onmessage = (event) => {
    if (event.data === 'ping') { ws.send('pong'); return; }
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'update') { renderTickets(true); checkRoomPermissions(); }
      if (msg.type === 'updateAnnonce') handleAnnonceUpdate(msg.message);
      if (['filesUpdate', 'newFile', 'deleteFile'].includes(msg.type)) syncRoomFiles();
    } catch (e) { console.error('WS parse error', e); }
  };
  ws.onclose = () => setTimeout(connectWebSocket, 3000);
}

function handleAnnonceUpdate(data) {
  currentAnnonce = data.texte || "";
  const color = data.couleur || "#cdcdcd";
  const msgDiv = document.getElementById('message');
  if (msgDiv) msgDiv.style.color = color;
  renderAnnouncement();
  updateDeleteButtonVisibility();
}

// --- API Helpers ---
async function apiCall(endpoint, method = "GET", body = null) {
  try {
    const options = { method, headers: { "Content-Type": "application/json" } };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${API_URL}${endpoint}`, options);
    if (method === "DELETE") return true;
    return await res.json();
  } catch (e) {
    console.error(`API Error ${method}`, e);
    return method === "GET" ? [] : null;
  }
}

// --- Logic & Permissions ---
async function checkRoomPermissions() {
  const roomData = await apiCall(`/api/rooms/${roomCode}`);
  if (!roomData || roomData.error) {
    localStorage.removeItem('last_room');
    alert("Salle introuvable.");
    window.location.href = "/";
    return;
  }
  if (roomData.maxTickets) {
    MAX_DURING_TICKET = roomData.maxTickets;
    const radio = document.querySelector(`input[name="SliderCount"][value="${MAX_DURING_TICKET}"]`);
    if (radio) radio.checked = true;
  }
  setAdminMode(roomData.adminId === userId);
}

async function getTickets() {
  const data = await apiCall(`/api/tickets/${roomCode}`);
  return Array.isArray(data) ? data : [];
}

async function createTicket(ticket) {
  ticket.roomCode = roomCode;
  return await apiCall('/api/tickets', "POST", ticket);
}

async function deleteTicket(id) {
  const endpoint = `/api/tickets/${id}?userId=${userId}&admin=${isRoomAdmin}&roomCode=${roomCode}`;
  await fetch(`${API_URL}${endpoint}`, { method: "DELETE" });
}

async function updateTicket(id, modifications) {
  modifications.roomCode = roomCode;
  await apiCall(`/api/tickets/${id}`, "PUT", modifications);
}

async function fetchAnnonce() {
  const data = await apiCall(`/api/announcement/${roomCode}`);
  if (data) handleAnnonceUpdate(data);
}

async function updateAnnonceApi(text, color = "#cdcdcd") {
  await apiCall(`/api/announcement/${roomCode}`, "PUT", { texte: text, couleur: color, userId: userId });
  currentAnnonce = text;
}

async function loadFilters() {
  try {
    const res = await fetch("./assets/filter.json?cb=" + Date.now());
    if (res.ok) {
        const data = await res.json();
        filterCache = data.banned_terms || [];
    }
  } catch (e) { console.error("Filter load error", e); }
}

// --- Utils ---
function formatTimeElapsed(dateString) {
  if (!dateString) return '';
  const diff = new Date() - new Date(dateString);
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `(${days}j)`;
  if (hours > 0) return `(${hours}h)`;
  return `(${mins}min)`;
}

function rgbToHex(rgbStr) {
  const match = rgbStr.match(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/);
  if (!match) return '#d40000';
  const [r, g, b] = match.slice(1).map(Number);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// --- Rendering ---
async function renderTickets(isExternalUpdate = false) {
  if (isRendering) return;
  isRendering = true;
  const tickets = await getTickets();
  const currentIds = new Set(tickets.map(t => t.id));

  let newTicketId = null;
  if (isExternalUpdate) {
    for (const id of currentIds) {
      if (!lastTicketIds.has(id)) { newTicketId = id; break; }
    }
  }
  lastTicketIds = currentIds;
  updateContainer("right", tickets.filter(t => t.etat === "en cours"), newTicketId, true);
  updateContainer("subdiv", tickets.filter(t => t.etat !== "en cours"), newTicketId, false);
  isRendering = false;
}

function updateContainer(containerId, tickets, newId, isActiveList) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const oldItems = container.querySelectorAll(isActiveList ? '.during' : '.history');
  oldItems.forEach(el => el.remove());
  const oldMsg = container.querySelector('.empty-message');
  if (oldMsg) oldMsg.remove();

  if (tickets.length === 0) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'empty-message';
    msgDiv.textContent = isActiveList ? "<Aucun ticket en cours>" : "<Aucun ticket terminé>";
    container.appendChild(msgDiv);
    return;
  }

  tickets.forEach(t => {
    const div = document.createElement('div');
    div.className = isActiveList ? "during" : "history";
    div.id = t.id;
    if (t.id === newId) {
      div.classList.add('add');
      setTimeout(() => div.classList.remove('add'), 600);
    }

    if (t.couleur?.includes('gradient')) div.style.backgroundImage = t.couleur;
    else div.style.backgroundColor = t.couleur || "#cdcdcd";

    const timeStr = t.dateCreation ? new Date(t.dateCreation).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const canDelete = isRoomAdmin || (isActiveList && t.userId === userId);
    const deleteBtn = canDelete ? `<a class="delete" data-id="${t.id}">—</a>` : "";

    if (isActiveList) {
      let info = `<p id="name">${t.nom}</p>`;
      if (t.description?.trim()) info += `<p id="desc">${t.description}</p>`;
      div.innerHTML = `
        <div class="checkbox" data-id="${t.id}"></div>
        <div class="info">${info}</div>
        <div class="time"><p id="created">${timeStr}</p><p id="remaining">${formatTimeElapsed(t.dateCreation)}</p></div>
        ${deleteBtn}
      `;
    } else {
      div.innerHTML = `
        <p class="name">${t.nom}</p>
        <div class="time"><p class="created">${timeStr}</p><p class="etat">${t.etat}</p></div>
        ${deleteBtn}
      `;
    }
    container.appendChild(div);
  });

  container.querySelectorAll('.delete').forEach(btn => {
    btn.onclick = (e) => handleDeleteClick(e, btn.dataset.id);
  });
}

async function handleDeleteClick(e, id) {
  e.stopPropagation();
  const el = e.target.closest('.during, .history');
  if (!el) return;
  el.classList.add('bounce-reverse');
  el.addEventListener('animationend', async () => {
    await deleteTicket(id);
    el.remove();
    renderTickets();
  }, { once: true });
}

document.getElementById("right").addEventListener("click", async (e) => {
  const checkbox = e.target.closest(".checkbox");
  if (!checkbox) return;
  if (!isRoomAdmin) return alert("Permission refusée.");
  
  const id = checkbox.dataset.id;
  const el = document.getElementById(id);
  el.classList.add("moving");
  el.addEventListener("animationend", async () => {
    await updateTicket(id, { etat: "terminé" });
    renderTickets();
  }, { once: true });
});

function setAdminMode(enable) {
  isRoomAdmin = enable;
  const createBtnText = document.querySelector('#createbutton .text');
  const nameInput = document.getElementById('name');
  const infosInput = document.getElementById('infos');
  const modalTitle = document.getElementById('lefttitle');
  const uploadContainer = document.getElementById('fileUploadContainer');
  const adminSettings = document.getElementById('adminSettingsSection');

  if (enable) {
    if (adminSettings) adminSettings.style.display = 'block';
    if (createBtnText) createBtnText.textContent = "Nouveau message";
    if (nameInput) {
      nameInput.placeholder = "Message";
      if (currentAnnonce) nameInput.value = currentAnnonce;
    }
    if (infosInput) infosInput.style.display = 'none';
    if (modalTitle) modalTitle.textContent = "Nouveau message";
    if (uploadContainer) uploadContainer.style.display = 'flex';
    renderFormFiles();
    updateDeleteButtonVisibility();
  } else {
    if (adminSettings) adminSettings.style.display = 'none';
    if (createBtnText) createBtnText.textContent = "Nouveau ticket";
    if (nameInput) {
      nameInput.placeholder = "Nom";
      nameInput.value = "";
    }
    if (infosInput) infosInput.style.display = 'block';
    if (modalTitle) modalTitle.textContent = "Nouveau ticket";
    if (uploadContainer) uploadContainer.style.display = 'none';
    const deleteBtn = document.getElementById('deleteAnnonce');
    if (deleteBtn) deleteBtn.style.display = 'none';
  }
  renderTickets();
}

// --- Upload Logic ---
function setUploadingState(uploading) {
  isUploading = uploading;
  const warning = document.getElementById('uploadWarning');
  const createBtn = document.getElementById('create');
  const deleteBtn = document.getElementById('deleteAnnonce');
  
  if (uploading) {
    if (warning) warning.style.display = 'block';
    if (createBtn) createBtn.classList.add('button-disabled');
    if (deleteBtn) deleteBtn.classList.add('button-disabled');
  } else if (activeUploads.length === 0) {
    if (warning) warning.style.display = 'none';
    if (createBtn) createBtn.classList.remove('button-disabled');
    if (deleteBtn) deleteBtn.classList.remove('button-disabled');
  }
}

async function uploadFile(file) {
  setUploadingState(true);
  const container = document.getElementById('uploadProgressContainer');
  const uiId = 'up-' + Date.now() + Math.random().toString(36).substr(2, 5);
  const div = document.createElement('div');
  div.className = 'upload-item';
  div.id = uiId;
  div.innerHTML = `
    <div class="upload-info"><span>${file.name.length > 25 ? file.name.substring(0,22)+'...' : file.name}</span><span class="pct">Chiffrement...</span></div>
    <div class="progress-bar-bg"><div class="progress-bar-fill"></div></div>
  `;
  container.appendChild(div);

  try {
    const encryptedBlob = await encryptFile(file);
    div.querySelector('.pct').textContent = "0%";

    const formData = new FormData();
    formData.append('file', encryptedBlob, file.name);
    formData.append('name', file.name);
    formData.append('roomCode', roomCode);
    formData.append('userId', userId);

    const xhr = new XMLHttpRequest();
    activeUploads.push(xhr);
    xhr.open('POST', `${API_URL}/api/files`, true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        div.querySelector('.progress-bar-fill').style.width = percent + '%';
        div.querySelector('.pct').textContent = percent + '%';
      }
    };

    xhr.onload = async () => {
      activeUploads = activeUploads.filter(x => x !== xhr);
      if (xhr.status === 200 || xhr.status === 201) {
        div.querySelector('.pct').textContent = "Terminé";
        div.querySelector('.progress-bar-fill').style.backgroundColor = "#79e056";
        await syncRoomFiles();
        setTimeout(() => { div.remove(); if (activeUploads.length === 0) setUploadingState(false); }, 1000);
      } else {
        div.querySelector('.pct').textContent = "Erreur";
        div.querySelector('.progress-bar-fill').style.backgroundColor = "#ff7070";
        if (activeUploads.length === 0) setUploadingState(false);
      }
    };
    xhr.onerror = () => {
      div.querySelector('.pct').textContent = "Echec";
      activeUploads = activeUploads.filter(x => x !== xhr);
      if (activeUploads.length === 0) setUploadingState(false);
    };
    xhr.send(formData);
  } catch (err) {
    console.error(err);
    div.querySelector('.pct').textContent = "Err Chiffrement";
    if (activeUploads.length === 0) setUploadingState(false);
  }
}

async function handleFormSubmit() {
  if (isUploading || activeUploads.length > 0) return alert("Attendez la fin des uploads.");
  
  const nameInput = document.getElementById('name');
  const infosInput = document.getElementById('infos');
  const name = nameInput.value.trim();
  const description = infosInput.value.trim();
  const hasFiles = currentFilesList.length > 0;

  if (!name && !hasFiles) return alert("Champ vide.");

  const content = (name + " " + description).toLowerCase();
  if (filterCache.some(term => content.includes(term.toLowerCase()))) return alert("Mot interdit.");

  if (isRoomAdmin) {
    const selectedColor = document.querySelector('.color.selected');
    let hexColor = '#d40000';
    if (selectedColor) {
      const bg = selectedColor.style.backgroundImage || selectedColor.style.backgroundColor;
      if (bg) hexColor = rgbToHex(bg) || bg;
    }
    await updateAnnonceApi(name, hexColor);
    document.getElementById('uploadProgressContainer').innerHTML = '';
    closeAllOverlays();
    return;
  }

  const tickets = await getTickets();
  const myActiveTickets = tickets.filter(t => t.etat === "en cours" && t.userId === userId);
  if (myActiveTickets.length >= MAX_DURING_TICKET) return alert("Limite atteinte.");

  const selectedColor = document.querySelector('.color.selected');
  const color = selectedColor ? (selectedColor.style.backgroundImage || selectedColor.style.backgroundColor) : '#cdcdcd';

  await createTicket({ nom: name, description, couleur: color, etat: "en cours", userId });
  nameInput.value = ""; infosInput.value = "";
  closeAllOverlays();
}

function openOverlay(id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = "flex";
    const box = el.querySelector('.menu-box');
    if (box) { box.style.animation = 'none'; box.offsetHeight; box.style.animation = null; }
  }
}

function closeAllOverlays() {
  document.querySelectorAll('.menu-overlay').forEach(el => el.style.display = "none");
  if (activeUploads.length > 0) {
    if(confirm("Annuler les uploads ?")) {
        activeUploads.forEach(xhr => xhr.abort());
        activeUploads = [];
        setUploadingState(false);
        document.getElementById('uploadProgressContainer').innerHTML = '';
    } else {
        openOverlay("formOverlay");
    }
  }
}

// --- Main Init ---
window.addEventListener('DOMContentLoaded', async () => {
  initFeatures();
  await checkRoomPermissions();
  await initCrypto();
  await loadFilters();
  await fetchAnnonce();
  await syncRoomFiles();
  renderTickets();
  connectWebSocket();
  document.querySelector('#codebutton .text').textContent = roomCode;

  // Events setup
  document.getElementById('create').addEventListener('click', (e) => { e.preventDefault(); handleFormSubmit(); });
  document.getElementById('deleteAnnonce')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!isRoomAdmin || activeUploads.length > 0) return;
    if (confirm("Supprimer l'annonce ?")) { await updateAnnonceApi(""); closeAllOverlays(); }
  });
  document.getElementById("createbutton").addEventListener('click', (e) => { e.preventDefault(); openOverlay("formOverlay"); });
  document.getElementById("setting").addEventListener('click', (e) => {
    e.preventDefault(); openOverlay("settingsOverlay");
    const radio = document.querySelector(`input[name="SliderCount"][value="${MAX_DURING_TICKET}"]`);
    if (radio) radio.checked = true;
  });
  
  document.querySelectorAll('input[name="SliderCount"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
        MAX_DURING_TICKET = parseInt(e.target.value);
        if (isRoomAdmin) await apiCall(`/api/rooms/${roomCode}`, "PUT", { maxTickets: MAX_DURING_TICKET });
    });
  });

  document.getElementById("closeSettings")?.addEventListener('click', (e) => { e.preventDefault(); closeAllOverlays(); });
  document.querySelectorAll('.menu-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAllOverlays(); });
  });
  document.getElementById("logout")?.addEventListener('click', (e) => { e.preventDefault(); openOverlay("logoutOverlay"); });
  document.getElementById("cancelLogout")?.addEventListener('click', (e) => { e.preventDefault(); closeAllOverlays(); });
  document.getElementById("confirmLogout")?.addEventListener('click', (e) => { e.preventDefault(); localStorage.removeItem('last_room'); window.location.href = '/'; });

  // Drag & Drop
  const dropArea = document.getElementById('dropArea');
  const fileInput = document.getElementById('fileInput');
  if (dropArea && fileInput) {
    dropArea.addEventListener('click', () => { if (activeUploads.length < MAX_FILES) fileInput.click(); else alert("Limite atteinte."); });
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files);
      if (activeUploads.length + files.length > MAX_FILES) { alert(`Trop de fichiers (max ${MAX_FILES}).`); return; }
      files.forEach(f => uploadFile(f));
      fileInput.value = '';
    });
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => dropArea.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); }));
    dropArea.addEventListener('dragenter', () => dropArea.classList.add('drag-over'));
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));
    dropArea.addEventListener('drop', (e) => {
      dropArea.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files);
      if (activeUploads.length + files.length > MAX_FILES) { alert(`Trop de fichiers.`); return; }
      files.forEach(f => uploadFile(f));
    });
  }
});