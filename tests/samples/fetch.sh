#!/usr/bin/env bash
# 下载测试用的真实样本到 samples/（不进 git）；程序生成的样书见 gen.py。来源都是公版书或开源项目的测试文件。
# 用法：tests/samples/fetch.sh [样本根目录，默认 <项目根>/samples]
# 幂等：已有的文件跳过。有任何一个下载失败就以非 0 退出，免得 CI 把残缺的样本存进缓存。
set -u
root=${1:-"$(cd "$(dirname "$0")/../.." && pwd)/samples"}
mkdir -p "$root" && cd "$root" || exit 1
failed=0
fetch() { # fetch <输出文件> <url>
  local out=$1 url=$2
  mkdir -p "$(dirname "$out")"
  if [ -s "$out" ]; then echo "have  $out"; return; fi
  if curl -fsSL --retry 3 -m 180 -o "$out.part" "$url"; then mv "$out.part" "$out"; echo "ok    $out ($(stat -c %s "$out") bytes)"
  else rm -f "$out.part"; echo "FAIL  $out <- $url"; failed=1; fi
}

# Project Gutenberg：《爱丽丝梦游仙境》五种格式、《傲慢与偏见》（大文件）、《紅樓夢》（繁体）
G=https://www.gutenberg.org/cache/epub
fetch books/pg11-alice.epub        $G/11/pg11-images-3.epub
fetch books/pg11-alice.kf8.mobi    $G/11/pg11-images-kf8.mobi
fetch books/pg11-alice.mobi        $G/11/pg11-images.mobi
fetch books/pg11-alice.txt         $G/11/pg11.txt
fetch books/pg11-alice.html        $G/11/pg11-images.html
fetch books/pg1342-pride.epub      $G/1342/pg1342-images-3.epub
fetch books/pg1342-pride.kf8.mobi  $G/1342/pg1342-images-kf8.mobi
fetch books/pg1342-pride.txt       $G/1342/pg1342.txt
fetch books/pg24264-hongloumeng.txt  $G/24264/pg24264.txt
fetch books/pg24264-hongloumeng.epub $G/24264/pg24264-images-3.epub
# 青空文库 夏目漱石《こころ》（Shift_JIS + ruby，zip）
fetch books/aozora-kokoro.zip https://www.aozora.gr.jp/cards/000148/files/773_ruby_5968.zip
# pdf.js 测试库：tracemonkey 论文（14 页）；issue6010_1 是 AES-256 加密 PDF，密码 abc
P=https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs
fetch books/tracemonkey.pdf   $P/tracemonkey.pdf
fetch books/encrypted-abc.pdf $P/issue6010_1.pdf
# CHM：PuTTY 用户手册
fetch chm/putty.chm https://the.earth.li/~sgtatham/putty/0.85/putty.chm
# RAR：node-unrar.js 的测试包（RAR 压缩器不是自由软件，没法现场生成）
U=https://raw.githubusercontent.com/YuJianrong/node-unrar.js/8c615868c9e2ec5ef2e661c5bcaee20ffad3862c/testFiles
fetch rar/FolderTest.rar    $U/FolderTest.rar
fetch rar/FileEncByName.rar $U/FileEncByName.rar

exit $failed
