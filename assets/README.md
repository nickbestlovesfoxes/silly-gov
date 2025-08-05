# Icon Placeholder

This folder should contain the application icon files:

- `icon.png` - Main application icon (256x256 or larger)
- `icon.ico` - Windows icon file (for .exe packaging)
- `icon.icns` - macOS icon file (for .app packaging)

For now, the application will use the default Electron icon. You can create custom icons using any image editor and place them in this directory.

## Recommended Icon Specifications

### PNG Icon (icon.png)
- Size: 512x512 pixels (will be resized automatically)
- Format: PNG with transparency
- Content: Simple, recognizable chat or network symbol

### Windows ICO (icon.ico)
- Multiple sizes: 16x16, 32x32, 48x48, 64x64, 128x128, 256x256
- Format: ICO file
- Can be generated from PNG using online converters

### macOS ICNS (icon.icns)
- Multiple sizes from 16x16 to 1024x1024
- Format: ICNS file
- Can be generated using `iconutil` on macOS

## Creating Icons

1. Design a 512x512 PNG icon
2. Use online converters or tools like:
   - [ICO Convert](https://icoconvert.com/) for Windows ICO
   - [CloudConvert](https://cloudconvert.com/) for ICNS
3. Place files in this directory
4. Update package.json build configuration if needed
