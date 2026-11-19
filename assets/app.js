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

const app = document.getElementById("app");
let session = null;

/* ---------- helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const kes = n => "KES " + Number(n || 0).toLocaleString("en-KE");
const waLink = text => `https://wa.me/${cfg.WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
const opts = (list, sel, blank) => (blank ? `<option value="">${esc(blank)}</option>` : "") +
  list.map(v => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(v)}</option>`).join("");
const timeAgo = iso => {
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 3600) return Math.max(1, Math.round(d / 60)) + " min ago";
  if (d < 86400) return Math.round(d / 3600) + " h ago";
  const days = Math.round(d / 86400);
  return days === 1 ? "yesterday" : days + " days ago";
};
const ref = () => "GS-" + Math.random().toString(36).slice(2, 7).toUpperCase();
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 3200);
}
function parseHash() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = h.split("?");
  return { parts: path.split("/").filter(Boolean), q: Object.fromEntries(new URLSearchParams(qs || "")) };
}
function cover(l, cls = "") {
  return `<div class="cover ${cls}"><span>${esc(l.title)}</span><small>${esc(l.grade)}</small></div>`;
}
function thumbHTML(l) {
  const img = l.photos && l.photos[0];
  return img ? `<img src="${esc(img)}" alt="" loading="lazy">` : cover(l);
}
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

/* ---------- data layer (Supabase, or sample data in preview mode) ---------- */
const DAY = 86400000;
const demo = {
  user: { id: "demo-user", email: "you@example.com", user_metadata: { full_name: "You" } },
  listings: [
    ["Primary Mathematics", "Sample Publishers", "Grade 5", "Riverside Academy", "Rongai", "Good — some writing", 450],
    ["English Activities", "Sample Publishers", "Grade 5", "Riverside Academy", "Rongai", "Like new", 500],
    ["Kiswahili Mufti", "Sample Publishers", "Grade 4", "Hillcrest Primary", "Ruaka", "Good — some writing", 380],
    ["Integrated Science", "Sample Publishers", "Grade 7", "Sunrise School", "Kitengela", "Like new", 650],
    ["Social Studies", "Sample Publishers", "Grade 6", "Hillcrest Primary", "Ruaka", "Fair — well used but complete", 250],
    ["Creative Arts", "Sample Publishers", "Grade 3", "Riverside Academy", "Rongai", "Good — some writing", 300],
    ["Pre-Technical Studies", "Sample Publishers", "Grade 8", "Sunrise School", "Kitengela", "Like new", 700],
    ["Language Activities", "Sample Publishers", "PP2", "Little Stars", "Syokimau", "Good — some writing", 200]
  ].map((r, i) => ({ id: "demo-" + (i + 1), seller_id: i === 0 ? "demo-user" : "other", title: r[0] + " " + r[2], publisher: r[1], grade: r[2],
    school: r[3], area: r[4], condition: r[5], price: r[6], description: "Sample listing to show how GradeSwap looks.", photos: [],
    status: i === 5 ? "sold" : "available", created_at: new Date(Date.now() - (i + 1) * DAY / 3).toISOString(), sample: true })),
  phone: ""
};

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
    const name = session.user.user_metadata?.full_name || session.user.email;
    const { error } = await sb.from("seller_contacts").upsert({ user_id: session.user.id, phone, display_name: name });
    if (error) throw error;
  },
  async order(row) {
    if (!LIVE) return;
    const { error } = await sb.from("orders").insert(row);
    if (error) throw error;
  }
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

/* ---------- auth ---------- */
async function signIn(returnTo) {
  if (!LIVE) { session = { user: demo.user }; updateNav(); router(); toast("Preview: signed in as a sample seller"); return; }
  try { sessionStorage.setItem("gs-return", returnTo); } catch (e) { /* storage blocked: fall back to home */ }
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname }
  });
  if (error) toast("Sign-in failed. Please try again.");
}
async function signOut() {
  if (LIVE) await sb.auth.signOut();
  session = null; updateNav(); location.hash = "#/";
}
function updateNav() {
  document.getElementById("nav-account").textContent = session ? "My listings" : "Sign in";
}
function signInCard(title, text, returnTo) {
  app.innerHTML = `<div class="container page"><div class="panel center-card">
    <svg width="64" height="64" aria-hidden="true"><use href="#gs-mark"/></svg>
    <h1>${esc(title)}</h1><p class="sub" style="margin:0 auto 24px">${esc(text)}</p>
    <button class="btn btn-google btn-block" id="google">
      <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
      Continue with Google</button>
    <p class="meta" style="margin-top:16px">We only use your name and email to manage your listings.</p>
  </div></div>`;
  document.getElementById("google").onclick = () => signIn(returnTo);
}

/* ---------- views ---------- */
async function viewHome(q) {
  app.innerHTML = `
  <section class="search-hero"><div class="container">
    <h1>Used school books, <em>matched to your school and grade.</em></h1>
    <p>Buy safely through GradeSwap with M-Pesa. Sell last year's books in two minutes.</p>
    <form class="search" id="search" role="search">
      <div class="q"><label class="sr-only" for="q">Book title or publisher</label><input id="q" name="q" placeholder="Book title or publisher" value="${esc(q.q)}"></div>
      <div><label class="sr-only" for="grade">Grade</label><select id="grade" name="grade">${opts(GRADES, q.grade, "Any grade")}</select></div>
      <div><label class="sr-only" for="school">School</label><input id="school" name="school" placeholder="School" value="${esc(q.school)}"></div>
      <div class="area"><label class="sr-only" for="area">Area</label><input id="area" name="area" placeholder="Area, e.g. Rongai" value="${esc(q.area)}"></div>
      <button class="btn btn-amber" type="submit">Search</button>
    </form>
  </div></section>
  <div class="container">
    <div class="results-head"><h2 id="res-title">Latest books</h2><p id="res-count"></p></div>
    <div id="results" class="loading">Loading books…</div>
  </div>`;
  document.getElementById("search").onsubmit = e => {
    e.preventDefault();
    const p = new URLSearchParams([...new FormData(e.target)].filter(([, v]) => v.trim()));
    location.hash = "#/" + (p.toString() ? "?" + p : "");
  };
  const filtered = q.q || q.grade || q.school || q.area;
  if (filtered) document.getElementById("res-title").textContent = "Search results";
  const box = document.getElementById("results");
  try {
    const list = await db.search(q);
    document.getElementById("res-count").textContent = list.length ? `${list.length} book${list.length > 1 ? "s" : ""}` : "";
    if (!list.length) {
      box.className = "";
      box.innerHTML = `<div class="empty"><h3>No books match yet</h3><p>New books are listed every day. Tell us your list and we'll find them for you.</p>
        <a class="btn btn-navy" target="_blank" rel="noopener" href="${waLink(`Hi GradeSwap! I'm looking for books.\nGrade: ${q.grade || ""}\nSchool: ${q.school || ""}\nArea: ${q.area || ""}\nBook: ${q.q || ""}`)}">Ask us on WhatsApp</a></div>`;
      return;
    }
    box.className = "grid";
    box.innerHTML = list.map(l => `
      <a class="card-link" href="#/book/${esc(l.id)}">
        <div class="thumb">${thumbHTML(l)}${l.status === "reserved" ? '<span class="badge">Reserved</span>' : ""}${l.sample ? '<span class="badge sample">Sample</span>' : ""}</div>
        <div class="card-body">
          <span class="price">${kes(l.price)}</span>
          <h3 class="card-title">${esc(l.title)}</h3>
          <p class="meta">${esc(l.school)} · ${esc(l.area)}</p>
          <div class="chips"><span class="chip">${esc(l.grade)}</span><span class="chip">${esc(l.condition.split(" —")[0])}</span></div>
          <p class="meta" style="margin-top:6px">${timeAgo(l.created_at)}</p>
        </div>
      </a>`).join("");
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
          <dt>Area</dt><dd>${esc(l.area)}</dd>
          <dt>Condition</dt><dd>${esc(l.condition)}</dd>
          <dt>Listed</dt><dd>${timeAgo(l.created_at)}</dd>
        </dl>
        ${l.description ? `<p>${esc(l.description)}</p>` : ""}
        <div class="panel" id="buybox">
          ${available ? `
          <h2 style="margin:0 0 4px;font-size:20px">Buy safely through GradeSwap</h2>
          <p class="meta" style="margin:0 0 16px">You pay GradeSwap by M-Pesa. The seller is paid only after you have the book.</p>
          <form id="buy" novalidate>
            <div class="form-grid">
              <div><label for="b-name">Your name</label><input id="b-name" autocomplete="name" required><div class="err" id="b-name-err"></div></div>
              <div><label for="b-phone">M-Pesa phone number</label><input id="b-phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="0712 345 678" data-phone="1" required><div class="err" id="b-phone-err"></div></div>
              <div class="full"><label for="b-area">Where are you? <span class="hint">(for pick-up or delivery)</span></label><input id="b-area" placeholder="e.g. Rongai, near Tuskys" required><div class="err" id="b-area-err"></div></div>
            </div>
            <button class="btn btn-amber btn-block" style="margin-top:18px" type="submit">Request to buy · ${kes(l.price)}</button>
          </form>` : `<a class="btn btn-navy btn-block" href="#/?grade=${encodeURIComponent(l.grade)}">See other ${esc(l.grade)} books</a>`}
        </div>
        <div class="safe"><h3>How buying works</h3><ol>
          <li>Send your request. We confirm the book with the seller.</li>
          <li>We WhatsApp you the M-Pesa payment details for GradeSwap.</li>
          <li>Pick up or receive the book and check it.</li>
          <li>We pay the seller. Wrong book? You get your money back.</li></ol></div>
      </div>
    </div></div>`;
  app.querySelectorAll(".gallery-thumbs button").forEach(b => b.onclick = () => {
    document.getElementById("gmain").innerHTML = `<img src="${esc(photos[+b.dataset.i])}" alt="Photo ${+b.dataset.i + 1} of ${esc(l.title)}">`;
    app.querySelectorAll(".gallery-thumbs button").forEach(x => x.setAttribute("aria-current", x === b));
  });
  const form = document.getElementById("buy");
  if (!form) return;
  clearOnInput(form);
  form.onsubmit = async e => {
    e.preventDefault();
    if (!validate(form)) return;
    const btn = form.querySelector("button"); btn.disabled = true;
    const code = ref();
    const row = { ref: code, listing_id: l.id, buyer_name: form["b-name"].value.trim(), buyer_phone: form["b-phone"].value.replace(/\s/g, ""), buyer_area: form["b-area"].value.trim() };
    try {
      await db.order(row);
      const msg = `Hi GradeSwap! I'd like to buy a book.\n\nOrder: ${code}\nBook: ${l.title} (${l.grade})\nPrice: ${kes(l.price)}\nName: ${row.buyer_name}\nPhone: ${row.buyer_phone}\nArea: ${row.buyer_area}`;
      const box = document.getElementById("buybox");
      box.innerHTML = `
        <h2 style="margin:0 0 6px;font-size:20px">Request sent ✓</h2>
        <p style="margin:0 0 6px">Your order number is <strong>${code}</strong>.</p>
        <p class="meta" style="margin:0 0 16px">Send it to us on WhatsApp so we can confirm the book and share M-Pesa payment details. Don't pay anyone else directly.</p>
        <a class="btn btn-navy btn-block" target="_blank" rel="noopener" href="${waLink(msg)}">Send order on WhatsApp</a>`;
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
      const row = { title: form["s-title"].value.trim(), publisher: form["s-publisher"].value.trim(), grade: form["s-grade"].value,
        school: form["s-school"].value.trim(), area: form["s-area"].value.trim(), condition: form["s-condition"].value,
        price: Math.round(+price.value), description: form["s-desc"].value.trim() };
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
  if (!session) return signInCard("Sign in to GradeSwap", "Sign in to list books and manage your listings.", "/my");
  app.innerHTML = `<div class="loading">Loading your listings…</div>`;
  let list = [];
  try { list = await db.mine(); } catch (e) { console.error(e); }
  const name = session.user.user_metadata?.full_name || session.user.email;
  app.innerHTML = `<div class="container page" style="max-width:900px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
      <div><h1>My listings</h1><p class="sub">Signed in as ${esc(name)} · <button class="linkbtn" id="out">Sign out</button></p></div>
      <a class="btn btn-amber" href="#/sell">List a book</a>
    </div>
    <div class="row-list" id="rows">${list.length ? list.map(l => `
      <div class="row" data-id="${esc(l.id)}">
        <div class="thumb">${thumbHTML(l)}</div>
        <div><a href="#/book/${esc(l.id)}" style="color:var(--ink);font-weight:700;text-decoration:none">${esc(l.title)}</a>
          <p class="meta">${kes(l.price)} · ${esc(l.grade)} · ${timeAgo(l.created_at)}</p></div>
        <div class="row-actions">
          <label class="sr-only" for="st-${esc(l.id)}">Status</label>
          <select class="status-select" id="st-${esc(l.id)}" data-act="status">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}"${k === l.status ? " selected" : ""}>${v}</option>`).join("")}</select>
          <button class="btn btn-ghost btn-sm" data-act="delete">Delete</button>
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

function viewHow() {
  const pct = Math.round(SELLER_SHARE * 100);
  app.innerHTML = `<div class="container page" style="max-width:960px">
    <h1>How GradeSwap works</h1>
    <p class="sub">A marketplace for used school books, where every payment goes through GradeSwap so both parents are protected.</p>
    <h2 style="font-size:22px">Buying</h2>
    <ol class="steps">
      <li class="step"><div class="num">1</div><h3>Search your list</h3><p>Filter by grade, school and area to find the exact title and publisher.</p></li>
      <li class="step"><div class="num">2</div><h3>Request and pay GradeSwap</h3><p>We confirm with the seller and send you M-Pesa details for GradeSwap.</p></li>
      <li class="step"><div class="num">3</div><h3>Collect and check</h3><p>Pick up or get delivery. We only pay the seller once you have the book.</p></li>
    </ol>
    <h2 style="font-size:22px">Selling</h2>
    <ol class="steps">
      <li class="step"><div class="num">1</div><h3>Sign in with Google</h3><p>No passwords. Your phone number stays private.</p></li>
      <li class="step"><div class="num">2</div><h3>List each book</h3><p>Add the title, publisher, grade, school, price and clear photos.</p></li>
      <li class="step"><div class="num">3</div><h3>Get paid by M-Pesa</h3><p>When the buyer has the book, you receive ${pct}% of your price.</p></li>
    </ol>
    <h2 style="font-size:22px">Questions</h2>
    <details><summary>What does GradeSwap charge?</summary><p>Listing and browsing are free. When a book sells, GradeSwap keeps ${100 - pct}% and the seller receives ${pct}%.</p></details>
    <details><summary>Why can't I call the seller directly?</summary><p>Payments go through GradeSwap so nobody loses money to a no-show or the wrong book. Never pay a seller directly.</p></details>
    <details><summary>What if I get the wrong book?</summary><p>Tell us before you confirm receipt. If it doesn't match the listing, you get your money back.</p></details>
    <details><summary>Which areas do you cover?</summary><p>We're starting in Nairobi and nearby estates. Search your area, or WhatsApp us to ask.</p></details>
  </div>`;
}

/* ---------- router ---------- */
async function router() {
  const { parts, q } = parseHash();
  window.scrollTo(0, 0);
  const [page, id] = parts;
  if (!page) await viewHome(q);
  else if (page === "book" && id) await viewBook(id);
  else if (page === "sell") await viewSell();
  else if (page === "my") await viewMy();
  else if (page === "how") viewHow();
  else await viewHome({});
  app.focus({ preventScroll: true });
}

async function start() {
  document.getElementById("yr").textContent = new Date().getFullYear();
  document.getElementById("foot-wa").href = waLink("Hi GradeSwap!");
  if (!LIVE) document.getElementById("demo-banner").hidden = false;
  if (LIVE) {
    const { data } = await sb.auth.getSession();
    session = data.session;
    // Back from Google: drop ?code=… from the address bar and return to where sign-in started.
    if (location.search.includes("code=")) {
      let back = "/";
      try { back = sessionStorage.getItem("gs-return") || "/"; sessionStorage.removeItem("gs-return"); } catch (e) { /* ignore */ }
      history.replaceState(null, "", location.pathname + "#" + back);
    }
    sb.auth.onAuthStateChange((_e, s) => { const was = !!session; session = s; updateNav(); if (was !== !!s) router(); });
  }
  updateNav();
  window.addEventListener("hashchange", router);
  router();
}
start();
})();
