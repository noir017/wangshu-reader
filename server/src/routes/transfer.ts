// GET /transfer —— 网页传书（原 app 的 WiFi 传书）：给电脑浏览器用的自包含页面，拖放多个文件上传到书库的 Upload/ 目录。
import type { Context } from 'hono';
import type { RouteModule } from '../index';

export interface TransferPageConfig {
  /** 上传目标（相对书库的路径，多根时以根名开头） */
  uploadPath: string;
  enabled: boolean;
  readonly: boolean;
  tokenRequired: boolean;
  version: string;
}

export function renderTransferPage(cfg: TransferPageConfig): string {
  // JSON 放进 <script type="application/json">：把 < 转义掉，避免 </script> 截断
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>望舒 · 网页传书</title>
<style>
:root{--bg:#f4f1ea;--card:#fff;--fg:#2b2b2b;--sub:#777;--line:#e2ddd0;--accent:#2f7d6d;--accent-fg:#fff;--bad:#c0392b}
@media (prefers-color-scheme:dark){:root{--bg:#1d1f21;--card:#292c2f;--fg:#e8e6e1;--sub:#9a9a9a;--line:#3a3e42;--accent:#4aa593;--accent-fg:#102a24;--bad:#e06c5c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:8px 0 4px}
.sub{color:var(--sub);margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
#drop{border:2px dashed var(--line);border-radius:12px;padding:40px 16px;text-align:center;cursor:pointer;transition:.15s}
#drop.over{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent)}
#drop strong{display:block;font-size:17px;margin-bottom:4px}
button,.btn{font:inherit;border:1px solid var(--line);background:transparent;color:var(--fg);border-radius:8px;padding:4px 12px;cursor:pointer}
button.primary{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
button:disabled{opacity:.5;cursor:default}
ul{list-style:none;margin:0;padding:0}
li{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line)}
li:first-child{border-top:0}
.name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta{color:var(--sub);font-size:13px;white-space:nowrap}
.bar{height:6px;border-radius:3px;background:var(--line);overflow:hidden;width:120px}
.bar i{display:block;height:100%;width:0;background:var(--accent);transition:width .1s}
.err{color:var(--bad);font-size:13px}
a{color:var(--accent)}
h2{font-size:15px;margin:0 0 8px;display:flex;justify-content:space-between;align-items:center}
.hide{display:none!important}
#login input{font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);width:240px}
</style>
</head>
<body>
<main>
  <h1 data-i="title"></h1>
  <p class="sub" id="sub"></p>

  <div class="card hide" id="login">
    <p data-i="needToken"></p>
    <input id="tok" type="password" autocomplete="off"> <button class="primary" id="tokBtn" data-i="ok"></button>
  </div>

  <div class="card hide" id="disabled"><p id="disabledMsg"></p></div>

  <div id="app" class="hide">
    <div class="card">
      <div id="drop"><strong data-i="drop"></strong><span class="sub" data-i="dropSub"></span></div>
      <input id="pick" type="file" multiple hidden>
      <ul id="queue"></ul>
    </div>
    <div class="card">
      <h2><span data-i="files"></span><button id="reload" data-i="refresh"></button></h2>
      <ul id="files"></ul>
      <p class="sub hide" id="empty" data-i="empty"></p>
    </div>
  </div>
</main>
<script type="application/json" id="cfg">${json}</script>
<script>
(function(){
var cfg=JSON.parse(document.getElementById('cfg').textContent);
// 界面语言跟 app 设置走（同源时读得到）：默认简体中文，只有在 app 里手动选了英文才用英文
var zh=true;try{var st=JSON.parse(localStorage.getItem('mr.settings.v1')||'{}');zh=!(st&&st.app&&st.app.language==='en')}catch(e){}
var T={
 title:zh?'望舒 · 网页传书':'Wangshu Reader · Transfer',
 drop:zh?'把电子书拖到这里':'Drop books here',
 dropSub:zh?'或点击选择文件（可多选）':'or click to choose files',
 files:zh?'已上传的文件':'Uploaded files',
 refresh:zh?'刷新':'Refresh',
 empty:zh?'还没有文件':'No files yet',
 del:zh?'删除':'Delete',
 delAsk:zh?'确定删除 ':'Delete ',
 needToken:zh?'服务端需要访问令牌（MR_TOKEN）：':'The server requires an access token (MR_TOKEN):',
 ok:zh?'确定':'OK',
 badToken:zh?'令牌不对':'Wrong token',
 noLib:zh?'服务端没有配置书库目录（MR_LIBRARY_DIR），不能传书。':'The server has no library directory configured (MR_LIBRARY_DIR).',
 ro:zh?'书库是只读的，不能传书。':'The library is read-only.',
 sub:zh?'上传到服务端书库的 ':'Files are uploaded to ',
 done:zh?'完成':'Done',
 fail:zh?'失败：':'Failed: '
};
function $(id){return document.getElementById(id)}
document.querySelectorAll('[data-i]').forEach(function(e){e.textContent=T[e.getAttribute('data-i')]});
document.title=T.title;
$('sub').textContent=T.sub+cfg.uploadPath+'/';
if(!cfg.enabled||cfg.readonly){$('disabled').classList.remove('hide');$('disabledMsg').textContent=cfg.enabled?T.ro:T.noLib;return}

var token=new URLSearchParams(location.search).get('token')||localStorage.getItem('mr-token')||'';
function hdr(){return token?{Authorization:'Bearer '+token}:{}}
function size(n){return n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':n<1073741824?(n/1048576).toFixed(1)+' MB':(n/1073741824).toFixed(2)+' GB'}
function enc(p){return encodeURIComponent(p)}
function tq(){return token?'&token='+enc(token):''}

function list(){
  return fetch('/api/library/list?path='+enc(cfg.uploadPath),{headers:hdr()}).then(function(r){
    if(r.status===401){$('login').classList.remove('hide');$('app').classList.add('hide');if(tried)alert(T.badToken);return null}
    $('login').classList.add('hide');$('app').classList.remove('hide');
    if(r.status===404)return {entries:[]};
    return r.json()
  }).then(function(j){
    if(!j)return;
    var ul=$('files');ul.textContent='';
    var es=(j.entries||[]).filter(function(e){return !e.dir});
    es.sort(function(a,b){return b.mtime-a.mtime});
    $('empty').classList.toggle('hide',es.length>0);
    es.forEach(function(e){
      var li=document.createElement('li');
      var a=document.createElement('a');a.className='name';a.textContent=e.name;a.href='/api/library/file?path='+enc(e.path)+'&download=1'+tq();
      var m=document.createElement('span');m.className='meta';m.textContent=size(e.size)+' · '+new Date(e.mtime).toLocaleString(zh?'zh-CN':'en');
      var b=document.createElement('button');b.textContent=T.del;
      b.onclick=function(){if(!confirm(T.delAsk+e.name+'?'))return;
        fetch('/api/library/delete',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},hdr()),body:JSON.stringify({paths:[e.path]})}).then(list)};
      li.append(a,m,b);ul.append(li)
    })
  }).catch(function(){})
}

function upload(file){
  var li=document.createElement('li');
  var n=document.createElement('span');n.className='name';n.textContent=file.name;
  var bar=document.createElement('div');bar.className='bar';var fill=document.createElement('i');bar.append(fill);
  var st=document.createElement('span');st.className='meta';st.textContent='0%';
  li.append(n,bar,st);$('queue').prepend(li);
  var fd=new FormData();fd.append('file',file,file.name);
  var x=new XMLHttpRequest();
  x.open('POST','/api/library/upload?path='+enc(cfg.uploadPath));
  var h=hdr();Object.keys(h).forEach(function(k){x.setRequestHeader(k,h[k])});
  x.upload.onprogress=function(e){if(e.lengthComputable){var p=Math.round(e.loaded/e.total*100);fill.style.width=p+'%';st.textContent=p+'%'}};
  x.onload=function(){
    if(x.status>=200&&x.status<300){fill.style.width='100%';st.textContent=T.done;list()}
    else{var msg='';try{msg=JSON.parse(x.responseText).error}catch(e){}bar.remove();st.className='err';st.textContent=T.fail+(msg||x.status)}
  };
  x.onerror=function(){bar.remove();st.className='err';st.textContent=T.fail+'network'};
  x.send(fd)
}
function addFiles(fs){Array.prototype.forEach.call(fs,upload)}
var drop=$('drop'),pick=$('pick');
drop.onclick=function(){pick.click()};
pick.onchange=function(){addFiles(pick.files);pick.value=''};
['dragenter','dragover'].forEach(function(t){drop.addEventListener(t,function(e){e.preventDefault();drop.classList.add('over')})});
['dragleave','drop'].forEach(function(t){drop.addEventListener(t,function(e){e.preventDefault();drop.classList.remove('over')})});
drop.addEventListener('drop',function(e){if(e.dataTransfer&&e.dataTransfer.files)addFiles(e.dataTransfer.files)});
window.addEventListener('dragover',function(e){e.preventDefault()});
window.addEventListener('drop',function(e){e.preventDefault()});
$('reload').onclick=list;
var tried=false;
$('tokBtn').onclick=function(){token=$('tok').value.trim();localStorage.setItem('mr-token',token);tried=true;list()};
list();
})();
</script>
</body>
</html>`;
}

export const route: RouteModule = {
  register(app, ctx) {
    const { config } = ctx;
    const page = (c: Context) => {
      const first = config.libraryRoots[0];
      const uploadPath = first ? (config.libraryRoots.length > 1 ? `${first.name}/Upload` : 'Upload') : 'Upload';
      const html = renderTransferPage({
        uploadPath,
        enabled: config.libraryRoots.length > 0,
        readonly: config.libraryReadonly,
        tokenRequired: !!config.token,
        version: config.version,
      });
      return c.html(html, 200, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    };
    app.get('/transfer', page);
    app.get('/transfer/', page);
  },
};
