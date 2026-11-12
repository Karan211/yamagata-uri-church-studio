/* 성경 자막(크로마키) — 조정 화면과 송출 창이 함께 쓰는 그리기 코드 */
'use strict';
const CAP_W=1920,CAP_H=1080;
const CAP_BG={green:'#00ff00',blue:'#0000ff',black:'#000000',camera:'#000000'};
const CAP_DEF={
 slides:[
  {ref:'요한복음 3:16',ko:'하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니\n이는 저를 믿는 자마다 멸망치 않고 영생을 얻게 하려 하심이니라',ja:'神はそのひとり子を賜わったほどに、この世を愛して下さった。'},
  {ref:'시편 23:1',ko:'여호와는 나의 목자시니 내가 부족함이 없으리로다',ja:'主はわたしの牧者であって、わたしには乏しいことがない。'}],
 cur:0,live:true,bg:'green',bgCustom:'#00ff00',camId:'',
 d:{layout:'lower',align:'center',font:'Noto Sans KR',size:64,width:84,margin:70,color:'#ffffff',jaColor:'#ffe9a8',refColor:'#e3b75a',showJa:true,showRef:true,
    stroke:8,strokeColor:'#000000',shadow:0,box:'#0b1730',boxOp:0,accent:true,accentColor:'#e3b75a',anim:'fade'}};
(function(){const s=document.createElement('style');s.textContent=`
.capstage{position:absolute;left:50%;top:50%;width:${CAP_W}px;height:${CAP_H}px;transform-origin:center;overflow:hidden}
.capstage .cam{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none}
.capstage .cap{position:absolute;inset:0;display:flex;opacity:0;transition:opacity .45s ease,transform .45s ease}
.capstage .cap.show{opacity:1;transform:none!important}
.capstage .inner{--k:1;box-sizing:border-box;border-radius:14px}
.capstage .ko,.capstage .ja,.capstage .ref{white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere;paint-order:stroke fill;line-height:1.36}
.capstage .ko{font-weight:800;font-size:calc(var(--fs)*var(--k))}
.capstage .ja{font-weight:700;font-size:calc(var(--fs)*var(--k)*.78);margin-top:.3em}
.capstage .ref{font-weight:800;font-size:calc(var(--fs)*var(--k)*.6);margin-top:.45em;letter-spacing:.02em}`;document.head.appendChild(s)})();
function capHex(h,a){const n=parseInt(h.slice(1),16);return`rgba(${n>>16&255},${n>>8&255},${n&255},${a})`}
function capBuild(stage){stage.classList.add('capstage');stage.innerHTML='<video class="cam" autoplay muted playsinline></video><div class="cap"><div class="inner"><div class="ko"></div><div class="ja"></div><div class="ref"></div></div></div>'}
function capFit(stage,box){const k=Math.min(box.clientWidth/CAP_W,box.clientHeight/CAP_H);stage.style.transform=`translate(-50%,-50%) scale(${k})`}
function capBgColor(st){return st.bg==='custom'?st.bgCustom:CAP_BG[st.bg]||'#00ff00'}
function capApply(stage,st){
 const d=st.d,sl=st.slides[st.cur]||{ref:'',ko:'',ja:''},cap=stage.querySelector('.cap'),inner=stage.querySelector('.inner'),q=c=>stage.querySelector(c);
 stage.style.background=capBgColor(st);q('.cam').style.display=st.bg==='camera'?'block':'none';
 cap.style.alignItems={lower:'flex-end',center:'center',top:'flex-start'}[d.layout];
 cap.style.justifyContent={left:'flex-start',center:'center',right:'flex-end'}[d.align];
 cap.style.padding=`${d.margin}px ${Math.max(40,d.margin)}px`;
 cap.style.transform=d.anim==='slide'?`translateY(${d.layout==='top'?-40:40}px)`:'none';
 cap.style.transitionDuration=d.anim==='none'?'0s':'.45s';
 inner.style.maxWidth=d.width+'%';inner.style.textAlign=d.align;inner.style.setProperty('--fs',d.size+'px');
 inner.style.fontFamily=`"${d.font}","Noto Sans KR","Noto Sans JP",sans-serif`;
 inner.style.background=d.boxOp>0?capHex(d.box,d.boxOp/100):'transparent';
 inner.style.padding=d.boxOp>0||d.accent?'26px 44px':'0';
 const bar=d.accent?`10px solid ${d.accentColor}`:'0';inner.style.borderLeft=d.align==='right'?'0':bar;inner.style.borderRight=d.align==='right'?bar:'0';
 if(d.accent&&d.align==='center'){inner.style.borderLeft='0';inner.style.borderBottom=bar;inner.style.borderRadius='0'}else{inner.style.borderBottom='0';inner.style.borderRadius='14px'}
 const sh=d.shadow>0?`0 ${d.shadow*.12}px ${d.shadow*.45}px rgba(0,0,0,.9)`:'none';
 [['.ko',sl.ko,d.color,true],['.ja',sl.ja,d.jaColor,d.showJa],['.ref',sl.ref,d.refColor,d.showRef]].forEach(([c,t,col,on])=>{const e=q(c);e.textContent=t||'';e.style.display=on&&t?'block':'none';e.style.color=col;
  e.style.webkitTextStroke=d.stroke>0?`${d.stroke}px ${d.strokeColor}`:'0';e.style.textShadow=sh});
 /* 글이 길면 화면 안에 들어오도록 자동으로 줄인다 */
 let k=1;inner.style.setProperty('--k',k);const max=CAP_H-2*d.margin;while(inner.offsetHeight>max&&k>.35){k-=.05;inner.style.setProperty('--k',k)}
 cap.classList.toggle('show',!!st.live&&!!(sl.ko||sl.ja||sl.ref))}
let capStream=null,capCamId=null;
async function capCamera(stage,st){const v=stage.querySelector('.cam');
 if(st.bg!=='camera'){if(capStream){capStream.getTracks().forEach(t=>t.stop());capStream=null;capCamId=null;v.srcObject=null}return}
 if(capStream&&capCamId===st.camId)return;if(capStream)capStream.getTracks().forEach(t=>t.stop());capCamId=st.camId;
 try{capStream=await navigator.mediaDevices.getUserMedia({video:{deviceId:st.camId?{exact:st.camId}:undefined,width:{ideal:1920},height:{ideal:1080}},audio:false});v.srcObject=capStream}
 catch(e){capStream=null;capCamId=null;throw e}}
