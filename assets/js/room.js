const API_URL = "https://ticketapi.juhdd.me";
const WS_URL = "wss://ticketapi.juhdd.me";

// state
let activeUploads = []; 
const MAX_FILES = 10;
let MAX_DURING_TICKET = 1;

// crypto globals
let cryptoKey = null; 

// data globals
let announcementList = []; // stores all announcements
let pendingFiles = []; // files waiting to be sent (admin)

// copy features
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

// copy code
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
let isSending = false; // replaces isUploading for form submit

let userId = localStorage.getItem('userId');
if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem('userId', userId);
}

// loaded class
if (document.readyState === 'complete') {
  document.body.classList.add('loaded');
} else {
  window.addEventListener('load', () => document.body.classList.add('loaded'));
}

// --- crypto ---

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

// encrypt file (returns blob with iv)
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

// decrypt blob
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

// --- sync & data ---

// fetch all announcements
async function syncAnnouncements() {
  const data = await apiCall(`/api/announcements/${roomCode}`);
  
  if (Array.isArray(data)) {
    announcementList = data;
    renderAnnouncement();
  }
}

// fetch encrypted content
async function fetchFileContent(fileId) {
  const res = await fetch(`${API_URL}/api/files/download/${fileId}`);
  if (!res.ok) throw new Error('download error');
  return await res.blob();
}

// handle download
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

// --- ui render ---

// render pending files in admin form
function renderPendingFiles() {
  const listDiv = document.getElementById('adminFilesList');
  if (!listDiv) return;

  listDiv.innerHTML = '';

  pendingFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'admin-file-item';
    
    const fileSize = (file.size / (1024 * 1024)).toFixed(1);

    item.innerHTML = `
      <div class="admin-file-info">
        <span class="admin-file-name">${file.name}</span>
        <span class="admin-file-size">${fileSize} Mo</span>
      </div>
      <button class="admin-file-delete" data-idx="${index}" title="Retirer">×</button>
    `;

    // remove from pending list
    item.querySelector('.admin-file-delete').addEventListener('click', (e) => {
      e.preventDefault();
      pendingFiles.splice(index, 1);
      renderPendingFiles();
    });

    listDiv.appendChild(item);
  });
}

// render main announcements stream
function renderAnnouncement() {
  const container = document.getElementById('announcementArea');
  if (!container) return;

  container.innerHTML = '';

  // loop through all announcements
  announcementList.forEach(annonce => {
    const wrapper = document.createElement('div');
    wrapper.className = 'announcement-wrapper'; // container for grouped items
    wrapper.style.marginBottom = "15px";

    // 1. render text part
    if (annonce.content && annonce.content.trim() !== "") {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'announcement-item';
        
        // background color
        if (annonce.color && annonce.color.includes('gradient')) {
            msgDiv.style.backgroundImage = annonce.color;
        } else {
            msgDiv.style.backgroundColor = annonce.color || '#cdcdcd';
        }

        // admin delete button for whole announcement
        const deleteBtn = isRoomAdmin ? `
            <button class="announcement-delete" title="Supprimer l'annonce">
                <img src="./assets/icon/delete.png" alt="X">
            </button>
        ` : '';

        msgDiv.innerHTML = `
            <div class="announcement-content">
                <img src="./assets/icon/icon thin.png" class="announcement-icon" style="opacity:0.6;">
                <span class="announcement-text">${annonce.content}</span>
            </div>
            <div class="announcement-actions">
                ${deleteBtn}
            </div>
        `;

        if (isRoomAdmin) {
            const btn = msgDiv.querySelector('.announcement-delete');
            btn.addEventListener('click', (e) => handleDeleteAnnouncement(e, annonce.id, wrapper));
        }

        wrapper.appendChild(msgDiv);
    } else if (isRoomAdmin && annonce.files && annonce.files.length > 0) {
        // if no text but has files, add a small delete button header or attach delete to first file?
        // simple approach: rendering a small "delete group" button if strictly no text
        const toolsDiv = document.createElement('div');
        toolsDiv.style.textAlign = 'right';
        toolsDiv.style.marginBottom = '5px';
        toolsDiv.innerHTML = `<button class="text-xs text-red-500 hover:underline">Supprimer ce groupe</button>`;
        toolsDiv.querySelector('button').addEventListener('click', (e) => handleDeleteAnnouncement(e, annonce.id, wrapper));
        wrapper.appendChild(toolsDiv);
    }

    // 2. render files part
    if (annonce.files && annonce.files.length > 0) {
        annonce.files.forEach(file => {
            const fileDiv = document.createElement('div');
            fileDiv.className = 'announcement-item';
            fileDiv.style.backgroundColor = '#ffffff';
            fileDiv.style.marginTop = '4px'; // small gap between text and file

            const fName = file.originalName || file.name;
            const ext = fName.split('.').pop(); 

            fileDiv.innerHTML = `
                <div class="announcement-content">
                    <img src="./assets/icon/icon thin.png" class="announcement-icon" style="filter:grayscale(1);">
                    <span class="announcement-text" title="${fName}">${fName}</span>
                    <span class="announcement-subtext">${ext.toUpperCase()} • ${(file.size/1024/1024).toFixed(1)} Mo</span>
                </div>
                <div class="announcement-actions">
                    <button class="announcement-action-btn download-trigger">
                        <img src="./assets/icon/icon thin.png" style="width:16px; transform:rotate(180deg);">
                    </button>
                </div>
            `;

            const dlBtn = fileDiv.querySelector('.download-trigger');
            dlBtn.addEventListener('click', (e) => {
                e.preventDefault();
                handleFileDownload(file.id, fName);
            });

            wrapper.appendChild(fileDiv);
        });
    }

    container.appendChild(wrapper);
  });
}

// delete announcement logic
async function handleDeleteAnnouncement(e, id, domElement) {
    e.preventDefault();
    if (!confirm("Supprimer cette annonce et ses fichiers ?")) return;

    // visual feedback
    domElement.style.opacity = '0.5';

    try {
        const res = await fetch(`${API_URL}/api/announcements/${id}?userId=${userId}`, {
            method: 'DELETE'
        });
        
        if (res.ok) {
            domElement.remove();
            // sync to be sure
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

// --- websocket ---

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
      // refresh announcements on specific event
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

// --- api wrappers ---

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

  if (roomData.adminId === userId) {
    console.log("admin detected");
    setAdminMode(true);
  } else {
    setAdminMode(false);
  }
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

// --- utils ---

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

// --- tickets render ---

async function renderTickets(isExternalUpdate = false) {
  if (isRendering) return;
  isRendering = true;
  const tickets = await getTickets();
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

// --- admin ui ---

function setAdminMode(enable) {
  isRoomAdmin = enable;
  const createBtnText = document.querySelector('#createbutton .text');
  const nameInput = document.getElementById('name');
  const infosInput = document.getElementById('infos');
  const modalTitle = document.querySelector('#formOverlay h1');
  const uploadContainer = document.getElementById('fileUploadContainer');
  const adminSettings = document.getElementById('adminSettingsSection');

  if (enable) {
    // show admin settings
    if (adminSettings) adminSettings.style.display = 'block';

    // configure for announcement
    if (createBtnText) createBtnText.textContent = "Nouveau message";
    if (nameInput) {
      nameInput.placeholder = "Message";
      nameInput.value = "";
    }
    if (infosInput) infosInput.style.display = 'none';
    if (modalTitle) modalTitle.textContent = "Nouveau message";
    
    // show upload field
    if (uploadContainer) uploadContainer.style.display = 'flex';
    
    // clear pending
    pendingFiles = [];
    renderPendingFiles();

  } else {
    // hide admin settings
    if (adminSettings) adminSettings.style.display = 'none';

    // configure for ticket
    if (createBtnText) createBtnText.textContent = "Nouveau tickets";
    if (nameInput) {
      nameInput.placeholder = "Nom";
      nameInput.value = "";
    }
    if (infosInput) infosInput.style.display = 'block';
    if (modalTitle) modalTitle.textContent = "Nouveau ticket";
    
    if (uploadContainer) uploadContainer.style.display = 'none';
  }
  
  // refresh list
  syncAnnouncements();
  renderTickets();
}

// --- submission logic ---

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

  // --- ADMIN: Create Announcement ---
  if (isRoomAdmin) {
    // validation: text or files required
    if (!name && pendingFiles.length === 0) {
        return alert("Veuillez entrer un message ou ajouter un fichier.");
    }

    isSending = true;
    const createBtn = document.getElementById('create');
    if (createBtn) createBtn.classList.add('button-disabled');

    try {
        const formData = new FormData();
        formData.append('roomCode', roomCode);
        formData.append('userId', userId);
        formData.append('content', name);

        // get color
        const selectedColor = document.querySelector('.color.selected');
        let hexColor = '#d40000';
        if (selectedColor) {
            const bg = selectedColor.style.backgroundImage || selectedColor.style.backgroundColor;
            if (bg) hexColor = rgbToHex(bg) || bg;
        }
        formData.append('color', hexColor);

        // encrypt and append files
        if (pendingFiles.length > 0) {
            for (const file of pendingFiles) {
                const encryptedBlob = await encryptFile(file);
                // append with original name so multer sees it
                formData.append('files', encryptedBlob, file.name);
            }
        }

        // send
        const res = await fetch(`${API_URL}/api/announcements`, {
            method: 'POST',
            body: formData 
        });

        if (res.ok) {
            closeAllOverlays();
            nameInput.value = "";
            pendingFiles = [];
            renderPendingFiles();
            await syncAnnouncements();
        } else {
            const json = await res.json();
            alert("Erreur: " + (json.error || "Inconnue"));
        }

    } catch (e) {
        console.error(e);
        alert("Erreur d'envoi.");
    } finally {
        isSending = false;
        if (createBtn) createBtn.classList.remove('button-disabled');
    }
    return;
  }

  // --- USER: Create Ticket ---
  
  // check limits
  const tickets = await getTickets();
  const myActiveTickets = tickets.filter(t => t.etat === "en cours" && t.userId === userId);
  if (myActiveTickets.length >= MAX_DURING_TICKET) {
    return alert("Limite de tickets atteinte.");
  }

  if (!name) return alert("Le nom est requis.");
  
  const selectedColor = document.querySelector('.color.selected');
  const color = selectedColor
    ? (selectedColor.style.backgroundImage || selectedColor.style.backgroundColor)
    : '#cdcdcd';
  
  await createTicket({
    nom: name,
    description,
    couleur: color,
    etat: "en cours",
    userId
  });
  
  nameInput.value = "";
  infosInput.value = "";
  closeAllOverlays();
}


// --- menu & init ---

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
  
  // load announcements
  await syncAnnouncements();

  renderTickets();
  connectWebSocket();
  
  document.querySelector('#codebutton .text').textContent = roomCode;
  
  // click events
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

  document.querySelectorAll('.menu-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeAllOverlays();
    });
  });

  // logout
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

  // --- file input handling ---
  const dropArea = document.getElementById('dropArea');
  const fileInput = document.getElementById('fileInput');

  if (dropArea && fileInput) {
    // open system dialog
    dropArea.addEventListener('click', () => {
        if (pendingFiles.length >= MAX_FILES) return alert("Limite atteinte.");
        fileInput.click();
    });

    // handle files added via button
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files);
      if (files.length === 0) return;

      if (pendingFiles.length + files.length > MAX_FILES) {
        alert(`Trop de fichiers (max ${MAX_FILES}).`);
        fileInput.value = '';
        return;
      }

      // add to pending and render
      pendingFiles = [...pendingFiles, ...files];
      renderPendingFiles();
      fileInput.value = ''; 
    });

    // drag & drop
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