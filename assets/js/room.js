const API_URL = "https://ticketapi.juhdd.me";
const WS_URL = "wss://ticketapi.juhdd.me";

// state
let activeUploads = [];
const MAX_FILES = 10;
let MAX_DURING_TICKET = 1;

// crypto
let cryptoKey = null;

// data
let announcementList = [];
let pendingFiles = [];

// upload state
let isSending = false;
window.currentXhr = null; // store xhr to allow abort
let lastDotInterval = null;

function startTraitementDots(idx) {
  // Clear any existing interval
  if (lastDotInterval) clearInterval(lastDotInterval);
  const txt = document.getElementById(`prog-txt-${idx}`);
  if (!txt) return;
  const states = ['traitement.', 'traitement..', 'traitement...'];
  let i = 0;
  txt.textContent = states[i];
  txt.style.fontSize = '0.8em';
  lastDotInterval = setInterval(() => {
    i = (i + 1) % states.length;
    txt.textContent = states[i];
  }, 500);
}

function stopTraitementDots() {
  if (lastDotInterval) {
    clearInterval(lastDotInterval);
    lastDotInterval = null;
  }
}

function initFeatures() {
  // copy link
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
      }).catch(err => {
        console.error('copy error :', err);
        alert("Échec de la copie du lien.");
      });
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
    })
  })
}

// url params
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('room');

if (roomCode) {
  localStorage.setItem('last_room', roomCode);
}
if (!roomCode) {
  window.location.href = "/";
}

let ws = null;
let lastTicketIds = new Set();
let filterCache = [];
let isRendering = false;
let isRoomAdmin = false;

// cache recent tickets to avoid an extra GET when submitting
let cachedTickets = [];

let userId = localStorage.getItem('userId');
if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem('userId', userId);
}

if (document.readyState === 'complete') {
  document.body.classList.add('loaded');
} else {
  window.addEventListener('load', () => document.body.classList.add('loaded'));
}

// crypto

async function initCrypto() {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(roomCode),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  cryptoKey = await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("ticket-static-salt"),
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  console.log('crypto key ready');
}

// encrypt file
async function encryptFile(file) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const buffer = await file.arrayBuffer();

  const encryptedContent = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    cryptoKey,
    buffer
  );

  return new Blob([iv, encryptedContent], { type: 'application/octet-stream' });
}

// decrypt file
async function decryptFile(blob) {
  const buffer = await blob.arrayBuffer();
  const iv = buffer.slice(0, 12);
  const data = buffer.slice(12);

  const decryptedContent = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    cryptoKey,
    data
  );

  return new Blob([decryptedContent]);
}

// sync

// constants
const MAX_STORAGE_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 Go in bytes

function formatBytes(bytes) {
  if (bytes === 0) return '0.00 Go';
  const sizes = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = (bytes / Math.pow(1024, i)).toFixed(2);
  // force display in Go if close to it, purely for ui match
  if (i < 3) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' Go';
  return `${val} ${sizes[i]}`;
}

// update storage ui based on files
function updateStorageUI() {
  let totalBytes = 0;
  let totalFiles = 0;

  announcementList.forEach(a => {
    if (a.files && a.files.length > 0) {
      totalFiles += a.files.length;
      a.files.forEach(f => totalBytes += f.size);
    }
  });

  const sizeText = document.getElementById('storageText');
  const countText = document.getElementById('fileCountText');
  const bar = document.getElementById('storageProgressBar');
  
  if (sizeText) sizeText.textContent = formatBytes(totalBytes) + ' / 1.5 Go';
  if (countText) countText.textContent = `${totalFiles} fichier${totalFiles > 1 ? 's' : ''} partagé${totalFiles > 1 ? 's' : ''}`;

  let pct = (totalBytes / MAX_STORAGE_BYTES) * 100;
  if (pct < 5 && totalBytes > 0) pct = 5;
  if (pct > 100) pct = 100;
  if (bar) bar.style.width = `${pct}%`;


  const stack1 = document.getElementById('stackCard1');
  const stack2 = document.getElementById('stackCard2');
  

  const setStackCardStyle = (cardElement, annonce) => {
    if (!cardElement) return;
    
    if (!annonce) {
      cardElement.style.display = 'none';
      return;
    }

    cardElement.style.display = 'flex'; 
    

    if (annonce.color && annonce.color.includes('gradient')) {
        cardElement.style.backgroundImage = annonce.color;
        cardElement.style.backgroundColor = '';
    } else {
        cardElement.style.backgroundColor = annonce.color || '#cdcdcd';
        cardElement.style.backgroundImage = '';
    }


    cardElement.innerHTML = `
        <div style="
            width: 100%; 
            padding: 0 25px; 
            margin-top: 38px; 
            display: flex; 
            align-items: center; 
            gap: 10px; 
            opacity: 0.7;
        ">
            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; font-size: 0.9rem;">
                ${annonce.content || (annonce.files.length + ' fichier(s)')}
            </span>
        </div>
    `;
  };


  setStackCardStyle(stack1, announcementList[0]);
  setStackCardStyle(stack2, announcementList[1]);
}

// modified sync function
async function syncAnnouncements() {
  const data = await apiCall(`/api/announcements/${roomCode}`);

  if (Array.isArray(data)) {
    announcementList = data;
    updateStorageUI(); // calc size
    renderAnnouncement();
  }
}

// setup interaction
function setupStorageWidget() {
  const widget = document.getElementById('storageWidget');
  const container = document.getElementById('announcementContainer');
  const closeBtn = document.getElementById('closeStorageBtn');
  const list = document.getElementById('announcementArea');

  if (!widget || !container) return;

  // open on main click
  widget.addEventListener('click', (e) => {
    // ignore if clicking close button
    if (e.target.closest('.close-storage')) return;
    
    if (!container.classList.contains('open')) {
      container.classList.add('open');
      list.classList.remove('hidden');
    }
  });

  // close on x button
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent reopen
      container.classList.remove('open');
      list.classList.add('hidden');
    });
  }
}

async function fetchFileContent(fileId) {
  const res = await fetch(`${API_URL}/api/files/download/${fileId}`);
  if (!res.ok) throw new Error('download error');
  return await res.blob();
}

async function handleFileDownload(fileId, fileName) {
  console.log(`[LOG] download started: ${fileName} (id: ${fileId})`);

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
    console.error('download/decrypt error', e);
    alert("Erreur lors du téléchargement.");
  }
}

// ui

function renderPendingFiles() {
  const listDiv = document.getElementById('adminFilesList');
  if (!listDiv) return;

  listDiv.innerHTML = '';

  pendingFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'admin-file-item';

    const fileSize = (file.size / (1024 * 1024)).toFixed(1);

    // render with progress bar structure
    item.innerHTML = `
      <div class="file-progress-bar" id="prog-bar-${index}"></div>
      <div class="admin-file-info">
        <span class="admin-file-name">${file.name}</span>
        <span class="admin-file-size">${fileSize} Mo</span>
        <span class="file-progress-pct" id="prog-txt-${index}"></span>
      </div>
      <button class="admin-file-delete" data-idx="${index}" title="Retirer">×</button>
    `;

    // remove from pending list with check
    item.querySelector('.admin-file-delete').addEventListener('click', (e) => {
      e.preventDefault();
      if (isSending) return alert("Upload en cours, impossible de retirer.");

      pendingFiles.splice(index, 1);
      renderPendingFiles();
    });

    listDiv.appendChild(item);
  });
}

function renderAnnouncement() {
  const container = document.getElementById('announcementArea');
  const leftContainer = document.querySelector('.left-container');

  if (!container) return;

  container.innerHTML = '';

  if (leftContainer) {
    if (announcementList.length === 0) {
      leftContainer.style.gap = '0px';
    } else {
      leftContainer.style.gap = '';
    }
  }

  announcementList.forEach(annonce => {
    const wrapper = document.createElement('div');
    wrapper.className = 'announcement-wrapper';


    const hasText = annonce.content && annonce.content.trim() !== "";

    const msgDiv = document.createElement('div');
    msgDiv.className = 'announcement-item';

    if (annonce.color && annonce.color.includes('gradient')) {
      msgDiv.style.backgroundImage = annonce.color;
    } else {
      msgDiv.style.backgroundColor = annonce.color || '#cdcdcd';
    }

    msgDiv.style.display = 'flex';
    msgDiv.style.flexDirection = 'column';
    msgDiv.style.justifyContent = 'center';
    msgDiv.style.gap = '8px';

    if (hasText) {
      const textRow = document.createElement('div');
      textRow.style.display = 'flex';
      textRow.style.justifyContent = 'space-between';
      textRow.style.alignItems = 'center';
      textRow.style.width = '100%';

      const deleteBtn = isRoomAdmin ? `
            <button class="announcement-delete" title="Supprimer">
                <img src="./assets/icon/delete.png" alt="X">
            </button>
        ` : '';

      textRow.innerHTML = `
            <div class="announcement-content" style="width:100%;">
                <span class="announcement-text">${annonce.content}</span>
            </div>
            <div class="announcement-actions">
                ${deleteBtn}
            </div>
        `;

      if (isRoomAdmin) {
        const btn = textRow.querySelector('.announcement-delete');
        if (btn) btn.addEventListener('click', (e) => handleDeleteAnnouncement(e, annonce.id, wrapper));
      }

      msgDiv.appendChild(textRow);
    }

    if (annonce.files && annonce.files.length > 0) {
      const fileContainer = document.createElement('div');
      fileContainer.style.display = 'flex';
      fileContainer.style.flexDirection = 'column';
      fileContainer.style.gap = '4px';
      fileContainer.style.width = '100%';

      annonce.files.forEach(file => {
        const fileRow = document.createElement('div');
        fileRow.style.display = 'flex';
        fileRow.style.alignItems = 'center';
        fileRow.style.justifyContent = 'space-between';
        fileRow.style.padding = '4px 0px';
        fileRow.style.borderRadius = '4px';
        fileRow.style.fontSize = '0.85em';

        const fName = file.originalName || file.name;
        const ext = fName.split('.').pop().toUpperCase();
        const size = (file.size / 1024 / 1024).toFixed(1);

        const leftPart = document.createElement('div');
        leftPart.style.display = 'flex';
        leftPart.style.alignItems = 'center';
        leftPart.style.gap = '6px';
        leftPart.style.overflow = 'hidden';

        leftPart.innerHTML = `
                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600;" title="${fName}">${fName}</span>
                <span style="opacity:0.7; font-size:0.9em;">(${ext} • ${size} Mo)</span>
            `;

        const actionsPart = document.createElement('div');
        actionsPart.style.display = 'flex';
        actionsPart.style.alignItems = 'center';
        actionsPart.style.gap = '8px';
        const dlBtn = document.createElement('button');
        dlBtn.className = 'announcement-action-btn';
        dlBtn.innerHTML = `<img src="./assets/icon/download.png" style="width:18px; height:18px;">`;
        dlBtn.title = "Télécharger";
        dlBtn.onclick = (e) => {
          e.preventDefault();
          handleFileDownload(file.id, fName);
        };
        actionsPart.appendChild(dlBtn);

        if (isRoomAdmin) {
          const fileDelBtn = document.createElement('button');
          fileDelBtn.className = 'announcement-action-btn';
          fileDelBtn.style.borderColor = '#000000';
          fileDelBtn.innerHTML = `<img src="./assets/icon/delete.png" style="width:18px; height:18px;">`;
          fileDelBtn.title = "Supprimer ce fichier";

          fileDelBtn.onclick = (e) => handleDeleteFile(e, annonce.id, file.id, fileRow);
          actionsPart.appendChild(fileDelBtn);
        }

        fileRow.appendChild(leftPart);
        fileRow.appendChild(actionsPart);
        fileContainer.appendChild(fileRow);
      });

      msgDiv.appendChild(fileContainer);
    }

    wrapper.appendChild(msgDiv);
    container.appendChild(wrapper);
  });
}

async function handleDeleteAnnouncement(e, id, domElement) {
  e.preventDefault();
  if (!confirm("Supprimer cette annonce et ses fichiers ?")) return;

  domElement.style.opacity = '0.5';

  try {
    const res = await fetch(`${API_URL}/api/announcements/${id}?userId=${userId}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      domElement.remove();
      await syncAnnouncements();
    } else {
      alert("Erreur suppression.");
      domElement.style.opacity = '1';
    }
  } catch (err) {
    console.error(err);
    domElement.style.opacity = '1';
  }
}

async function handleDeleteFile(e, announcementId, fileId, domElement) {
  e.preventDefault();
  if (!confirm("Supprimer ce fichier ?")) return;

  domElement.style.opacity = '0.5';

  try {
    const res = await fetch(`${API_URL}/api/announcements/${announcementId}/files/${fileId}?userId=${userId}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      domElement.remove();
      await syncAnnouncements();
    } else {
      alert("Erreur suppression fichier.");
      domElement.style.opacity = '1';
    }
  } catch (err) {
    console.error(err);
    domElement.style.opacity = '1';
  }
}

// websocket

function connectWebSocket() {
  ws = new WebSocket(`${WS_URL}?room=${roomCode}`);

  ws.onopen = () => console.log('ws connected', roomCode);
  ws.onmessage = (event) => {
    if (event.data === 'ping') {
      ws.send('pong');
      return;
    }
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'update') {
        renderTickets(true);
        checkRoomPermissions();
      }
      if (msg.type === 'updateAnnonce') {
        syncAnnouncements();
      }
    } catch (e) {
      console.error('ws error', e);
    }
  };
  ws.onerror = (err) => console.error('ws error', err);

  ws.onclose = () => {
    console.log('ws closed, retry in 3s');
    setTimeout(connectWebSocket, 3000);
  };
}

// api

async function apiCall(endpoint, method = "GET", body = null) {
  try {
    const options = {
      method,
      headers: { "Content-Type": "application/json" }
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${API_URL}${endpoint}`, options);
    if (method === "DELETE") return true;
    return await res.json();
  } catch (e) {
    console.error(`api error ${method}`, e);
    return method === "GET" ? [] : null;
  }
}

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

  if (roomData.adminId === userId) setAdminMode(true);
  else setAdminMode(false);
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

async function loadFilters() {
  try {
    const res = await fetch("./assets/filter.json?cb=" + Date.now());
    if (!res.ok) throw new Error("Erreur filter.json");
    const data = await res.json();
    filterCache = data.banned_terms || [];
  } catch (error) {
    console.error("Erreur filtre:", error);
    filterCache = [];
  }
}

// utils

function formatTimeElapsed(dateString) {
  if (!dateString) return '';
  const diff = new Date() - new Date(dateString);
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `(${days}j)`;
  if (hours > 0) return `(${hours}h)`;
  return `(${mins}mins)`;
}

function rgbToHex(rgbStr) {
  const match = rgbStr.match(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/);
  if (!match) return '#d40000';
  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// tickets

async function renderTickets(isExternalUpdate = false) {
  if (isRendering) return;
  isRendering = true;
  const tickets = await getTickets();
  // keep a local cache of the last fetched tickets to avoid refetching
  cachedTickets = tickets;
  const currentIds = new Set(tickets.map(t => t.id));

  let newTicketId = null;
  if (isExternalUpdate) {
    for (const id of currentIds) {
      if (!lastTicketIds.has(id)) {
        newTicketId = id;
        break;
      }
    }
  }
  lastTicketIds = currentIds;
  const listActive = tickets.filter(t => t.etat === "en cours");
  const listHistory = tickets.filter(t => t.etat !== "en cours");
  updateContainer("right", listActive, newTicketId, true);
  updateContainer("subdiv", listHistory, newTicketId, false);
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

    const timeStr = t.dateCreation
      ? new Date(t.dateCreation).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    const canDelete = isRoomAdmin || (isActiveList && t.userId === userId);
    const deleteBtn = canDelete ? `<a class="delete" data-id="${t.id}">—</a>` : "";

    if (isActiveList) {
      let info = `<p id="name">${t.nom}</p>`;
      if (t.description?.trim()) info += `<p id="desc">${t.description}</p>`;

      div.innerHTML = `
        <div class="checkbox" data-id="${t.id}"></div>
        <div class="info">${info}</div>
        <div class="time">
          <p id="created">${timeStr}</p>
          <p id="remaining">${formatTimeElapsed(t.dateCreation)}</p>
        </div>
        ${deleteBtn}
      `;
    } else {
      div.innerHTML = `
        <p class="name">${t.nom}</p>
        <div class="time">
          <p class="created">${timeStr}</p>
          <p class="etat">${t.etat}</p>
        </div>
        ${deleteBtn}
      `;
    }
    container.appendChild(div);
  });

  container.querySelectorAll('.delete').forEach(btn => btn.onclick = (e) => handleDeleteClick(e, btn.dataset.id));
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
  const id = checkbox.dataset.id;
  const el = document.getElementById(id);

  if (!isRoomAdmin) {
    alert("Permission refusée.");
    return;
  }
  el.classList.add("moving");
  el.addEventListener("animationend", async () => {
    await updateTicket(id, { etat: "terminé" });
    renderTickets();
  }, { once: true });
});

// admin

function setAdminMode(enable) {
  isRoomAdmin = enable;
  const createBtnText = document.querySelector('#createbutton .text');
  const nameInput = document.getElementById('name');
  const infosInput = document.getElementById('infos');
  const modalTitle = document.querySelector('#formOverlay h1');
  const uploadContainer = document.getElementById('fileUploadContainer');
  const adminSettings = document.getElementById('adminSettingsSection');

  if (enable) {
    if (adminSettings) adminSettings.style.display = 'block';

    if (createBtnText) createBtnText.textContent = "Nouveau message";
    if (nameInput) {
      nameInput.placeholder = "Message";
      nameInput.value = "";
    }
    if (infosInput) infosInput.style.display = 'none';
    if (modalTitle) modalTitle.textContent = "Nouveau message";

    if (uploadContainer) uploadContainer.style.display = 'flex';

    pendingFiles = [];
    renderPendingFiles();

  } else {
    if (adminSettings) adminSettings.style.display = 'none';

    if (createBtnText) createBtnText.textContent = "Nouveau tickets";
    if (nameInput) {
      nameInput.placeholder = "Nom";
      nameInput.value = "";
    }
    if (infosInput) infosInput.style.display = 'block';
    if (modalTitle) modalTitle.textContent = "Nouveau ticket";

    if (uploadContainer) uploadContainer.style.display = 'none';
  }

  syncAnnouncements();
  renderTickets();
}

// submission

// global var to handle abort
window.currentXhr = null;

async function handleFormSubmit() {
  if (isSending) return;

  const nameInput = document.getElementById('name');
  const infosInput = document.getElementById('infos');
  const name = nameInput.value.trim();
  const description = infosInput.value.trim();

  // bad words check
  const content = (name + " " + description).toLowerCase();
  const forbidden = filterCache.find(term => content.includes(term.toLowerCase()));
  if (forbidden) return alert("Mot interdit détecté.");

  // --- ADMIN LOGIC ---
  if (isRoomAdmin) {
    if (!name && pendingFiles.length === 0) {
      return alert("Message ou fichier requis.");
    }

    isSending = true;
    const createBtn = document.getElementById('create');
    if (createBtn) createBtn.classList.add('button-disabled');

    try {
      const formData = new FormData();
      formData.append('roomCode', roomCode);
      formData.append('userId', userId);
      formData.append('content', name);

      // color
      const selectedColor = document.querySelector('.color.selected');
      let hexColor = '#d40000';
      if (selectedColor) {
        const bg = selectedColor.style.backgroundImage || selectedColor.style.backgroundColor;
        if (bg) hexColor = rgbToHex(bg) || bg;
      }
      formData.append('color', hexColor);

      // Store encrypted blobs separately to calculate individual progress
      const encryptedFilesList = [];

      // encrypt files
      if (pendingFiles.length > 0) {
        // visual feedback: encrypting
        pendingFiles.forEach((_, idx) => {
          const txt = document.getElementById(`prog-txt-${idx}`);
          if (txt) txt.textContent = "Crypto...";
        });

        for (const file of pendingFiles) {
          const encryptedBlob = await encryptFile(file);
          // add to list for size calculation
          encryptedFilesList.push(encryptedBlob);
          // add to form data
          formData.append('files', encryptedBlob, file.name);
        }
      }

      // upload with XHR for progress
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        window.currentXhr = xhr; // save reference

        xhr.open('POST', `${API_URL}/api/announcements`, true);

        // clear any previous animation
        stopTraitementDots();

        // tracking upload progress individually
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            let remainingLoaded = e.loaded;

            encryptedFilesList.forEach((blob, idx) => {
              const bar = document.getElementById(`prog-bar-${idx}`);
              const txt = document.getElementById(`prog-txt-${idx}`);
              const fileSize = blob.size;

              let percent = 0;

              if (remainingLoaded >= fileSize) {
                percent = 100;
                remainingLoaded -= fileSize;
              } else if (remainingLoaded > 0) {
                percent = Math.round((remainingLoaded / fileSize) * 100);
                remainingLoaded = 0;
              } else {
                percent = 0;
              }

              if (bar) bar.style.width = `${percent}%`;
              if (txt) {
                if (percent === 100) {
                  // If this is the last file, show animated "traitement...", otherwise show "terminé"
                  if (idx === encryptedFilesList.length - 1) {
                    startTraitementDots(idx);
                  } else {
                    // stop any dot animation (ensure only last animates)
                    txt.textContent = 'terminé';
                    txt.style.fontSize = '';
                  }
                } else {
                  txt.textContent = `${percent}%`;
                }
              }
            });
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            // Force all bars to 100% and set final texts:
            encryptedFilesList.forEach((_, idx) => {
              const bar = document.getElementById(`prog-bar-${idx}`);
              const txt = document.getElementById(`prog-txt-${idx}`);
              if (bar) bar.style.width = '100%';
              if (txt) {
                if (idx === encryptedFilesList.length - 1) {
                  startTraitementDots(idx);
                } else {
                  txt.textContent = 'terminé';
                  txt.style.fontSize = '';
                }
              }
            });
            resolve(xhr.response);
          } else reject(new Error("Upload failed"));
        };

        xhr.onerror = () => { stopTraitementDots(); reject(new Error("Network error")); };
        xhr.onabort = () => { stopTraitementDots(); reject(new Error("Aborted")); };

        xhr.send(formData);
      });

      // success: keep the last-file animation visible briefly, then clear it and UI
      await new Promise(res => setTimeout(res, 1200));
      stopTraitementDots();

      closeAllOverlays();
      nameInput.value = "";
      pendingFiles = []; // clear list
      renderPendingFiles();
      await syncAnnouncements();

    } catch (e) {
      if (e.message !== "Aborted") {
        console.error(e);
        alert("Erreur: " + e.message);
        // reset bars on error
        renderPendingFiles();
      }
    } finally {
      isSending = false;
      window.currentXhr = null;
      if (createBtn) createBtn.classList.remove('button-disabled');
    }
    return;
  }

  // --- USER LOGIC (inchangé) ---
  // use cached tickets if available to avoid an extra network roundtrip
  const tickets = cachedTickets.length ? cachedTickets : await getTickets();
  const myActiveTickets = tickets.filter(t => t.etat === "en cours" && t.userId === userId);
  if (myActiveTickets.length >= MAX_DURING_TICKET) return alert("Limite atteinte.");
  if (!name) return alert("Nom requis.");

  const selectedColor = document.querySelector('.color.selected');
  const color = selectedColor ? (selectedColor.style.backgroundImage || selectedColor.style.backgroundColor) : '#cdcdcd';

  await createTicket({ nom: name, description, couleur: color, etat: "en cours", userId });
  nameInput.value = "";
  infosInput.value = "";
  closeAllOverlays();
}

// safe close
function tryCloseOverlay() {
  if (isSending) {
    if (!confirm("Envoi en cours. Annuler l'envoi ?")) return;

    if (window.currentXhr) {
      window.currentXhr.abort();
    }
    isSending = false;
    renderPendingFiles();
  } else if (pendingFiles.length > 0) {
    if (!confirm("Fichiers non envoyés. Fermer et supprimer les fichiers ?")) return;
    pendingFiles = [];
    renderPendingFiles();
  }

  closeAllOverlays();
}

// ui init

function openOverlay(id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = "flex";
  }
}

function closeAllOverlays() {
  document.querySelectorAll('.menu-overlay').forEach(el => el.style.display = "none");
}

window.addEventListener('DOMContentLoaded', async () => {
  initFeatures();
  await checkRoomPermissions();
  await initCrypto();
  await loadFilters();

  await syncAnnouncements();

  setupStorageWidget();

  renderTickets();
  connectWebSocket();

  document.querySelector('#codebutton .text').textContent = roomCode;

  document.getElementById('create').addEventListener('click', (e) => {
    e.preventDefault();
    handleFormSubmit();
  });

  document.getElementById("createbutton").addEventListener('click', (e) => {
    e.preventDefault();
    openOverlay("formOverlay");
  });

  document.getElementById("setting").addEventListener('click', (e) => {
    e.preventDefault();
    openOverlay("settingsOverlay");
    const radio = document.querySelector(`input[name="SliderCount"][value="${MAX_DURING_TICKET}"]`);
    if (radio) radio.checked = true;
  });

  document.querySelectorAll('input[name="SliderCount"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      const val = parseInt(e.target.value);
      MAX_DURING_TICKET = val;
      if (isRoomAdmin) {
        await apiCall(`/api/rooms/${roomCode}`, "PUT", { maxTickets: val });
      }
    });
  });

  document.getElementById("closeSettings")?.addEventListener('click', (e) => {
    e.preventDefault();
    closeAllOverlays();
  });

  // safe overlay close logic
  document.querySelectorAll('.menu-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        if (overlay.id === 'formOverlay') {
          tryCloseOverlay();
        } else {
          closeAllOverlays();
        }
      }
    });
  });

  document.getElementById("logout")?.addEventListener('click', (e) => {
    e.preventDefault();
    openOverlay("logoutOverlay");
  });
  document.getElementById("cancelLogout")?.addEventListener('click', (e) => {
    e.preventDefault();
    closeAllOverlays();
  });
  document.getElementById("confirmLogout")?.addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('last_room');
    window.location.href = '/';
  });

  // file input
  const dropArea = document.getElementById('dropArea');
  const fileInput = document.getElementById('fileInput');

  if (dropArea && fileInput) {
    dropArea.addEventListener('click', () => {
      if (pendingFiles.length >= MAX_FILES) return alert("Limite atteinte.");
      fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files);
      if (files.length === 0) return;

      if (pendingFiles.length + files.length > MAX_FILES) {
        alert(`Trop de fichiers (max ${MAX_FILES}).`);
        fileInput.value = '';
        return;
      }

      pendingFiles = [...pendingFiles, ...files];
      renderPendingFiles();
      fileInput.value = '';
    });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    });

    dropArea.addEventListener('dragenter', () => dropArea.classList.add('drag-over'));
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));

    dropArea.addEventListener('drop', (e) => {
      dropArea.classList.remove('drag-over');
      const dt = e.dataTransfer;
      const files = Array.from(dt.files);

      if (pendingFiles.length + files.length > MAX_FILES) {
        alert(`Trop de fichiers (max ${MAX_FILES}).`);
        return;
      }

      pendingFiles = [...pendingFiles, ...files];
      renderPendingFiles();
    });
  }
});