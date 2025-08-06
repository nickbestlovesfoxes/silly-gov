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
let isInRoom = false;

// Initialize the application
function init() {
    setupEventListeners();
    updateJoinButtonState();
    messageInput.focus = () => {}; // Prevent auto-focus in setup
    roomInput.focus();
}

function setupEventListeners() {
    // Setup screen events
    roomInput.addEventListener('input', updateJoinButtonState);
    displayNameInput.addEventListener('input', updateJoinButtonState);
    joinBtn.addEventListener('click', joinRoom);
    
    // Chat screen events
    leaveBtn.addEventListener('click', leaveRoom);
    sendBtn.addEventListener('click', sendMessage);
    
    // Handle textarea input and auto-resize
    messageInput.addEventListener('input', autoResizeTextarea);
    
    // Handle key presses for Discord-like behavior
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                // Shift+Enter: Allow new line (default behavior)
                return;
            } else {
                // Enter alone: Send message
                e.preventDefault();
                sendMessage();
            }
        }
    });

    // IPC event listeners
    ipcRenderer.on('new-message', (event, message) => {
        // Handle both message.content and message.text for compatibility
        const messageText = message.text || message.content || '';
        addMessageToUI(message.sender, messageText, message.timestamp, false);
    });

    ipcRenderer.on('history-received', (event, messages) => {
        // Clear existing messages and add history
        chatMessages.innerHTML = '';
        messages.forEach(message => {
            addMessageToUI(message.sender, message.text || message.content, message.timestamp, message.sender === currentDisplayName);
        });
    });

    ipcRenderer.on('error', (event, errorMessage) => {
        showStatus(errorMessage, 'error');
    });
}

function updateJoinButtonState() {
    const roomName = roomInput.value.trim();
    joinBtn.disabled = !roomName;
}

// Format name function: convert spaces to dashes, capitalize first letter, lowercase rest
function formatName(name) {
    if (!name) return '';
    return name.trim()
        .replace(/\s+/g, '-') // Replace spaces with dashes
        .toLowerCase() // Make everything lowercase
        .replace(/^./, char => char.toUpperCase()); // Capitalize first character
}

// Auto-resize textarea function
function autoResizeTextarea() {
    messageInput.style.height = '44px'; // Reset to minimum height
    const scrollHeight = messageInput.scrollHeight;
    const maxHeight = 200; // Match CSS max-height
    messageInput.style.height = Math.min(scrollHeight, maxHeight) + 'px';
}

async function joinRoom() {
    const room = formatName(roomInput.value);
    const name = displayNameInput.value.trim() ? formatName(displayNameInput.value) : '';

    if (!room) {
        showStatus('Please enter a room name', 'error');
        return;
    }

    joinBtn.disabled = true;
    showStatus('Connecting...', 'info');

    try {
        const result = await ipcRenderer.invoke('join-room', room, name);
        
        if (result.success) {
            currentDisplayName = name || 'Anonymous';
            isInRoom = true;
            
            // Show room name and user name together with styling
            currentRoomSpan.innerHTML = `${room} <span style="color: #888;">•</span> <span style="color: #ff4444;">${currentDisplayName}</span>`;
            
            // Switch to chat screen
            setupScreen.style.display = 'none';
            chatScreen.style.display = 'flex';
            
            // Clear any existing messages
            chatMessages.innerHTML = '';
            
            // Update placeholder with room name
            messageInput.placeholder = `Message ${room}`;
            messageInput.focus();
            
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
        
        // Update state
        isInRoom = false;
        currentDisplayName = '';
        
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
    }
}

async function sendMessage() {
    const text = messageInput.value.trim();
    
    if (!text) return;
    
    if (!isInRoom) {
        return;
    }

    // Store message locally first (optimistic UI)
    const tempMessage = text;
    messageInput.value = '';
    autoResizeTextarea(); // Reset height after clearing
    sendBtn.disabled = true;

    try {
        const result = await ipcRenderer.invoke('send-message', tempMessage);
        
        if (result.success) {
            // Add the message to UI immediately (local echo)
            addMessageToUI(currentDisplayName, tempMessage, Date.now(), true);
        } else {
            // Restore message on failure
            messageInput.value = tempMessage;
            autoResizeTextarea();
        }
    } catch (error) {
        console.error('Error sending message:', error);
        // Restore message on error
        messageInput.value = tempMessage;
        autoResizeTextarea();
    } finally {
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

// Add message to UI with Discord-style layout
function addMessageToUI(sender, text, timestamp, isOwn) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isOwn ? 'own' : ''}`;
    
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const displayName = sender || 'Anonymous';
    messageDiv.innerHTML = `
        <span class="message-time">${time}</span>
        <span class="message-author">${displayName}</span>
        <span class="message-content">${text}</span>
    `;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addMessage(message, isOwn) {
    addMessageToUI(message.sender, message.content || message.text, message.timestamp, isOwn);
}

function showStatus(message, type = 'info') {
    setupStatus.textContent = message;
    setupStatus.style.color = type === 'error' ? '#e74c3c' : '#f39c12';
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', init);

// Auto focus on room input
document.addEventListener('DOMContentLoaded', () => {
    roomInput.focus();
});
