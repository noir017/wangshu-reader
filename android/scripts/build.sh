#!/usr/bin/env bash
# 打 Android 包：前端 → assets/www，服务端 → assets/server.zip，Termux node → jniLibs（没有才取），再 gradle assemble。
# 用法（任意目录）：android/scripts/build.sh [debug|release]，产物在 android/app/build/outputs/apk/
set -euo pipefail
cd "$(dirname "$0")/../.."
variant="${1:-debug}"
main=android/app/src/main
out=android/build

rm -rf "$out/www" "$out/server" "$out/server.zip" "$main/assets"
mkdir -p "$out/server/node_modules" "$main/assets"

# 前端：标准构建（多文件），页面由 WebViewAssetLoader 从 assets 读
npx vite build --outDir "$out/www" --emptyOutDir --logLevel warn
cp -r "$out/www" "$main/assets/www"

# 服务端：依赖全打进一个文件。node-unrar-js 要读包里自带的 wasm，整个包原样带上；
# @napi-rs/canvas 是原生模块，不带（封面缩略图退化为原图）；ws 的两个可选加速模块不带
npx esbuild server/src/index.ts --bundle --platform=node --format=esm --target=node22 --log-level=warning \
  --external:node-unrar-js --external:@napi-rs/canvas --external:bufferutil --external:utf-8-validate \
  --banner:js="import { createRequire as __wsCreateRequire } from 'node:module'; const require = __wsCreateRequire(import.meta.url);" \
  --outfile="$out/server/index.mjs"
cp -r node_modules/node-unrar-js "$out/server/node_modules/"
(cd "$out/server" && zip -qr ../server.zip .)
cp "$out/server.zip" "$main/assets/server.zip"

[[ -f "$main/jniLibs/arm64-v8a/libnode.so" ]] || android/scripts/fetch-node.sh

cd android
./gradlew --no-daemon -q --stacktrace "assemble${variant^}"
ls -l app/build/outputs/apk/"$variant"/*.apk
