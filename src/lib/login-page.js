// 登录页：由 Worker 内联返回。
//
// 为什么完全内联：静态资源在没登录时也该尽量少暴露，而且内联页不依赖 /assets，
// 也就不会被 Service Worker 当成"App 壳子"缓存下来（那会导致登出后永远看到旧界面）。

export function loginPageHTML(error) {
  const message = error ? String(error).slice(0, 120) : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f5f6f3">
<meta name="robots" content="noindex">
<title>登录 · My Portfolio</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f3f5f2;color:#17211b;font:15px -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif;-webkit-text-size-adjust:100%}
.box{width:100%;max-width:340px;padding:26px 22px 22px;border:1px solid #dfe4df;border-radius:22px;background:#fff;box-shadow:0 1px 2px rgba(17,32,23,.03),0 10px 28px rgba(17,32,23,.06);text-align:center}
.logo{width:74px;height:74px;border-radius:20px;display:block;margin:0 auto 14px}
h1{margin:0 0 4px;font-size:1.05rem;font-weight:650;letter-spacing:-.01em}
p{margin:0 0 18px;font-size:12.5px;line-height:1.6;color:#6e7771}
label{display:block;text-align:left;font-size:12.5px;font-weight:600;color:#6e7771;margin-bottom:6px}
input{width:100%;min-height:46px;padding:0 12px;border:1px solid #dfe4df;border-radius:12px;background:#f7f8f6;color:inherit;font:inherit;font-size:.86rem}
input:focus{outline:2px solid #147a4b33;outline-offset:1px;border-color:#147a4b}
button{width:100%;min-height:46px;margin-top:14px;border:0;border-radius:12px;background:#147a4b;color:#fff;font:inherit;font-weight:650;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
.err{margin-top:12px;font-size:12.5px;color:#c94d45;min-height:16px}
.hint{margin-top:14px;font-size:11.5px;color:#9aa39d;line-height:1.5}
</style>
</head>
<body>
<form class="box" id="loginForm">
<img class="logo" src="/icon-192.png" alt="">
<h1>My Portfolio</h1>
<p>请登录</p>
<label for="un">用户名</label>
<input id="un" name="username" type="text" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="英文用户名" required>
<label for="pw" style="margin-top:12px">密码</label>
<input id="pw" name="password" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="密码" required>
<button type="submit" id="go">登录</button>
<div class="err" id="err">${message}</div>
<div class="hint">首次登录请用你的用户名 + 原来的那串令牌作为密码（服务端会把它登记成你的账号）。登录状态在这台设备上保留 90 天。</div>
</form>
<script>
(function(){
  var form=document.getElementById('loginForm'),user=document.getElementById('un'),input=document.getElementById('pw'),btn=document.getElementById('go'),err=document.getElementById('err');
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var name=user.value.trim().toLowerCase();
    var value=input.value.trim();
    if(!name){err.textContent='请输入用户名';user.focus();return}
    if(!value){err.textContent='请输入密码';input.focus();return}
    btn.disabled=true;err.textContent='';
    fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:name,password:value})})
      .then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {ok:r.ok,status:r.status,body:j}})})
      .then(function(res){
        if(res.ok&&res.body&&res.body.ok){location.replace('/');return}
        btn.disabled=false;
        err.textContent=res.status===429?'尝试次数过多，请过一会儿再试':(res.body&&res.body.error==='not configured'?'服务器没有配置密码':'用户名或密码不正确');
        input.select();
      })
      .catch(function(){btn.disabled=false;err.textContent='网络错误，请重试'});
  });
})();
</script>
</body>
</html>`;
}

export function loginPageResponse(error) {
  return new Response(loginPageHTML(error), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex',
    },
  });
}

/** 找不到页面时给人看的小页面（绝不吐裸 JSON —— 那玩意儿在手机上没法自查）。 */
export function notFoundPage() {
  return new Response(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f5f6f3">
<meta name="robots" content="noindex">
<title>页面不存在 · My Portfolio</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f3f5f2;color:#17211b;font:15px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;text-align:center}
main{max-width:300px}
strong{font-size:1rem;font-weight:650}
p{margin:10px 0 0;color:#6e7771;font-size:13.5px;line-height:1.6}
a{display:inline-block;margin-top:18px;min-height:44px;line-height:44px;padding:0 20px;border-radius:12px;background:#147a4b;color:#fff;text-decoration:none;font-weight:600;font-size:.85rem}
</style>
</head>
<body>
<main>
<strong>页面不存在</strong>
<p>这个地址没有对应的页面。如果你刚才是从旧书签打开的，回到首页即可。</p>
<a href="/">回到首页</a>
</main>
</body>
</html>`, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex',
    },
  });
}
