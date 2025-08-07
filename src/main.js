const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const dgram = require('dgram');
const crypto = require('crypto');
const fs = require('fs');

app.disableHardwareAcceleration();

// Application state
let mainWindow;
let udpSocket;
let currentRoom = null;
let displayName = null;
let myPeerId = null;
let peers = new Map(); // peerId -> { address, port, lastSeen }
let messages = []; // In-memory message storage
let roomKey = null;
let processedMessages = new Set(); // Track processed message IDs to prevent duplicates
let historyReceived = false; // Track if we've received history from peers

// Constants
const BASE_PORT = 12000;
const DISCOVERY_INTERVAL = 5000; // 5 seconds
const PEER_TIMEOUT = 30000; // 30 seconds
const ACK_TIMEOUT = 3000; // 3 seconds
const MAX_RETRIES = 3;

// Message types
const MESSAGE_TYPES = {
  JOIN: 'join',
  MESSAGE: 'message',
  FILE_CHUNK: 'file_chunk',
  ACK: 'ack',
  HISTORY_REQUEST: 'history_request',
  STATUS_REQUEST: 'status_request',
  LEAVE: 'leave'
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    title: 'Local Network Chat'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

// Encryption utilities
function deriveKey(roomName) {
  const salt = Buffer.from('localchat2024salt', 'utf8'); // Fixed salt
  return crypto.pbkdf2Sync(roomName, salt, 100000, 32, 'sha256');
}

function encrypt(text, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('localchat', 'utf8'));
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    iv: iv.toString('hex'),
    encrypted,
    authTag: authTag.toString('hex')
  };
}

function decrypt(encryptedData, key) {
  try {
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from('localchat', 'utf8'));
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error);
    return null;
  }
}

// UDP networking
function getPortForRoom(roomName) {
  const hash = crypto.createHash('md5').update(roomName).digest();
  const port = BASE_PORT + (hash.readUInt16BE(0) % 1000);
  return port;
}

function createUDPSocket() {
  if (udpSocket) {
    try {
      udpSocket.close();
    } catch (err) {
      // Ignore close errors
    }
    udpSocket = null;
  }

  udpSocket = dgram.createSocket('udp4');
  
  udpSocket.on('message', handleUDPMessage);
  udpSocket.on('error', (err) => {
    console.error('UDP Error:', err);
    // Don't send bind errors to UI - they're handled in join-room
    if (err.code !== 'EADDRINUSE' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('error', `Network error: ${err.message}`);
    }
  });
}

function handleUDPMessage(buffer, rinfo) {
  try {
    const message = JSON.parse(buffer.toString());
    
    // Skip our own messages immediately
    if (message.peerId === myPeerId) {
      return;
    }
    
    // Skip duplicate messages (prevents multi-port duplicates)
    if (message.messageId && processedMessages.has(message.messageId)) {
      return;
    }
    
    // Add to processed messages set
    if (message.messageId) {
      processedMessages.add(message.messageId);
      
      // Clean up old message IDs (keep last 1000)
      if (processedMessages.size > 1000) {
        const oldMessages = Array.from(processedMessages).slice(0, 500);
        oldMessages.forEach(id => processedMessages.delete(id));
      }
    }
    
    // Decrypt the message if it has encrypted content
    if (message.encrypted && roomKey) {
      const decrypted = decrypt(message.encrypted, roomKey);
      if (decrypted) {
        message.content = JSON.parse(decrypted);
      } else {
        console.log('Failed to decrypt message from', rinfo.address);
        return;
      }
    }

    // Update peer info for valid peers
    if (message.peerId && message.peerId !== myPeerId) {
      peers.set(message.peerId, {
        address: rinfo.address,
        port: rinfo.port,
        lastSeen: Date.now(),
        displayName: message.displayName,
        hasTimedOut: false // Reset timeout flag when peer is active
      });
    }

    handleMessage(message, rinfo);
  } catch (error) {
    console.error('Error parsing UDP message:', error);
  }
}

function handleMessage(message, rinfo) {
  switch (message.type) {
    case MESSAGE_TYPES.JOIN:
      handleJoinMessage(message, rinfo);
      break;
    case MESSAGE_TYPES.MESSAGE:
      handleChatMessage(message, rinfo);
      break;
    case MESSAGE_TYPES.FILE_CHUNK:
      handleFileChunkMessage(message);
      break;
    case MESSAGE_TYPES.ACK:
      handleAckMessage(message);
      break;
    case MESSAGE_TYPES.HISTORY_REQUEST:
      handleHistoryRequest(message, rinfo);
      break;
    case MESSAGE_TYPES.STATUS_REQUEST:
      handleStatusRequest(message, rinfo);
      break;
    case MESSAGE_TYPES.LEAVE:
      handleLeaveMessage(message);
      break;
  }
}

function handleJoinMessage(message, rinfo) {
  console.log(`${message.displayName} joined from ${rinfo.address}`);
  
  // Don't automatically send history - let the new peer request it
  // This allows them to choose which peer's history to use
}

function handleChatMessage(message, rinfo) {
  const chatMessage = {
    id: message.messageId,
    sender: message.displayName,
    structure: message.content.structure,
    files: message.content.files || [],
    timestamp: message.timestamp
  };
  
  messages.push(chatMessage);
  
  // Send to UI
  mainWindow.webContents.send('new-message', chatMessage);
}

function handleFileChunkMessage(message) {
  // Forward the chunk to the renderer process
  mainWindow.webContents.send('file-chunk-received', message.content);
}

function handleAckMessage(message) {
  // ACK handling removed for simplicity
}

function handleHistoryRequest(message, rinfo) {
  // Send our chat history to the requesting peer, one message at a time
  for (const msg of messages) {
    const historyMessage = {
      type: MESSAGE_TYPES.MESSAGE,
      messageId: msg.id,
      peerId: myPeerId,
      displayName: msg.sender,
      timestamp: msg.timestamp,
      content: {
        structure: msg.structure,
        files: msg.files.map(f => ({ id: f.id, name: f.name, size: f.size })) // send metadata only
      }
    };
    sendMessage(historyMessage, rinfo.address, rinfo.port);

    // If there are files, send them in chunks
    for (const file of msg.files) {
      if (file.data) {
        const totalChunks = Math.ceil(file.data.length / 60000); // Use a fixed chunk size
        for (let i = 0; i < totalChunks; i++) {
          const chunk = file.data.substring(i * 60000, (i + 1) * 60000);
          const chunkMessage = {
            type: MESSAGE_TYPES.FILE_CHUNK,
            messageId: generateMessageId(),
            peerId: myPeerId,
            displayName: displayName,
            timestamp: Date.now(),
            content: {
              fileId: file.id,
              chunkIndex: i,
              chunkData: chunk
            }
          };
          sendMessage(chunkMessage, rinfo.address, rinfo.port);
        }
      }
    }
  }
}

function handleStatusRequest(message, rinfo) {
  // Simplified - no ACK needed
}

function handleLeaveMessage(message) {
  if (peers.has(message.peerId)) {
    peers.delete(message.peerId);
  }
}

function requestChatHistory() {
  const historyRequestMessage = {
    type: MESSAGE_TYPES.HISTORY_REQUEST,
    messageId: generateMessageId(),
    peerId: myPeerId,
    displayName: displayName,
    timestamp: Date.now()
  };
  
  console.log('Requesting chat history from peers...');
  // Send to the general broadcast address on the specific port
  sendMessage(historyRequestMessage, '255.255.255.255', getPortForRoom(currentRoom));
}

function sendMessage(message, address, port) {
  if (!udpSocket) return;
  
  // Encrypt content if we have a room key
  if (roomKey && message.content) {
    const encrypted = encrypt(JSON.stringify(message.content), roomKey);
    message.encrypted = encrypted;
    delete message.content;
  }
  
  const buffer = Buffer.from(JSON.stringify(message));
  udpSocket.send(buffer, port, address, (error) => {
    if (error && error.code !== 'EACCES') {
      // Only log non-permission errors
      console.error('Error sending message to', address + ':' + port, error.message);
    }
  });
}

function broadcastMessage(message) {
  if (!currentRoom || !udpSocket) return;
  
  const basePort = getPortForRoom(currentRoom);
  
  // Simplified broadcast strategy
  const addresses = [
    '255.255.255.255', // General broadcast
  ];
  
  // Send to known peers directly
  peers.forEach((peer, peerId) => {
    if (peerId !== myPeerId) {
      sendMessage(message, peer.address, peer.port);
    }
  });
  
  // Send to broadcast addresses
  addresses.forEach(address => {
    sendMessage(message, address, basePort);
  });
}

function generatePeerId() {
  return crypto.randomBytes(8).toString('hex');
}

function generateMessageId() {
  return crypto.randomBytes(16).toString('hex');
}

// Cleanup inactive peers
function cleanupPeers() {
  const now = Date.now();
  const toRemove = [];
  
  peers.forEach((peer, peerId) => {
    if (now - peer.lastSeen > PEER_TIMEOUT && !peer.hasTimedOut) {
      toRemove.push(peerId);
    }
  });
  
  toRemove.forEach(peerId => {
    const peer = peers.get(peerId);
    if (peer && !peer.hasTimedOut) {
      peer.hasTimedOut = true; // Mark as timed out to prevent duplicate messages
      
      // Remove after a short delay
      setTimeout(() => {
        peers.delete(peerId);
      }, 100);
    }
  });
}

// Start peer cleanup interval
setInterval(cleanupPeers, 5000);

// IPC handlers
ipcMain.handle('join-room', async (event, roomName, userName) => {
  try {
    console.log(`Attempting to join room: ${roomName} as ${userName}`);
    
    // Clean up any existing connection first
    if (udpSocket) {
      try {
        udpSocket.close();
      } catch (err) {
        // Ignore close errors
      }
      udpSocket = null;
    }
    
    currentRoom = roomName;
    displayName = userName || 'Anonymous';
    myPeerId = generatePeerId(); // Generate a unique peer ID
    roomKey = deriveKey(roomName);
    
    const port = getPortForRoom(roomName);
    console.log(`Base port for room ${roomName}: ${port}`);
    
    // Try to find an available port
    let actualPort = null;
    let boundSocket = null;
    
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const bindPort = port + attempt;
        console.log(`Attempting to bind to port ${bindPort} (attempt ${attempt + 1})`);
        
        // Create a new socket for each attempt
        const testSocket = dgram.createSocket('udp4');
        
        // Use a timeout to avoid hanging
        const bindResult = await Promise.race([
          new Promise((resolve, reject) => {
            testSocket.bind(bindPort, (err) => {
              if (err) {
                testSocket.close();
                reject(err);
              } else {
                resolve({ socket: testSocket, port: bindPort });
              }
            });
          }),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Bind timeout')), 2000);
          })
        ]);
        
        // Success!
        boundSocket = bindResult.socket;
        actualPort = bindResult.port;
        console.log(`Successfully bound to port ${actualPort}`);
        break;
        
      } catch (err) {
        console.log(`Failed to bind to port ${port + attempt}: ${err.message}`);
        if (err.code === 'EADDRINUSE' && attempt < 4) {
          continue;
        } else if (attempt === 4) {
          throw new Error(`Could not bind to any port after 5 attempts. Last error: ${err.message}`);
        }
      }
    }
    
    if (!boundSocket || !actualPort) {
      throw new Error('Failed to bind to any port');
    }
    
    // Set up the bound socket as our main UDP socket
    udpSocket = boundSocket;
    udpSocket.on('message', handleUDPMessage);
    udpSocket.on('error', (err) => {
      console.error('UDP Error:', err);
      if (err.code !== 'EADDRINUSE' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('error', `Network error: ${err.message}`);
      }
    });
    
    // Enable broadcast
    udpSocket.setBroadcast(true);
    console.log(`Room joined successfully on port ${actualPort}`);
    
    // Send join message
    const joinMessage = {
      type: MESSAGE_TYPES.JOIN,
      messageId: generateMessageId(),
      peerId: myPeerId,
      displayName: displayName,
      timestamp: Date.now()
    };
    
    broadcastMessage(joinMessage);
    
    // Request chat history from any existing peers
    // Use a small delay to let the join message be processed first
    setTimeout(() => {
      requestChatHistory();
    }, 500);
    
    return { success: true, port: actualPort };
  } catch (error) {
    console.error('Error joining room:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('send-message', async (event, messageData) => {
  if (!currentRoom || !displayName || !myPeerId) {
    return { success: false, error: 'Not in a room' };
  }

  const messageId = generateMessageId();

  // New format: { structure: [...], files: [...] }
  const { structure, files } = messageData;

  const chatMessage = {
    type: MESSAGE_TYPES.MESSAGE,
    messageId,
    peerId: myPeerId,
    displayName: displayName,
    timestamp: Date.now(),
    content: { structure, files } // new content format
  };

  // Add to local messages first
  const localMessage = {
    id: messageId,
    sender: displayName,
    structure, // new property
    files,
    timestamp: chatMessage.timestamp
  };

  messages.push(localMessage);

  // Broadcast to peers
  broadcastMessage(chatMessage);

  return { success: true, message: localMessage };
});

ipcMain.handle('leave-room', async () => {
  if (currentRoom && udpSocket) {
    try {
      // Send leave message
      const leaveMessage = {
        type: MESSAGE_TYPES.LEAVE,
        messageId: generateMessageId(),
        peerId: myPeerId,
        displayName: displayName,
        timestamp: Date.now()
      };
      
      broadcastMessage(leaveMessage);
      
      // Small delay to ensure message is sent
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err) {
      console.error('Error sending leave message:', err);
    }
    
    // Cleanup
    try {
      udpSocket.close();
    } catch (err) {
      // Ignore close errors
    }
    udpSocket = null;
    currentRoom = null;
    displayName = null;
    myPeerId = null;
    roomKey = null;
    peers.clear();
    messages = [];
    processedMessages.clear(); // Clear processed message IDs
    historyReceived = false; // Reset history received flag
  }
  
  return { success: true };
});

ipcMain.handle('get-peers', async () => {
  return Array.from(peers.entries()).map(([peerId, peer]) => ({
    peerId,
    displayName: peer.displayName,
    lastSeen: peer.lastSeen
  }));
});

// App event handlers
app.whenReady().then(createWindow);

ipcMain.on('send-file-chunk', (event, chunkData) => {
  const chunkMessage = {
    type: MESSAGE_TYPES.FILE_CHUNK,
    messageId: generateMessageId(),
    peerId: myPeerId,
    displayName: displayName,
    timestamp: Date.now(),
    content: chunkData
  };
  broadcastMessage(chunkMessage);
});

ipcMain.handle('save-file-dialog', async (event, { fileName, fileData }) => {
  if (!mainWindow) return { success: false, error: 'Main window not available' };

  try {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: fileName
    });

    if (filePath) {
      const buffer = Buffer.from(fileData, 'base64');
      fs.writeFileSync(filePath, buffer);
      return { success: true };
    } else {
      // User cancelled the save dialog
      return { success: false, error: 'Save cancelled' };
    }
  } catch (error) {
    console.error('Failed to save file:', error);
    // Optionally, send an error message back to the renderer
    mainWindow.webContents.send('error', `Failed to save file: ${error.message}`);
    throw error; // Throw error to be caught by the renderer's invoke().catch()
  }
});

app.on('window-all-closed', () => {
  if (udpSocket) {
    try {
      udpSocket.close();
    } catch (err) {
      // Ignore close errors
    }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (udpSocket) {
    try {
      udpSocket.close();
    } catch (err) {
      // Ignore close errors
    }
  }
});
