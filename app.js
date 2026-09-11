// ================= CONFIG =================
// Put the values from Supabase > Project Settings > API here.
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

// Add map images that you have permission to use.
// Example: {name:"Bermuda",url:"https://your-domain.example/bermuda.jpg"}
const MAPS = [];

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let user=null,currentVideo=null,currentTool="select",currentZoom=1,drawing=false,start=null,lastAnnotations=[];

const $=id=>document.getElementById(id);
const show=id=>$(id).classList.remove("hidden");
const hide=id=>$(id).classList.add("hidden");
const msg=(id,text)=>$(id).textContent=text;

window.addEventListener("load",async()=>{
  $("mapSelect").innerHTML=MAPS.length?MAPS.map((m,i)=>`<option value="${i}">${escapeHtml(m.name)}</option>`).join(""):`<option>No maps configured</option>`;
  if(MAPS.length)loadMap(0);
  if(SUPABASE_URL.startsWith("YOUR_")){msg("authMsg","First configure SUPABASE_URL and SUPABASE_ANON_KEY in app.js.");return;}
  const {data}=await sb.auth.getSession();
  if(data.session){user=data.session.user;enterApp();}
});

$("signupBtn").onclick=async()=>{
  const email=$("email").value.trim(),password=$("password").value;
  if(!email||password.length<6)return msg("authMsg","Enter a valid email and a password of at least 6 characters.");
  const {error}=await sb.auth.signUp({email,password});
  msg("authMsg",error?error.message:"Account created. Check your email if confirmation is enabled.");
};
$("loginBtn").onclick=async()=>{
  const {data,error}=await sb.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
  msg("authMsg",error?error.message:"");
  if(data.user){user=data.user;enterApp();}
};
$("logoutBtn").onclick=async()=>{await sb.auth.signOut();location.reload();};

function enterApp(){hide("auth");show("app");show("logoutBtn");loadVideos();loadStats();}
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>openTab(b.dataset.tab));
$("goUpload").onclick=()=>openTab("upload");
$("backVideos").onclick=()=>openTab("videos");

function openTab(name){
  document.querySelectorAll(".tab").forEach(x=>x.classList.add("hidden"));
  show(name);
  document.querySelectorAll(".tabs button").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
  if(name==="videos")loadVideos();
}

async function loadStats(){
  const {count:vc}=await sb.from("videos").select("*",{count:"exact",head:true});
  const {count:nc}=await sb.from("annotations").select("*",{count:"exact",head:true});
  const {count:ac}=await sb.from("ai_reports").select("*",{count:"exact",head:true});
  $("videoCount").textContent=vc||0;$("noteCount").textContent=nc||0;$("analysisCount").textContent=ac||0;
}

$("uploadBtn").onclick=async()=>{
  const file=$("videoFile").files[0];
  if(!file)return msg("uploadMsg","Choose a gameplay video first.");
  if(file.size>1024*1024*1024)return msg("uploadMsg","Keep the video under 1 GB for this version.");
  msg("uploadMsg","Uploading...");
  const path=`${user.id}/${crypto.randomUUID()}-${file.name}`;
  const {error:upErr}=await sb.storage.from("gameplay-videos").upload(path,file,{contentType:file.type,upsert:false});
  if(upErr)return msg("uploadMsg",upErr.message);
  const {data:row,error:dbErr}=await sb.from("videos").insert({user_id:user.id,title:$("videoTitle").value.trim()||file.name,storage_path:path}).select().single();
  if(dbErr)return msg("uploadMsg",dbErr.message);
  msg("uploadMsg","Uploaded.");
  $("videoFile").value="";$("videoTitle").value="";
  await openVideo(row);
};

async function loadVideos(){
  const {data,error}=await sb.from("videos").select("*").order("created_at",{ascending:false});
  if(error){$("videoList").innerHTML=`<p class="muted">${escapeHtml(error.message)}</p>`;return;}
  $("videoList").innerHTML=data?.length?data.map(v=>`<div class="item"><div><b>${escapeHtml(v.title)}</b><small>${new Date(v.created_at).toLocaleString()}</small></div><button onclick='openVideo(${JSON.stringify(v)})'>Open</button></div>`).join(""):"<p class='muted'>No uploaded videos yet.</p>";
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

async function openVideo(v){
  currentVideo=v;currentZoom=1;openTab("analyser");
  $("analyserTitle").textContent=v.title;
  const {data,error}=await sb.storage.from("gameplay-videos").createSignedUrl(v.storage_path,3600);
  if(error||!data?.signedUrl){msg("analysisMsg",error?.message||"Could not open video.");return;}
  $("player").src=data.signedUrl;
  $("player").onloadedmetadata=()=>resizeCanvas();
  $("player").ontimeupdate=()=>{msg("timeBadge",`${$("player").currentTime.toFixed(1)}s`);renderOverlay();};
  $("player").onseeked=renderOverlay;
  window.addEventListener("resize",resizeCanvas);
  loadAnnotations();loadReport();
}
function resizeCanvas(){
  const v=$("player"),c=$("overlay");
  if(!v.videoWidth)return;
  c.width=v.clientWidth;c.height=v.clientHeight;renderOverlay();
}
function point(e,c){const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*c.width/r.width,y:(e.clientY-r.top)*c.height/r.height};}
$("overlay").onpointerdown=e=>{
  if(currentTool==="select")return;
  drawing=true;start=point(e,$("overlay"));$("overlay").setPointerCapture?.(e.pointerId);
};
$("overlay").onpointerup=e=>{
  if(!drawing)return;drawing=false;
  const end=point(e,$("overlay"));
  if(currentTool==="note"){const text=prompt("Enter analysis note:");if(text)saveAnnotation("note",{text});return;}
  saveAnnotation(currentTool,{start,end});
};
function renderOverlay(){
  const c=$("overlay"),ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);
  if(!lastAnnotations.length)return;
  const t=$("player").currentTime;
  const near=lastAnnotations.filter(a=>Math.abs(Number(a.timestamp_seconds)-t)<=0.75);
  ctx.lineWidth=3;ctx.strokeStyle="#18a8ff";ctx.fillStyle="#18a8ff";ctx.font="bold 14px system-ui";
  near.forEach(a=>{
    const p=a.payload||{};if(a.type==="note"){ctx.fillText(p.text||"Note",12,24);return;}
    if(!p.start||!p.end)return;
    const x1=p.start.x,y1=p.start.y,x2=p.end.x,y2=p.end.y;
    if(a.type==="circle"){ctx.beginPath();ctx.ellipse((x1+x2)/2,(y1+y2)/2,Math.abs(x2-x1)/2,Math.abs(y2-y1)/2,0,0,Math.PI*2);ctx.stroke();}
    if(a.type==="arrow"){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();const ang=Math.atan2(y2-y1,x2-x1);ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-18*Math.cos(ang-.5),y2-18*Math.sin(ang-.5));ctx.lineTo(x2-18*Math.cos(ang+.5),y2-18*Math.sin(ang+.5));ctx.stroke();}
    if(a.type==="draw"){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
  });
}
document.querySelectorAll("[data-tool]").forEach(b=>b.onclick=()=>{currentTool=b.dataset.tool;document.querySelectorAll("[data-tool]").forEach(x=>x.classList.remove("active"));b.classList.add("active");});
$("zoomIn").onclick=()=>setVideoZoom(1.15);$("zoomOut").onclick=()=>setVideoZoom(.87);
function setVideoZoom(z){currentZoom=Math.max(.6,Math.min(3,currentZoom*z));$("player").style.transform=`scale(${currentZoom})`;}

$("saveMark").onclick=async()=>{
  if(!currentVideo)return;
  if(currentTool==="note"){const text=prompt("Enter note:");if(text)await saveAnnotation("note",{text});}
  else {const text=prompt("Describe what happened at this timestamp:")||"Manual mark";await saveAnnotation(currentTool,{text});}
};
async function saveAnnotation(type,payload){
  const {error}=await sb.from("annotations").insert({video_id:currentVideo.id,user_id:user.id,timestamp_seconds:$("player").currentTime,type,payload});
  if(error)return msg("analysisMsg",error.message);
  msg("analysisMsg",`Evidence saved at ${$("player").currentTime.toFixed(1)}s`);
  await loadAnnotations();loadStats();
}
async function loadAnnotations(){
  const {data,error}=await sb.from("annotations").select("*").eq("video_id",currentVideo.id).order("timestamp_seconds");
  if(error){$("annotations").innerHTML=`<p class="muted">${escapeHtml(error.message)}</p>`;return;}
  lastAnnotations=data||[];renderOverlay();
  $("annotations").innerHTML=lastAnnotations.length?lastAnnotations.map(a=>`<div class="note"><b>${escapeHtml(a.type)}</b> · ${Number(a.timestamp_seconds).toFixed(1)}s<br>${escapeHtml(a.payload?.text||"")}</div>`).join(""):"<p class='muted'>No saved evidence.</p>";
}
async function loadReport(){
  const {data}=await sb.from("ai_reports").select("*").eq("video_id",currentVideo.id).order("created_at",{ascending:false}).limit(1);
  $("aiReport").textContent=data?.[0]?.report||"No AI report yet.";
}

// Capture a small number of frames from the actual uploaded video.
// This gives the AI visual evidence without sending the full video file.
async function captureFrames(maxFrames=6){
  const v=$("player");
  if(!v.duration||!isFinite(v.duration))throw new Error("Video is not ready.");
  const wasPlaying=!v.paused;const old=v.currentTime;
  const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");
  const scale=Math.min(1,960/(v.videoWidth||960));canvas.width=Math.max(320,Math.round((v.videoWidth||960)*scale));canvas.height=Math.max(180,Math.round((v.videoHeight||540)*scale));
  const out=[];
  for(let i=0;i<maxFrames;i++){
    const t=(v.duration*(i+1))/(maxFrames+1);
    await seekVideo(t);ctx.drawImage(v,0,0,canvas.width,canvas.height);
    out.push({time:t,image:canvas.toDataURL("image/jpeg",.62).split(",")[1]});
  }
  await seekVideo(old);if(wasPlaying)v.play();
  return out;
}
function seekVideo(t){return new Promise((resolve,reject)=>{const v=$("player");const done=()=>{v.removeEventListener("seeked",done);resolve();};v.addEventListener("seeked",done,{once:true});v.currentTime=Math.min(Math.max(0,t),Math.max(0,v.duration-.05));setTimeout(()=>{v.removeEventListener("seeked",done);reject(new Error("Video seek timed out."));},8000);});}

$("aiBtn").onclick=async()=>{
  if(!currentVideo)return;
  try{
    msg("analysisMsg","Sampling gameplay frames for AI...");
    const frames=await captureFrames(6);
    msg("analysisMsg","AI is reviewing visual evidence + your saved marks...");
    const {data,error}=await sb.functions.invoke("analyze-video",{body:{video_id:currentVideo.id,frames}});
    if(error)throw error;
    $("aiReport").textContent=data?.report||"No report returned.";
    msg("analysisMsg","AI report generated.");
    loadStats();
  }catch(e){msg("analysisMsg",e.message||String(e));}
};

function loadMap(i){
  if(!MAPS[i]){ $("mapImage").removeAttribute("src"); return;}
  $("mapImage").src=MAPS[i].url;currentZoom=1;$("mapImage").style.transform="scale(1)";
}
$("mapSelect").onchange=e=>loadMap(Number(e.target.value));
$("mapPlus").onclick=()=>mapZoom(1.2);$("mapMinus").onclick=()=>mapZoom(.83);
$("mapReset").onclick=()=>{currentZoom=1;$("mapImage").style.transform="scale(1)";};
function mapZoom(z){currentZoom=Math.max(.5,Math.min(5,currentZoom*z));$("mapImage").style.transform=`scale(${currentZoom})`;}
$("mapImage").onerror=()=>msg("mapMsg","Map image could not be loaded. Check the URL and permission.");
