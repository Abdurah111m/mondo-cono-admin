/* ============================================================
   Mondo Cono — Admin Panel (Telegram Mini App)
   Backend: FastAPI /admin/*  ·  Auth: X-Telegram-Init-Data
   ============================================================ */

const API = "https://cono-backend-kkcy.onrender.com";

const tg = window.Telegram?.WebApp;
function initData(){ return tg?.initData || ""; }
function haptic(t="light"){ try{ tg?.HapticFeedback?.impactOccurred(t); }catch{} }
function notify(t="success"){ try{ tg?.HapticFeedback?.notificationOccurred(t); }catch{} }

/* ---------- API helper ---------- */
async function api(path, { method="GET", body, raw=false } = {}){
  const headers = { "X-Telegram-Init-Data": initData() };
  let opts = { method, headers };
  if (raw){ opts.body = raw; }                 // FormData (rasm yuklash)
  else if (body !== undefined){ headers["Content-Type"]="application/json"; opts.body = JSON.stringify(body); }
  let resp;
  try{ resp = await fetch(API + path, opts); }
  catch{ throw new ApiErr("Internetga ulanib bo'lmadi", 0); }
  const data = await resp.json().catch(()=>null);
  if(!resp.ok){
    const msg = data?.error?.message || data?.detail || "Xatolik yuz berdi";
    throw new ApiErr(typeof msg==="string"?msg:"Xatolik", resp.status, data);
  }
  return data;
}
class ApiErr extends Error{ constructor(m,s,d){ super(m); this.status=s; this.data=d; } }

/* ---------- format helpers ---------- */
const money = n => (n==null?0:n).toLocaleString("ru-RU").replace(/,/g," ") + " so'm";
const moneyShort = n => {
  n = n||0;
  if(n>=1e6) return (n/1e6).toFixed(n>=1e7?0:1).replace(".0","")+"M";
  if(n>=1e3) return (n/1e3).toFixed(n>=1e4?0:1).replace(".0","")+"k";
  return ""+n;
};
function timeAgo(iso){
  const d = new Date(iso); const s = (Date.now()-d.getTime())/1000;
  if(s<60) return "hozir";
  if(s<3600) return Math.floor(s/60)+" daqiqa oldin";
  if(s<86400) return Math.floor(s/3600)+" soat oldin";
  const days = Math.floor(s/86400);
  if(days<7) return days+" kun oldin";
  return d.toLocaleDateString("uz-UZ",{day:"numeric",month:"short"});
}
function dayShort(iso){
  const dn = ["Yak","Du","Se","Cho","Pa","Ju","Sha"];
  return dn[new Date(iso).getDay()];
}
const esc = s => (s==null?"":String(s)).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ---------- status maps ---------- */
const ORDER_STATUS = {
  new:        {label:"Yangi",          emoji:"🆕"},
  preparing:  {label:"Tayyorlanmoqda", emoji:"👨‍🍳"},
  on_the_way: {label:"Yo'lda",         emoji:"🚚"},
  delivered:  {label:"Yetkazildi",     emoji:"✅"},
  canceled:   {label:"Bekor qilindi",  emoji:"❌"},
};
const STATUS_FLOW = { new:"preparing", preparing:"on_the_way", on_the_way:"delivered" };
const PAY_STATUS = {
  pending:"Kutilmoqda", paid:"To'landi", canceled:"Bekor", refunded:"Qaytarildi", failed:"Xato",
};
const PROVIDER = { payme:"Payme", click:"Click", uzum:"Uzum", crypto:"Kripto", cash:"Naqd" };

/* ---------- toast / modal ---------- */
function toast(msg, type=""){
  const w = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast "+type;
  el.innerHTML = (type==="ok"?"✓ ":type==="err"?"✕ ":"") + esc(msg);
  w.appendChild(el);
  setTimeout(()=>{ el.style.transition="opacity .3s,transform .3s"; el.style.opacity="0"; el.style.transform="translateY(-10px)"; setTimeout(()=>el.remove(),300); }, 2600);
}
function openModal(html){
  document.getElementById("modalBody").innerHTML = '<div class="modal-grip"></div>'+html;
  document.getElementById("modal").classList.add("open");
}
function closeModal(){ document.getElementById("modal").classList.remove("open"); }
function confirmDialog(title, text, okLabel, onOk, danger=true){
  openModal(`
    <h2>${esc(title)}</h2>
    <p class="modal-sub">${esc(text)}</p>
    <button class="btn ${danger?'danger':'primary'} block" id="cfOk">${esc(okLabel)}</button>
    <button class="btn ghost block" style="margin-top:10px" onclick="closeModal()">Bekor qilish</button>
  `);
  document.getElementById("cfOk").onclick = async ()=>{ closeModal(); await onOk(); };
}

/* ---------- app state ---------- */
const S = { tab:"dash", me:null, cats:[], products:[], orderFilter:"", payFilter:"" };

/* ---------- boot: verify admin ---------- */
async function boot(){
  if(tg){ tg.ready(); tg.expand(); try{ tg.setHeaderColor("#FFF8F0"); tg.setBackgroundColor("#FBF4EC"); }catch{} }
  if(!initData()){
    return gate("📱","Telegram orqali oching","Bu admin panel faqat Telegram ichida, bot orqali ochilganda ishlaydi. Botga o'ting va /admin buyrug'ini bosing.");
  }
  try{
    S.me = await api("/me");
    // /me hamma uchun ishlaydi; admin tekshiruvini stats bilan sinaymiz
    await api("/admin/stats");
  }catch(e){
    if(e.status===403) return gate("🔒","Ruxsat yo'q","Sizda admin huquqi yo'q. Agar bu xato bo'lsa, Telegram ID raqamingiz ADMIN_IDS ro'yxatida ekanini tekshiring.");
    return authErrorGate(e);
  }
  buildShell();
  go("dash");
}
function authErrorGate(e){
  const id = initData();
  const has = k => id.includes(k+"=") ? "✓" : "yo'q";
  const diag = `initData: ${id?("bor, "+id.length+" belgi"):"YO'Q"} · user ${has("user")} · hash ${has("hash")} · auth_date ${has("auth_date")} · signature ${has("signature")}`;
  const platform = (tg && tg.platform) ? tg.platform : "noma'lum";
  const title = e.status===401 ? "Kirish rad etildi" : "Ulanishda xato";
  const emo = e.status===401 ? "🔑" : "⚠️";
  document.getElementById("app").innerHTML = `
    <div class="gate">
      <div class="emo">${emo}</div>
      <h2>${title}</h2>
      <p>Server javobi: <b>${esc(e.message||"noma'lum")}</b><br>(kod: ${e.status})</p>
      <div style="margin-top:18px;background:#fff;border-radius:14px;padding:14px 16px;box-shadow:var(--shadow);max-width:340px;font-size:12px;color:var(--muted);text-align:left;line-height:1.7">
        <b style="color:var(--choco)">🔧 Diagnostika</b><br>
        ${esc(diag)}<br>
        platforma: ${esc(platform)}
      </div>
      <button class="btn primary" style="margin-top:20px" onclick="location.reload()">Qayta urinish</button>
    </div>`;
}
function gate(emo,title,text){
  document.getElementById("app").innerHTML =
    `<div class="gate"><div class="emo">${emo}</div><h2>${esc(title)}</h2><p>${esc(text)}</p>
     <button class="btn primary" style="margin-top:22px" onclick="location.reload()">Qayta urinish</button></div>`;
}

/* ---------- app shell ---------- */
function buildShell(){
  document.getElementById("app").innerHTML = `
    <div class="topbar">
      <div class="wordmark">🍦 Mondo Cono <span class="tag">Admin</span></div>
      <button class="icon-btn" onclick="refresh()" id="refreshBtn">↻</button>
    </div>
    <div id="page"></div>
    <button class="fab" id="fab" onclick="fabAction()" style="display:none">＋</button>
    <div class="bottomnav">
      ${navItem("dash","📊","Panel")}
      ${navItem("orders","🧾","Buyurtma")}
      ${navItem("products","🍦","Mahsulot")}
      ${navItem("more","⚙️","Boshqa")}
    </div>`;
}
const navItem = (id,ic,label)=>`<div class="nav-item" id="nav-${id}" onclick="go('${id}')"><div class="ic">${ic}</div>${label}</div>`;

function go(tab){
  haptic("light");
  S.tab = tab;
  document.querySelectorAll(".nav-item").forEach(n=>n.classList.remove("active"));
  const navId = (tab==="dash"||tab==="orders"||tab==="products")?tab:"more";
  document.getElementById("nav-"+navId)?.classList.add("active");
  const fab = document.getElementById("fab");
  fab.style.display = (tab==="products"||tab==="categories")?"grid":"none";
  const r = { dash:loadDash, orders:loadOrders, products:loadProducts,
              more:loadMore, categories:loadCategories, users:loadUsers, payments:loadPayments, import:loadImport };
  (r[tab]||loadDash)();
}
function refresh(){ const b=document.getElementById("refreshBtn"); if(b){b.style.transition="transform .5s";b.style.transform="rotate(360deg)";setTimeout(()=>{b.style.transition="";b.style.transform="";},500);} go(S.tab); }
function fabAction(){ if(S.tab==="products") productForm(); else if(S.tab==="categories") categoryForm(); }
function setPage(html){ document.getElementById("page").innerHTML = `<div class="page">${html}</div>`; }
function pageLoader(text="Yuklanmoqda…"){ setPage(`<div class="loader"><div class="spinner"></div><p>${esc(text)}</p></div>`); }

boot();

/* ============================================================
   DASHBOARD
   ============================================================ */
async function loadDash(){
  pageLoader("Statistika yuklanmoqda…");
  let s;
  try{ s = await api("/admin/stats"); }
  catch(e){ return setPage(errBox(e)); }

  const maxRev = Math.max(1, ...s.daily_chart.map(d=>d.revenue));
  const bars = s.daily_chart.map(d=>{
    const h = d.revenue>0 ? Math.max(6, Math.round(d.revenue/maxRev*100)) : 0;
    return `<div class="bar-col">
      <div class="bar-val">${d.revenue>0?moneyShort(d.revenue):""}</div>
      <div class="bar ${h===0?'empty':''}" style="height:${h||4}%"></div>
      <div class="bar-label">${dayShort(d.date)}</div></div>`;
  }).join("");

  const top = s.top_products.length
    ? s.top_products.map((p,i)=>`<div class="rank-row">
        <div class="rank-num">${i+1}</div>
        <div class="rank-name">${esc(p.name)}</div>
        <div class="rank-qty">${p.qty} dona</div></div>`).join("")
    : `<p style="color:var(--muted);font-size:13.5px;text-align:center;padding:14px">Hali sotuv yo'q</p>`;

  const sb = s.status_breakdown||{};
  const statuses = Object.keys(ORDER_STATUS).filter(k=>sb[k]);
  const statusPills = statuses.length
    ? statuses.map(k=>`<span class="pill ${k}" style="margin:0 6px 8px 0">${ORDER_STATUS[k].emoji} ${ORDER_STATUS[k].label}: ${sb[k]}</span>`).join("")
    : `<p style="color:var(--muted);font-size:13.5px">Buyurtmalar yo'q</p>`;

  setPage(`
    <div class="kpi-grid">
      <div class="kpi pink"><div class="label">🧾 Jami buyurtma</div><div class="value">${s.total_orders}</div></div>
      <div class="kpi mint"><div class="label">💰 Jami daromad</div><div class="value">${moneyShort(s.total_revenue)}</div><div class="sub">${money(s.total_revenue)}</div></div>
      <div class="kpi cone"><div class="label">📅 Bugun buyurtma</div><div class="value">${s.today_orders}</div></div>
      <div class="kpi blue"><div class="label">📈 Bugun daromad</div><div class="value">${moneyShort(s.today_revenue)}</div><div class="sub">${money(s.today_revenue)}</div></div>
    </div>

    <div class="panel">
      <h3>📊 So'nggi 7 kun daromadi</h3>
      <div class="chart">${bars}</div>
    </div>

    <div class="panel">
      <h3>🔝 Top mahsulotlar</h3>
      ${top}
    </div>

    <div class="panel">
      <h3>🚦 Buyurtma holatlari</h3>
      <div>${statusPills}</div>
    </div>
  `);
}
function errBox(e){
  return `<div class="empty"><div class="emo">⚠️</div><div class="t">Xatolik</div>
    <div class="d">${esc(e.message||"Noma'lum xato")}</div>
    <button class="btn primary" style="margin-top:18px" onclick="go(S.tab)">Qayta urinish</button></div>`;
}

/* ============================================================
   BUYURTMALAR
   ============================================================ */
async function loadOrders(){
  const chips = [["","Barchasi"],...Object.entries(ORDER_STATUS).map(([k,v])=>[k,v.emoji+" "+v.label])];
  const chipsHtml = chips.map(([k,l])=>`<div class="chip ${S.orderFilter===k?'active':''}" onclick="setOrderFilter('${k}')">${l}</div>`).join("");
  setPage(`<h1 class="page-title">Buyurtmalar</h1><div class="chips">${chipsHtml}</div><div id="orderList"><div class="loader"><div class="spinner"></div></div></div>`);
  try{
    const q = S.orderFilter?`?status=${S.orderFilter}&`:"?";
    const res = await api(`/admin/orders${q}page=1&page_size=50`);
    const list = document.getElementById("orderList");
    if(!res.items.length){ list.innerHTML = emptyBox("🧾","Buyurtma yo'q","Bu bo'limda hozircha buyurtmalar yo'q."); return; }
    list.innerHTML = res.items.map(orderCard).join("");
  }catch(e){ document.getElementById("orderList").innerHTML = errBox(e); }
}
function setOrderFilter(f){ S.orderFilter=f; haptic("light"); loadOrders(); }

function orderCard(o){
  const st = ORDER_STATUS[o.status]||{label:o.status,emoji:"•"};
  const next = STATUS_FLOW[o.status];
  const itemsTxt = (o.items||[]).map(it=>`${esc(it.product_name)} ×${it.qty}`).join(", ");
  let actions = "";
  if(next){
    const nx = ORDER_STATUS[next];
    actions += `<button class="btn primary sm" onclick="setStatus('${o.public_id}','${next}')">${nx.emoji} ${nx.label}</button>`;
  }
  if(o.status!=="delivered" && o.status!=="canceled"){
    actions += `<button class="btn danger sm" onclick="askCancel('${o.public_id}')">❌ Bekor</button>`;
  }
  actions += `<button class="btn ghost sm" onclick='orderDetail(${JSON.stringify(o).replace(/'/g,"&#39;")})'>👁 Batafsil</button>`;
  return `<div class="lc">
    <div class="lc-top">
      <div><div class="lc-id">#${esc(o.public_id)}</div>
        <div class="lc-sub">${esc(o.customer_name)} · ${timeAgo(o.created_at)}</div></div>
      <div style="text-align:right">
        <div class="lc-total">${moneyShort(o.total)}</div>
        <div style="margin-top:5px"><span class="pill ${o.status}">${st.emoji} ${st.label}</span></div>
      </div>
    </div>
    <div class="lc-meta">
      <span><b>📞</b> ${esc(o.customer_phone)}</span>
      <span><b>${o.delivery_method==="pickup"?"🏪 Olib ketish":"🚚 Yetkazish"}</b></span>
      <span class="pill ${o.payment_status}" style="font-size:11px">${PAY_STATUS[o.payment_status]||o.payment_status}</span>
    </div>
    ${itemsTxt?`<div class="lc-sub" style="margin-top:8px">🍦 ${esc(itemsTxt)}</div>`:""}
    <div class="lc-actions">${actions}</div>
  </div>`;
}

async function setStatus(pid, status){
  haptic("medium");
  try{
    await api(`/admin/orders/${pid}/status`, { method:"PUT", body:{status} });
    notify("success"); toast("Holat yangilandi: "+ORDER_STATUS[status].label,"ok");
    loadOrders();
  }catch(e){ notify("error"); toast(e.message,"err"); }
}
function askCancel(pid){
  confirmDialog("Buyurtmani bekor qilish?","#"+pid+" bekor qilinadi va mijozga xabar boradi.","❌ Ha, bekor qilish",
    ()=>setStatus(pid,"canceled"));
}
function orderDetail(o){
  const items = (o.items||[]).map(it=>`<div class="rank-row"><div class="rank-name">${esc(it.product_name)} <span style="color:var(--muted)">×${it.qty}</span></div><div class="rank-qty">${money(it.subtotal)}</div></div>`).join("");
  const st = ORDER_STATUS[o.status]||{};
  openModal(`
    <h2>#${esc(o.public_id)}</h2>
    <p class="modal-sub"><span class="pill ${o.status}">${st.emoji} ${st.label}</span></p>
    <div class="field"><label>Mijoz</label><div style="font-weight:600">${esc(o.customer_name)} · ${esc(o.customer_phone)}</div></div>
    ${o.address?`<div class="field"><label>Manzil</label><div>${esc(o.address)}</div></div>`:""}
    ${o.note?`<div class="field"><label>Izoh</label><div>${esc(o.note)}</div></div>`:""}
    <div class="section-label" style="margin-left:0">Mahsulotlar</div>
    ${items}
    <div class="rank-row" style="border-top:2px solid var(--line);margin-top:6px"><div class="rank-name">Mahsulotlar</div><div class="rank-qty">${money(o.items_total)}</div></div>
    ${o.delivery_price?`<div class="rank-row"><div class="rank-name">Yetkazib berish</div><div class="rank-qty">${money(o.delivery_price)}</div></div>`:""}
    ${o.penoplast_price?`<div class="rank-row"><div class="rank-name">Penoplast (sovutgich)</div><div class="rank-qty">${money(o.penoplast_price)}</div></div>`:""}
    <div class="rank-row"><div class="rank-name" style="font-family:Fredoka;font-weight:700">Jami</div><div class="rank-qty" style="color:var(--pink-dark);font-family:Fredoka;font-weight:700;font-size:16px">${money(o.total)}</div></div>
    ${o.lat&&o.lng?`<a class="btn mint block" style="margin-top:14px" href="https://maps.google.com/?q=${o.lat},${o.lng}" target="_blank">📍 Xaritada ko'rish</a>`:""}
    <button class="btn ghost block" style="margin-top:10px" onclick="closeModal()">Yopish</button>
  `);
}
function emptyBox(emo,t,d){ return `<div class="empty"><div class="emo">${emo}</div><div class="t">${esc(t)}</div><div class="d">${esc(d)}</div></div>`; }

/* ============================================================
   MAHSULOTLAR
   ============================================================ */
async function loadProducts(){
  pageLoader("Mahsulotlar yuklanmoqda…");
  try{
    const [cats, prods] = await Promise.all([ api("/admin/categories"), api("/admin/products") ]);
    S.cats = cats; S.products = prods;
    if(!prods.length){
      return setPage(`<h1 class="page-title">Mahsulotlar</h1>${emptyBox("🍦","Mahsulot yo'q","Pastdagi ＋ tugmasi orqali birinchi mahsulotni qo'shing.")}`);
    }
    const catName = id => { const c=S.cats.find(c=>c.id===id); return c?`${c.emoji} ${c.name_uz}`:"—"; };
    const cards = prods.map(p=>{
      const img = p.images&&p.images[0] ? `<img src="${esc(p.images[0])}" alt="">` : (p.emoji||"🍦");
      const tags = [];
      if(p.badge) tags.push(`<span class="pill muted" style="background:var(--cone-soft);color:#B8821E">${esc(p.badge)}</span>`);
      tags.push(`<span class="pill ${p.is_active?'delivered':'muted'}" style="font-size:11px">${p.is_active?"Faol":"O'chiq"}</span>`);
      tags.push(`<span class="pill ${p.stock>0?'on_the_way':'canceled'}" style="font-size:11px">${p.stock>0?p.stock+" dona":"Tugagan"}</span>`);
      return `<div class="lc">
        <div class="pr">
          <div class="pr-img">${img}</div>
          <div class="pr-body">
            <div class="pr-name">${esc(p.name_uz)}</div>
            <div class="pr-price">${money(p.price)}</div>
            <div class="pr-tags">${tags.join("")}</div>
          </div>
        </div>
        <div class="lc-actions" style="margin-top:11px">
          <button class="btn soft sm" onclick="productForm(${p.id})">✏️ Tahrirlash</button>
          <button class="btn mint sm" onclick="imageForm(${p.id})">🖼 Rasm</button>
          <button class="btn danger sm" onclick="askDeleteProduct(${p.id})">🗑</button>
          <span style="margin-left:auto;font-size:12px;color:var(--muted);align-self:center">${esc(catName(p.category_id))}</span>
        </div>
      </div>`;
    }).join("");
    setPage(`<h1 class="page-title">Mahsulotlar <span style="font-size:15px;color:var(--muted);font-family:Inter">${prods.length}</span></h1>${cards}`);
  }catch(e){ setPage(errBox(e)); }
}

function productForm(id){
  const p = id ? S.products.find(x=>x.id===id) : null;
  if(!S.cats.length){ toast("Avval kategoriya qo'shing","err"); go("categories"); return; }
  const catOpts = S.cats.map(c=>`<option value="${c.id}" ${p&&p.category_id===c.id?"selected":""}>${esc(c.emoji)} ${esc(c.name_uz)}</option>`).join("");
  openModal(`
    <h2>${p?"Mahsulotni tahrirlash":"Yangi mahsulot"}</h2>
    <p class="modal-sub">${p?"#"+p.id:"Do'koningizga muzqaymoq qo'shing"}</p>
    <div class="field"><label>Nomi (o'zbekcha) *</label><input id="f_name_uz" value="${p?esc(p.name_uz):""}" placeholder="Plombir vanil"></div>
    <div class="field"><label>Nomi (ruscha) *</label><input id="f_name_ru" value="${p?esc(p.name_ru):""}" placeholder="Пломбир ваниль"></div>
    <div class="field"><label>Kategoriya *</label><select id="f_cat">${catOpts}</select></div>
    <div class="row2">
      <div class="field"><label>Narx (so'm) *</label><input id="f_price" type="number" inputmode="numeric" value="${p?p.price:""}" placeholder="12000"></div>
      <div class="field"><label>Zaxira (dona)</label><input id="f_stock" type="number" inputmode="numeric" value="${p?p.stock:"100"}" placeholder="100"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Emoji</label><input id="f_emoji" value="${p?esc(p.emoji):"🍦"}" placeholder="🍦"></div>
      <div class="field"><label>Belgi <span class="opt">(ixtiyoriy)</span></label><input id="f_badge" value="${p&&p.badge?esc(p.badge):""}" placeholder="Yangi / Hit"></div>
    </div>
    <div class="field"><label>Tavsif <span class="opt">(ixtiyoriy)</span></label><textarea id="f_desc" placeholder="Mahsulot haqida...">${p&&p.description_uz?esc(p.description_uz):""}</textarea></div>
    <div class="switch-row"><span>Faol (do'konda ko'rinadi)</span><div class="switch ${(!p||p.is_active)?'on':''}" id="f_active" onclick="this.classList.toggle('on')"></div></div>
    <button class="btn primary block" id="saveBtn" onclick="saveProduct(${id||0})">${p?"Saqlash":"Qo'shish"}</button>
    <button class="btn ghost block" style="margin-top:10px" onclick="closeModal()">Bekor qilish</button>
  `);
}
async function saveProduct(id){
  const v = s=>document.getElementById(s).value.trim();
  const body = {
    name_uz:v("f_name_uz"), name_ru:v("f_name_ru"),
    category_id:parseInt(document.getElementById("f_cat").value,10),
    price:parseInt(v("f_price")||"0",10),
    stock:parseInt(v("f_stock")||"0",10),
    emoji:v("f_emoji")||"🍦",
    badge:v("f_badge")||null,
    description_uz:v("f_desc")||null,
    is_active:document.getElementById("f_active").classList.contains("on"),
  };
  if(!body.name_uz||!body.name_ru){ toast("Nomlarni to'ldiring","err"); return; }
  if(!body.price||body.price<0){ toast("To'g'ri narx kiriting","err"); return; }
  const btn=document.getElementById("saveBtn"); btn.disabled=true; btn.textContent="Saqlanmoqda…";
  try{
    if(id) await api(`/admin/products/${id}`,{method:"PUT",body});
    else   await api(`/admin/products`,{method:"POST",body});
    notify("success"); closeModal(); toast(id?"Saqlandi":"Mahsulot qo'shildi","ok"); loadProducts();
  }catch(e){ btn.disabled=false; btn.textContent="Saqlash"; toast(e.message,"err"); }
}
function askDeleteProduct(id){
  const p=S.products.find(x=>x.id===id);
  confirmDialog("Mahsulotni o'chirish?",(p?p.name_uz:"Mahsulot")+" butunlay o'chiriladi.","🗑 O'chirish",async()=>{
    try{ await api(`/admin/products/${id}`,{method:"DELETE"}); notify("success"); toast("O'chirildi","ok"); loadProducts(); }
    catch(e){ toast(e.message,"err"); }
  });
}

/* ---- rasm boshqaruvi ---- */
function imageForm(id){
  const p = S.products.find(x=>x.id===id);
  const imgs = (p.images||[]).map((u,i)=>`<div class="img-thumb"><img src="${esc(u)}"><div class="x" onclick="removeImage(${id},${i})">✕</div></div>`).join("");
  openModal(`
    <h2>Rasmlar</h2>
    <p class="modal-sub">${esc(p.name_uz)}</p>
    <div class="img-pick" id="imgPick">
      ${imgs}
      <label class="img-add">＋<input type="file" accept="image/*" style="display:none" onchange="uploadImage(${id},this)"></label>
    </div>
    <p style="font-size:12.5px;color:var(--muted);margin-top:14px;line-height:1.5">Rasm Supabase'ga yuklanadi. Maksimal hajm chegarasi backend sozlamasiga bog'liq (odatda 5MB).</p>
    <button class="btn primary block" style="margin-top:16px" onclick="closeModal();loadProducts()">Tayyor</button>
  `);
}
async function uploadImage(id, input){
  const file = input.files[0]; if(!file) return;
  const fd = new FormData(); fd.append("file", file);
  toast("Rasm yuklanmoqda…");
  try{
    const updated = await api(`/admin/products/${id}/image`,{method:"POST",raw:fd});
    notify("success"); toast("Rasm qo'shildi","ok");
    const idx = S.products.findIndex(x=>x.id===id); if(idx>=0) S.products[idx]=updated;
    imageForm(id);
  }catch(e){ notify("error"); toast(e.message,"err"); }
}
async function removeImage(id, i){
  const p=S.products.find(x=>x.id===id); const url=p.images[i];
  try{
    const updated = await api(`/admin/products/${id}/image?url=${encodeURIComponent(url)}`,{method:"DELETE"});
    const idx=S.products.findIndex(x=>x.id===id); if(idx>=0) S.products[idx]=updated;
    toast("Rasm olib tashlandi","ok"); imageForm(id);
  }catch(e){ toast(e.message,"err"); }
}

/* ============================================================
   KATEGORIYALAR
   ============================================================ */
async function loadCategories(){
  pageLoader("Kategoriyalar yuklanmoqda…");
  try{
    const cats = await api("/admin/categories"); S.cats=cats;
    let body;
    if(!cats.length){ body = emptyBox("🗂","Kategoriya yo'q","Pastdagi ＋ orqali birinchi kategoriyani qo'shing (masalan: Plombir, Eskimo, Stakanchik)."); }
    else body = cats.map(c=>`<div class="lc"><div class="lc-top">
        <div><div class="lc-id">${esc(c.emoji)} ${esc(c.name_uz)}</div>
          <div class="lc-sub">${esc(c.name_ru)} · tartib: ${c.sort_order}</div></div>
        <span class="pill ${c.is_active?'delivered':'muted'}" style="font-size:11px">${c.is_active?"Faol":"O'chiq"}</span></div>
        <div class="lc-actions">
          <button class="btn soft sm" onclick="categoryForm(${c.id})">✏️ Tahrirlash</button>
          <button class="btn danger sm" onclick="askDeleteCategory(${c.id})">🗑 O'chirish</button>
        </div></div>`).join("");
    setPage(`<h1 class="page-title">Kategoriyalar</h1>${body}`);
  }catch(e){ setPage(errBox(e)); }
}
function categoryForm(id){
  const c = id ? S.cats.find(x=>x.id===id) : null;
  openModal(`
    <h2>${c?"Kategoriyani tahrirlash":"Yangi kategoriya"}</h2>
    <p class="modal-sub">${c?"#"+c.id:"Mahsulotlarni guruhlash uchun"}</p>
    <div class="field"><label>Nomi (o'zbekcha) *</label><input id="c_name_uz" value="${c?esc(c.name_uz):""}" placeholder="Plombir"></div>
    <div class="field"><label>Nomi (ruscha) *</label><input id="c_name_ru" value="${c?esc(c.name_ru):""}" placeholder="Пломбир"></div>
    <div class="row2">
      <div class="field"><label>Emoji</label><input id="c_emoji" value="${c?esc(c.emoji):"🍦"}" placeholder="🍦"></div>
      <div class="field"><label>Tartib raqami</label><input id="c_sort" type="number" inputmode="numeric" value="${c?c.sort_order:"0"}"></div>
    </div>
    <div class="switch-row"><span>Faol</span><div class="switch ${(!c||c.is_active)?'on':''}" id="c_active" onclick="this.classList.toggle('on')"></div></div>
    <button class="btn primary block" id="cSave" onclick="saveCategory(${id||0})">${c?"Saqlash":"Qo'shish"}</button>
    <button class="btn ghost block" style="margin-top:10px" onclick="closeModal()">Bekor qilish</button>
  `);
}
async function saveCategory(id){
  const v=s=>document.getElementById(s).value.trim();
  const body={ name_uz:v("c_name_uz"), name_ru:v("c_name_ru"), emoji:v("c_emoji")||"🍦",
    sort_order:parseInt(v("c_sort")||"0",10), is_active:document.getElementById("c_active").classList.contains("on") };
  if(!body.name_uz||!body.name_ru){ toast("Nomlarni to'ldiring","err"); return; }
  const btn=document.getElementById("cSave"); btn.disabled=true; btn.textContent="Saqlanmoqda…";
  try{
    if(id) await api(`/admin/categories/${id}`,{method:"PUT",body});
    else   await api(`/admin/categories`,{method:"POST",body});
    notify("success"); closeModal(); toast(id?"Saqlandi":"Kategoriya qo'shildi","ok"); loadCategories();
  }catch(e){ btn.disabled=false; btn.textContent="Saqlash"; toast(e.message,"err"); }
}
function askDeleteCategory(id){
  const c=S.cats.find(x=>x.id===id);
  confirmDialog("Kategoriyani o'chirish?",(c?c.name_uz:"Kategoriya")+" o'chiriladi. Ichidagi mahsulotlar bo'lsa, avval ularni boshqa kategoriyaga o'tkazing.","🗑 O'chirish",async()=>{
    try{ await api(`/admin/categories/${id}`,{method:"DELETE"}); notify("success"); toast("O'chirildi","ok"); loadCategories(); }
    catch(e){ toast(e.message,"err"); }
  });
}

/* ============================================================
   FOYDALANUVCHILAR
   ============================================================ */
async function loadUsers(){
  pageLoader("Foydalanuvchilar yuklanmoqda…");
  try{
    const users = await api("/admin/users?page=1&page_size=100");
    let body;
    if(!users.length){ body = emptyBox("👥","Foydalanuvchi yo'q","Botdan kim foydalansa, shu yerda ko'rinadi."); }
    else body = users.map(u=>{
      const name = [u.first_name,u.last_name].filter(Boolean).join(" ") || "Foydalanuvchi";
      const uname = u.username?`@${esc(u.username)}`:`ID ${u.telegram_id}`;
      return `<div class="lc"><div class="lc-top">
        <div><div class="lc-id">${esc(name)}</div><div class="lc-sub">${uname}${u.phone?" · "+esc(u.phone):""}</div></div>
        <div style="text-align:right"><div class="lc-total">${u.orders_count}</div><div class="lc-sub">buyurtma</div></div></div>
        <div class="lc-meta"><span><b>💸</b> ${money(u.total_spent)} sarflagan</span>
        ${u.is_blocked?`<span class="pill canceled" style="font-size:11px">Bloklangan</span>`:""}</div></div>`;
    }).join("");
    setPage(`<h1 class="page-title">Foydalanuvchilar <span style="font-size:15px;color:var(--muted);font-family:Inter">${users.length}</span></h1>${body}`);
  }catch(e){ setPage(errBox(e)); }
}

/* ============================================================
   TO'LOVLAR
   ============================================================ */
async function loadPayments(){
  const chips = [["","Barchasi"],...Object.entries(PAY_STATUS).map(([k,v])=>[k,v])];
  const chipsHtml = chips.map(([k,l])=>`<div class="chip ${S.payFilter===k?'active':''}" onclick="setPayFilter('${k}')">${esc(l)}</div>`).join("");
  setPage(`<h1 class="page-title">To'lovlar</h1><div class="chips">${chipsHtml}</div><div id="payList"><div class="loader"><div class="spinner"></div></div></div>`);
  try{
    const q = S.payFilter?`?status=${S.payFilter}&`:"?";
    const list = await api(`/admin/payments${q}page=1&page_size=80`);
    const el = document.getElementById("payList");
    if(!list.length){ el.innerHTML = emptyBox("💳","To'lov yo'q","Bu bo'limda hozircha to'lovlar yo'q."); return; }
    el.innerHTML = list.map(p=>`<div class="lc"><div class="lc-top">
      <div><div class="lc-id">${PROVIDER[p.provider]||p.provider}</div>
        <div class="lc-sub">${timeAgo(p.created_at)}${p.provider_txn_id?" · "+esc(p.provider_txn_id):""}</div></div>
      <div style="text-align:right"><div class="lc-total">${moneyShort(p.amount_uzs)}</div>
        <div style="margin-top:5px"><span class="pill ${p.status}">${PAY_STATUS[p.status]||p.status}</span></div></div></div>
      ${p.crypto_currency?`<div class="lc-sub" style="margin-top:8px">${p.amount_crypto} ${esc(p.crypto_currency)}</div>`:""}</div>`).join("");
  }catch(e){ document.getElementById("payList").innerHTML = errBox(e); }
}
function setPayFilter(f){ S.payFilter=f; haptic("light"); loadPayments(); }

/* ============================================================
   BOSHQA (menyu)
   ============================================================ */
function loadMore(){
  const item = (icon,title,sub,onclick,soon)=>`
    <div class="lc" style="margin-bottom:10px;${soon?'opacity:.65':''}" ${soon?'':`onclick="${onclick}"`}>
      <div class="pr">
        <div class="pr-img" style="font-size:24px;background:var(--pink-soft)">${icon}</div>
        <div class="pr-body"><div class="pr-name">${title}${soon?` <span class="pill muted" style="font-size:10px">Tez orada</span>`:""}</div>
          <div class="lc-sub">${sub}</div></div>
        <div style="font-size:20px;color:var(--muted)">${soon?"":"›"}</div>
      </div></div>`;
  setPage(`
    <h1 class="page-title">Boshqa</h1>
    <div class="section-label" style="margin-left:4px">Katalog</div>
    ${item("🗂","Kategoriyalar","Mahsulot guruhlarini boshqarish","go('categories')")}
    ${item("📦","Katalog import","50+ mahsulotni bir marta qo'shish","go('import')")}
    <div class="section-label" style="margin-left:4px">Mijozlar va to'lovlar</div>
    ${item("👥","Foydalanuvchilar","Mijozlar ro'yxati va statistikasi","go('users')")}
    ${item("💳","To'lovlar","To'lovlar tarixi va holatlari","go('payments')")}
    <div class="section-label" style="margin-left:4px">Tez orada qo'shiladi</div>
    ${item("📣","Ommaviy xabar","Barcha mijozlarga xabar yuborish","",true)}
    ${item("🏷","Chegirmalar","Promo-kod va aksiyalar","",true)}
    ${item("⚙️","To'lov turlari","Payme/Click/Uzum yoqish-o'chirish","",true)}
    <div style="text-align:center;color:var(--muted);font-size:12px;margin-top:24px;line-height:1.6">
      Mondo Cono Ice Creams · Admin<br>${S.me?esc([S.me.first_name,S.me.last_name].filter(Boolean).join(" ")):""}
    </div>
  `);
}

/* ============================================================
   KATALOG IMPORT (bir martalik ommaviy qo'shish)
   ============================================================ */
const CATALOG = [
  { c:{name_uz:"Eskimo", name_ru:"Эскимо", emoji:"🍫"}, p:[
    {name_uz:"Mondo Dubai Pistachio (110g)", name_ru:"Mondo Dubai фисташка (110г)", emoji:"🟢", badge:"Hit"},
    {name_uz:"Mondo Coconut Choco", name_ru:"Mondo Coconut Choco", emoji:"🥥"},
    {name_uz:"Mondo Eskimo Lemon", name_ru:"Mondo Эскимо Лимон", emoji:"🍋"},
    {name_uz:"Mondo Eskimo Chocolate", name_ru:"Mondo Эскимо Шоколад", emoji:"🍫"},
    {name_uz:"Mondo Eskimo Vanilla", name_ru:"Mondo Эскимо Ваниль", emoji:"🤍"},
    {name_uz:"Mondo Eskimo Berry", name_ru:"Mondo Эскимо Ягодный", emoji:"🫐"},
    {name_uz:"Mondo Eskimo Mango", name_ru:"Mondo Эскимо Манго", emoji:"🥭"},
    {name_uz:"Mondo Eskimo Passion Fruit", name_ru:"Mondo Эскимо Маракуйя", emoji:"🍐"},
  ]},
  { c:{name_uz:"Sorbet / Muzli", name_ru:"Сорбет / Лёд", emoji:"🧊"}, p:[
    {name_uz:"CONO Sorbet Lemon", name_ru:"CONO Сорбет Лимон", emoji:"🍋"},
    {name_uz:"CONO Sorbet Mango", name_ru:"CONO Сорбет Манго", emoji:"🥭"},
    {name_uz:"CONO Sorbet Passion Fruit", name_ru:"CONO Сорбет Маракуйя", emoji:"🍐"},
    {name_uz:"CONO Sorbet Melon (Qovun)", name_ru:"CONO Сорбет Дыня", emoji:"🍈"},
    {name_uz:"CONO Sorbet Bubble Gum", name_ru:"CONO Сорбет Бабл Гам", emoji:"🩷"},
    {name_uz:"CONO Sorbet Tutti Frutti", name_ru:"CONO Сорбет Тутти Фрутти", emoji:"🌈"},
    {name_uz:"CONO Sorbet Apelsin", name_ru:"CONO Сорбет Апельсин", emoji:"🍊"},
    {name_uz:"CONO Sorbet Cola", name_ru:"CONO Сорбет Кола", emoji:"🥤"},
    {name_uz:"CONO Sorbet Klubnika", name_ru:"CONO Сорбет Клубника", emoji:"🍓"},
    {name_uz:"CONO Sorbet Barbie", name_ru:"CONO Сорбет Барби", emoji:"💗"},
    {name_uz:"Mondo Sorbet Limone (50g)", name_ru:"Mondo Сорбет Лимон (50г)", emoji:"🍋"},
    {name_uz:"Mondo Sorbet Mango (50g)", name_ru:"Mondo Сорбет Манго (50г)", emoji:"🥭"},
    {name_uz:"Mondo Sorbet Passion Fruit (50g)", name_ru:"Mondo Сорбет Маракуйя (50г)", emoji:"🍐"},
  ]},
  { c:{name_uz:"Stakanchik 150g", name_ru:"Стаканчик 150г", emoji:"🍨"}, p:[
    {name_uz:"Mondo Banana 150g", name_ru:"Mondo Банан 150г", emoji:"🍌"},
    {name_uz:"Mondo Forest Berries 150g", name_ru:"Mondo Лесные ягоды 150г", emoji:"🫐"},
    {name_uz:"Mondo Strawberry 150g", name_ru:"Mondo Клубника 150г", emoji:"🍓"},
    {name_uz:"Mondo Vanilla 150g", name_ru:"Mondo Ваниль 150г", emoji:"🤍"},
    {name_uz:"Mondo Chocolate 150g", name_ru:"Mondo Шоколад 150г", emoji:"🍫"},
  ]},
  { c:{name_uz:"Vanna 500g", name_ru:"Ванна 500г", emoji:"🥡"}, p:[
    {name_uz:"Mondo Vanilla 500g", name_ru:"Mondo Ваниль 500г", emoji:"🤍"},
    {name_uz:"Mondo Forest Berries 500g", name_ru:"Mondo Лесные ягоды 500г", emoji:"🫐"},
    {name_uz:"Mondo Banana 500g", name_ru:"Mondo Банан 500г", emoji:"🍌"},
    {name_uz:"Mondo Chocolate 500g", name_ru:"Mondo Шоколад 500г", emoji:"🍫"},
    {name_uz:"Mondo Plombir sliv. 500g", name_ru:"Mondo Пломбир сливочный 500г", emoji:"🍦"},
    {name_uz:"Mondo Plombir Chocolate 500g", name_ru:"Mondo Пломбир шоколадный 500г", emoji:"🍫"},
    {name_uz:"Mondo Sorbet Limone 120g", name_ru:"Mondo Сорбет Лимон 120г", emoji:"🍋"},
    {name_uz:"Mondo Sorbet Mango 120g", name_ru:"Mondo Сорбет Манго 120г", emoji:"🥭"},
    {name_uz:"Mondo Sorbet Passion Fruit 120g", name_ru:"Mondo Сорбет Маракуйя 120г", emoji:"🍐"},
  ]},
  { c:{name_uz:"Family 1000g", name_ru:"Семейный 1000г", emoji:"👨‍👩‍👧"}, p:[
    {name_uz:"Dilkash Sliv. 1000g", name_ru:"Dilkash Сливочное 1000г", emoji:"🤍"},
    {name_uz:"Dilkash Klubnika 1000g", name_ru:"Dilkash Клубника 1000г", emoji:"🍓"},
    {name_uz:"Dilkash Banan 1000g", name_ru:"Dilkash Банан 1000г", emoji:"🍌"},
    {name_uz:"Dilkash Shokolad 1000g", name_ru:"Dilkash Шоколад 1000г", emoji:"🍫"},
  ]},
  { c:{name_uz:"To'plam / Quti", name_ru:"Набор / Коробка", emoji:"🎁"}, p:[
    {name_uz:"Mondo Sorbet Limone (10 dona)", name_ru:"Mondo Сорбет Лимон (10шт)", emoji:"🍋"},
    {name_uz:"Mondo Sorbet Mango (10 dona)", name_ru:"Mondo Сорбет Манго (10шт)", emoji:"🥭"},
    {name_uz:"Mondo Sorbet Passion Fruit (10 dona)", name_ru:"Mondo Сорбет Маракуйя (10шт)", emoji:"🍐"},
    {name_uz:"CONO Fruity Pop", name_ru:"CONO Fruity Pop", emoji:"🍬", badge:"Yangi"},
    {name_uz:"CONO Bon Bon Klubnika", name_ru:"CONO Bon Bon Клубника", emoji:"🍓"},
    {name_uz:"CONO Bon Bon Banan", name_ru:"CONO Bon Bon Банан", emoji:"🍌"},
    {name_uz:"CONO Bon Bon Shokolad", name_ru:"CONO Bon Bon Шоколад", emoji:"🍫"},
    {name_uz:"CONO Bon Bon Pista", name_ru:"CONO Bon Bon Фисташка", emoji:"🟢"},
    {name_uz:"CONO Bon Bon Kokos", name_ru:"CONO Bon Bon Кокос", emoji:"🥥"},
  ]},
  { c:{name_uz:"Maxsus desert", name_ru:"Спец. десерт", emoji:"🍰"}, p:[
    {name_uz:"CONO Can (desert muzqaymoq)", name_ru:"CONO Can (десертное)", emoji:"🥫"},
    {name_uz:"CONO The Cake (tort-muzqaymoq)", name_ru:"CONO The Cake (торт)", emoji:"🍰"},
    {name_uz:"CONO KFC (vafli kroshka)", name_ru:"CONO KFC (вафельная крошка)", emoji:"🍗"},
  ]},
  { c:{name_uz:"Ichimlik", name_ru:"Напитки", emoji:"🥤"}, p:[
    {name_uz:"CONO Life Qulupnay", name_ru:"CONO Life Клубника", emoji:"🍓"},
    {name_uz:"CONO Life Mango", name_ru:"CONO Life Манго", emoji:"🥭"},
    {name_uz:"CONO Life Shaftoli", name_ru:"CONO Life Персик", emoji:"🍑"},
  ]},
  { c:{name_uz:"Shirinliklar", name_ru:"Сладости", emoji:"🍬"}, p:[
    {name_uz:"Uzbekistan O'rik + pista", name_ru:"Uzbekistan Абрикос с фисташками", emoji:"🟢"},
    {name_uz:"Uzbekistan O'rik + bodom", name_ru:"Uzbekistan Абрикос с миндалём", emoji:"🤎"},
    {name_uz:"Uzbekistan Qoqi + bodom", name_ru:"Uzbekistan Чернослив с миндалём", emoji:"🟤"},
    {name_uz:"Uzbekistan Qoqi + yong'oq", name_ru:"Uzbekistan Чернослив с грецким орехом", emoji:"🌰"},
  ]},
];

function loadImport(){
  let total = 0;
  const blocks = CATALOG.map((blk,ci)=>{
    const rows = blk.p.map((pr,pi)=>{
      total++;
      return `<div class="imp-row" data-imp data-ci="${ci}" data-pi="${pi}">
        <input type="checkbox" class="imp-check" checked>
        <span class="imp-emoji">${pr.emoji||"🍦"}</span>
        <span class="imp-name">${esc(pr.name_uz)}</span>
        <input type="number" inputmode="numeric" class="imp-price" placeholder="narx">
      </div>`;
    }).join("");
    return `<div class="panel" style="padding:13px 14px">
      <h3 style="margin-bottom:9px">${blk.c.emoji} ${esc(blk.c.name_uz)} <span style="font-size:12px;color:var(--muted);font-weight:500;font-family:Inter">${blk.p.length} ta</span></h3>
      ${rows}</div>`;
  }).join("");

  setPage(`
    <h1 class="page-title">Katalog import</h1>
    <div class="panel" style="background:var(--cone-soft);box-shadow:none">
      <div style="font-size:13px;line-height:1.6;color:#7A5C1E">
        <b>Bir marta bosib</b> butun katalogni qo'shing. Har mahsulotga narx kiriting (so'mda).
        Narxsiz qoldirsangiz — <b>qoralama</b> (yashirin) bo'lib qo'shiladi, keyin tahrirlab faollashtirasiz.
        Belgini olib tashlab, kerakmas mahsulotni o'tkazib yuborishingiz mumkin.
      </div>
    </div>
    ${blocks}
    <button class="btn primary block" style="margin-top:8px;position:sticky;bottom:96px" onclick="runImport()">
      ⬇️ Tanlanganlarni import qilish
    </button>
    <div style="height:10px"></div>
  `);
}

async function runImport(){
  const rows = [...document.querySelectorAll('.imp-row')]
    .filter(r=>r.querySelector('.imp-check').checked)
    .map(r=>({ ci:+r.dataset.ci, pi:+r.dataset.pi, price:parseInt(r.querySelector('.imp-price').value||"0",10) }));
  if(!rows.length){ toast("Hech narsa tanlanmadi","err"); return; }

  haptic("medium");
  openModal(`<h2>Import qilinyapti…</h2>
    <p class="modal-sub">Iltimos kuting, oynani yopmang.</p>
    <div style="background:var(--cream);border-radius:12px;overflow:hidden;height:10px;margin:14px 0">
      <div id="impBar" style="height:100%;width:0;background:var(--pink);transition:width .2s"></div></div>
    <div id="impStatus" style="font-size:13px;color:var(--muted);text-align:center">Tayyorlanmoqda…</div>`);
  const setBar=(p,t)=>{ const b=document.getElementById("impBar"); if(b)b.style.width=p+"%"; const s=document.getElementById("impStatus"); if(s)s.textContent=t; };

  let cats, prods;
  try{ [cats,prods] = await Promise.all([api("/admin/categories"), api("/admin/products")]); }
  catch(e){ closeModal(); toast(e.message,"err"); return; }

  const norm = s => s.toLowerCase().trim();
  const catByName = {}; cats.forEach(c=>catByName[norm(c.name_uz)]=c.id);
  const existProd = new Set(prods.map(p=>norm(p.name_uz)));

  // kerakli kategoriyalar
  const neededCats = [...new Set(rows.map(r=>r.ci))];
  let done=0, created=0, drafts=0, skipped=0, failed=0;
  const totalSteps = neededCats.length + rows.length;

  // 1) kategoriyalarni yaratamiz
  for(const ci of neededCats){
    const c = CATALOG[ci].c;
    if(!catByName[norm(c.name_uz)]){
      try{
        const nc = await api("/admin/categories",{method:"POST",body:{...c, sort_order:ci, is_active:true}});
        catByName[norm(c.name_uz)] = nc.id;
      }catch(e){ /* ehtimol mavjud */ }
    }
    done++; setBar(Math.round(done/totalSteps*100), `Kategoriyalar: ${c.name_uz}`);
  }

  // 2) mahsulotlarni yaratamiz
  for(const r of rows){
    const blk = CATALOG[r.ci]; const pr = blk.p[r.pi];
    done++; setBar(Math.round(done/totalSteps*100), `Qo'shilyapti: ${pr.name_uz}`);
    if(existProd.has(norm(pr.name_uz))){ skipped++; continue; }
    const catId = catByName[norm(blk.c.name_uz)];
    if(!catId){ failed++; continue; }
    const active = r.price>0;
    try{
      await api("/admin/products",{method:"POST",body:{
        category_id:catId, name_uz:pr.name_uz, name_ru:pr.name_ru,
        price:r.price||0, stock:100, emoji:pr.emoji||"🍦",
        badge:pr.badge||null, is_active:active,
      }});
      if(active) created++; else drafts++;
    }catch(e){ failed++; }
  }

  closeModal(); notify("success");
  openModal(`<h2>✅ Import tugadi!</h2>
    <div style="margin:10px 0 18px;font-size:14px;line-height:1.9">
      🟢 Faol qo'shildi: <b>${created}</b><br>
      📝 Qoralama (narxsiz): <b>${drafts}</b><br>
      ⏭ O'tkazib yuborildi (mavjud): <b>${skipped}</b><br>
      ${failed?`❌ Xato: <b>${failed}</b><br>`:""}
    </div>
    <p class="modal-sub">Qoralama mahsulotlarga narx + rasm qo'shib, "Faol" qiling — shunda do'konda ko'rinadi.</p>
    <button class="btn primary block" onclick="closeModal();go('products')">Mahsulotlarga o'tish</button>`);
}
