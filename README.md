# Local Network Chat

A secure, standalone desktop chat application for peer-to-peer communication on local networks.

## Features

- 🏠 **Local Network Only**: Works entirely on your local network without internet
- 🔒 **End-to-End Encryption**: AES-256-GCM encryption with room-based keys
- 💬 **Room-Based Chat**: Join rooms by name, automatic peer discovery
- 🚀 **Standalone Executable**: Single .exe file, no installation required
- 📱 **Cross-Device**: Chat between multiple devices on the same network
- 🔄 **Reliable Delivery**: Message acknowledgment and retransmission
- 📜 **Chat History Sync**: New joiners receive full chat history
- 🔐 **Ephemeral Storage**: All data stored in RAM only, no persistence
- ⚡ **Real-time Communication**: UDP-based for low latency

## Quick Start

### Prerequisites
- Node.js 18+ installed on your development machine
- Windows, macOS, or Linux

### Development Setup

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd local-network-chat
   npm install
   ```

2. **Run in Development**
   ```bash
   npm run dev
   ```

3. **Build Executable**
   ```bash
   npm run build
   ```

### Usage

1. **Start the Application**
   - Run the executable or use `npm start`

2. **Join a Room**
   - Enter a room name (e.g., "team-meeting")
   - Enter your display name
   - Click "Join Room"

3. **Chat**
   - Type messages and press Enter or click Send
   - Other devices on the same network can join the same room
   - Chat history is automatically shared with new joiners

4. **Leave Room**
   - Click "Leave Room" to disconnect and return to setup

## Technical Details

### Architecture
- **Main Process**: UDP networking, encryption, peer management
- **Renderer Process**: User interface and user interactions
- **IPC Communication**: Secure communication between processes

### Security
- **AES-256-GCM Encryption**: All messages encrypted with room-derived keys
- **PBKDF2 Key Derivation**: 100,000 iterations with fixed salt
- **No Data Persistence**: All messages stored in RAM only
- **Network Isolation**: No internet communication required

### Networking
- **UDP Broadcasting**: Automatic peer discovery on local network
- **Port Assignment**: Deterministic port selection based on room name
- **Message Types**: JOIN, MESSAGE, ACK, HISTORY, LEAVE, STATUS_REQUEST
- **Peer Timeout**: 30-second inactivity timeout with cleanup

### Message Flow
1. **Discovery**: Broadcast JOIN messages to find peers
2. **Handshake**: Exchange peer information and capabilities
3. **History Sync**: Existing peers send chat history to new joiners
4. **Chat**: Encrypted messages with ACK confirmation
5. **Cleanup**: Automatic peer removal on timeout or explicit leave

## Building for Distribution

### Windows Executable
```bash
npm run build-win
```

Creates a standalone .exe file in the `dist` folder that can be run on any Windows machine without Node.js.

### Cross-Platform
```bash
npm run build
```

Creates packages for the current platform. Modify `package.json` build configuration for other platforms.

## Configuration

### Network Settings
- **Base Port**: 12000 (configurable in `src/main.js`)
- **Port Range**: Determined by room name hash
- **Broadcast Addresses**: 255.255.255.255, 192.168.x.255, 10.x.x.255
- **Discovery Interval**: 5 seconds
- **Peer Timeout**: 30 seconds

### Security Settings
- **Encryption**: AES-256-GCM
- **Key Derivation**: PBKDF2 with 100,000 iterations
- **Salt**: Fixed for cross-device compatibility
- **IV**: Random per message

## Troubleshooting

### Common Issues

1. **Can't Join Room**
   - Check firewall settings (allow UDP traffic)
   - Ensure devices are on the same network
   - Try a different room name

2. **No Peers Found**
   - Verify network connectivity between devices
   - Check if antivirus is blocking the application
   - Ensure UDP port range (12000-13000) is available

3. **Messages Not Delivered**
   - Check encryption key derivation (room name must match exactly)
   - Verify peer connectivity
   - Monitor console for error messages

### Logs and Debugging
- Run with `npm run dev` to see console output
- Check the DevTools console for detailed error messages
- Network activity is logged in the main process

## Development

### Project Structure
```
src/
├── main.js          # Main Electron process (networking, crypto)
├── renderer.js      # Renderer process (UI logic)
├── index.html       # Application interface
package.json         # Dependencies and build configuration
```

### Key Components
- **Crypto Utils**: Encryption/decryption with AES-256-GCM
- **Network Manager**: UDP socket management and peer discovery
- **Message Handler**: Message routing and acknowledgment
- **UI Controller**: Interface updates and user interactions

### Adding Features
1. Define new message types in main.js
2. Add IPC handlers for renderer communication
3. Update UI components as needed
4. Test across multiple devices

## License

MIT License - see LICENSE file for details.

## Security Notice

This application is designed for local network use only. While messages are encrypted, the application should not be used over untrusted networks. All data is ephemeral and stored in RAM only for privacy.
