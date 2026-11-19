/* GradeSwap marketplace — single-page app on Supabase. No build step. */
(() => {
"use strict";

const cfg = window.GRADESWAP_CONFIG || {};
const LIVE = !!(cfg.SUPABASE_URL && !cfg.SUPABASE_URL.startsWith("YOUR") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.startsWith("YOUR") && window.supabase);
const sb = LIVE ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } }) : null;
const SELLER_SHARE = cfg.SELLER_SHARE || 0.9;
const BUCKET = "listing-photos";
const MAX_PHOTOS = 4;

const GRADES = ["PP1","PP2","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6","Grade 7","Grade 8","Grade 9","Grade 10","Grade 11","Grade 12","Form 4"];
const CONDITIONS = ["Like new","Good — some writing","Fair — well used but complete"];
const STATUS_LABEL = { available: "Available", reserved: "Reserved", sold: "Sold" };
const SAFE_SPOTS = ["Supermarket entrance", "Shopping mall", "School gate", "Police station front", "Busy matatu stage", "Petrol station"];
const SAFETY_TEXT = "For your safety, keep all chats and payments in GradeSwap. Never pay a seller directly or share your M-Pesa PIN, and meet in a busy public place during the day.";

const app = document.getElementById("app");
let session = null;
let chatChannel = null;
let me = null; // { lat, lng } once the visitor allows location

/* ---------- helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const kes = n => "KES " + Number(n || 0).toLocaleString("en-KE");
const waLink = text => `https://wa.me/${cfg.WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
const mapsAt = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
const mapsSearch = q => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const mapsDirections = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
const opts = (list, sel, blank) => (blank ? `<option value="">${esc(blank)}</option>` : "") +
  list.map(v => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(v)}</option>`).join("");
const firstName = s => String(s || "").trim().split(/\s+/)[0].slice(0, 40) || "Parent";
const myName = () => firstName(session?.user?.user_metadata?.full_name || session?.user?.email?.split("@")[0]);
const timeAgo = iso => {
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return Math.round(d / 60) + " min ago";
  if (d < 86400) return Math.round(d / 3600) + " h ago";
  const days = Math.round(d / 86400);
  return days === 1 ? "yesterday" : days + " days ago";
};
const clock = iso => new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
const when = iso => new Date(iso).toLocaleString("en-KE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ref = () => "GS-" + Math.random().toString(36).slice(2, 7).toUpperCase();
// Phone numbers and long number strings (tills, paybills) are hidden in chat so deals stay safe inside GradeSwap.
const PHONE_RE = /(?:\+?254|0)\s?[17]\d{2}[\s-]?\d{3}[\s-]?\d{3}|\b\d{5,}\b/g;
const hasContact = s => { PHONE_RE.lastIndex = 0; return PHONE_RE.test(s); };
const maskContacts = s => String(s).replace(PHONE_RE, "•••• (hidden for safety)");
const round = n => Math.round(n * 100) / 100; // about 1 km
function km(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const distLabel = l => (me && l.lat != null && l.lng != null) ? `≈ ${Math.max(1, Math.round(km(me, l)))} km away` : "";
function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Location isn't available on this device."));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => reject(new Error("We couldn't get your location. Check that location is allowed for this site.")),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 3400);
}
function parseHash() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = h.split("?");
  return { parts: path.split("/").filter(Boolean), q: Object.fromEntries(new URLSearchParams(qs || "")) };
}
const cover = l => `<div class="cover"><span>${esc(l.title)}</span><small>${esc(l.grade)}</small></div>`;
const thumbHTML = l => (l.photos && l.photos[0]) ? `<img src="${esc(l.photos[0])}" alt="" loading="lazy">` : cover(l);
const safetyNote = (extra = "") => `<div class="safety ${extra}" role="note"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg><p>${SAFETY_TEXT}</p></div>`;
const pinIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>`;
function validate(form) {
  let first = null;
  form.querySelectorAll("[required]").forEach(el => {
    const err = form.querySelector(`#${el.id}-err`);
    let msg = "";
    if (!el.value.trim()) msg = "Please fill this in.";
    else if (el.type === "number" && (+el.value < 1)) msg = "Enter a price above 0.";
    else if (el.dataset.phone && !/^(\+?254|0)[17]\d{8}$/.test(el.value.replace(/\s/g, ""))) msg = "Enter a Kenyan phone number, e.g. 0712 345 678.";
    if (err) err.textContent = msg;
    el.setAttribute("aria-invalid", msg ? "true" : "false");
    if (msg && !first) first = el;
  });
  if (first) first.focus();
  return !first;
}
function clearOnInput(form) {
  form.addEventListener("input", e => {
    const err = form.querySelector(`#${e.target.id}-err`);
    if (err) err.textContent = "";
    e.target.removeAttribute("aria-invalid");
  });
}

/* ---------- sample data for preview mode ---------- */
const DAY = 86400000;
const AREAS = { Rongai: [-1.40, 36.76], Ruaka: [-1.21, 36.78], Kitengela: [-1.48, 36.96], Syokimau: [-1.37, 36.93] };
const demo = {
  user: { id: "demo-user", email: "you@example.com", user_metadata: { full_name: "Sample Parent" } },
  listings: [
    ["Primary Mathematics", "Grade 5", "Riverside Academy", "Rongai", "Good — some writing", 450, "demo-user", "Sample"],
    ["English Activities", "Grade 5", "Riverside Academy", "Rongai", "Like new", 500, "seller-2", "Wanjiru"],
    ["Kiswahili Mufti", "Grade 4", "Hillcrest Primary", "Ruaka", "Good — some writing", 380, "seller-3", "Otieno"],
    ["Integrated Science", "Grade 7", "Sunrise School", "Kitengela", "Like new", 650, "seller-2", "Wanjiru"],
    ["Social Studies", "Grade 6", "Hillcrest Primary", "Ruaka", "Fair — well used but complete", 250, "seller-3", "Otieno"],
    ["Creative Arts", "Grade 3", "Riverside Academy", "Rongai", "Good — some writing", 300, "seller-4", "Achieng"],
    ["Pre-Technical Studies", "Grade 8", "Sunrise School", "Kitengela", "Like new", 700, "seller-4", "Achieng"],
    ["Language Activities", "PP2", "Little Stars", "Syokimau", "Good — some writing", 200, "seller-3", "Otieno"]
  ].map((r, i) => ({ id: "demo-" + (i + 1), title: r[0] + " " + r[1], publisher: "Sample Publishers", grade: r[1], school: r[2], area: r[3],
    condition: r[4], price: r[5], seller_id: r[6], seller_name: r[7], lat: AREAS[r[3]][0], lng: AREAS[r[3]][1],
    description: "Sample listing to show how GradeSwap looks.", photos: [], status: i === 5 ? "sold" : "available",
    created_at: new Date(Date.now() - (i + 1) * DAY / 3).toISOString(), sample: true })),
  phone: "",
  conversations: [],
  messages: []
};
// One sample chat where another parent is asking about your book.
demo.conversations.push({ id: "conv-1", listing_id: "demo-1", buyer_id: "buyer-9", seller_id: "demo-user", buyer_name: "Mercy", seller_name: "Sample",
  last_message: "Hi, is this still available?", last_sender: "buyer-9", last_message_at: new Date(Date.now() - 20 * 60000).toISOString(),
  buyer_last_read: new Date().toISOString(), seller_last_read: new Date(0).toISOString() });
demo.messages.push({ id: "m-1", conversation_id: "conv-1", sender_id: "buyer-9", kind: "text", body: "Hi, is this still available?", created_at: new Date(Date.now() - 20 * 60000).toISOString() });

/* ---------- data layer ---------- */
const withListing = c => ({ ...c, listing: c.listings || demo.listings.find(l => l.id === c.listing_id) || {} });
const db = {
  async search({ q = "", grade = "", school = "", area = "" }) {
    if (!LIVE) {
      const has = (v, s) => !s || (v || "").toLowerCase().includes(s.toLowerCase());
      return demo.listings.filter(l => l.status !== "sold" && (!grade || l.grade === grade) && has(l.school, school) && has(l.area, area) &&
        (has(l.title, q) || has(l.publisher, q)));
    }
    const clean = s => s.replace(/[%,()*]/g, " ").trim();
    let qy = sb.from("listings").select("*").in("status", ["available", "reserved"]).order("created_at", { ascending: false }).limit(60);
    if (grade) qy = qy.eq("grade", grade);
    if (clean(school)) qy = qy.ilike("school", `%${clean(school)}%`);
    if (clean(area)) qy = qy.ilike("area", `%${clean(area)}%`);
    if (clean(q)) qy = qy.or(`title.ilike.%${clean(q)}%,publisher.ilike.%${clean(q)}%`);
    const { data, error } = await qy;
    if (error) throw error;
    return data;
  },
  async get(id) {
    if (!LIVE) return demo.listings.find(l => l.id === id) || null;
    const { data, error } = await sb.from("listings").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async mine() {
    if (!LIVE) return demo.listings.filter(l => l.seller_id === "demo-user");
    const { data, error } = await sb.from("listings").select("*").eq("seller_id", session.user.id).order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },
  async create(row, files) {
    if (!LIVE) {
      const l = { ...row, id: "demo-" + Date.now(), seller_id: "demo-user", status: "available", created_at: new Date().toISOString(),
        photos: files.map(f => URL.createObjectURL(f)), sample: true };
      demo.listings.unshift(l);
      return l;
    }
    const photos = [];
    for (const f of files) {
      const blob = await shrink(f);
      const path = `${session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      photos.push(sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
    }
    const { data, error } = await sb.from("listings").insert({ ...row, seller_id: session.user.id, photos }).select().single();
    if (error) throw error;
    return data;
  },
  async setStatus(id, status) {
    if (!LIVE) { demo.listings.find(l => l.id === id).status = status; return; }
    const { error } = await sb.from("listings").update({ status }).eq("id", id);
    if (error) throw error;
  },
  async remove(l) {
    if (!LIVE) { demo.listings = demo.listings.filter(x => x.id !== l.id); return; }
    const paths = (l.photos || []).map(u => u.split(`/${BUCKET}/`)[1]).filter(Boolean);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    const { error } = await sb.from("listings").delete().eq("id", l.id);
    if (error) throw error;
  },
  async getPhone() {
    if (!LIVE) return demo.phone;
    const { data } = await sb.from("seller_contacts").select("phone").eq("user_id", session.user.id).maybeSingle();
    return data ? data.phone : "";
  },
  async savePhone(phone) {
    if (!LIVE) { demo.phone = phone; return; }
    const { error } = await sb.from("seller_contacts").upsert({ user_id: session.user.id, phone, display_name: session.user.user_metadata?.full_name || session.user.email });
    if (error) throw error;
  },
  async order(row) {
    if (!LIVE) return;
    const { error } = await sb.from("orders").insert(row);
    if (error) throw error;
  },

  /* chat */
  async startChat(l) {
    const uid = session.user.id;
    if (!LIVE) {
      let c = demo.conversations.find(x => x.listing_id === l.id && x.buyer_id === uid);
      if (!c) {
        c = { id: "conv-" + Date.now(), listing_id: l.id, buyer_id: uid, seller_id: l.seller_id, buyer_name: myName(), seller_name: l.seller_name,
          last_message: null, last_sender: null, last_message_at: new Date().toISOString(), buyer_last_read: new Date().toISOString(), seller_last_read: new Date(0).toISOString() };
        demo.conversations.unshift(c);
      }
      return c.id;
    }
    const found = await sb.from("conversations").select("id").eq("listing_id", l.id).eq("buyer_id", uid).maybeSingle();
    if (found.error) throw found.error;
    if (found.data) return found.data.id;
    const { data, error } = await sb.from("conversations")
      .insert({ listing_id: l.id, buyer_id: uid, seller_id: l.seller_id, buyer_name: myName(), seller_name: l.seller_name || "Seller" })
      .select("id").single();
    if (error) throw error;
    return data.id;
  },
  async chats() {
    if (!LIVE) return demo.conversations.filter(c => [c.buyer_id, c.seller_id].includes(session.user.id) && (c.last_message || c.buyer_id === session.user.id))
      .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at)).map(withListing);
    const { data, error } = await sb.from("conversations").select("*, listings(id, title, grade, price, photos, status, area, lat, lng)").order("last_message_at", { ascending: false });
    if (error) throw error;
    return data.filter(c => c.last_message || c.buyer_id === session.user.id).map(withListing);
  },
  async chat(id) {
    if (!LIVE) { const c = demo.conversations.find(x => x.id === id); return c ? withListing(c) : null; }
    const { data, error } = await sb.from("conversations").select("*, listings(id, title, grade, price, photos, status, area, lat, lng, seller_id)").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? withListing(data) : null;
  },
  async messages(id) {
    if (!LIVE) return demo.messages.filter(m => m.conversation_id === id);
    const { data, error } = await sb.from("messages").select("*").eq("conversation_id", id).order("created_at").limit(500);
    if (error) throw error;
    return data;
  },
  async send(c, msg) {
    if (!LIVE) {
      const m = { id: "m-" + Date.now(), conversation_id: c.id, sender_id: session.user.id, created_at: new Date().toISOString(), ...msg };
      demo.messages.push(m);
      Object.assign(demo.conversations.find(x => x.id === c.id), { last_message: msg.kind === "meetup" ? "Meetup: " + msg.place : msg.kind === "location" ? "Shared a location" : msg.body,
        last_sender: session.user.id, last_message_at: m.created_at });
      return m;
    }
    const { data, error } = await sb.from("messages").insert({ conversation_id: c.id, ...msg }).select().single();
    if (error) throw error;
    return data;
  },
  async markRead(c) {
    const col = c.buyer_id === session.user.id ? "buyer_last_read" : "seller_last_read";
    const now = new Date().toISOString();
    if (!LIVE) { const x = demo.conversations.find(k => k.id === c.id); if (x) x[col] = now; return; }
    await sb.from("conversations").update({ [col]: now }).eq("id", c.id);
  }
};
const isUnread = c => {
  if (!session || !c.last_sender || c.last_sender === session.user.id) return false;
  const mine = c.buyer_id === session.user.id ? c.buyer_last_read : c.seller_last_read;
  return new Date(c.last_message_at) > new Date(mine);
};

// Resize photos in the browser so uploads stay small on mobile data.
function shrink(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => b ? resolve(b) : reject(new Error("Could not read photo")), "image/jpeg", 0.8);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error("Could not read photo"));
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- auth + nav ---------- */
async function signIn(returnTo) {
  if (!LIVE) { session = { user: demo.user }; updateNav(); router(); toast("Preview: signed in as a sample parent"); return; }
  try { sessionStorage.setItem("gs-return", returnTo); } catch (e) { /* storage blocked: fall back to home */ }
  const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
  if (error) toast("Sign-in failed. Please try again.");
}
async function signOut() {
  if (LIVE) await sb.auth.signOut();
  session = null; updateNav(); location.hash = "#/";
}
function updateNav() {
  document.getElementById("nav-account").textContent = session ? "My listings" : "Sign in";
  document.getElementById("nav-chats").hidden = !session;
  refreshUnread();
}
async function refreshUnread() {
  const dot = document.getElementById("chat-dot");
  if (!session) { dot.hidden = true; return; }
  try { const list = await db.chats(); dot.hidden = !list.some(isUnread); } catch (e) { dot.hidden = true; }
}
function signInCard(title, text, returnTo) {
  app.innerHTML = `<div class="container page"><div class="panel center-card">
    <svg width="64" height="64" aria-hidden="true"><use href="#gs-mark"/></svg>
    <h1>${esc(title)}</h1><p class="sub" style="margin:0 auto 24px">${esc(text)}</p>
    <button class="btn btn-google btn-block" id="google">
      <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
      Continue with Google</button>
    <p class="meta" style="margin-top:16px">We only use your name and email. Your phone number is never shown to other parents.</p>
  </div></div>`;
  document.getElementById("google").onclick = () => signIn(returnTo);
}

/* ---------- views ---------- */
async function viewHome(q) {
  app.innerHTML = `
  <section class="search-hero"><div class="container">
    <h1>Used school books, <em>matched to your school and grade.</em></h1>
    <p>Chat with sellers, meet safely, and pay through GradeSwap with M-Pesa.</p>
    <form class="search" id="search" role="search">
      <div class="q"><label class="sr-only" for="q">Book title or publisher</label><input id="q" name="q" placeholder="Book title or publisher" value="${esc(q.q)}"></div>
      <div><label class="sr-only" for="grade">Grade</label><select id="grade" name="grade">${opts(GRADES, q.grade, "Any grade")}</select></div>
      <div><label class="sr-only" for="school">School</label><input id="school" name="school" placeholder="School" value="${esc(q.school)}"></div>
      <div class="area"><label class="sr-only" for="area">Area</label><input id="area" name="area" placeholder="Area, e.g. Rongai" value="${esc(q.area)}"></div>
      <button class="btn btn-amber" type="submit">Search</button>
    </form>
  </div></section>
  <div class="container">
    <div class="results-head"><h2 id="res-title">Latest books</h2>
      <div class="results-tools"><p id="res-count"></p><button class="btn btn-outline btn-sm" id="near" type="button">${pinIcon}<span>${me ? "Nearest first" : "Near me"}</span></button></div></div>
    <div id="results" class="loading">Loading books…</div>
  </div>`;
  document.getElementById("search").onsubmit = e => {
    e.preventDefault();
    const p = new URLSearchParams([...new FormData(e.target)].filter(([, v]) => v.trim()));
    location.hash = "#/" + (p.toString() ? "?" + p : "");
  };
  if (q.q || q.grade || q.school || q.area) document.getElementById("res-title").textContent = "Search results";
  const box = document.getElementById("results");
  let list = [];
  function render() {
    const sorted = me ? [...list].sort((a, b) => ((a.lat == null) - (b.lat == null)) || (a.lat == null ? 0 : km(me, a) - km(me, b))) : list;
    box.className = "grid";
    box.innerHTML = sorted.map(l => `
      <a class="card-link" href="#/book/${esc(l.id)}">
        <div class="thumb">${thumbHTML(l)}${l.status === "reserved" ? '<span class="badge">Reserved</span>' : ""}${l.sample ? '<span class="badge sample">Sample</span>' : ""}</div>
        <div class="card-body">
          <span class="price">${kes(l.price)}</span>
          <h3 class="card-title">${esc(l.title)}</h3>
          <p class="meta">${esc(l.school)} · ${esc(l.area)}</p>
          <div class="chips"><span class="chip">${esc(l.grade)}</span><span class="chip">${esc(l.condition.split(" —")[0])}</span></div>
          <p class="meta" style="margin-top:6px">${distLabel(l) ? `<strong class="dist">${distLabel(l)}</strong> · ` : ""}${timeAgo(l.created_at)}</p>
        </div>
      </a>`).join("");
  }
  document.getElementById("near").onclick = async e => {
    const b = e.currentTarget;
    try { me = await locate(); b.querySelector("span").textContent = "Nearest first"; if (list.length) render(); toast("Showing books nearest to you"); }
    catch (err) { toast(err.message); }
  };
  try {
    list = await db.search(q);
    document.getElementById("res-count").textContent = list.length ? `${list.length} book${list.length > 1 ? "s" : ""}` : "";
    if (!list.length) {
      box.className = "";
      box.innerHTML = `<div class="empty"><h3>No books match yet</h3><p>New books are listed every day. Tell us your list and we'll find them for you.</p>
        <a class="btn btn-navy" target="_blank" rel="noopener" href="${waLink(`Hi GradeSwap! I'm looking for books.\nGrade: ${q.grade || ""}\nSchool: ${q.school || ""}\nArea: ${q.area || ""}\nBook: ${q.q || ""}`)}">Ask us on WhatsApp</a></div>`;
      return;
    }
    render();
  } catch (err) {
    console.error(err);
    box.className = "";
    box.innerHTML = `<div class="empty"><h3>We couldn't load books</h3><p>Check your connection and try again.</p></div>`;
  }
}

async function viewBook(id) {
  app.innerHTML = `<div class="loading">Loading…</div>`;
  let l;
  try { l = await db.get(id); } catch (e) { console.error(e); }
  if (!l) { app.innerHTML = `<div class="container page"><div class="empty"><h3>This book isn't available</h3><p>It may have been sold or removed.</p><a class="btn btn-navy" href="#/">Browse books</a></div></div>`; return; }
  const photos = l.photos || [];
  const available = l.status === "available";
  const mineListing = session && session.user.id === l.seller_id;
  app.innerHTML = `<div class="container page">
    <p class="crumbs"><a href="#/">Books</a> › <a href="#/?grade=${encodeURIComponent(l.grade)}">${esc(l.grade)}</a></p>
    <div class="detail">
      <div>
        <div class="gallery-main" id="gmain">${photos[0] ? `<img src="${esc(photos[0])}" alt="Photo of ${esc(l.title)}">` : cover(l)}</div>
        ${photos.length > 1 ? `<div class="gallery-thumbs">${photos.map((p, i) => `<button type="button" data-i="${i}" aria-label="Show photo ${i + 1}" aria-current="${i === 0}"><img src="${esc(p)}" alt=""></button>`).join("")}</div>` : ""}
      </div>
      <div>
        ${l.sample ? '<p class="notice">This is a sample listing for the preview.</p>' : ""}
        <h1>${esc(l.title)}</h1>
        <p class="big-price">${kes(l.price)}</p>
        ${!available ? `<p class="notice"><strong>${STATUS_LABEL[l.status]}.</strong> Another parent is buying this book.</p>` : ""}
        <dl class="facts">
          <dt>Grade</dt><dd>${esc(l.grade)}</dd>
          <dt>Publisher</dt><dd>${esc(l.publisher)}</dd>
          <dt>School</dt><dd>${esc(l.school)}</dd>
          <dt>Area</dt><dd>${esc(l.area)}${distLabel(l) ? ` <span class="dist">· ${distLabel(l)}</span>` : ""}</dd>
          <dt>Condition</dt><dd>${esc(l.condition)}</dd>
          <dt>Seller</dt><dd>${esc(l.seller_name || "Parent")}</dd>
          <dt>Listed</dt><dd>${timeAgo(l.created_at)}</dd>
        </dl>
        ${l.description ? `<p>${esc(l.description)}</p>` : ""}
        ${mineListing ? `<div class="panel"><h2 style="margin:0 0 6px;font-size:20px">This is your listing</h2><p class="meta" style="margin:0 0 14px">Messages from buyers about it appear in your chats.</p><a class="btn btn-navy btn-block" href="#/chats">Open my chats</a></div>` : `
        <div class="panel" id="buybox">
          ${available ? `
          <h2 style="margin:0 0 4px;font-size:20px">Interested in this book?</h2>
          <p class="meta" style="margin:0 0 16px">Ask the seller anything and agree on a safe meetup, all inside GradeSwap.</p>
          <button class="btn btn-amber btn-block" id="chat-btn" type="button">Chat with ${esc(l.seller_name || "the seller")}</button>
          <details class="buy-details"><summary>Ready to pay? Request to buy · ${kes(l.price)}</summary>
          <form id="buy" novalidate style="margin-top:14px">
            <div class="form-grid">
              <div><label for="b-name">Your name</label><input id="b-name" autocomplete="name" required><div class="err" id="b-name-err"></div></div>
              <div><label for="b-phone">M-Pesa phone number</label><input id="b-phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="0712 345 678" data-phone="1" required><div class="err" id="b-phone-err"></div></div>
              <div class="full"><label for="b-area">Where are you? <span class="hint">(for pick-up or delivery)</span></label><input id="b-area" placeholder="e.g. Rongai" required><div class="err" id="b-area-err"></div></div>
            </div>
            <p class="meta" style="margin:12px 0 0">Your number goes only to GradeSwap, never to the seller.</p>
            <button class="btn btn-navy btn-block" style="margin-top:14px" type="submit">Send buy request</button>
          </form></details>` : `<a class="btn btn-navy btn-block" href="#/?grade=${encodeURIComponent(l.grade)}">See other ${esc(l.grade)} books</a>`}
        </div>`}
        ${safetyNote("safety-gap")}
        <div class="safe"><h3>How buying works</h3><ol>
          <li>Chat with the seller in GradeSwap and agree on a public meetup spot.</li>
          <li>Send a buy request. We send you GradeSwap's M-Pesa payment details.</li>
          <li>Meet, check the book, and confirm you have it.</li>
          <li>We pay the seller. Wrong book? You get your money back.</li></ol></div>
      </div>
    </div></div>`;
  app.querySelectorAll(".gallery-thumbs button").forEach(b => b.onclick = () => {
    document.getElementById("gmain").innerHTML = `<img src="${esc(photos[+b.dataset.i])}" alt="Photo ${+b.dataset.i + 1} of ${esc(l.title)}">`;
    app.querySelectorAll(".gallery-thumbs button").forEach(x => x.setAttribute("aria-current", x === b));
  });
  const chatBtn = document.getElementById("chat-btn");
  if (chatBtn) chatBtn.onclick = async () => {
    if (!session) return signInCard("Sign in to chat", "Sign in with Google to message the seller. Your phone number stays private.", "/book/" + l.id);
    chatBtn.disabled = true;
    try { location.hash = "#/chat/" + await db.startChat(l); }
    catch (err) { console.error(err); chatBtn.disabled = false; toast("Couldn't open the chat. Please try again."); }
  };
  const form = document.getElementById("buy");
  if (!form) return;
  clearOnInput(form);
  form.onsubmit = async e => {
    e.preventDefault();
    if (!validate(form)) return;
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
    const code = ref();
    const row = { ref: code, listing_id: l.id, buyer_name: form["b-name"].value.trim(), buyer_phone: form["b-phone"].value.replace(/\s/g, ""), buyer_area: form["b-area"].value.trim() };
    try {
      await db.order(row);
      const msg = `Hi GradeSwap! I'd like to buy a book.\n\nOrder: ${code}\nBook: ${l.title} (${l.grade})\nPrice: ${kes(l.price)}\nName: ${row.buyer_name}\nPhone: ${row.buyer_phone}\nArea: ${row.buyer_area}`;
      const box = document.getElementById("buybox");
      box.innerHTML = `
        <h2 style="margin:0 0 6px;font-size:20px">Request sent ✓</h2>
        <p style="margin:0 0 6px">Your order number is <strong>${code}</strong>.</p>
        <p class="meta" style="margin:0 0 16px">Send it to GradeSwap on WhatsApp to get our M-Pesa payment details. Don't pay the seller directly.</p>
        <a class="btn btn-navy btn-block" target="_blank" rel="noopener" href="${waLink(msg)}">Send order to GradeSwap</a>`;
      box.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      console.error(err); btn.disabled = false; toast("Couldn't send your request. Please try again.");
    }
  };
}

async function viewSell() {
  if (!session) return signInCard("Sell your books", "Sign in to list last year's books. It takes about two minutes.", "/sell");
  let phone = "";
  try { phone = await db.getPhone(); } catch (e) { console.error(e); }
  const pct = Math.round(SELLER_SHARE * 100);
  let spot = null;
  app.innerHTML = `<div class="container page" style="max-width:820px">
    <h1>List a book</h1>
    <p class="sub">One listing per book. Clear photos of the cover sell faster. When it sells, you receive ${pct}% of your price by M-Pesa.</p>
    <form class="panel" id="sell" novalidate>
      <div class="form-grid">
        <div class="full"><label for="s-title">Book title</label><input id="s-title" maxlength="120" placeholder="As printed on the cover" required><div class="err" id="s-title-err"></div></div>
        <div><label for="s-publisher">Publisher</label><input id="s-publisher" maxlength="80" required><div class="err" id="s-publisher-err"></div></div>
        <div><label for="s-grade">Grade</label><select id="s-grade" required>${opts(GRADES, "", "Choose a grade")}</select><div class="err" id="s-grade-err"></div></div>
        <div><label for="s-school">School it was used at</label><input id="s-school" maxlength="100" required><div class="err" id="s-school-err"></div></div>
        <div><label for="s-area">Your area or estate</label><input id="s-area" maxlength="60" placeholder="e.g. Ruaka" required><div class="err" id="s-area-err"></div></div>
        <div class="full loc-row"><button type="button" class="btn btn-outline btn-sm" id="s-loc">${pinIcon}<span>Show buyers how far away I am</span></button><p class="meta" id="s-loc-note">Optional. We save your area to about 1 km, never your exact home, so nearby parents see "≈ 3 km away".</p></div>
        <div><label for="s-condition">Condition</label><select id="s-condition">${opts(CONDITIONS, CONDITIONS[1])}</select></div>
        <div><label for="s-price">Price (KES)</label><input id="s-price" type="number" min="1" step="10" inputmode="numeric" required><div class="err" id="s-price-err"></div><p class="meta" id="s-net" style="margin-top:6px"></p></div>
        <div class="full"><label for="s-desc">Notes <span class="hint">(optional: missing pages, writing inside, edition year)</span></label><textarea id="s-desc" maxlength="600"></textarea></div>
        <div class="full"><label for="s-photos">Photos <span class="hint">(1 to ${MAX_PHOTOS}: cover first, then inside pages)</span></label><input id="s-photos" type="file" accept="image/*" multiple required><div class="err" id="s-photos-err"></div><div class="photo-pick" id="s-preview"></div></div>
        <div class="full"><label for="s-phone">Your M-Pesa number <span class="hint">(private: only GradeSwap sees it, to pay you)</span></label><input id="s-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="0712 345 678" data-phone="1" value="${esc(phone)}" required><div class="err" id="s-phone-err"></div></div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:22px">
        <button class="btn btn-amber" type="submit">Publish listing</button>
        <a class="btn btn-ghost" href="#/my">Cancel</a>
      </div>
    </form></div>`;
  const form = document.getElementById("sell");
  clearOnInput(form);
  const price = form["s-price"], net = document.getElementById("s-net");
  price.oninput = () => { net.textContent = +price.value > 0 ? `You receive ${kes(Math.floor(+price.value * SELLER_SHARE))}` : ""; };
  document.getElementById("s-loc").onclick = async e => {
    const b = e.currentTarget;
    try {
      const p = await locate();
      spot = { lat: round(p.lat), lng: round(p.lng) };
      b.querySelector("span").textContent = "✓ Approximate location added";
      document.getElementById("s-loc-note").textContent = "Saved to about 1 km. Buyers see the distance, not your address.";
    } catch (err) { toast(err.message); }
  };
  let files = [];
  form["s-photos"].onchange = e => {
    files = [...e.target.files].filter(f => f.type.startsWith("image/")).slice(0, MAX_PHOTOS);
    if (e.target.files.length > MAX_PHOTOS) toast(`Only the first ${MAX_PHOTOS} photos will be used.`);
    document.getElementById("s-preview").innerHTML = files.map((f, i) => `<img src="${URL.createObjectURL(f)}" alt="Selected photo ${i + 1}">`).join("");
  };
  form.onsubmit = async e => {
    e.preventDefault();
    if (!validate(form)) return;
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Publishing…";
    try {
      const p = form["s-phone"].value.replace(/\s/g, "");
      if (p !== phone) await db.savePhone(p);
      const inKenya = spot && spot.lat >= -5 && spot.lat <= 5.5 && spot.lng >= 33 && spot.lng <= 42.5;
      const row = { title: form["s-title"].value.trim(), publisher: form["s-publisher"].value.trim(), grade: form["s-grade"].value,
        school: form["s-school"].value.trim(), area: form["s-area"].value.trim(), condition: form["s-condition"].value,
        price: Math.round(+price.value), description: form["s-desc"].value.trim(), seller_name: myName(),
        lat: inKenya ? spot.lat : null, lng: inKenya ? spot.lng : null };
      const l = await db.create(row, files);
      toast("Your book is listed!");
      location.hash = "#/book/" + l.id;
    } catch (err) {
      console.error(err); btn.disabled = false; btn.textContent = "Publish listing";
      toast("Couldn't publish. Check your photos and connection, then try again.");
    }
  };
}

async function viewMy() {
  if (!session) return signInCard("Sign in to GradeSwap", "Sign in to list books, chat with parents and manage your listings.", "/my");
  app.innerHTML = `<div class="loading">Loading your listings…</div>`;
  let list = [];
  try { list = await db.mine(); } catch (e) { console.error(e); }
  const name = session.user.user_metadata?.full_name || session.user.email;
  app.innerHTML = `<div class="container page" style="max-width:900px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
      <div><h1>My listings</h1><p class="sub">Signed in as ${esc(name)} · <button class="linkbtn" id="out" type="button">Sign out</button></p></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn btn-outline" href="#/chats">My chats</a><a class="btn btn-amber" href="#/sell">List a book</a></div>
    </div>
    <div class="row-list" id="rows">${list.length ? list.map(l => `
      <div class="row" data-id="${esc(l.id)}">
        <div class="thumb">${thumbHTML(l)}</div>
        <div><a href="#/book/${esc(l.id)}" style="color:var(--ink);font-weight:700;text-decoration:none">${esc(l.title)}</a>
          <p class="meta">${kes(l.price)} · ${esc(l.grade)} · ${timeAgo(l.created_at)}</p></div>
        <div class="row-actions">
          <label class="sr-only" for="st-${esc(l.id)}">Status</label>
          <select class="status-select" id="st-${esc(l.id)}" data-act="status">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}"${k === l.status ? " selected" : ""}>${v}</option>`).join("")}</select>
          <button class="btn btn-ghost btn-sm" data-act="delete" type="button">Delete</button>
        </div>
      </div>`).join("") : `<div class="empty"><h3>No listings yet</h3><p>List last year's books and turn them into this year's savings.</p><a class="btn btn-navy" href="#/sell">List a book</a></div>`}
    </div></div>`;
  document.getElementById("out").onclick = signOut;
  app.querySelectorAll(".row").forEach(row => {
    const l = list.find(x => String(x.id) === row.dataset.id);
    row.querySelector("[data-act=status]").onchange = async e => {
      try { await db.setStatus(l.id, e.target.value); toast("Status updated"); }
      catch (err) { console.error(err); toast("Couldn't update. Try again."); }
    };
    row.querySelector("[data-act=delete]").onclick = async () => {
      if (!confirm(`Delete "${l.title}"? This can't be undone.`)) return;
      try { await db.remove(l); row.remove(); toast("Listing deleted"); }
      catch (err) { console.error(err); toast("Couldn't delete. Try again."); }
    };
  });
}

async function viewChats() {
  if (!session) return signInCard("Your chats", "Sign in to see your conversations with other parents.", "/chats");
  app.innerHTML = `<div class="loading">Loading chats…</div>`;
  let list = [];
  try { list = await db.chats(); } catch (e) { console.error(e); }
  const uid = session.user.id;
  app.innerHTML = `<div class="container page" style="max-width:760px">
    <h1>Chats</h1>
    ${safetyNote()}
    <div class="row-list" style="margin-top:20px">${list.length ? list.map(c => {
      const other = c.buyer_id === uid ? (c.seller_name || "Seller") : (c.buyer_name || "Buyer");
      const role = c.buyer_id === uid ? "Seller" : "Buyer";
      return `<a class="chat-row${isUnread(c) ? " unread" : ""}" href="#/chat/${esc(c.id)}">
        <div class="thumb">${thumbHTML(c.listing)}</div>
        <div class="chat-row-main"><p class="chat-row-top"><strong>${esc(other)}</strong><span class="role">${role}</span><span class="meta when">${timeAgo(c.last_message_at)}</span></p>
          <p class="chat-row-book">${esc(c.listing.title || "Book")}</p>
          <p class="meta chat-row-last">${c.last_sender === uid ? "You: " : ""}${esc(maskContacts(c.last_message || "No messages yet"))}</p></div>
        ${isUnread(c) ? '<span class="unread-dot" aria-label="Unread"></span>' : ""}
      </a>`; }).join("") : `<div class="empty"><h3>No chats yet</h3><p>Find a book and tap "Chat with the seller" to start.</p><a class="btn btn-navy" href="#/">Browse books</a></div>`}
    </div></div>`;
}

async function viewChat(id) {
  if (!session) return signInCard("Sign in to chat", "Sign in with Google to see this conversation.", "/chat/" + id);
  app.innerHTML = `<div class="loading">Opening chat…</div>`;
  let c, msgs = [];
  try { c = await db.chat(id); if (c) msgs = await db.messages(id); } catch (e) { console.error(e); }
  if (!c) { app.innerHTML = `<div class="container page"><div class="empty"><h3>Chat not found</h3><a class="btn btn-navy" href="#/chats">Back to chats</a></div></div>`; return; }
  const uid = session.user.id;
  const iAmBuyer = c.buyer_id === uid;
  const other = iAmBuyer ? (c.seller_name || "Seller") : (c.buyer_name || "Buyer");
  const l = c.listing;
  const listingId = l.id || c.listing_id;
  app.innerHTML = `<div class="container chat-page">
    <div class="chat-head">
      <a class="back" href="#/chats" aria-label="Back to chats">‹</a>
      <a class="chat-book" href="#/book/${esc(listingId)}"><div class="thumb">${thumbHTML(l)}</div>
        <div><p class="chat-who"><strong>${esc(other)}</strong><span class="role">${iAmBuyer ? "Seller" : "Buyer"}</span></p><p class="meta">${esc(l.title || "")}${l.price ? " · " + kes(l.price) : ""}</p></div></a>
    </div>
    ${safetyNote("safety-chat")}
    <div class="messages" id="msgs" aria-live="polite"></div>
    <div class="chat-tools">
      <button class="btn btn-ghost btn-sm" id="t-meet" type="button">${pinIcon}<span>Suggest a meetup</span></button>
      <button class="btn btn-ghost btn-sm" id="t-here" type="button">I'm here</button>
      ${iAmBuyer && l.status === "available" ? `<a class="btn btn-ghost btn-sm" href="#/book/${esc(listingId)}">Pay safely</a>` : ""}
    </div>
    <form class="meet-form" id="meet" novalidate hidden>
      <p class="meet-title">Suggest a busy public place</p>
      <div class="spots">${SAFE_SPOTS.map(s => `<button type="button" class="chip-btn" data-spot="${esc(s)}">${esc(s)}</button>`).join("")}</div>
      <div class="form-grid">
        <div class="full"><label for="m-place">Place name</label><input id="m-place" maxlength="120" placeholder="e.g. Naivas Rongai main entrance" required><div class="err" id="m-place-err"></div></div>
        <div><label for="m-time">Day and time</label><input id="m-time" type="datetime-local" required><div class="err" id="m-time-err"></div></div>
        <div class="pin-wrap"><label class="check"><input type="checkbox" id="m-pin"> Pin my current location on the map</label></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:14px"><button class="btn btn-navy btn-sm" type="submit">Send meetup</button><button class="btn btn-ghost btn-sm" type="button" id="m-cancel">Cancel</button></div>
    </form>
    <form class="composer" id="compose">
      <label class="sr-only" for="msg">Message</label>
      <textarea id="msg" rows="1" maxlength="1000" placeholder="Write a message…"></textarea>
      <button class="btn btn-amber" type="submit">Send</button>
    </form>
    <p class="err" id="msg-warn" role="alert"></p>
  </div>`;
  const box = document.getElementById("msgs");
  const seen = new Set();
  function bubble(m) {
    if (seen.has(m.id)) return "";
    seen.add(m.id);
    const mine = m.sender_id === uid;
    let inner;
    if (m.kind === "meetup") {
      const link = m.lat != null ? mapsAt(m.lat, m.lng) : mapsSearch(m.place);
      inner = `<p class="meet-card-title">Meetup suggestion</p><p class="meet-card-place">${esc(m.place)}</p>
        ${m.meet_at ? `<p class="meet-card-time">${esc(when(m.meet_at))}</p>` : ""}
        <div class="meet-actions"><a href="${esc(link)}" target="_blank" rel="noopener">Open in Maps</a>${m.lat != null ? `<a href="${esc(mapsDirections(m.lat, m.lng))}" target="_blank" rel="noopener">Directions</a>` : ""}
        ${!mine ? `<button type="button" class="linkbtn" data-accept="${esc(m.place)}">Accept</button>` : ""}</div>`;
    } else if (m.kind === "location") {
      inner = `<p class="meet-card-title">${mine ? "You shared where you are" : esc(other) + " is here"}</p>
        <div class="meet-actions"><a href="${esc(mapsAt(m.lat, m.lng))}" target="_blank" rel="noopener">Open in Maps</a><a href="${esc(mapsDirections(m.lat, m.lng))}" target="_blank" rel="noopener">Directions</a></div>`;
    } else {
      inner = `<p>${esc(maskContacts(m.body)).replace(/\n/g, "<br>")}</p>`;
    }
    return `<div class="msg ${mine ? "mine" : "theirs"}${m.kind !== "text" ? " card" : ""}">${inner}<span class="time">${clock(m.created_at)}</span></div>`;
  }
  function append(list) {
    const html = list.map(bubble).join("");
    if (html) { box.querySelector(".chat-empty")?.remove(); box.insertAdjacentHTML("beforeend", html); box.scrollTop = box.scrollHeight; }
  }
  if (!msgs.length) box.innerHTML = `<p class="chat-empty">Say hello. Ask about the book's condition, then suggest a busy public place to meet.</p>`;
  append(msgs);
  db.markRead(c).then(refreshUnread);

  async function send(msg) {
    try { append([await db.send(c, msg)]); }
    catch (err) { console.error(err); toast("Message not sent. Check your connection."); throw err; }
  }

  if (LIVE) {
    chatChannel = sb.channel("chat-" + id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${id}` }, p => {
        append([p.new]);
        if (p.new.sender_id !== uid) db.markRead(c);
      }).subscribe();
  }

  const compose = document.getElementById("compose"), input = document.getElementById("msg"), warn = document.getElementById("msg-warn");
  input.addEventListener("input", () => {
    input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px";
    warn.textContent = hasContact(input.value) ? "Phone numbers are hidden in chat for your safety. Keep talking and paying inside GradeSwap." : "";
  });
  input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); compose.requestSubmit(); } });
  compose.onsubmit = async e => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    input.value = ""; input.style.height = "auto"; warn.textContent = "";
    try { await send({ kind: "text", body }); } catch (err) { input.value = body; }
  };
  box.addEventListener("click", async e => {
    const b = e.target.closest("[data-accept]");
    if (!b) return;
    b.disabled = true;
    try { await send({ kind: "text", body: `✓ Meetup confirmed: ${b.dataset.accept}. See you there!` }); b.textContent = "Accepted"; }
    catch (err) { b.disabled = false; }
  });

  const meet = document.getElementById("meet");
  document.getElementById("t-meet").onclick = () => { meet.hidden = !meet.hidden; if (!meet.hidden) meet.querySelector("#m-place").focus(); };
  document.getElementById("m-cancel").onclick = () => { meet.hidden = true; };
  meet.querySelectorAll("[data-spot]").forEach(b => b.onclick = () => {
    const f = meet.querySelector("#m-place");
    f.value = b.dataset.spot + (l.area ? ", " + l.area : "");
    f.dispatchEvent(new Event("input", { bubbles: true })); f.focus();
  });
  clearOnInput(meet);
  meet.onsubmit = async e => {
    e.preventDefault();
    if (!validate(meet)) return;
    const btn = meet.querySelector("button[type=submit]"); btn.disabled = true;
    const place = meet.querySelector("#m-place").value.trim();
    const t = meet.querySelector("#m-time").value;
    let pin = null;
    if (meet.querySelector("#m-pin").checked) { try { pin = await locate(); } catch (err) { toast(err.message); } }
    try {
      await send({ kind: "meetup", body: `Meetup: ${place}`, place, meet_at: t ? new Date(t).toISOString() : null, lat: pin?.lat ?? null, lng: pin?.lng ?? null });
      meet.reset(); meet.hidden = true;
    } catch (err) { /* toast already shown */ }
    btn.disabled = false;
  };
  document.getElementById("t-here").onclick = async e => {
    const b = e.currentTarget; b.disabled = true;
    try { const p = await locate(); await send({ kind: "location", body: "I'm here", lat: p.lat, lng: p.lng }); }
    catch (err) { if (err && err.message) toast(err.message); }
    b.disabled = false;
  };
}

function viewHow() {
  const pct = Math.round(SELLER_SHARE * 100);
  app.innerHTML = `<div class="container page" style="max-width:960px">
    <h1>How GradeSwap works</h1>
    <p class="sub">A marketplace for used school books. Chats, meetups and payments all stay inside GradeSwap, so both parents are protected.</p>
    ${safetyNote()}
    <h2 style="font-size:22px;margin-top:32px">Buying</h2>
    <ol class="steps">
      <li class="step"><div class="num">1</div><h3>Find books near you</h3><p>Filter by grade, school and area, or tap "Near me" to see the closest books first.</p></li>
      <li class="step"><div class="num">2</div><h3>Chat and plan a meetup</h3><p>Message the seller in the app and agree on a busy public place and time.</p></li>
      <li class="step"><div class="num">3</div><h3>Pay GradeSwap, collect</h3><p>Pay GradeSwap by M-Pesa. We pay the seller only after you have the book.</p></li>
    </ol>
    <h2 style="font-size:22px">Selling</h2>
    <ol class="steps">
      <li class="step"><div class="num">1</div><h3>Sign in with Google</h3><p>No passwords. Your phone number is never shown to other parents.</p></li>
      <li class="step"><div class="num">2</div><h3>List each book</h3><p>Add the title, publisher, grade, school, price and clear photos.</p></li>
      <li class="step"><div class="num">3</div><h3>Get paid by M-Pesa</h3><p>When the buyer has the book, you receive ${pct}% of your price.</p></li>
    </ol>
    <h2 style="font-size:22px">Questions</h2>
    <details><summary>Why should we chat only in GradeSwap?</summary><p>Chats in the app are linked to the book and the order, so if anything goes wrong we can see what was agreed and help. Phone numbers are hidden in chat to stop scams that move you to another app or ask you to pay outside GradeSwap.</p></details>
    <details><summary>How do we find each other?</summary><p>Use "Suggest a meetup" in the chat to pick a busy public place and time, with a map pin. When you arrive, tap "I'm here" to share your location once, so the other parent can get Google Maps directions to you. GradeSwap never tracks your location in the background.</p></details>
    <details><summary>What does GradeSwap charge?</summary><p>Listing, browsing and chatting are free. When a book sells, GradeSwap keeps ${100 - pct}% and the seller receives ${pct}%.</p></details>
    <details><summary>What if I get the wrong book?</summary><p>Check the book at the meetup before you confirm. If it doesn't match the listing, you get your money back.</p></details>
  </div>`;
}

/* ---------- router ---------- */
async function router() {
  if (chatChannel) { sb.removeChannel(chatChannel); chatChannel = null; }
  const { parts, q } = parseHash();
  window.scrollTo(0, 0);
  const [page, id] = parts;
  document.body.classList.toggle("in-chat", page === "chat");
  if (!page) await viewHome(q);
  else if (page === "book" && id) await viewBook(id);
  else if (page === "sell") await viewSell();
  else if (page === "my") await viewMy();
  else if (page === "chats") await viewChats();
  else if (page === "chat" && id) await viewChat(id);
  else if (page === "how") viewHow();
  else await viewHome({});
  if (page !== "chat") app.focus({ preventScroll: true });
}

async function start() {
  document.getElementById("yr").textContent = new Date().getFullYear();
  document.getElementById("foot-wa").href = waLink("Hi GradeSwap!");
  if (!LIVE) document.getElementById("demo-banner").hidden = false;
  if (LIVE) {
    const { data } = await sb.auth.getSession();
    session = data.session;
    if (location.search.includes("code=")) {
      let back = "/";
      try { back = sessionStorage.getItem("gs-return") || "/"; sessionStorage.removeItem("gs-return"); } catch (e) { /* ignore */ }
      history.replaceState(null, "", location.pathname + "#" + back);
    }
    sb.auth.onAuthStateChange((_e, s) => { const was = !!session; session = s; if (was !== !!s) { updateNav(); router(); } });
    sb.channel("my-convs").on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => refreshUnread()).subscribe();
  }
  updateNav();
  window.addEventListener("hashchange", router);
  router();
}
start();
})();
