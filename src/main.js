const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const dgram = require('dgram');
const crypto = require('crypto');

// Application state
let mainWindow;
let udpSocket;
let currentRoom = null;
let displayName = null;
let peers = new Map(); // peerId -> { address, port, lastSeen }
let messages = []; // In-memory message storage
let roomKey = null;

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
  ACK: 'ack',
  HISTORY: 'history',
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
  const cipher = crypto.createCipher('aes-256-gcm', key);
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
    const decipher = crypto.createDecipher('aes-256-gcm', key);
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
    udpSocket.close();
  }

  udpSocket = dgram.createSocket('udp4');
  
  udpSocket.on('message', handleUDPMessage);
  udpSocket.on('error', (err) => {
    console.error('UDP Error:', err);
    mainWindow.webContents.send('error', `Network error: ${err.message}`);
  });
}

function handleUDPMessage(buffer, rinfo) {
  try {
    const message = JSON.parse(buffer.toString());
    
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

    // Update peer info
    if (message.peerId && message.peerId !== getPeerId()) {
      peers.set(message.peerId, {
        address: rinfo.address,
        port: rinfo.port,
        lastSeen: Date.now(),
        displayName: message.displayName
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
    case MESSAGE_TYPES.ACK:
      handleAckMessage(message);
      break;
    case MESSAGE_TYPES.HISTORY:
      handleHistoryMessage(message);
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
  
  // Send current chat history to the new peer
  if (messages.length > 0) {
    sendHistoryToPeer(message.peerId, rinfo);
  }
  
  // Notify UI
  mainWindow.webContents.send('peer-joined', {
    peerId: message.peerId,
    displayName: message.displayName,
    peerCount: peers.size
  });
  
  // Send ACK
  sendMessage({
    type: MESSAGE_TYPES.ACK,
    messageId: message.messageId,
    peerId: getPeerId(),
    displayName: displayName
  }, rinfo.address, rinfo.port);
}

function handleChatMessage(message, rinfo) {
  const chatMessage = {
    id: message.messageId,
    sender: message.displayName,
    text: message.content.text,
    timestamp: message.timestamp
  };
  
  messages.push(chatMessage);
  
  // Send to UI
  mainWindow.webContents.send('new-message', chatMessage);
  
  // Send ACK
  sendMessage({
    type: MESSAGE_TYPES.ACK,
    messageId: message.messageId,
    peerId: getPeerId(),
    displayName: displayName
  }, rinfo.address, rinfo.port);
}

function handleAckMessage(message) {
  // Handle ACK for message delivery confirmation
  mainWindow.webContents.send('message-ack', message.messageId);
}

function handleHistoryMessage(message) {
  if (message.content.history) {
    messages = [...message.content.history];
    mainWindow.webContents.send('history-received', messages);
  }
}

function handleStatusRequest(message, rinfo) {
  sendMessage({
    type: MESSAGE_TYPES.ACK,
    messageId: message.messageId,
    peerId: getPeerId(),
    displayName: displayName
  }, rinfo.address, rinfo.port);
}

function handleLeaveMessage(message) {
  if (peers.has(message.peerId)) {
    const peer = peers.get(message.peerId);
    peers.delete(message.peerId);
    
    mainWindow.webContents.send('peer-left', {
      peerId: message.peerId,
      displayName: peer.displayName,
      peerCount: peers.size
    });
  }
}

function sendHistoryToPeer(peerId, rinfo) {
  const historyMessage = {
    type: MESSAGE_TYPES.HISTORY,
    messageId: generateMessageId(),
    peerId: getPeerId(),
    displayName: displayName,
    timestamp: Date.now(),
    content: { history: messages }
  };
  
  sendMessage(historyMessage, rinfo.address, rinfo.port);
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
    if (error) {
      console.error('Error sending message:', error);
    }
  });
}

function broadcastMessage(message) {
  if (!currentRoom || !udpSocket) return;
  
  const port = getPortForRoom(currentRoom);
  const broadcasts = [
    '255.255.255.255',
    '192.168.1.255',
    '192.168.0.255',
    '10.0.0.255'
  ];
  
  broadcasts.forEach(address => {
    sendMessage(message, address, port);
  });
}

function getPeerId() {
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
    if (now - peer.lastSeen > PEER_TIMEOUT) {
      toRemove.push(peerId);
    }
  });
  
  toRemove.forEach(peerId => {
    const peer = peers.get(peerId);
    peers.delete(peerId);
    
    mainWindow.webContents.send('peer-timeout', {
      peerId,
      displayName: peer.displayName,
      peerCount: peers.size
    });
  });
}

// Start peer cleanup interval
setInterval(cleanupPeers, 5000);

// IPC handlers
ipcMain.handle('join-room', async (event, roomName, userName) => {
  try {
    currentRoom = roomName;
    displayName = userName;
    roomKey = deriveKey(roomName);
    
    createUDPSocket();
    
    const port = getPortForRoom(roomName);
    udpSocket.bind(port);
    
    // Send join message
    const joinMessage = {
      type: MESSAGE_TYPES.JOIN,
      messageId: generateMessageId(),
      peerId: getPeerId(),
      displayName: displayName,
      timestamp: Date.now()
    };
    
    broadcastMessage(joinMessage);
    
    return { success: true, port };
  } catch (error) {
    console.error('Error joining room:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('send-message', async (event, text) => {
  if (!currentRoom || !displayName) {
    return { success: false, error: 'Not in a room' };
  }
  
  const messageId = generateMessageId();
  const chatMessage = {
    type: MESSAGE_TYPES.MESSAGE,
    messageId,
    peerId: getPeerId(),
    displayName: displayName,
    timestamp: Date.now(),
    content: { text }
  };
  
  // Add to local messages
  const localMessage = {
    id: messageId,
    sender: displayName,
    text,
    timestamp: Date.now()
  };
  
  messages.push(localMessage);
  
  // Broadcast to peers
  broadcastMessage(chatMessage);
  
  return { success: true, message: localMessage };
});

ipcMain.handle('leave-room', async () => {
  if (currentRoom && udpSocket) {
    // Send leave message
    const leaveMessage = {
      type: MESSAGE_TYPES.LEAVE,
      messageId: generateMessageId(),
      peerId: getPeerId(),
      displayName: displayName,
      timestamp: Date.now()
    };
    
    broadcastMessage(leaveMessage);
    
    // Cleanup
    udpSocket.close();
    udpSocket = null;
    currentRoom = null;
    displayName = null;
    roomKey = null;
    peers.clear();
    messages = [];
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

app.on('window-all-closed', () => {
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
    udpSocket.close();
  }
});
