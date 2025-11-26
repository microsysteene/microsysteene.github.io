const API_URL = "https://ticketapi.juhdd.me";
const WS_URL = "wss://ticketapi.juhdd.me";

let activeUploads = []; // track xhr requests
const MAX_FILES = 10;
let MAX_DURING_TICKET = 1; // let allows updates

// cache and crypto globals
let cryptoKey = null; // derived from room code
let currentFilesList = []; // store files list for announcement display

// copy features
function initFeatures() {
  // copy link button
  const copyBtn = document.getElementById('copyLink');
  if (copyBtn) {
    copyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const link = window.location.href;

      navigator.clipboard.writeText(link).then(() => {
        const textSpan = document.getElementById('copyText');
        const originalText = textSpan.textContent;

        // visual feedback
        textSpan.textContent = "Copié !";
        setTimeout(() => textSpan.textContent = originalText, 2000);
      }).catch(err => {
        console.error('Erreur copie :', err);
        alert("Échec de la copie du lien.");
      });
    });
  }
}

// copy code when cliqued on a#codebutton
const codeButton = document.getElementById('codebutton');
if (codeButton) {
  codeButton.addEventListener('click', (e) => {
    e.preventDefault();

    navigator.clipboard.writeText(roomCode).then(() => {
      const textSpan = codeButton.querySelector('.text');
      const originalText = textSpan.textContent;

      // visual feedback
      textSpan.textContent = "Copié";
      setTimeout(() => textSpan.textContent = originalText, 2000);
    })
  })
}

// get room code
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('room');

// save room code
if (roomCode) {
  localStorage.setItem('last_room', roomCode);
}

// redirect if no room
if (!roomCode) {
  window.location.href = "/";
}

let ws = null;
let currentAnnonce = "";
let lastTicketIds = new Set();
let filterCache = [];
let isRendering = false;
let isRoomAdmin = false;
let isUploading = false;

// get user id
let userId = localStorage.getItem('userId');
if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem('userId', userId);
}

// add loaded class
if (document.readyState === 'complete') {
  document.body.classList.add('loaded');
} else {
  window.addEventListener('load', () => document.body.classList.add('loaded'));
}

// crypto

// init crypto key from room code
async function initCrypto() {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(roomCode),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  // derive aes-gcm key
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

// encrypt file (returns blob with iv prepended)
async function encryptFile(file) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const buffer = await file.arrayBuffer();
  
  const encryptedContent = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    cryptoKey,
    buffer
  );

  // combine iv + encrypted data
  return new Blob([iv, encryptedContent], { type: 'application/octet-stream' });
}

// decrypt blob (extracts iv first)
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

// sync & download

// sync files (list only, no preload)
async function syncRoomFiles() {
  // fetch list of files
  const data = await apiCall(`/api/files/${roomCode}`);
  
  // check if files exist in response
  const filesList = (data && data.files) ? data.files : [];

  // update global list
  currentFilesList = filesList;

  // update storage ui
  updateStorageUI(filesList);
  renderRoomFilesList(filesList);

  // render announcement with files
  renderAnnouncement();
  updateDeleteButtonVisibility();
  
  // render list inside admin form
  renderFormFiles();
}

// fetch encrypted content
async function fetchFileContent(fileId) {
  const res = await fetch(`${API_URL}/api/files/download/${fileId}`);
  if (!res.ok) throw new Error('download error');
  return await res.blob();
}

// handle download click (direct fetch)
async function handleFileDownload(fileId, fileName) {
  // log download start
  console.log(`[LOG] download started: ${fileName} (id: ${fileId})`);

  try {
    // 1. fetch encrypted blob
    const blobToDecrypt = await fetchFileContent(fileId);
    
    // 2. decrypt
    const clearBlob = await decryptFile(blobToDecrypt);
    
    // 3. trigger download
    const url = URL.createObjectURL(clearBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log(`[LOG] download success: ${fileName}`);
  } catch (e) {
    console.error('download/decrypt error', e);
    alert("Erreur lors du téléchargement.");
  }
}

// delete file by id
async function deleteFile(fileId) {
  if (!confirm("Supprimer ce fichier ?")) return;

  try {
    // call api delete
    const res = await fetch(`${API_URL}/api/files/${fileId}?userId=${userId}&roomCode=${roomCode}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      // update list after delete
      await syncRoomFiles();
    } else {
      alert("Erreur lors de la suppression.");
    }
  } catch (e) {
    console.error('delete error', e);
  }
}

// update storage text
function updateStorageUI(files) {
  const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
  const gb = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);
  const storageEl = document.getElementById('storageDisplay');
  if (storageEl) storageEl.textContent = `${gb} Go / 2 Go`;
}

// render shared files list in settings or main
function renderRoomFilesList(files) {
  const container = document.getElementById('roomFilesContainer');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (files.length === 0) {
    container.innerHTML = '<p style="opacity:0.5; font-size:14px;">Aucun fichier partagé</p>';
    return;
  }

  files.forEach(f => {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.innerHTML = `
      <span class="fname">${f.name}</span>
      <span class="fsize">${(f.size / 1024 / 1024).toFixed(1)} MB</span>
      <button class="download-btn" data-id="${f.id}" data-name="${f.name}">↓</button>
    `;
    container.appendChild(div);
  });

  // attach events
  container.querySelectorAll('.download-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      handleFileDownload(btn.dataset.id, btn.dataset.name);
    };
  });
}

// render files inside admin form
function renderFormFiles() {
  const container = document.getElementById('fileUploadContainer');
  if (!container) return;

  // check if list container exists, create if not
  let listDiv = document.getElementById('adminFilesList');
  if (!listDiv) {
    listDiv = document.createElement('div');
    listDiv.id = 'adminFilesList';
    listDiv.className = 'admin-files-list';
    // basic style for the list
    listDiv.style.marginTop = "10px";
    listDiv.style.width = "100%";
    container.appendChild(listDiv);
  }

  listDiv.innerHTML = '';

  // loop global files list
  currentFilesList.forEach(f => {
    const item = document.createElement('div');
    // simple styling
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

    // attach delete event
    item.querySelector('.del-btn').onclick = (e) => {
      e.preventDefault();
      deleteFile(f.id);
    };

    listDiv.appendChild(item);
  });
}

// render announcement combined (text + files)
function renderAnnouncement() {
  const msgDiv = document.getElementById('message');
  if (!msgDiv) return;

  // hide if empty
  if (!currentAnnonce && currentFilesList.length === 0) {
    msgDiv.style.display = 'none';
    return;
  }

  msgDiv.style.display = 'block';
  msgDiv.innerHTML = ''; // clear

  // 1. render text
  if (currentAnnonce) {
    const textSpan = document.createElement('div');
    textSpan.className = 'message-content';
    textSpan.textContent = currentAnnonce;

    // remove margin if no files attached
    if (currentFilesList.length === 0) {
      textSpan.style.marginBottom = "0";
    }

    msgDiv.appendChild(textSpan);
  }

  // 2. render files buttons
  if (currentFilesList.length > 0) {
    const filesContainer = document.createElement('div');
    filesContainer.className = 'message-files';

    currentFilesList.forEach(file => {
      const btn = document.createElement('button');
      btn.className = 'message-file-btn';
      // use originalName if available (from db), else name
      const fName = file.originalName || file.name; 
      btn.innerHTML = `<span>📎</span> ${fName}`;
      
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleFileDownload(file.id, fName);
      };
      
      filesContainer.appendChild(btn);
    });

    msgDiv.appendChild(filesContainer);
  }
}

// update delete button visibility (admin only)
function updateDeleteButtonVisibility() {
  if (isRoomAdmin) {
    const deleteBtn = document.getElementById('deleteAnnonce');
    if (deleteBtn) {
      const hasContent = currentAnnonce || (currentFilesList && currentFilesList.length > 0);
      deleteBtn.style.display = hasContent ? 'flex' : 'none';
    }
  }
}

// websocket functions

// connect ws
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
        // re-check settings to sync changes like max tickets
        checkRoomPermissions();
      }
      if (msg.type === 'updateAnnonce') handleAnnonceUpdate(msg.message);
      //sync on update
      if (msg.type === 'filesUpdate' || msg.type === 'newFile' || msg.type === 'deleteFile') syncRoomFiles(); 
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

// update announcement ui
function handleAnnonceUpdate(data) {
  currentAnnonce = data.texte || "";
  const color = data.couleur || "#cdcdcd";

  const msgDiv = document.getElementById('message');
  if (msgDiv) {
    msgDiv.style.color = color;
  }
  
  renderAnnouncement();
  updateDeleteButtonVisibility();
}

// api functions

// fetch wrapper
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

// check if admin and load settings
async function checkRoomPermissions() {
  const roomData = await apiCall(`/api/rooms/${roomCode}`);

  if (!roomData || roomData.error) {
    // clear invalid room
    localStorage.removeItem('last_room');
    alert("Salle introuvable.");
    window.location.href = "/";
    return;
  }

  // sync max tickets from server
  if (roomData.maxTickets) {
    MAX_DURING_TICKET = roomData.maxTickets;
    
    // update slider ui
    const radio = document.querySelector(`input[name="SliderCount"][value="${MAX_DURING_TICKET}"]`);
    if (radio) radio.checked = true;
  }

  // compare ids
  if (roomData.adminId === userId) {
    console.log("admin detected");
    setAdminMode(true);
  } else {
    setAdminMode(false);
  }
}

// get tickets
async function getTickets() {
  const data = await apiCall(`/api/tickets/${roomCode}`);
  return Array.isArray(data) ? data : [];
}

// create ticket
async function createTicket(ticket) {
  ticket.roomCode = roomCode;
  return await apiCall('/api/tickets', "POST", ticket);
}

// delete ticket
async function deleteTicket(id) {
  const endpoint = `/api/tickets/${id}?userId=${userId}&admin=${isRoomAdmin}&roomCode=${roomCode}`;
  await fetch(`${API_URL}${endpoint}`, { method: "DELETE" });
}

// update ticket
async function updateTicket(id, modifications) {
  modifications.roomCode = roomCode;
  await apiCall(`/api/tickets/${id}`, "PUT", modifications);
}

// get announcement
async function fetchAnnonce() {
  const data = await apiCall(`/api/announcement/${roomCode}`);
  if (data) handleAnnonceUpdate(data);
}

// set announcement
async function updateAnnonceApi(text, color = "#cdcdcd") {
  await apiCall(`/api/announcement/${roomCode}`, "PUT", {
    texte: text,
    couleur: color,
    userId: userId
  });
  currentAnnonce = text;
}

// load bad words in local /assets/filter.json
async function loadFilters() {
  try {
    const res = await fetch("./assets/filter.json?cb=" + Date.now());
    if (!res.ok) throw new Error("Erreur lors du chargement de filter.json");
    const data = await res.json();
    filterCache = data.banned_terms || [];
  } catch (error) {
    console.error("Erreur de chargement du filtre:", error);
    filtresCache = [];
  }
}

// utils

// format time
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

// rgb to hex
function rgbToHex(rgbStr) {
  const match = rgbStr.match(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/);
  if (!match) return '#d40000';
  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// ui render

// render list
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

// update container
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
    // text changes depending on whether it is the active or historical list
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

    // color handling
    if (t.couleur?.includes('gradient')) div.style.backgroundImage = t.couleur;
    else div.style.backgroundColor = t.couleur || "#cdcdcd";

    const timeStr = t.dateCreation
      ? new Date(t.dateCreation).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    // check delete rights
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

  // reattach delete events
  container.querySelectorAll('.delete').forEach(btn => {
    btn.onclick = (e) => handleDeleteClick(e, btn.dataset.id);
  });
}

// delete with anim
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

// ticket done
document.getElementById("right").addEventListener("click", async (e) => {
  const checkbox = e.target.closest(".checkbox");
  if (!checkbox) return;
  const id = checkbox.dataset.id;
  const el = document.getElementById(id);

  const tickets = await getTickets();
  const ticket = tickets.find(t => t.id === id);

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

// admin ui

// toggle admin ui
function setAdminMode(enable) {
  isRoomAdmin = enable;
  const createBtnText = document.querySelector('#createbutton .text');
  const nameInput = document.getElementById('name');
  const infosInput = document.getElementById('infos');
  const modalTitle = document.getElementById('lefttitle');
  const uploadContainer = document.getElementById('fileUploadContainer');

  // get admin settings section
  const adminSettings = document.getElementById('adminSettingsSection');

  if (enable) {
    // show admin settings
    if (adminSettings) adminSettings.style.display = 'block';

    // admin mode active: announcement ui
    if (createBtnText) createBtnText.textContent = "Nouveau message";
    if (nameInput) {
      nameInput.placeholder = "Message";
      if (currentAnnonce) nameInput.value = currentAnnonce;
    }
    if (infosInput) infosInput.style.display = 'none';
    if (modalTitle) modalTitle.textContent = "Nouveau message";
    
    // show upload field in admin
    if (uploadContainer) uploadContainer.style.display = 'flex';
    
    // update files list in admin
    renderFormFiles();

    updateDeleteButtonVisibility();

  } else {
    // hide admin settings
    if (adminSettings) adminSettings.style.display = 'none';

    // standard user: ticket ui
    if (createBtnText) createBtnText.textContent = "Nouveau tickets";
    if (nameInput) {
      nameInput.placeholder = "Nom";
      nameInput.value = "";
    }
    if (infosInput) infosInput.style.display = 'block';
    if (modalTitle) modalTitle.textContent = "Nouveau ticket";
    
    // hide upload field in user mode
    if (uploadContainer) uploadContainer.style.display = 'none';

    // always hide delete button
    const deleteBtn = document.getElementById('deleteAnnonce');
    if (deleteBtn) deleteBtn.style.display = 'none';
  }
  renderTickets();
}

// --- upload logic (new) ---

// set ui state during upload
function setUploadingState(uploading) {
  isUploading = uploading;
  const warning = document.getElementById('uploadWarning');
  const createBtn = document.getElementById('create');
  const deleteBtn = document.getElementById('deleteAnnonce');
  
  if (uploading) {
    if (warning) warning.style.display = 'block';
    if (createBtn) createBtn.classList.add('button-disabled');
    if (deleteBtn) deleteBtn.classList.add('button-disabled');
  } else {
    // only hide if no active uploads remaining
    if (activeUploads.length === 0) {
      if (warning) warning.style.display = 'none';
      if (createBtn) createBtn.classList.remove('button-disabled');
      if (deleteBtn) deleteBtn.classList.remove('button-disabled');
    }
  }
}

// handle file encryption & upload immediately
async function uploadFile(file) {
  setUploadingState(true);

  // create progress ui
  const container = document.getElementById('uploadProgressContainer');
  const uiId = 'up-' + Date.now() + Math.random().toString(36).substr(2, 5);
  const div = document.createElement('div');
  div.className = 'upload-item';
  div.id = uiId;
  div.innerHTML = `
    <div class="upload-info">
      <span>${file.name.length > 25 ? file.name.substring(0,22)+'...' : file.name}</span>
      <span class="pct">Encrypting...</span>
    </div>
    <div class="progress-bar-bg">
      <div class="progress-bar-fill"></div>
    </div>
  `;
  container.appendChild(div);

  try {
    // 1. encrypt
    const encryptedBlob = await encryptFile(file);
    div.querySelector('.pct').textContent = "0%";

    // 2. upload with progress via xhr
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
        const fill = div.querySelector('.progress-bar-fill');
        const text = div.querySelector('.pct');
        if (fill) fill.style.width = percent + '%';
        if (text) text.textContent = percent + '%';
      }
    };

    xhr.onload = async () => {
        // remove xhr from list
        activeUploads = activeUploads.filter(x => x !== xhr);
        
        if (xhr.status === 200 || xhr.status === 201) {
            console.log("upload complete", file.name);
            div.querySelector('.pct').textContent = "Done";
            div.querySelector('.progress-bar-fill').style.backgroundColor = "#79e056"; // green
            
            // refresh list from server
            await syncRoomFiles();
            
            // remove ui after small delay
            setTimeout(() => {
                div.remove();
                if (activeUploads.length === 0) setUploadingState(false);
            }, 1000);
        } else {
            div.querySelector('.pct').textContent = "Error";
            div.querySelector('.progress-bar-fill').style.backgroundColor = "#ff7070";
            alert("Erreur upload: " + xhr.statusText);
            activeUploads = activeUploads.filter(x => x !== xhr);
            if (activeUploads.length === 0) setUploadingState(false);
        }
    };

    xhr.onerror = () => {
        div.querySelector('.pct').textContent = "Fail";
        activeUploads = activeUploads.filter(x => x !== xhr);
        if (activeUploads.length === 0) setUploadingState(false);
    };

    xhr.send(formData);

  } catch (err) {
    console.error(err);
    div.querySelector('.pct').textContent = "Error Encrypt";
    if (activeUploads.length === 0) setUploadingState(false);
  }
}

// form submit
async function handleFormSubmit() {
  // block if uploading
  if (isUploading || activeUploads.length > 0) {
    alert("Veuillez attendre la fin des uploads.");
    return;
  }

  const nameInput = document.getElementById('name');
  const infosInput = document.getElementById('infos');
  
  const name = nameInput.value.trim();
  const description = infosInput.value.trim();
  
  // check files presence
  const hasFiles = currentFilesList && currentFilesList.length > 0;

  // required name or msg or files
  if (!name && !hasFiles) return alert("Le champ est vide.");
  
  // check bad words
  const content = (name + " " + description).toLowerCase();
  const words = content.toLowerCase().split(/\s+/);
  const forbidden = filterCache.find(term => words.includes(term.toLowerCase()));
  if (forbidden) return alert("Mot interdit détecté.");

  // admin action: update announcement
  if (isRoomAdmin) {
    const selectedColor = document.querySelector('.color.selected');
    let hexColor = '#d40000';

    if (selectedColor) {
      const bg = selectedColor.style.backgroundImage || selectedColor.style.backgroundColor;
      if (bg) hexColor = rgbToHex(bg) || bg;
    }

    await updateAnnonceApi(name, hexColor);

    // reset uploads ui just in case
    document.getElementById('uploadProgressContainer').innerHTML = '';
    
    // close and clear
    closeAllOverlays();
    return;
  }

  // user action: create ticket
  // check limits
  const tickets = await getTickets();
  const myActiveTickets = tickets.filter(t => t.etat === "en cours" && t.userId === userId);
  if (myActiveTickets.length >= MAX_DURING_TICKET) {
    return alert("Limite de tickets atteinte.");
  }
  
  const selectedColor = document.querySelector('.color.selected');
  const color = selectedColor
    ? (selectedColor.style.backgroundImage || selectedColor.style.backgroundColor)
    : '#cdcdcd';
  
  // create
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

// menu functions
function openOverlay(id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = "flex";
    const box = el.querySelector('.menu-box');
    if (box) {
      box.style.animation = 'none';
      box.offsetHeight;
      box.style.animation = null;
    }
  }
}
function closeAllOverlays() {
  document.querySelectorAll('.menu-overlay').forEach(el => el.style.display = "none");
  
  // cancel uploads if closing
  if (activeUploads.length > 0) {
    if(confirm("Annuler les uploads en cours ?")) {
        activeUploads.forEach(xhr => xhr.abort());
        activeUploads = [];
        setUploadingState(false);
        document.getElementById('uploadProgressContainer').innerHTML = '';
    } else {
        // reopen if user cancelled close (hacky but keeps ui logic simple)
        openOverlay("formOverlay");
    }
  }
}

// init
window.addEventListener('DOMContentLoaded', async () => {
  initFeatures();
  // check permissions first
  await checkRoomPermissions();

  //  init crypto
  await initCrypto();

  // load data
  await loadFilters();
  await fetchAnnonce();
  
  //  initial sync
  await syncRoomFiles();

  renderTickets();
  connectWebSocket();
  // show room code 
  document.querySelector('#codebutton .text').textContent = roomCode;
  
  // events
  document.getElementById('create').addEventListener('click', (e) => {
    e.preventDefault();
    handleFormSubmit();
  });

  // delete announcement (admin)
  document.getElementById('deleteAnnonce')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!isRoomAdmin) return;
    if (activeUploads.length > 0) return;
    if (confirm("Supprimer l'annonce ?")) {
      await updateAnnonceApi("");
      closeAllOverlays();
    }
  });
  
  // open create menu (updated)
  document.getElementById("createbutton").addEventListener('click', (e) => {
    e.preventDefault();
    openOverlay("formOverlay");
  });
  
  document.getElementById("setting").addEventListener('click', (e) => {
    e.preventDefault();
    openOverlay("settingsOverlay");

    // sync ui with var
    const radio = document.querySelector(`input[name="SliderCount"][value="${MAX_DURING_TICKET}"]`);
    if (radio) radio.checked = true;
  });

  // listen for limit changes
  document.querySelectorAll('input[name="SliderCount"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
        // update local limit
        const val = parseInt(e.target.value);
        MAX_DURING_TICKET = val;
        
        // save to server if admin
        if (isRoomAdmin) {
          await apiCall(`/api/rooms/${roomCode}`, "PUT", { 
            maxTickets: val 
          });
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

// file upload listeners
  const dropArea = document.getElementById('dropArea');
  const fileInput = document.getElementById('fileInput');

  if (dropArea && fileInput) {
    // 1. Click Trigger
    dropArea.addEventListener('click', () => {
        if (activeUploads.length >= MAX_FILES) {
            alert("Limit reached.");
            return;
        }
        fileInput.click();
    });

    // 2. File Select via Input
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files);
      if (files.length === 0) return;

      if (activeUploads.length + files.length > MAX_FILES) {
        alert(`Too many files (max ${MAX_FILES}).`);
        fileInput.value = '';
        return;
      }

      files.forEach(f => uploadFile(f));
      fileInput.value = ''; 
    });

    // Empêcher le comportement par défaut
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    });

    let dragCounter = 0;

    dropArea.addEventListener('dragenter', (e) => {
        dragCounter++;
        dropArea.classList.add('drag-over');
    });

    dropArea.addEventListener('dragleave', (e) => {
        dragCounter--;
        if (dragCounter === 0) {
            dropArea.classList.remove('drag-over');
        }
    });

    // Gestion du Drop
    dropArea.addEventListener('drop', (e) => {
      dragCounter = 0;
      dropArea.classList.remove('drag-over');

      const dt = e.dataTransfer;
      const files = Array.from(dt.files);

      if (activeUploads.length + files.length > MAX_FILES) {
          alert(`Too many files (max ${MAX_FILES}).`);
          return;
      }

      files.forEach(f => uploadFile(f));
    });
  }
});