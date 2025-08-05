const { ipcRenderer } = require('electron');

// DOM elements
const setupScreen = document.getElementById('setup-screen');
const chatScreen = document.getElementById('chat-screen');
const roomInput = document.getElementById('room-input');
const displayNameInput = document.getElementById('display-name-input');
const joinBtn = document.getElementById('join-btn');
const setupStatus = document.getElementById('setup-status');
const currentRoomSpan = document.getElementById('current-room');
const peerCountSpan = document.getElementById('peer-count');
const leaveBtn = document.getElementById('leave-btn');
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');

// Application state
let currentDisplayName = '';
let peerCount = 0;

// Initialize the application
function init() {
    setupEventListeners();
    updateJoinButtonState();
}

function setupEventListeners() {
    // Setup screen events
    roomInput.addEventListener('input', updateJoinButtonState);
    displayNameInput.addEventListener('input', updateJoinButtonState);
    joinBtn.addEventListener('click', joinRoom);
    
    // Chat screen events
    leaveBtn.addEventListener('click', leaveRoom);
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // IPC event listeners
    ipcRenderer.on('new-message', (event, message) => {
        addMessage(message, false);
    });

    ipcRenderer.on('peer-joined', (event, data) => {
        peerCount = data.peerCount;
        updatePeerCount();
        addSystemMessage(`${data.displayName} joined the room`);
    });

    ipcRenderer.on('peer-left', (event, data) => {
        peerCount = data.peerCount;
        updatePeerCount();
        addSystemMessage(`${data.displayName} left the room`);
    });

    ipcRenderer.on('peer-timeout', (event, data) => {
        peerCount = data.peerCount;
        updatePeerCount();
        addSystemMessage(`${data.displayName} disconnected (timeout)`);
    });

    ipcRenderer.on('history-received', (event, messages) => {
        // Clear existing messages and add history
        chatMessages.innerHTML = '';
        messages.forEach(message => {
            addMessage(message, message.sender === currentDisplayName);
        });
        addSystemMessage('Chat history synchronized');
    });

    ipcRenderer.on('message-ack', (event, messageId) => {
        // Handle message acknowledgment if needed
        console.log('Message acknowledged:', messageId);
    });

    ipcRenderer.on('error', (event, errorMessage) => {
        showStatus(errorMessage, 'error');
    });
}

function updateJoinButtonState() {
    const roomName = roomInput.value.trim();
    const displayName = displayNameInput.value.trim();
    const isValid = roomName.length > 0 && displayName.length > 0;
    
    joinBtn.disabled = !isValid;
}

async function joinRoom() {
    const roomName = roomInput.value.trim();
    const displayName = displayNameInput.value.trim();

    if (!roomName || !displayName) {
        showStatus('Please enter both room name and display name', 'error');
        return;
    }

    // Validate room name (alphanumeric and basic symbols only)
    if (!/^[a-zA-Z0-9_-]+$/.test(roomName)) {
        showStatus('Room name can only contain letters, numbers, underscores, and hyphens', 'error');
        return;
    }

    joinBtn.disabled = true;
    showStatus('Joining room...', 'info');

    try {
        const result = await ipcRenderer.invoke('join-room', roomName, displayName);
        
        if (result.success) {
            currentDisplayName = displayName;
            currentRoomSpan.textContent = roomName;
            peerCount = 0;
            updatePeerCount();
            
            // Switch to chat screen
            setupScreen.style.display = 'none';
            chatScreen.style.display = 'flex';
            
            // Clear any existing messages
            chatMessages.innerHTML = '';
            
            // Focus message input
            messageInput.focus();
            
            addSystemMessage(`Welcome to room "${roomName}"! Listening on port ${result.port}`);
            addSystemMessage('Looking for other peers...');
            
        } else {
            showStatus(`Failed to join room: ${result.error}`, 'error');
            joinBtn.disabled = false;
        }
    } catch (error) {
        console.error('Error joining room:', error);
        showStatus(`Error joining room: ${error.message}`, 'error');
        joinBtn.disabled = false;
    }
}

async function leaveRoom() {
    try {
        await ipcRenderer.invoke('leave-room');
        
        // Switch back to setup screen
        chatScreen.style.display = 'none';
        setupScreen.style.display = 'flex';
        
        // Reset form
        roomInput.value = '';
        displayNameInput.value = '';
        updateJoinButtonState();
        
        // Clear status
        setupStatus.textContent = '';
        setupStatus.className = 'status';
        
        // Focus room input
        roomInput.focus();
        
    } catch (error) {
        console.error('Error leaving room:', error);
        addSystemMessage(`Error leaving room: ${error.message}`);
    }
}

async function sendMessage() {
    const text = messageInput.value.trim();
    
    if (!text) return;
    
    messageInput.value = '';
    sendBtn.disabled = true;

    try {
        const result = await ipcRenderer.invoke('send-message', text);
        
        if (result.success) {
            addMessage(result.message, true);
        } else {
            addSystemMessage(`Failed to send message: ${result.error}`);
        }
    } catch (error) {
        console.error('Error sending message:', error);
        addSystemMessage(`Error sending message: ${error.message}`);
    } finally {
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

function addMessage(message, isOwn) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isOwn ? 'own' : 'other'}`;
    
    const headerDiv = document.createElement('div');
    headerDiv.className = 'message-header';
    headerDiv.textContent = `${message.sender} • ${formatTimestamp(message.timestamp)}`;
    
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.textContent = message.text;
    
    messageDiv.appendChild(headerDiv);
    messageDiv.appendChild(textDiv);
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'system-message';
    messageDiv.textContent = text;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updatePeerCount() {
    const text = peerCount === 0 ? 'No other peers' : 
                 peerCount === 1 ? '1 peer connected' : 
                 `${peerCount} peers connected`;
    peerCountSpan.textContent = text;
}

function showStatus(message, type = 'info') {
    setupStatus.textContent = message;
    setupStatus.className = `status ${type}`;
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Utility functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', init);

// Handle window focus for better UX
window.addEventListener('focus', () => {
    if (chatScreen.style.display !== 'none') {
        messageInput.focus();
    } else {
        roomInput.focus();
    }
});

// Auto-save display name to localStorage
displayNameInput.addEventListener('input', () => {
    const displayName = displayNameInput.value.trim();
    if (displayName) {
        localStorage.setItem('localchat-displayname', displayName);
    }
});

// Load saved display name on startup
document.addEventListener('DOMContentLoaded', () => {
    const savedDisplayName = localStorage.getItem('localchat-displayname');
    if (savedDisplayName) {
        displayNameInput.value = savedDisplayName;
        updateJoinButtonState();
    }
});
