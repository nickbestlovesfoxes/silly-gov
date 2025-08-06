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
const filePickerBtn = document.getElementById('file-picker-btn');
const fileInput = document.getElementById('file-input');

// Application state
let currentDisplayName = '';
let isInRoom = false;
let attachedFiles = new Map(); // fileId -> { name, size, data }

// Initialize the application
function init() {
    setupEventListeners();
    updateJoinButtonState();
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
    
    // File picker events
    filePickerBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelection);
    
    // Handle contenteditable input
    messageInput.addEventListener('input', handleInputChange);
    
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
        addMessageToUI(message.sender, messageText, message.timestamp, false, message.files);
    });

    ipcRenderer.on('history-received', (event, messages) => {
        // Clear existing messages and add history
        chatMessages.innerHTML = '';
        messages.forEach(message => {
            addMessageToUI(message.sender, message.text || message.content, message.timestamp, message.sender === currentDisplayName, message.files);
        });
    });

    ipcRenderer.on('error', (event, errorMessage) => {
        showStatus(errorMessage, 'error');
    });

    ipcRenderer.on('file-download', (event, fileData) => {
        downloadFile(fileData);
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
    // Not needed for contenteditable div
}

// Handle file selection
function handleFileSelection(event) {
    const files = Array.from(event.target.files);
    
    files.forEach(file => {
        const fileId = generateFileId();
        const fileSize = formatFileSize(file.size);
        
        // Store file data
        const reader = new FileReader();
        reader.onload = (e) => {
            attachedFiles.set(fileId, {
                name: file.name,
                size: file.size,
                data: e.target.result
            });
        };
        reader.readAsArrayBuffer(file);
        
        // Create file element
        createFileElement(fileId, file.name, fileSize);
    });
    
    // Clear the file input
    fileInput.value = '';
}

// Generate unique file ID
function generateFileId() {
    return 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
}

// Create file element in the input
function createFileElement(fileId, fileName, fileSize) {
    const fileElement = document.createElement('span');
    fileElement.className = 'file-element';
    fileElement.dataset.fileId = fileId;
    fileElement.contentEditable = false;
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.innerHTML = '×';
    removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFileElement(fileId);
    });
    
    const textSpan = document.createElement('span');
    textSpan.className = 'file-element-text';
    textSpan.textContent = `[${fileName}] (${fileSize})`;
    
    fileElement.appendChild(removeBtn);
    fileElement.appendChild(textSpan);
    
    // Insert at cursor position
    insertAtCursor(fileElement);
    
    // Add space after file element
    const space = document.createTextNode(' ');
    insertAtCursor(space);
    
    messageInput.focus();
}

// Insert element at cursor position
function insertAtCursor(element) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(element);
        range.setStartAfter(element);
        range.setEndAfter(element);
        selection.removeAllRanges();
        selection.addRange(range);
    } else {
        messageInput.appendChild(element);
    }
}

// Remove file element
function removeFileElement(fileId) {
    const fileElement = messageInput.querySelector(`[data-file-id="${fileId}"]`);
    if (fileElement) {
        fileElement.remove();
        attachedFiles.delete(fileId);
    }
}

// Handle input changes
function handleInputChange() {
    // Remove any file elements that might have been corrupted
    const fileElements = messageInput.querySelectorAll('.file-element');
    fileElements.forEach(element => {
        const fileId = element.dataset.fileId;
        if (!attachedFiles.has(fileId)) {
            element.remove();
        }
    });
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
            messageInput.setAttribute('data-placeholder', `Message ${room}`);
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
    // Get text content and files
    const textContent = getTextContent();
    const messageFiles = getAttachedFiles();
    
    if (!textContent.trim() && messageFiles.length === 0) return;
    
    if (!isInRoom) {
        return;
    }

    // Store message locally first (optimistic UI)
    const tempContent = messageInput.innerHTML;
    const tempFiles = [...messageFiles];
    
    // Clear input
    messageInput.innerHTML = '';
    attachedFiles.clear();
    sendBtn.disabled = true;

    try {
        const result = await ipcRenderer.invoke('send-message', {
            text: textContent,
            files: tempFiles
        });
        
        if (result.success) {
            // Add the message to UI immediately (local echo)
            addMessageToUI(currentDisplayName, textContent, Date.now(), true, tempFiles);
        } else {
            // Restore message on failure
            messageInput.innerHTML = tempContent;
            tempFiles.forEach(file => {
                attachedFiles.set(file.id, {
                    name: file.name,
                    size: file.size,
                    data: file.data
                });
            });
        }
    } catch (error) {
        console.error('Error sending message:', error);
        // Restore message on error
        messageInput.innerHTML = tempContent;
        tempFiles.forEach(file => {
            attachedFiles.set(file.id, {
                name: file.name,
                size: file.size,
                data: file.data
            });
        });
    } finally {
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

// Get text content from contenteditable div
function getTextContent() {
    const clone = messageInput.cloneNode(true);
    // Remove file elements for text extraction
    const fileElements = clone.querySelectorAll('.file-element');
    fileElements.forEach(el => el.remove());
    return clone.textContent || '';
}

// Get attached files for sending
function getAttachedFiles() {
    const files = [];
    const fileElements = messageInput.querySelectorAll('.file-element');
    
    fileElements.forEach(element => {
        const fileId = element.dataset.fileId;
        const fileData = attachedFiles.get(fileId);
        if (fileData) {
            files.push({
                id: fileId,
                name: fileData.name,
                size: fileData.size,
                data: fileData.data
            });
        }
    });
    
    return files;
}

// Add message to UI with Discord-style layout
function addMessageToUI(sender, text, timestamp, isOwn, files = []) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isOwn ? 'own' : ''}`;
    
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const displayName = sender || 'Anonymous';
    
    // Create message content with text and files
    let messageContent = '';
    
    // Add text if present
    if (text && text.trim()) {
        messageContent += `<span class="message-text">${escapeHtml(text)}</span>`;
    }
    
    // Add files if present
    if (files && files.length > 0) {
        const fileElements = files.map(file => {
            const fileSize = typeof file.size === 'number' ? formatFileSize(file.size) : file.size;
            return `<span class="file-element clickable-file" data-file-id="${file.id}" data-file-name="${escapeHtml(file.name)}" data-file-data="${file.data ? btoa(String.fromCharCode(...new Uint8Array(file.data))) : ''}">[${escapeHtml(file.name)}] (${fileSize})</span>`;
        }).join(' ');
        
        if (messageContent) {
            messageContent += ' ' + fileElements;
        } else {
            messageContent = fileElements;
        }
    }
    
    messageDiv.innerHTML = `
        <span class="message-time">${time}</span>
        <span class="message-author">${escapeHtml(displayName)}</span>
        <span class="message-content">${messageContent}</span>
    `;
    
    // Add click handlers for file downloads
    const clickableFiles = messageDiv.querySelectorAll('.clickable-file');
    clickableFiles.forEach(fileElement => {
        fileElement.addEventListener('click', () => {
            const fileName = fileElement.dataset.fileName;
            const fileData = fileElement.dataset.fileData;
            if (fileData) {
                downloadFileFromBase64(fileName, fileData);
            }
        });
    });
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Download file from base64 data
function downloadFileFromBase64(fileName, base64Data) {
    try {
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        const blob = new Blob([bytes]);
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Error downloading file:', error);
    }
}

// Download file (for IPC events)
function downloadFile(fileData) {
    downloadFileFromBase64(fileData.name, fileData.data);
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
