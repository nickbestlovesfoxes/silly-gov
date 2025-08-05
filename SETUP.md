# Node.js Installation Required

To run this Local Network Chat application, you need to install Node.js first.

## Quick Installation

### Option 1: Download from Official Website (Recommended)
1. Go to [https://nodejs.org/](https://nodejs.org/)
2. Download the **LTS version** (Long Term Support)
3. Run the installer with default settings
4. Restart your terminal/PowerShell
5. Come back to this project and run: `npm install`

### Option 2: Using Winget (Windows Package Manager)
If you have Windows 10/11 with winget:
```powershell
winget install OpenJS.NodeJS
```

### Option 3: Using Chocolatey
If you have Chocolatey installed:
```powershell
choco install nodejs
```

## After Installation

Once Node.js is installed, run these commands in this project folder:

```bash
# Install dependencies
npm install

# Run in development mode (with debugging)
npm run dev

# Or run normally
npm start

# To build a standalone .exe file
npm run build
```

## Verification

To verify Node.js is installed correctly:
```bash
node --version
npm --version
```

Both commands should return version numbers.

## Project Dependencies

After installing Node.js, this project will install:
- **Electron**: For creating the desktop application
- **Electron Builder**: For packaging into standalone executables

Total download size: ~200MB (includes Electron binaries)

## Troubleshooting

If you get permission errors:
- Run PowerShell as Administrator
- Or use `npm install --no-optional` to skip optional packages

If you get execution policy errors:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## Next Steps

1. Install Node.js using one of the methods above
2. Restart your terminal
3. Navigate back to this project folder
4. Run `npm install` to install dependencies
5. Run `npm run dev` to start the application in development mode

The application will open in a desktop window where you can create or join chat rooms!
