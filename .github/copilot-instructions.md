<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

# Local Network Chat Application

This is an Electron-based desktop chat application for secure peer-to-peer communication on local networks.

## Key Technologies
- **Electron**: Desktop application framework
- **Node.js dgram**: UDP networking for peer-to-peer communication
- **Node.js crypto**: AES-256-GCM encryption with PBKDF2 key derivation
- **Electron Builder**: For packaging into standalone executables

## Architecture
- **Main Process** (`src/main.js`): Handles UDP networking, encryption, peer management, and message routing
- **Renderer Process** (`src/renderer.js`): Manages the user interface and communicates with main process via IPC
- **HTML/CSS** (`src/index.html`): Responsive user interface with setup and chat screens

## Core Features
- Room-based communication with derived encryption keys
- Reliable message delivery with ACK mechanism
- Automatic peer discovery via UDP broadcasting
- Chat history synchronization for new joiners
- Ephemeral storage (RAM only, no persistent data)
- Disconnection detection and cleanup
- Cross-platform desktop application

## Security
- AES-256-GCM encryption for all messages
- PBKDF2 key derivation from room names
- Fixed salt for consistency across peers
- No data persistence for privacy

## Development Notes
- Use `npm run dev` for development with DevTools
- Use `npm run build` to create distributable packages
- All networking happens on UDP ports derived from room names
- Peer timeout is set to 30 seconds of inactivity
- Messages are stored in memory only and cleared when all peers disconnect

When working on this codebase, focus on maintaining the security, reliability, and user experience of the peer-to-peer communication system.
