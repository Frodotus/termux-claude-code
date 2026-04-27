#!/data/data/com.termux/files/usr/bin/bash
set -e

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
LIB_DIR="$PREFIX/lib/claude-code"
MUSL_LINKER="$LIB_DIR/ld-musl-aarch64.so.1"
PATCHED_BIN="$LIB_DIR/claude-musl"

echo "==> Installing dependencies..."
pkg install -y nodejs npm patchelf proot proot-distro

echo "==> Installing Claude Code npm packages..."
npm install -g @anthropic-ai/claude-code
npm install -g --force @anthropic-ai/claude-code-linux-arm64-musl

echo "==> Getting musl linker from Ubuntu rootfs..."
ROOTFS="$PREFIX/var/lib/proot-distro/installed-rootfs/ubuntu"
proot-distro install ubuntu 2>/dev/null || true
if [ ! -f "$ROOTFS/usr/lib/ld-musl-aarch64.so.1" ]; then
    proot-distro login ubuntu -- bash -c \
        "apt-get install -y software-properties-common && add-apt-repository -y universe && apt-get update -qq && apt-get install -y musl"
fi

echo "==> Patching binary..."
mkdir -p "$LIB_DIR"
cp "$ROOTFS/usr/lib/ld-musl-aarch64.so.1" "$MUSL_LINKER"
NATIVE_BIN="$(npm root -g)/@anthropic-ai/claude-code-linux-arm64-musl/claude"
cp "$NATIVE_BIN" "$PATCHED_BIN"
chmod +x "$PATCHED_BIN"
patchelf --set-interpreter "$MUSL_LINKER" "$PATCHED_BIN"

echo "==> Installing wrapper..."
cat > "$PREFIX/bin/claude" << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
exec proot \
  -b /data/data/com.termux/files/usr/etc/resolv.conf:/etc/resolv.conf \
  -b /data/data/com.termux/files/usr/etc/tls/cert.pem:/etc/ssl/certs/ca-certificates.crt \
  env -u LD_PRELOAD \
  /data/data/com.termux/files/usr/lib/claude-code/claude-musl "$@"
EOF
chmod +x "$PREFIX/bin/claude"

echo ""
echo "Done! Run 'claude --version' to verify."
