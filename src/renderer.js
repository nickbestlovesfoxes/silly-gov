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
const CHUNK_SIZE = 60000; // 60KB
let currentDisplayName = '';
let isInRoom = false;
let attachedFiles = new Map(); // fileId -> { name, size, data }
let incomingChunks = new Map(); // fileId -> { name, size, totalChunks, chunks[] }


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
        addMessageToUI(message.sender, message, message.timestamp, false);
    });

    ipcRenderer.on('history-received', (event, messages) => {
        // Clear existing messages and add history
        chatMessages.innerHTML = '';
        messages.forEach(message => {
            addMessageToUI(message.sender, message, message.timestamp, message.sender === currentDisplayName);
        });
    });

    ipcRenderer.on('error', (event, errorMessage) => {
        showStatus(errorMessage, 'error');
    });

    ipcRenderer.on('file-download', (event, fileData) => {
        ipcRenderer.send('save-file-dialog', fileData);
    });

    ipcRenderer.on('file-chunk-received', (event, chunkData) => {
        handleFileChunk(chunkData);
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

// Robust ArrayBuffer to Base64 converter
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}


// Promisified file reader
function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve(arrayBufferToBase64(reader.result));
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

// Handle file selection
async function handleFileSelection(event) {
    const files = Array.from(event.target.files);
    
    for (const file of files) {
        const fileId = generateFileId();
        
        try {
            const base64Data = await readFileAsBase64(file);
            attachedFiles.set(fileId, {
                name: file.name,
                size: file.size,
                data: base64Data
            });
            createFileElement(fileId, file.name, formatFileSize(file.size));
        } catch (error) {
            console.error("Error reading file:", error);
            // Optionally, show an error to the user
        }
    }
    
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
    textSpan.className = 'file-element-text file-name';
    textSpan.textContent = fileName;

    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'file-size';
    sizeSpan.textContent = fileSize;
    
    fileElement.appendChild(removeBtn);
    fileElement.appendChild(textSpan);
    fileElement.appendChild(sizeSpan);
    
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

function getMessagePayload() {
    const structure = [];
    const filesToSend = new Map();

    for (const node of messageInput.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            if (text) {
                structure.push({ type: 'text', content: text });
            }
        } else if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('file-element')) {
            const fileId = node.dataset.fileId;
            if (fileId && attachedFiles.has(fileId)) {
                structure.push({ type: 'file', id: fileId });
                if (!filesToSend.has(fileId)) {
                    const fileData = attachedFiles.get(fileId);
                    filesToSend.set(fileId, {
                        id: fileId,
                        name: fileData.name,
                        size: fileData.size,
                        data: fileData.data
                    });
                }
            }
        }
    }

    // Trim leading/trailing whitespace text nodes
    if (structure.length > 0 && structure[0].type === 'text') {
        structure[0].content = structure[0].content.trimStart();
    }
    if (structure.length > 0 && structure[structure.length - 1].type === 'text') {
        structure[structure.length - 1].content = structure[structure.length - 1].content.trimEnd();
    }

    return {
        structure: structure.filter(item => item.type !== 'text' || item.content), // remove empty text nodes
        files: Array.from(filesToSend.values())
    };
}

async function sendMessage() {
    const payload = getMessagePayload();

    if (payload.structure.length === 0) return;
    if (!isInRoom) return;

    const tempContent = messageInput.innerHTML;
    const tempAttachedFiles = new Map(attachedFiles);

    // Create a version of the payload without the large file data
    const messagePayload = {
        structure: payload.structure,
        files: payload.files.map(file => ({
            id: file.id,
            name: file.name,
            size: file.size,
            totalChunks: Math.ceil(file.data.length / CHUNK_SIZE)
        }))
    };

    messageInput.innerHTML = '';
    attachedFiles.clear();

    try {
        sendBtn.disabled = true;
        const result = await ipcRenderer.invoke('send-message', messagePayload);

        if (result.success) {
            // Add message to UI immediately (without file data)
            addMessageToUI(currentDisplayName, messagePayload, Date.now(), true, tempAttachedFiles);

            // Now, send the file chunks
            for (const file of payload.files) {
                const totalChunks = Math.ceil(file.data.length / CHUNK_SIZE);
                for (let i = 0; i < totalChunks; i++) {
                    const chunk = file.data.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                    ipcRenderer.send('send-file-chunk', {
                        fileId: file.id,
                        chunkIndex: i,
                        chunkData: chunk
                    });
                    // Small delay to avoid flooding the main process
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
            }
        } else {
            messageInput.innerHTML = tempContent;
            attachedFiles = tempAttachedFiles;
        }
    } catch (error) {
        console.error('Error sending message:', error);
        messageInput.innerHTML = tempContent;
        attachedFiles = tempAttachedFiles;
    } finally {
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

function handleFileChunk(chunkData) {
    const { fileId, chunkIndex } = chunkData;

    if (!incomingChunks.has(fileId)) {
        // This shouldn't happen if the main message arrives first, but as a fallback:
        console.error(`Received chunk for unknown fileId: ${fileId}`);
        return;
    }

    const file = incomingChunks.get(fileId);
    file.chunks[chunkIndex] = chunkData;

    // Check if all chunks have arrived
    if (file.chunks.filter(c => c).length === file.totalChunks) {
        const fileData = file.chunks.join('');
        incomingChunks.delete(fileId);

        // Update the file element in the DOM
        const fileElement = document.querySelector(`[data-file-id="${fileId}"]`);
        if (fileElement) {
            fileElement.dataset.fileData = fileData;
            // Maybe add a visual indicator that the file is ready
            fileElement.style.borderColor = '#4CAF50'; // Green border
        }
    }
}

function addMessageToUI(sender, payload, timestamp, isOwn, tempAttachedFiles = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isOwn ? 'own' : ''}`;

    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const displayName = sender || 'Anonymous';

    const messageContentSpan = document.createElement('span');
    messageContentSpan.className = 'message-content';

    const filesMap = new Map((payload.files || []).map(f => [f.id, f]));

    if (payload.structure && payload.structure.length > 0) {
        payload.structure.forEach(item => {
            if (item.type === 'text') {
                messageContentSpan.appendChild(document.createTextNode(item.content));
            } else if (item.type === 'file') {
                const file = filesMap.get(item.id);
                if (file) {
                    const fileSize = typeof file.size === 'number' ? formatFileSize(file.size) : file.size;
                    const fileElement = document.createElement('span');
                    fileElement.className = 'file-element clickable-file';
                    fileElement.dataset.fileId = file.id;
                    fileElement.dataset.fileName = escapeHtml(file.name);

                    // If the message is from another user, store metadata for chunk reassembly
                    if (!isOwn) {
                        incomingChunks.set(file.id, {
                            name: file.name,
                            size: file.size,
                            totalChunks: file.totalChunks,
                            chunks: new Array(file.totalChunks)
                        });
                    } else {
                        // For our own message, the data is already available
                        const fileMap = tempAttachedFiles || attachedFiles;
                        const originalFile = fileMap.get(file.id);
                        if (originalFile) {
                            fileElement.dataset.fileData = originalFile.data;
                        }
                    }

                    const fileNameSpan = document.createElement('span');
                    fileNameSpan.className = 'file-name';
                    fileNameSpan.textContent = escapeHtml(file.name);

                    const fileSizeSpan = document.createElement('span');
                    fileSizeSpan.className = 'file-size';
                    fileSizeSpan.textContent = fileSize;

                    fileElement.appendChild(fileNameSpan);
                    fileElement.appendChild(fileSizeSpan);

                    fileElement.addEventListener('click', async () => {
                        if (fileElement.dataset.fileData) {
                            try {
                                await ipcRenderer.invoke('save-file-dialog', {
                                    fileName: fileElement.dataset.fileName,
                                    fileData: fileElement.dataset.fileData
                                });
                            } catch (error) {
                                console.error('File save error:', error);
                            }
                        } else {
                            // File not ready yet
                            showStatus('File is still downloading...', 'info');
                        }
                    });

                    messageContentSpan.appendChild(fileElement);
                }
            }
        });
    } else if (payload.text) { // Fallback for old format if needed
        const textSpan = document.createElement('span');
        textSpan.className = 'message-text';
        textSpan.textContent = payload.text;
        messageContentSpan.appendChild(textSpan);
    }
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = time;

    const authorSpan = document.createElement('span');
    authorSpan.className = 'message-author';
    authorSpan.textContent = escapeHtml(displayName);

    messageDiv.appendChild(timeSpan);
    messageDiv.appendChild(authorSpan);
    messageDiv.appendChild(messageContentSpan);

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
