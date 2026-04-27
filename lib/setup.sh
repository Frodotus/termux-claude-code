#!/data/data/com.termux/files/usr/bin/bash
# Installs and patches the Claude Code musl binary.
# Run once after installing the package, or again after a Claude Code update.
set -e

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
LIB_DIR="$PREFIX/lib/claude-code"
MUSL_LINKER="$LIB_DIR/ld-musl-aarch64.so.1"
PATCHED_BIN="$LIB_DIR/claude-musl"

echo "Installing Claude Code npm packages..."
npm install -g @anthropic-ai/claude-code
npm install -g --force @anthropic-ai/claude-code-linux-arm64-musl

echo "Getting musl linker from Ubuntu rootfs..."
if ! proot-distro list | grep -q "^ubuntu"; then
    proot-distro install ubuntu
fi
ROOTFS="$PREFIX/var/lib/proot-distro/installed-rootfs/ubuntu"
if [ ! -f "$ROOTFS/usr/lib/ld-musl-aarch64.so.1" ]; then
    proot-distro login ubuntu -- apt-get install -y musl
fi

mkdir -p "$LIB_DIR"
cp "$ROOTFS/usr/lib/ld-musl-aarch64.so.1" "$MUSL_LINKER"

echo "Patching binary..."
NATIVE_BIN="$(npm root -g)/@anthropic-ai/claude-code-linux-arm64-musl/claude"
cp "$NATIVE_BIN" "$PATCHED_BIN"
chmod +x "$PATCHED_BIN"
patchelf --set-interpreter "$MUSL_LINKER" "$PATCHED_BIN"

echo "Done. Run 'claude --version' to verify."
