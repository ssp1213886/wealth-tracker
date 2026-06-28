var fs=require("fs");
var c=fs.readFileSync("public/index.html","utf8");

// Delete updateConsoleDCA
var oldDca="function updateConsoleDCA(){\r\n  var dca=state.monthlyDCA||2000,a={VGT:state.vgt,SMH:state.smh,BTC:state.btc};\r\n  ETF_SYMS.forEach(function(s){var el=document.getElementById('conDca'+s);if(el)el.textContent=fmt$(dca*a[s])});\r\n  var ct=document.getElementById('conDcaTotal');if(ct)ct.textContent=fmt$(dca);\r\n  var cd=document.getElementById('conDcaDate');if(cd&&!cd.value)cd.value=new Date().toISOString().slice(0,10)}";
if(c.includes(oldDca)){
  c=c.replace(oldDca,"");
  console.log("1. updateConsoleDCA deleted");
} else { console.log("1. SKIP - not found"); }

// Delete btnExecDCA handler
var btnLine="  document.getElementById('btnExecDCA')?.addEventListener('click',function(){\r\n";
var ib=c.indexOf(btnLine);
if(ib>=0){
  var end2=c.indexOf("\r\n  });\r\n", ib+btnLine.length+100);
  // Actually let me find the exact end
  // Pattern: document.getElementById('btnExecDCA')?.addEventListener('click',function(){...});
  // Find the matching closing: })}) 
  var depth=0, ei=ib+btnLine.length;
  for(var k=ei;k<Math.min(ei+500,c.length);k++){
    if(c[k]==='{') depth++;
    if(c[k]==='}') depth--;
    if(depth<=0 && c[k]==='}'){
      // Skip past ;)\r\n
      ei=k+2; // skip ; and \r\n
      break;
    }
  }
  // Actually this is fragile. Let me just find the exact end text.
  var endText="  });\r\n";
  var ei2=c.indexOf(endText, ei-1);
  if(ei2>=0){
    c=c.substring(0,ib)+c.substring(ei2+endText.length);
    console.log("2. btnExecDCA handler deleted");
  } else { console.log("2. SKIP - end not found"); }
} else { console.log("2. SKIP - start not found, searching..."); 
  var idx=c.indexOf("btnExecDCA");
  if(idx>=0) console.log("  Found btnExecDCA at",idx,":",c.substring(idx-50,idx+100).replace(/\r/g,"\\r").replace(/\n/g,"\\n"));
}

fs.writeFileSync("public/index.html",c);
console.log("Done");
