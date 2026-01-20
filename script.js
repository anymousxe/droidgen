const firebaseConfig = {
    apiKey: 'AIzaSyBMzTNiBfT5JOMaJvrCUoK3nKsnSP_aJxg',
    authDomain: 'droidgenai.firebaseapp.com',
    projectId: 'droidgenai',
    storageBucket: 'droidgenai.firebasestorage.app',
    messagingSenderId: '919385381226',
    appId: '1:919385381226:web:172d54c8ab332c2690ad13',
    measurementId: 'G-SMWBPGEJJK'
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

const state = {
    user: null,
    credits: 0,
    isAdmin: false,
    selectedModel: {
        id: 'xiaomi/mimo-v2-flash:free',
        name: 'MiMo 2 Flash',
        cost: 300
    },
    files: [],
    attachedFiles: [],
    versions: [],
    isGenerating: false,
    currentOutput: ''
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const elements = {
    authScreen: $('#auth-screen'),
    mainScreen: $('#main-screen'),
    googleLogin: $('#google-login'),
    creditsCount: $('#credits-count'),
    userAvatar: $('#user-avatar'),
    settingsBtn: $('#settings-btn'),
    settingsModal: $('#settings-modal'),
    adminModal: $('#admin-modal'),
    settingsAvatar: $('#settings-avatar'),
    settingsEmail: $('#settings-email'),
    settingsCredits: $('#settings-credits'),
    logoutBtn: $('#logout-btn'),
    changeEmailBtn: $('#change-email-btn'),
    promptInput: $('#prompt-input'),
    sendBtn: $('#send-btn'),
    modelBtn: $('#model-btn'),
    modelDropdown: $('#model-dropdown'),
    selectedModel: $('#selected-model'),
    outputContent: $('#output-content'),
    loadingIndicator: $('#loading-indicator'),
    versionsSidebar: $('#versions-sidebar'),
    versionsList: $('#versions-list'),
    toggleVersions: $('#toggle-versions'),
    closeSidebar: $('#close-sidebar'),
    filesGrid: $('#files-grid'),
    uploadBtn: $('#upload-btn'),
    fileInput: $('#file-input'),
    mentionsDropdown: $('#mentions-dropdown'),
    attachedFiles: $('#attached-files'),
    recentList: $('#recent-list'),
    toastContainer: $('#toast-container'),
    adminEmailInput: $('#admin-email-input'),
    adminCreditsInput: $('#admin-credits-input'),
    adminGiveCredits: $('#admin-give-credits'),
    adminResult: $('#admin-result')
};

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
        <span>${message}</span>
    `;
    elements.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function switchScreen(screen) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
}

function switchTab(tabName) {
    $$('.nav-tab').forEach(t => t.classList.remove('active'));
    $(`.nav-tab[data-tab="${tabName}"]`).classList.add('active');
    $$('.tab-content').forEach(c => c.classList.remove('active'));
    $(`#${tabName}-tab`).classList.add('active');
}

async function initUser(user) {
    state.user = user;
    
    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'init_user',
                userId: user.uid,
                email: user.email
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            state.credits = data.credits;
            state.isAdmin = data.isAdmin;
            state.versions = data.versions || [];
            state.files = data.files || [];
        }
    } catch (error) {
        console.error('Init error:', error);
        showToast('Failed to initialize user', 'error');
    }
    
    updateUI();
    switchScreen(elements.mainScreen);
}

function updateUI() {
    elements.creditsCount.textContent = state.credits.toLocaleString();
    
    if (state.user?.photoURL) {
        elements.userAvatar.style.backgroundImage = `url(${state.user.photoURL})`;
        elements.settingsAvatar.style.backgroundImage = `url(${state.user.photoURL})`;
    }
    
    elements.settingsEmail.textContent = state.user?.email || '';
    elements.settingsCredits.textContent = `${state.credits.toLocaleString()} credits`;
    
    renderVersions();
    renderFiles();
    renderRecent();
    
    elements.sendBtn.disabled = !elements.promptInput.value.trim() || state.isGenerating;
}

function renderVersions() {
    if (state.versions.length === 0) {
        elements.versionsList.innerHTML = `
            <div class="empty-state" style="padding: 40px 20px;">
                <i class="fas fa-history" style="font-size: 32px;"></i>
                <p style="margin-top: 12px;">No versions yet</p>
            </div>
        `;
        return;
    }
    
    elements.versionsList.innerHTML = state.versions.map((v, i) => `
        <div class="version-item ${v.pinned ? 'pinned' : ''}" data-index="${i}">
            <div class="version-header">
                <span class="version-number">v${state.versions.length - i}</span>
                <div class="version-actions">
                    <button class="pin-btn" title="${v.pinned ? 'Unpin' : 'Pin as main'}">
                        <i class="fas fa-thumbtack"></i>
                    </button>
                    <button class="delete-btn" title="Delete version">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="version-preview">${v.prompt.substring(0, 50)}...</div>
            <div class="version-date">${new Date(v.createdAt).toLocaleString()}</div>
        </div>
    `).join('');
}

function renderFiles() {
    if (state.files.length === 0) {
        elements.filesGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1; padding: 60px 20px;">
                <i class="fas fa-folder-open"></i>
                <p>No files uploaded yet</p>
            </div>
        `;
        return;
    }
    
    elements.filesGrid.innerHTML = state.files.map((f, i) => `
        <div class="file-card" data-index="${i}">
            <div class="file-preview">
                ${f.type.startsWith('image/') 
                    ? `<img src="${f.dataUrl}" alt="${f.name}">`
                    : `<i class="fas fa-${f.type.startsWith('audio/') ? 'music' : 'video'}"></i>`
                }
            </div>
            <div class="file-info">
                <div class="file-name">${f.name}</div>
                <div class="file-size">${formatFileSize(f.size)}</div>
            </div>
        </div>
    `).join('');
}

function renderRecent() {
    const recent = state.versions.slice(0, 5);
    
    if (recent.length === 0) {
        elements.recentList.innerHTML = `
            <div class="empty-state" style="padding: 40px 20px;">
                <i class="fas fa-clock"></i>
                <p>No recent generations</p>
            </div>
        `;
        return;
    }
    
    elements.recentList.innerHTML = recent.map((v, i) => `
        <div class="recent-item" data-index="${i}">
            <div class="icon">
                <i class="fas fa-wand-magic-sparkles"></i>
            </div>
            <div class="info">
                <div class="title">${v.prompt.substring(0, 40)}...</div>
                <div class="date">${new Date(v.createdAt).toLocaleString()}</div>
            </div>
        </div>
    `).join('');
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function showMentionsDropdown() {
    if (state.files.length === 0) {
        elements.mentionsDropdown.innerHTML = `
            <div style="padding: 16px; text-align: center; color: var(--text-muted);">
                No files to mention
            </div>
        `;
    } else {
        elements.mentionsDropdown.innerHTML = state.files.map((f, i) => `
            <div class="mention-item" data-index="${i}">
                <div class="icon">
                    <i class="fas fa-${f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'music' : 'video'}"></i>
                </div>
                <span class="name">${f.name}</span>
            </div>
        `).join('');
    }
    
    elements.mentionsDropdown.classList.add('open');
}

function hideMentionsDropdown() {
    elements.mentionsDropdown.classList.remove('open');
}

function attachFile(file) {
    if (state.attachedFiles.find(f => f.name === file.name)) return;
    
    state.attachedFiles.push(file);
    renderAttachedFiles();
}

function renderAttachedFiles() {
    elements.attachedFiles.innerHTML = state.attachedFiles.map((f, i) => `
        <div class="attached-file">
            <i class="fas fa-${f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'music' : 'video'}"></i>
            <span>${f.name}</span>
            <button class="remove" data-index="${i}">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

async function handleGenerate() {
    if (state.isGenerating) {
        showToast('Please wait for current generation to complete', 'error');
        return;
    }
    
    const prompt = elements.promptInput.value.trim();
    if (!prompt) return;
    
    if (state.credits < state.selectedModel.cost) {
        showToast('Insufficient credits', 'error');
        return;
    }
    
    state.isGenerating = true;
    elements.loadingIndicator.classList.add('active');
    elements.sendBtn.disabled = true;
    switchTab('workspace');
    
    elements.outputContent.innerHTML = `
        <div class="generating-state">
            <div class="loading-spinner"></div>
            <p>Generating with ${state.selectedModel.name}...</p>
        </div>
    `;
    
    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'generate',
                userId: state.user.uid,prompt: prompt,
                model: state.selectedModel.id,
                cost: state.selectedModel.cost,
                files: state.attachedFiles.map(f => ({
                    name: f.name,
                    type: f.type,
                    dataUrl: f.dataUrl
                }))
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Generation failed');
        }
        
        if (data.success) {
            state.credits = data.credits;
            state.currentOutput = data.output;
            
            const newVersion = {
                id: Date.now().toString(),
                prompt: prompt,
                output: data.output,
                model: state.selectedModel.name,
                createdAt: new Date().toISOString(),
                pinned: false
            };
            
            state.versions.unshift(newVersion);
            
            renderOutput(data.output);
            updateUI();
            showToast('Generation complete!');
            
            elements.promptInput.value = '';
            state.attachedFiles = [];
            renderAttachedFiles();
        } else {
            throw new Error(data.error || 'Generation failed');
        }
    } catch (error) {
        console.error('Generation error:', error);
        showToast(error.message, 'error');
        elements.outputContent.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i>
                <p>${error.message}</p>
            </div>
        `;
    } finally {
        state.isGenerating = false;
        elements.loadingIndicator.classList.remove('active');
        elements.sendBtn.disabled = false;
    }
}

function renderOutput(content) {
    const formatted = content
        .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
    
    elements.outputContent.innerHTML = `<div class="output-text">${formatted}</div>`;
}

async function handleVersionAction(index, action) {
    const version = state.versions[index];
    
    if (action === 'pin') {
        state.versions.forEach(v => v.pinned = false);
        version.pinned = !version.pinned;
        
        if (version.pinned) {
            state.currentOutput = version.output;
            renderOutput(version.output);
        }
        
        renderVersions();
        showToast(version.pinned ? 'Version pinned as main' : 'Version unpinned');
    } else if (action === 'delete') {
        state.versions.splice(index, 1);
        renderVersions();
        renderRecent();
        showToast('Version deleted');
    } else if (action === 'view') {
        state.currentOutput = version.output;
        renderOutput(version.output);
        switchTab('workspace');
    }
    
    try {
        await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'update_versions',
                userId: state.user.uid,
                versions: state.versions
            })
        });
    } catch (error) {
        console.error('Failed to sync versions:', error);
    }
}

async function handleFileUpload(files) {
    for (const file of files) {
        if (file.size > 10 * 1024 * 1024) {
            showToast(`${file.name} is too large (max 10MB)`, 'error');
            continue;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const newFile = {
                id: Date.now().toString(),
                name: file.name,
                type: file.type,
                size: file.size,
                dataUrl: e.target.result
            };
            
            state.files.push(newFile);
            renderFiles();
            showToast(`${file.name} uploaded`);
            
            syncFiles();
        };
        reader.readAsDataURL(file);
    }
}

async function syncFiles() {
    try {
        await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'update_files',
                userId: state.user.uid,
                files: state.files.map(f => ({
                    id: f.id,
                    name: f.name,
                    type: f.type,
                    size: f.size
                }))
            })
        });
    } catch (error) {
        console.error('Failed to sync files:', error);
    }
}

async function handleAdminGiveCredits() {
    const email = elements.adminEmailInput.value.trim();
    const credits = parseInt(elements.adminCreditsInput.value);
    
    if (!email || !credits || credits <= 0) {
        elements.adminResult.className = 'admin-result error';
        elements.adminResult.textContent = 'Please enter valid email and credits amount';
        return;
    }
    
    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'admin_give_credits',
                adminId: state.user.uid,
                targetEmail: email,
                credits: credits
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            elements.adminResult.className = 'admin-result success';
            elements.adminResult.textContent = `Successfully gave ${credits} credits to ${email}`;
            elements.adminEmailInput.value = '';
            elements.adminCreditsInput.value = '';
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        elements.adminResult.className = 'admin-result error';
        elements.adminResult.textContent = error.message;
    }
}

elements.googleLogin.addEventListener('click', async () => {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        await auth.signInWithPopup(provider);
    } catch (error) {
        console.error('Login error:', error);
        showToast('Login failed', 'error');
    }
});

auth.onAuthStateChanged((user) => {
    if (user) {
        initUser(user);
    } else {
        state.user = null;
        switchScreen(elements.authScreen);
    }
});

elements.logoutBtn.addEventListener('click', async () => {
    try {
        await auth.signOut();
        showToast('Logged out successfully');
    } catch (error) {
        showToast('Logout failed', 'error');
    }
});

elements.changeEmailBtn.addEventListener('click', async () => {
    const newEmail = prompt('Enter new email address:');
    if (!newEmail) return;
    
    try {
        await state.user.verifyBeforeUpdateEmail(newEmail);
        showToast('Verification email sent to ' + newEmail);
    } catch (error) {
        showToast(error.message, 'error');
    }
});

$$('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        switchTab(tab.dataset.tab);
    });
});

elements.settingsBtn.addEventListener('click', () => {
    elements.settingsModal.classList.add('open');
});

elements.userAvatar.addEventListener('click', () => {
    if (state.isAdmin) {
        elements.adminModal.classList.add('open');
    } else {
        elements.settingsModal.classList.add('open');
    }
});

$$('.modal-overlay, .close-modal').forEach(el => {
    el.addEventListener('click', () => {
        $$('.modal').forEach(m => m.classList.remove('open'));
    });
});

elements.modelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    elements.modelBtn.parentElement.classList.toggle('open');
});

$$('.model-option').forEach(opt => {
    opt.addEventListener('click', () => {
        $$('.model-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        
        state.selectedModel = {
            id: opt.dataset.model,
            name: opt.dataset.name,
            cost: parseInt(opt.dataset.cost)
        };
        
        elements.selectedModel.textContent = opt.dataset.name;
        elements.modelBtn.parentElement.classList.remove('open');
    });
});

document.addEventListener('click', () => {
    elements.modelBtn.parentElement.classList.remove('open');
    hideMentionsDropdown();
});

elements.promptInput.addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
    
    elements.sendBtn.disabled = !e.target.value.trim() || state.isGenerating;
    
    const value = e.target.value;
    const lastAtIndex = value.lastIndexOf('@');
    
    if (lastAtIndex !== -1 && lastAtIndex === value.length - 1) {
        showMentionsDropdown();
    } else {
        hideMentionsDropdown();
    }
});

elements.promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleGenerate();
    }
});

elements.sendBtn.addEventListener('click', handleGenerate);

elements.mentionsDropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.mention-item');
    if (item) {
        const file = state.files[item.dataset.index];
        attachFile(file);
        
        const value = elements.promptInput.value;
        elements.promptInput.value = value.slice(0, -1) + `@${file.name} `;
        hideMentionsDropdown();
        elements.promptInput.focus();
    }
});

elements.attachedFiles.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.remove');
    if (removeBtn) {
        state.attachedFiles.splice(removeBtn.dataset.index, 1);
        renderAttachedFiles();
    }
});

elements.toggleVersions.addEventListener('click', () => {
    elements.versionsSidebar.classList.toggle('open');
});

elements.closeSidebar.addEventListener('click', () => {
    elements.versionsSidebar.classList.remove('open');
});

elements.versionsList.addEventListener('click', (e) => {
    const item = e.target.closest('.version-item');
    const pinBtn = e.target.closest('.pin-btn');
    const deleteBtn = e.target.closest('.delete-btn');
    
    if (pinBtn && item) {
        handleVersionAction(parseInt(item.dataset.index), 'pin');
    } else if (deleteBtn && item) {
        handleVersionAction(parseInt(item.dataset.index), 'delete');
    } else if (item) {
        handleVersionAction(parseInt(item.dataset.index), 'view');
    }
});

elements.uploadBtn.addEventListener('click', () => {
    elements.fileInput.click();
});

elements.fileInput.addEventListener('change', (e) => {
    handleFileUpload(e.target.files);
    e.target.value = '';
});

$$('.quick-action').forEach(action => {
    action.addEventListener('click', () => {
        elements.promptInput.value = action.dataset.prompt;
        elements.promptInput.dispatchEvent(new Event('input'));
        switchTab('workspace');
        elements.promptInput.focus();
    });
});

elements.recentList.addEventListener('click', (e) => {
    const item = e.target.closest('.recent-item');
    if (item) {
        handleVersionAction(parseInt(item.dataset.index), 'view');
    }
});

elements.adminGiveCredits.addEventListener('click', handleAdminGiveCredits);

document.addEventListener('dragover', (e) => {
    e.preventDefault();
});

document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
        handleFileUpload(e.dataTransfer.files);
    }
});
