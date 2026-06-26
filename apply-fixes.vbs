Const ForReading = 1, ForWriting = 2
Set fso = CreateObject("Scripting.FileSystemObject")
Set f = fso.OpenTextFile("public/index.html", ForReading, False, True)
content = f.ReadAll
f.Close

' Fix 4: F&G 10-min cache
content = Replace(content, "function fetchFearGreed(){var fv=document.getElementById('fngValue');if(!fv)return;", "function fetchFearGreed(){var fv=document.getElementById('fngValue');if(!fv)return;var c2=JSON.parse(localStorage.getItem('fng_cache')||'{}');if(c2.v!=null&&Date.now()-c2.ts<600000){fv.textContent=c2.v+' ('+(c2.cls||'')+')';fv.style.color=c2.v<=20?'var(--red)':c2.v<=40?'var(--orange)':c2.v>=75?'var(--accent)':'var(--fg)';return}")

' Fix 5: DCA confirm
content = Replace(content, "document.getElementById('btnExecDCA').addEventListener('click',function(){", "document.getElementById('btnExecDCA').addEventListener('click',function(){if(!confirm('确认执行定投？\n\n总额：'+fmt$(state.monthlyDCA||2000)+'\nVGT 50% · SMH 30% · BTC 20%\n日期：'+(document.getElementById('conDcaDate').value||new Date().toISOString().slice(0,10))+'\n\n此操作将录入3条买入记录'))return;")

' Fix 6: Rebalance show calc when locked
content = Replace(content, "content.style.opacity='.35';content.style.pointerEvents='none'", "content.style.opacity='.7';content.style.pointerEvents='auto'")
content = Replace(content, "if(isDec31){badge.textContent='🔓 今日解锁';badge.style.background='var(--accent-l)';badge.style.color='var(--accent)';msg.style.display='none';content.style.opacity='1';content.style.pointerEvents='auto'}", "if(isDec31){badge.textContent='🔓 今日解锁';badge.style.background='var(--accent-l)';badge.style.color='var(--accent)';msg.style.display='none';content.style.opacity='1';content.style.pointerEvents='auto'}else{content.style.opacity='.85';content.style.pointerEvents='auto'}")

Set f = fso.OpenTextFile("public/index.html", ForWriting, True, True)
f.Write content
f.Close

WScript.Echo "All fixes applied"
