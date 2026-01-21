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
const googleProvider = new firebase.auth.GoogleAuthProvider();

const state = {
    user: null,
    userData: null,
    credits: 0,
    username: '',
    projects: [],
    currentProject: null,
    currentFile: null,
    selectedModel: { id: 'liquid/lfm-2.5-1.2b-instruct:free', name: 'LFM 2.5 Base', cost: 100 },
    isGenerating: false,
    thinkingEnabled: false,
    lastUsernameChange: 0
};

const MODELS = {
    'liquid/lfm-2.5-1.2b-instruct:free': { name: 'LFM 2.5 Base', cost: 100 },
    'liquid/lfm-2.5-1.2b-thinking:free': { name: 'LFM 2.5 Thinking', cost: 200 },
    'z-ai/glm-4.5-air:free': { name: 'GLM 4.5 Air', cost: 300 },
    'moonshotai/kimi-k2:free': { name: 'Kimi K2', cost: 100 },
    'google/gemma-3-27b-it:free': { name: 'Gemma 3', cost: 50 },
    'z-ai/glm-4.7-flash': { name: 'GLM 4.7 Flash', cost: 800 }
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showScreen(screenId) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    const screen = $(`#${screenId}`);
    if (screen) screen.classList.add('active');
    $$('.taskbar-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.screen === screenId.replace('-screen', ''));
    });
}

function showToast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i><span>${msg}</span>`;
    $('#toast-container').appendChild(t);
    setTimeout(() => t.remove(), 4000);
}

function showLoading(show, text = 'Generating...') {
    const overlay = $('#loading-overlay');
    overlay.querySelector('span').textContent = text;
    overlay.classList.toggle('active', show);
}

function generateId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

async function apiCall(action, data = {}) {
    try {
        const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, userId: state.user?.uid, ...data })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Request failed');
        return result;
    } catch (err) {
        console.error('API Error:', err);
        throw err;
    }
}

auth.onAuthStateChanged(async (user) => {
    if (user) {
        state.user = user;
        try {
            showLoading(true, 'Loading...');
            const data = await apiCall('init_user', {
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL
            });
            if (data.success) {
                state.userData = data;
                state.credits = data.credits;
                state.username = data.username;
                state.projects = data.projects || [];
                updateUI();
                showLoading(false);
                if (!data.username || data.needsUsername) {
                    $('#username-modal').classList.add('open');
                } else {
                    showScreen('main-screen');
                }
            } else {
                throw new Error(data.error || 'Failed to initialize');
            }
        } catch (err) {
            showLoading(false);
            showToast(err.message || 'Connection failed. Please refresh.', 'error');
        }
    } else {
        state.user = null;
        state.userData = null;
        showScreen('auth-screen');
    }
});

$('#google-login').addEventListener('click', async () => {
    const btn = $('#google-login');
    btn.disabled = true;
    try {
        await auth.signInWithPopup(googleProvider);
    } catch (err) {
        showToast(err.message || 'Login failed', 'error');
        btn.disabled = false;
    }
});

$('#logout-btn').addEventListener('click', () => {
    auth.signOut();
    $('#user-dropdown').classList.remove('open');
});

function updateUI() {
    $('#credits-count').textContent = state.credits.toLocaleString();
    $('#settings-credits').textContent = state.credits.toLocaleString();
    const photoURL = state.user?.photoURL || 'https://via.placeholder.com/36/27272f/71717a?text=?';
    $('#user-avatar').src = photoURL;
    $('#dropdown-avatar').src = photoURL;
    $('#settings-avatar').style.backgroundImage = `url(${photoURL})`;
    const displayName = state.user?.displayName || state.username || 'User';
    $('#user-name').textContent = displayName;
    $('#dropdown-name').textContent = displayName;
    $('#dropdown-email').textContent = state.user?.email || '';
    $('#settings-email').textContent = state.user?.email || '';
    $('#settings-username').value = state.username || '';
    loadFeed();
}

async function loadFeed() {
    try {
        const data = await apiCall('get_public_projects');
        const grid = $('#feed-grid');
        if (!data.projects || data.projects.length === 0) {
            grid.innerHTML = `
                <div class="empty-feed">
                    <i class="fas fa-rocket"></i>
                    <h3>No projects yet</h3>
                    <p>Be the first to create something amazing!</p>
                </div>
            `;
            return;
        }
        grid.innerHTML = data.projects.map(p => `
            <div class="project-card" data-id="${p.id}">
                <div class="project-preview">
                    ${p.preview ? `<iframe srcdoc="${escapeHtml(p.preview)}" sandbox="allow-scripts"></iframe>` : '<div class="preview-placeholder"><i class="fas fa-code"></i></div>'}
                </div>
                <div class="project-info">
                    <div class="project-title-row">
                        <span class="project-title">${escapeHtml(p.name)}</span>
                    </div>
                    <p class="project-desc">${escapeHtml(p.description || 'No description')}</p>
                    <div class="project-meta">
                        <div class="project-author" data-user="${p.author_id}">
                            <img src="${p.author_photo || 'https://via.placeholder.com/24/27272f/71717a?text=?'}" alt="">
                            <span>@${escapeHtml(p.author_username || 'user')}</span>
                        </div>
                        <div class="project-stats">
                            <button class="like-btn ${p.liked ? 'liked' : ''}" data-id="${p.id}">
                                <i class="fas fa-heart"></i>
                                <span>${p.likes || 0}</span>
                            </button>
                            <span class="stat"><i class="fas fa-comment"></i> ${p.comments_count || 0}</span>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Failed to load feed:', err);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

$('#user-pill').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#user-dropdown').classList.toggle('open');
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('#user-pill') && !e.target.closest('#user-dropdown')) {
        $('#user-dropdown').classList.remove('open');
    }
    if (!e.target.closest('.model-selector')) {
        $$('.model-selector').forEach(s => s.classList.remove('open'));
    }
});

$$('.taskbar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const screen = btn.dataset.screen;
        if (screen === 'feed') {
            showScreen('main-screen');
        } else if (screen === 'create') {
            showScreen('create-screen');
        } else if (screen === 'settings') {
            showScreen('settings-screen');
        } else if (screen === 'search') {
            showToast('Search coming soon!', 'success');
        }
    });
});

$('#create-back').addEventListener('click', () => showScreen('main-screen'));
$('#settings-back').addEventListener('click', () => showScreen('main-screen'));
$('#profile-back').addEventListener('click', () => showScreen('main-screen'));
$('#editor-back').addEventListener('click', () => showScreen('main-screen'));

$$('.model-selector-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.closest('.model-selector').classList.toggle('open');
    });
});

$$('.model-option').forEach(opt => {
    opt.addEventListener('click', () => {
        const modelId = opt.dataset.model;
        const cost = parseInt(opt.dataset.cost);
        const name = opt.querySelector('.name').textContent;
        state.selectedModel = { id: modelId, name, cost };
        const selector = opt.closest('.model-selector');
        selector.querySelector('.model-selector-btn span').textContent = name;
        selector.querySelectorAll('.model-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        selector.classList.remove('open');
        if (selector.id === 'create-model-selector') {
            $('#create-cost').textContent = cost;
            const isLFM = modelId.includes('lfm-2.5');
            $('#thinking-toggle').style.display = isLFM ? 'flex' : 'none';
            if (isLFM && modelId.includes('thinking')) {
                state.thinkingEnabled = true;
                $('#thinking-toggle').classList.add('active');
            } else {
                state.thinkingEnabled = false;
                $('#thinking-toggle').classList.remove('active');
            }
        }
    });
});

$('#thinking-toggle').addEventListener('click', () => {
    state.thinkingEnabled = !state.thinkingEnabled;
    $('#thinking-toggle').classList.toggle('active', state.thinkingEnabled);
    if (state.thinkingEnabled) {
        state.selectedModel = { id: 'liquid/lfm-2.5-1.2b-thinking:free', name: 'LFM 2.5 Thinking', cost: 200 };
        $('#create-model-name').textContent = 'LFM 2.5 Thinking';
        $('#create-cost').textContent = '200';
    } else {
        state.selectedModel = { id: 'liquid/lfm-2.5-1.2b-instruct:free', name: 'LFM 2.5 Base', cost: 100 };
        $('#create-model-name').textContent = 'LFM 2.5 Base';
        $('#create-cost').textContent = '100';
    }
});

$('#create-prompt').addEventListener('input', (e) => {
    $('#create-generate').disabled = !e.target.value.trim();
});

$('#editor-prompt').addEventListener('input', (e) => {
    $('#editor-generate').disabled = !e.target.value.trim();
});

$('#create-generate').addEventListener('click', async () => {
    const prompt = $('#create-prompt').value.trim();
    if (!prompt) return;
    if (prompt.length > 10000) {
        showToast('Prompt too long. Max 10,000 characters.', 'error');
        return;
    }
    if (state.credits < state.selectedModel.cost) {
        showToast('Not enough credits!', 'error');
        return;
    }
    showLoading(true);
    try {
        const data = await apiCall('generate', {
            prompt,
            model: state.selectedModel.id,
            cost: state.selectedModel.cost
        });
        if (data.success) {
            state.credits = data.credits;
            updateUI();
            const project = {
                id: generateId(),
                name: prompt.substring(0, 50),
                description: prompt.substring(0, 200),
                visibility: 'private',
                slug: '',
                files: data.files || [{ name: 'index.html', content: data.output || '' }],
                versions: [{ id: 1, timestamp: Date.now(), files: data.files }],
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            state.projects.push(project);
            state.currentProject = project;
            state.currentFile = project.files[0];
            openEditor();
            showToast('Project created!', 'success');
        } else {
            throw new Error(data.error);
        }
    } catch (err) {
        showToast(err.message || 'Generation failed', 'error');
    }
    showLoading(false);
});

function openEditor() {
    if (!state.currentProject) return;
    $('#editor-project-name').textContent = state.currentProject.name;
    renderFileList();
    if (state.currentProject.files.length > 0) {
        selectFile(state.currentProject.files[0]);
    }
    showScreen('editor-screen');
}

function renderFileList() {
    const list = $('#file-list');
    list.innerHTML = state.currentProject.files.map((f, i) => `
        <div class="file-item ${state.currentFile?.name === f.name ? 'active' : ''}" data-index="${i}">
            <i class="fas fa-file-code"></i>
            <span class="fname">${escapeHtml(f.name)}</span>
            <button class="del-btn" data-index="${i}"><i class="fas fa-times"></i></button>
        </div>
    `).join('');
    list.querySelectorAll('.file-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.del-btn')) return;
            const idx = parseInt(item.dataset.index);
            selectFile(state.currentProject.files[idx]);
        });
    });
    list.querySelectorAll('.del-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index);
            if (state.currentProject.files.length > 1) {
                state.currentProject.files.splice(idx, 1);
                if (state.currentFile === state.currentProject.files[idx]) {
                    selectFile(state.currentProject.files[0]);
                }
                renderFileList();
            }
        });
    });
}

function selectFile(file) {
    state.currentFile = file;
    $('#code-textarea').value = file.content || '';
    renderFileList();
    updatePreview();
}

$('#code-textarea').addEventListener('input', (e) => {
    if (state.currentFile) {
        state.currentFile.content = e.target.value;
        updatePreview();
    }
});

function updatePreview() {
    if (!state.currentProject) return;
    const htmlFile = state.currentProject.files.find(f => f.name.endsWith('.html'));
    if (htmlFile) {
        let html = htmlFile.content;
        state.currentProject.files.forEach(f => {
            if (f.name.endsWith('.css')) {
                html = html.replace('</head>', `<style>${f.content}</style></head>`);
            }
            if (f.name.endsWith('.js') && !f.name.endsWith('.html')) {
                html = html.replace('</body>', `<script>${f.content}<\/script></body>`);
            }
        });
        $('#preview-frame').srcdoc = html;
    }
}

$('#refresh-preview').addEventListener('click', updatePreview);

$('#add-file-btn').addEventListener('click', () => {
    $('#add-file-modal').style.display = 'flex';
    $('#new-filename-input').value = '';
    $('#new-filename-input').focus();
});

$('#cancel-add-file').addEventListener('click', () => {
    $('#add-file-modal').style.display = 'none';
});

$('#confirm-add-file').addEventListener('click', () => {
    const name = $('#new-filename-input').value.trim();
    if (!name) return;
    if (state.currentProject.files.some(f => f.name === name)) {
        showToast('File already exists', 'error');
        return;
    }
    const newFile = { name, content: '' };
    state.currentProject.files.push(newFile);
    selectFile(newFile);
    renderFileList();
    $('#add-file-modal').style.display = 'none';
});

$('#editor-generate').addEventListener('click', async () => {
    const prompt = $('#editor-prompt').value.trim();
    if (!prompt || !state.currentProject) return;
    if (prompt.length > 10000) {
        showToast('Prompt too long. Max 10,000 characters.', 'error');
        return;
    }
    if (state.credits < state.selectedModel.cost) {
        showToast('Not enough credits!', 'error');
        return;
    }
    showLoading(true);
    try {
        const data = await apiCall('generate', {
            prompt,
            model: state.selectedModel.id,
            cost: state.selectedModel.cost,
            files: state.currentProject.files
        });
        if (data.success) {
            state.credits = data.credits;
            updateUI();
            if (data.files && data.files.length > 0) {
                data.files.forEach(newFile => {
                    const existing = state.currentProject.files.find(f => f.name === newFile.name);
                    if (existing) {
                        existing.content = newFile.content;
                    } else {
                        state.currentProject.files.push(newFile);
                    }
                });
                renderFileList();
                if (state.currentFile) {
                    const updated = state.currentProject.files.find(f => f.name === state.currentFile.name);
                    if (updated) {
                        selectFile(updated);
                    }
                }
            }
            $('#editor-prompt').value = '';
            $('#editor-generate').disabled = true;
            showToast('Code updated!', 'success');
        } else {
            throw new Error(data.error);
        }
    } catch (err) {
        showToast(err.message || 'Generation failed', 'error');
    }
    showLoading(false);
});

$('#save-project-btn').addEventListener('click', async () => {
    if (!state.currentProject) return;
    try {
        await apiCall('save_project', { project: state.currentProject });
        showToast('Project saved!', 'success');
    } catch (err) {
        showToast(err.message || 'Failed to save', 'error');
    }
});

$('#project-settings-btn').addEventListener('click', () => {
    if (!state.currentProject) return;
    $('#project-name-input').value = state.currentProject.name || '';
    $('#project-slug-input').value = state.currentProject.slug || '';
    $('#project-desc-input').value = state.currentProject.description || '';
    $('#project-visibility-input').value = state.currentProject.visibility || 'private';
    $('#project-username-preview').textContent = state.username || 'user';
    $('#project-settings-modal').classList.add('active');
});

$('#close-project-settings').addEventListener('click', () => {
    $('#project-settings-modal').classList.remove('active');
});

$('#cancel-project-settings').addEventListener('click', () => {
    $('#project-settings-modal').classList.remove('active');
});

$('#save-project-settings').addEventListener('click', async () => {
    if (!state.currentProject) return;
    state.currentProject.name = $('#project-name-input').value.trim() || 'Untitled';
    state.currentProject.slug = $('#project-slug-input').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    state.currentProject.description = $('#project-desc-input').value.trim();
    state.currentProject.visibility = $('#project-visibility-input').value;
    state.currentProject.updatedAt = Date.now();
    $('#editor-project-name').textContent = state.currentProject.name;
    $('#project-settings-modal').classList.remove('active');
    try {
        await apiCall('save_project', { project: state.currentProject });
        showToast('Settings saved!', 'success');
    } catch (err) {
        showToast(err.message || 'Failed to save', 'error');
    }
});

$('#delete-project-btn').addEventListener('click', async () => {
    if (!state.currentProject) return;
    if (!confirm('Are you sure you want to delete this project? This cannot be undone.')) return;
    try {
        await apiCall('delete_project', { projectId: state.currentProject.id });
        state.projects = state.projects.filter(p => p.id !== state.currentProject.id);
        state.currentProject = null;
        $('#project-settings-modal').classList.remove('active');
        showScreen('main-screen');
        showToast('Project deleted', 'success');
    } catch (err) {
        showToast(err.message || 'Failed to delete', 'error');
    }
});

let usernameCheckTimeout;
$('#username-input').addEventListener('input', (e) => {
    const val = e.target.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    e.target.value = val;
    clearTimeout(usernameCheckTimeout);
    if (val.length < 3) {
        $('#username-status').textContent = 'Username must be at least 3 characters';
        $('#username-status').className = 'username-status taken';
        $('#save-username-btn').disabled = true;
        return;
    }
    $('#username-status').textContent = 'Checking...';
    $('#username-status').className = 'username-status';
    usernameCheckTimeout = setTimeout(async () => {
        try {
            const data = await apiCall('check_username', { username: val });
            if (data.available) {
                $('#username-status').textContent = 'Username available!';
                $('#username-status').className = 'username-status available';
                $('#save-username-btn').disabled = false;
            } else {
                $('#username-status').textContent = 'Username taken';
                $('#username-status').className = 'username-status taken';
                $('#save-username-btn').disabled = true;
            }
        } catch (err) {
            $('#username-status').textContent = 'Error checking username';
            $('#username-status').className = 'username-status taken';
        }
    }, 500);
});

$('#save-username-btn').addEventListener('click', async () => {
    const username = $('#username-input').value.trim();
    if (!username || username.length < 3) return;
    try {
        const data = await apiCall('update_username', { username });
        if (data.success) {
            state.username = data.username;
            updateUI();
            $('#username-modal').classList.remove('open');
            showScreen('main-screen');
            showToast('Username set!', 'success');
        } else {
            throw new Error(data.error);
        }
    } catch (err) {
        showToast(err.message || 'Failed to set username', 'error');
    }
});

$('#save-settings-btn').addEventListener('click', async () => {
    const newUsername = $('#settings-username').value.trim();
    if (newUsername !== state.username) {
        const now = Date.now();
        if (now - state.lastUsernameChange < 60000) {
            const remaining = Math.ceil((60000 - (now - state.lastUsernameChange)) / 1000);
            showToast(`Please wait ${remaining}s before changing username again`, 'error');
            return;
        }
        try {
            const data = await apiCall('update_username', { username: newUsername });
            if (data.success) {
                state.username = data.username;
                state.lastUsernameChange = now;
                updateUI();
                showToast('Settings saved!', 'success');
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            showToast(err.message || 'Failed to update', 'error');
        }
    } else {
        showToast('Settings saved!', 'success');
    }
});

$('#change-avatar-btn').addEventListener('click', () => {
    $('#avatar-input').click();
});

$('#avatar-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
        showToast('Image must be under 2MB', 'error');
        return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
        const base64 = ev.target.result;
        try {
            const data = await apiCall('update_avatar', { avatar: base64 });
            if (data.success) {
                $('#settings-avatar').style.backgroundImage = `url(${base64})`;
                $('#user-avatar').src = base64;
                $('#dropdown-avatar').src = base64;
                showToast('Avatar updated!', 'success');
            }
        } catch (err) {
            showToast(err.message || 'Failed to update avatar', 'error');
        }
    };
    reader.readAsDataURL(file);
});

$('#my-profile-btn').addEventListener('click', () => {
    $('#user-dropdown').classList.remove('open');
    loadProfile(state.user.uid);
});

$('#my-projects-btn').addEventListener('click', async () => {
    $('#user-dropdown').classList.remove('open');
    showLoading(true, 'Loading projects...');
    try {
        const data = await apiCall('get_my_projects');
        state.projects = data.projects || [];
        const grid = $('#feed-grid');
        if (state.projects.length === 0) {
            grid.innerHTML = `
                <div class="empty-feed">
                    <i class="fas fa-folder-open"></i>
                    <h3>No projects yet</h3>
                    <p>Create your first project!</p>
                </div>
            `;
        } else {
            grid.innerHTML = state.projects.map(p => `
                <div class="project-card" data-id="${p.id}" data-mine="true">
                    <div class="project-preview">
                        ${p.preview ? `<iframe srcdoc="${escapeHtml(p.preview)}" sandbox="allow-scripts"></iframe>` : '<div class="preview-placeholder"><i class="fas fa-code"></i></div>'}
                    </div>
                    <div class="project-info">
                        <div class="project-title-row">
                            <span class="project-title">
                                ${escapeHtml(p.name)}
                                <i class="fas fa-${p.visibility === 'public' ? 'globe' : p.visibility === 'unlisted' ? 'link' : 'lock'}" style="font-size: 12px; color: var(--text-3);"></i>
                            </span>
                        </div>
                        <p class="project-desc">${escapeHtml(p.description || 'No description')}</p>
                        <div class="project-meta">
                            <span>${new Date(p.updated_at || p.updatedAt).toLocaleDateString()}</span>
                        </div>
                    </div>
                </div>
            `).join('');
        }
        showScreen('main-screen');
        $('.feed-header h1').textContent = 'My Projects';
        $('.feed-header p').textContent = 'Manage your creations';
    } catch (err) {
        showToast(err.message || 'Failed to load projects', 'error');
    }
    showLoading(false);
});

async function loadProfile(userId) {
    showLoading(true, 'Loading profile...');
    try {
        const data = await apiCall('get_profile', { profileUserId: userId });
        if (data.success) {
            const isOwn = userId === state.user.uid;
            $('#profile-avatar').style.backgroundImage = `url(${data.profile.photo_url || 'https://via.placeholder.com/100/27272f/71717a?text=?'})`;
            $('#profile-display-name').textContent = data.profile.display_name || data.profile.username;
            $('#profile-username').textContent = '@' + (data.profile.username || 'user');
            $('#profile-projects-count').textContent = data.projectsCount || 0;
            $('#profile-followers-count').textContent = data.followersCount || 0;
            $('#profile-likes-count').textContent = data.likesCount || 0;
            $('#follow-btn').style.display = isOwn ? 'none' : 'flex';
            if (!isOwn) {
                $('#follow-btn').innerHTML = data.isFollowing 
                    ? '<i class="fas fa-user-check"></i> Following' 
                    : '<i class="fas fa-user-plus"></i> Follow';
                $('#follow-btn').onclick = () => toggleFollow(userId);
            }
            const grid = $('#profile-projects-grid');
            if (!data.projects || data.projects.length === 0) {
                grid.innerHTML = '<div class="empty-feed"><p>No public projects yet</p></div>';
            } else {
                grid.innerHTML = data.projects.map(p => `
                    <div class="project-card" data-id="${p.id}">
                        <div class="project-preview">
                            ${p.preview ? `<iframe srcdoc="${escapeHtml(p.preview)}" sandbox="allow-scripts"></iframe>` : '<div class="preview-placeholder"><i class="fas fa-code"></i></div>'}
                        </div>
                        <div class="project-info">
                            <span class="project-title">${escapeHtml(p.name)}</span>
                            <p class="project-desc">${escapeHtml(p.description || '')}</p>
                        </div>
                    </div>
                `).join('');
            }
            showScreen('profile-screen');
        }
    } catch (err) {
        showToast(err.message || 'Failed to load profile', 'error');
    }
    showLoading(false);
}

async function toggleFollow(userId) {
    try {
        const data = await apiCall('toggle_follow', { targetUserId: userId });
        if (data.success) {
            $('#follow-btn').innerHTML = data.isFollowing 
                ? '<i class="fas fa-user-check"></i> Following' 
                : '<i class="fas fa-user-plus"></i> Follow';
            const count = parseInt($('#profile-followers-count').textContent) + (data.isFollowing ? 1 : -1);
            $('#profile-followers-count').textContent = Math.max(0, count);
        }
    } catch (err) {
        showToast(err.message || 'Failed to follow', 'error');
    }
}

document.addEventListener('click', (e) => {
    const card = e.target.closest('.project-card');
    if (card) {
        const projectId = card.dataset.id;
        const isMine = card.dataset.mine === 'true';
        if (isMine) {
            const project = state.projects.find(p => p.id === projectId);
            if (project) {
                state.currentProject = project;
                state.currentFile = project.files?.[0] || null;
                openEditor();
            }
        } else {
            openPublicProject(projectId);
        }
    }
    const likeBtn = e.target.closest('.like-btn');
    if (likeBtn) {
        e.stopPropagation();
        toggleLike(likeBtn.dataset.id, likeBtn);
    }
    const authorEl = e.target.closest('.project-author');
    if (authorEl) {
        e.stopPropagation();
        loadProfile(authorEl.dataset.user);
    }
});

async function openPublicProject(projectId) {
    showLoading(true, 'Loading project...');
    try {
        const data = await apiCall('get_project', { projectId });
        if (data.success && data.project) {
            state.currentProject = {
                ...data.project,
                files: data.project.files || [{ name: 'index.html', content: '' }]
            };
            state.currentFile = state.currentProject.files[0];
            openEditor();
        }
    } catch (err) {
        showToast(err.message || 'Failed to load project', 'error');
    }
    showLoading(false);
}

async function toggleLike(projectId, btn) {
    try {
        const data = await apiCall('toggle_like', { projectId });
        if (data.success) {
            btn.classList.toggle('liked', data.liked);
            const countEl = btn.querySelector('span');
            const count = parseInt(countEl.textContent) + (data.liked ? 1 : -1);
            countEl.textContent = Math.max(0, count);
        }
    } catch (err) {
        showToast(err.message || 'Failed to like', 'error');
    }
}

const taskbar = $('#taskbar');
let taskbarTimeout;
document.addEventListener('mousemove', (e) => {
    if (e.clientY > window.innerHeight - 100) {
        taskbar.classList.add('visible');
        clearTimeout(taskbarTimeout);
    } else {
        taskbarTimeout = setTimeout(() => {
            if (!taskbar.matches(':hover')) {
                taskbar.classList.remove('visible');
            }
        }, 1000);
    }
});

auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
