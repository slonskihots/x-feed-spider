// ==UserScript==
// @name         X feed crawler
// @namespace    local
// @version      1.0
// @description  A glass spider scans a page (built for X), finds keywords or AI-style markers and counts them in columns. Read-only overlay, changes nothing on the page.
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/* How to use
   - Tampermonkey: create a new script, paste this whole file, save, open x.com.
   - Or: open x.com, press F12, open Console, paste this whole file, press Enter.
   Keys (Alt + key, work on any keyboard layout):
     Alt+G  show / hide the overlay      Alt+A  auto-scroll on / off
     Alt+R  reset counters               Alt+W  change keywords (up to 8)
     Alt+H  hide / show the key hints    Alt+S  switch between your keywords and "style markers"
   Style markers: a list of writing habits that are common in AI-generated text (stock words, hype,
   "not just X, it's Y", chatbot phrases, em dashes), taken from the humanizer skill, which is based on
   Wikipedia's "Signs of AI writing". They are signals of STYLE, not proof of who wrote a post.
   People write like this too, and AI text can avoid all of it. Never use it to accuse anyone.
   Pasting the file a second time just toggles the overlay.
   Works on the timeline, on single posts with replies, and on long-form X articles.
   Other websites: on any page the text of the page is read paragraph by paragraph (menus, footers,
   forms and buttons are skipped). In the Console it works anywhere right away. In Tampermonkey add a
   line like   // @match        https://www.example.com/pages/   with a star after the last slash, or the
   line   // @include *   for every site, to the header above.
   If something is not found, run  __xCrawler.state()  in the Console: "units" is how many text
   blocks were read and "visible" how many keyword matches exist on the page right now.
*/

(() => {
"use strict";
if (window.__xCrawler) { window.__xCrawler.toggle(); return; }

/* ====================== settings ====================== */
const CONFIG = {
  mode: "words",            // "words" = your keywords below, "slop" = AI style markers (Alt+S switches any time)
  words: ["jev", "grok", "opus", "llm", "dots", "agent", "gpt"],   // up to 8. "agent" also catches agents, "gpt" also ChatGPT / GPT-4   // case-insensitive, matches inside words too (SuperGrok, LLMs)
  autostart: true,           // false = stay hidden until Alt+G
  autostartOthers: true,     // same, but for sites other than X (only matters if you widened @match)
  autoscroll: false,         // Alt+A toggles
  showMore: false,           // click X's "Show more" on long posts so their full text gets read (button in the panel)
  scrollPxPerSec: 75,
  side: "left",              // panel side: "left" or "right"
  hints: true,               // key hints and buttons at the bottom of the panel
  keys: {toggle: "KeyG", scroll: "KeyA", reset: "KeyR", words: "KeyW", hints: "KeyH", mode: "KeyS"},   // used together with Alt (or Alt+Shift). Change a letter if your browser grabs it.
  speed: 0.33,               // how fast the spider sweeps the page: 1 = the first version's speed, 0.5 = twice as slow, 1.5 = faster
  band: false                // show the pink scan line (purely visual, the search works the same without it)
};

const COLORS = ["#ff2f8e", "#33e8d8", "#ffb21f", "#8c82ff", "#ff7a30", "#c6f135", "#4da3ff", "#ff6b6b"];
const RGB    = [[255,47,142], [51,232,216], [255,178,31], [140,130,255], [255,122,48], [198,241,53], [77,163,255], [255,107,107]];
const GREEN  = "#2dff72";
const MONO = 'ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace';
const SANS = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
const AREA_H = 220;                                 // height of the column area in the panel

// Style markers (English). One column per group. Source: humanizer skill / Wikipedia "Signs of AI writing".
const SLOP = [
  {label: "words", re: /\b(?:delv(?:e|es|ed|ing)|tapestr(?:y|ies)|pivotal|vibrant|intricate|intricacies|interplay|underscor(?:e|es|ed|ing)|showcas(?:e|es|ed|ing)|fostering|garner(?:s|ed|ing)?|enduring|ever-evolving|evolving landscape)\b/gi},
  {label: "hype",  re: /\b(?:(?:a|the) testament to|stands as an?|serves as an?|plays? an? (?:vital|crucial|pivotal|key|significant) role|marks? an? (?:pivotal|significant|major) (?:moment|shift)|game-?chang(?:er|ing)|groundbreaking|breathtaking|nestled|in the heart of|rich (?:cultural )?heritage|must-visit|unlock(?:s|ing)? the (?:power|potential)|revolutioni[sz](?:e|es|ing))\b/gi},
  {label: "notX",  re: /\b(?:it'?s|this is|that'?s|isn'?t|is not|not)\s+(?:just|only|merely|simply)\b[^.!?\n]{0,80}?(?:[,;:\u2014\u2013-]|\.\.\.)\s*(?:it'?s|but|it is|this is|that'?s)\b|\bnot only\b[^.!?\n]{0,80}\bbut(?: also)?\b|,?\s+no (?:guessing|fluff|noise|hype|guesswork)\b/gi},
  {label: "bot",   re: /\b(?:i hope this helps|let me know if|feel free to|certainly!|of course!|great question|you'?re absolutely right|as of my (?:last|knowledge)|let'?s (?:dive in|dive into|break this down|explore)|here'?s what you need to know|without further ado|in conclusion|at its core|the real question is|it(?:'s| is) (?:important|worth) (?:to note|noting)|here'?s the (?:thing|kicker|catch))/gi},
  {label: "dash",  re: /\u2014|(?<!\d)\u2013(?!\d)|\s--\s|[\u{1F680}\u{1F4A1}\u2705\u2728\u{1F525}]/gu}
];

const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const lerp = (a,b,u) => a + (b-a)*u;
const easeOut = u => 1 - Math.pow(1-u, 3);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escHtml = s => s.replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

/* ====================== state ====================== */
let words = CONFIG.words.map(w => w.trim().toLowerCase()).filter(Boolean).slice(0, 8);
const userWords = { list: words.slice() };
let mode = CONFIG.mode === "slop" ? "slop" : "words";   // "words" = your keywords, "slop" = style markers
if(mode === "slop") words = SLOP.map(pt => pt.label);
let RE, reVersion = 0;
function setRegex(){ RE = new RegExp("\\b\\w*(?:" + words.map(esc).join("|") + ")\\w*\\b", "gi"); reVersion++; }
setRegex();

let active = false, raf = 0, last = 0, T = 0, W = 0, H = 0, dpr = 1;
let canvas, ctx, host, root;
let autoscroll = CONFIG.autoscroll, scrollAcc = 0, hintsOn = CONFIG.hints;
let expandOn = CONFIG.showMore, lastExpand = 0, expanded = 0;

const posts = new WeakMap();          // tweetText element -> {text, ver, list}
const artIds = new WeakMap();
let artCounter = 0;
let current = [];                     // matches that exist in the DOM right now
let scannedUnits = 0;                 // text blocks looked at in the last scan (for diagnostics)
const counted = new Set();            // match keys already counted, survives re-renders
const pairSeen = new Set();
let counts, shown, hits, pairs, postsSeen, unitsSeen, links, flights, pending, tgt, nextAt;
let head, drone, sparks = [], bandPrev = 0, bandY = 0, lastScan = 0, lastSnippet = null;
let lo = 100, hi = 600, colCenter = 0, colWidth = 600, colLeft = 0, colRight = 0;

function resetCounters(){
  counts = words.map(() => 0); shown = words.map(() => 0);
  hits = 0; pairs = 0; postsSeen = new Set(); unitsSeen = new Set();
  links = []; flights = []; pending = []; tgt = null; nextAt = 0; lastSnippet = null;
  counted.clear(); pairSeen.clear();
  head = {x: innerWidth/2, y: 140, bite: -9};
  initSpider(head.x, head.y - 66);
  reVersion++;                                     // forces a fresh scan of every post
  current = [];
}

/* ====================== finding keywords in posts ====================== */
function statusId(art){
  const a = art.querySelector('a[href*="/status/"]');
  const m = a && a.getAttribute("href").match(/status\/(\d+)/);
  if(m) return m[1];
  if(!artIds.has(art)) artIds.set(art, "a" + (++artCounter));
  return artIds.get(art);
}

function makeRange(nodes, from, to){
  let a = null, b = null;
  for(const n of nodes){
    const end = n.start + n.n.nodeValue.length;
    if(!a && from >= n.start && from < end) a = {node:n.n, off:from - n.start};
    if(to > n.start && to <= end) b = {node:n.n, off:to - n.start};
  }
  if(!a || !b) return null;
  const r = document.createRange();
  r.setStart(a.node, a.off); r.setEnd(b.node, b.off);
  return r;
}

function h32(str){ let h = 2166136261; for(let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

// X long-form articles are laid out differently from normal posts, so they are read block by block
const onX = /(^|\.)(x|twitter)\.com$/i.test(location.hostname);
function isGenericPage(){ return !onX || isArticlePage(); }
function isArticlePage(){
  return /\/article\b/.test(location.pathname) ||
         !!document.querySelector('[data-testid="twitterArticleReadView"],[data-testid="twitterArticleRichTextView"]');
}

function findMatches(acc){
  const found = [];
  if(mode === "slop"){
    SLOP.forEach((pt, wi) => {
      pt.re.lastIndex = 0; let m;
      while((m = pt.re.exec(acc))){ if(!m[0]){ pt.re.lastIndex++; continue; } found.push({index: m.index, text: m[0], wi}); }
    });
    found.sort((a, b) => a.index - b.index);
    const out = []; let end = -1;                     // earlier group wins when two patterns overlap
    for(const f of found){ if(f.index >= end){ out.push(f); end = f.index + f.text.length; } }
    return out;
  }
  RE.lastIndex = 0; let m;
  while((m = RE.exec(acc))){
    const wi = words.findIndex(w => m[0].toLowerCase().includes(w));
    if(wi >= 0) found.push({index: m.index, text: m[0], wi});
  }
  return found;
}

function processUnit(el, postKey, ei, nodes, acc, out){
  if(acc.trim()) unitsSeen.add(postKey + ":" + ei);
  let rec = posts.get(el);
  if(!rec || rec.text !== acc || rec.ver !== reVersion){
    rec = {text: acc, ver: reVersion, list: []};
    posts.set(el, rec);
    const bounds = [0]; const sre = /[.!?]["\u201d')]*\s+/g; let sm;
    while((sm = sre.exec(acc))) bounds.push(sm.index + sm[0].length);
    for(const f of findMatches(acc)){
      const range = makeRange(nodes, f.index, f.index + f.text.length);
      if(!range) continue;
      const key = postKey + ":" + ei + ":" + f.index + ":" + f.wi;
      const sent = bounds.filter(b => b <= f.index).length - 1;
      const mt = {key, wi: f.wi, word: f.text, range, sid: postKey + ":" + ei + ":" + sent, post: postKey + ":" + ei,
                  before: acc.slice(Math.max(0, f.index-16), f.index).replace(/\\s+/g, " "),
                  after:  acc.slice(f.index + f.text.length, f.index + f.text.length + 24).replace(/\\s+/g, " "),
                  caught: false, queued: false, caughtAt: -9, lastD: undefined};
      if(counted.has(key)){ mt.caught = true; mt.quiet = true; }   // seen before, show without recounting
      rec.list.push(mt);
    }
  }
  for(const mt of rec.list) out.push(mt);
}

function scanPosts(){
  const out = []; let units = 0;

  // 1. long-form article: group every text node under its nearest block (paragraph, heading, list item)
  if(isGenericPage()){
    const root = document.querySelector('[data-testid="twitterArticleReadView"]') ||
                 document.querySelector('main,[role="main"]') || document.body;
    const SKIP = onX ? "script,style,noscript"
                     : "script,style,noscript,nav,aside,footer,form,button,select,textarea,[contenteditable='true'],[role='navigation']";
    const groups = new Map();
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT});
    let n, count = 0;
    while((n = tw.nextNode()) && ++count < 20000){
      const par = n.parentElement;
      if(!par || par.closest(SKIP)) continue;
      if(par.closest('article[data-testid="tweet"]')) continue;          // normal posts are handled below
      const block = par.closest("div,p,li,h1,h2,h3,h4,h5,blockquote,td,dd,section") || par;
      if(!groups.has(block)) groups.set(block, []);
      groups.get(block).push(n);
    }
    groups.forEach((list, block) => {
      if(!onX){                                                          // big pages: only blocks near the screen
        const r = block.getBoundingClientRect();
        if(r.bottom < -H*1.5 || r.top > H*2.5) return;
      }
      const nodes = []; let acc = "";
      for(const t of list){ nodes.push({n: t, start: acc.length}); acc += t.nodeValue; }
      units++;
      processUnit(block, location.pathname, h32(acc.slice(0, 60)), nodes, acc, out);
    });
  }

  // 2. normal posts in the timeline, replies, quotes
  document.querySelectorAll('article[data-testid="tweet"]').forEach(art => {
    const id = statusId(art);
    art.querySelectorAll('[data-testid="tweetText"]').forEach((el, ei) => {
      const nodes = []; let acc = "";
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n; while((n = tw.nextNode())){ nodes.push({n, start: acc.length}); acc += n.nodeValue; }
      units++;
      processUnit(el, id, ei, nodes, acc, out);
    });
  });

  current = out; scannedUnits = units;
}

function rectOf(m){
  if(!m.range || !m.range.startContainer.isConnected) return null;
  const rs = m.range.getClientRects();
  for(const r of rs) if(r.width > 1 && r.height > 1) return r;
  return null;
}

/* ====================== overlay ====================== */
function panelHtml(){
  const cols = words.map((w, i) =>
    `<div class="c"><div class="area"><div class="bar" id="bar${i}" style="background:${COLORS[i]}"></div><i class="num" id="num${i}"></i></div><span class="lab">${escHtml(w)}</span></div>`).join("");
  const side = CONFIG.side === "right" ? "right" : "left";
  const PW = words.length > 5 ? 252 + (words.length - 5) * 40 : 252;       // panel grows with the number of columns
  return `<style>
  #p{position:fixed;top:72px;${side}:12px;width:${PW}px;box-sizing:border-box;padding:14px 14px 12px;border-radius:14px;background:rgba(14,10,22,.92);
     box-shadow:0 0 0 1px #2a2140,0 12px 40px rgba(0,0,0,.45);color:#efe9fb;font:13px/1.3 ${SANS};pointer-events:none}
  .hd{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}
  .hd b{font:600 18px/1 ${SANS}}
  .hd span{font:11px ${MONO};color:#8d84a3}
  .big{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}
  .big b{font:600 46px/1 ${SANS};letter-spacing:-.02em}
  .big span{font:600 12px/1 ${MONO};color:#2dff72;text-transform:uppercase;letter-spacing:.06em}
  .stats{display:flex;gap:14px;margin-bottom:12px}
  .st{display:flex;flex-direction:column}
  .st b{font:500 20px/1 ${MONO}}
  .st span{font:10px ${MONO};color:#8d84a3;margin-top:3px}
  .cols{display:flex;gap:6px}
  .c{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center}
  .area{position:relative;width:100%;height:${AREA_H}px;border-bottom:1px solid #2a2140;display:flex;align-items:flex-end}
  .bar{width:100%;height:0;border-radius:3px;transition:height .35s cubic-bezier(.2,.9,.2,1);
       -webkit-mask-image:repeating-linear-gradient(to top,#000 0,#000 calc(var(--u,22px) - 3px),transparent calc(var(--u,22px) - 3px),transparent var(--u,22px));
               mask-image:repeating-linear-gradient(to top,#000 0,#000 calc(var(--u,22px) - 3px),transparent calc(var(--u,22px) - 3px),transparent var(--u,22px))}
  .num{position:absolute;left:0;right:0;bottom:4px;text-align:center;font:500 13px/1 ${MONO};font-style:normal;color:#efe9fb;transition:bottom .35s cubic-bezier(.2,.9,.2,1)}
  .lab{margin-top:6px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 11px/1 ${MONO};color:${GREEN}}
  .last{margin-top:12px;min-height:30px;font:11px/1.35 ${MONO};color:#a99fc0;overflow:hidden}
  .btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;pointer-events:auto}
  .btns button{all:unset;cursor:pointer;padding:5px 9px;border-radius:7px;background:#1b1429;box-shadow:0 0 0 1px #2a2140;color:#cfc8e2;font:600 11px/1 ${MONO}}
  .btns button:hover{background:#271c3a}
  .btns button.on{color:#12091c;background:#2dff72;box-shadow:none}
  .hint{margin-top:8px;font:10px/1.4 ${MONO};color:#5d5473}
  </style>
  <div id="p">
    <div class="hd"><b id="ttl">Crawler</b><span id="mode"></span></div>
    <div class="big"><b id="s-big">0</b><span id="s-bl">matches</span></div>
    <div class="stats">
      <div class="st"><b id="s-p">0</b><span>pairs</span></div>
      <div class="st"><b id="s-n">0</b><span>posts</span></div>
      <div class="st"><b id="s-r">0%</b><span>share</span></div>
    </div>
    <div class="cols">${cols}</div>
    <div class="last" id="last"></div>
    <div class="btns" id="btns"><button id="b-mode">AI marks</button><button id="b-scroll">Auto-scroll</button><button id="b-more">Show more</button><button id="b-words">Words</button><button id="b-reset">Reset</button></div>
    <div class="hint" id="hint">Alt+A scroll &nbsp; Alt+R reset &nbsp; Alt+W words &nbsp; Alt+S markers &nbsp; Alt+G hide</div>
  </div>`;
}

function mount(){
  canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646";
  document.documentElement.appendChild(canvas);
  ctx = canvas.getContext("2d");
  host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647";
  document.documentElement.appendChild(host);
  root = host.attachShadow({mode: "open"});
  rebuildPanel();
  resize();
}
function rebuildPanel(){
  root.innerHTML = panelHtml();
  root.getElementById("b-mode").onclick = toggleSlop;
  root.getElementById("b-scroll").onclick = () => setAutoscroll(!autoscroll);
  root.getElementById("b-more").onclick = () => { expandOn = !expandOn; renderPanel(); };
  root.getElementById("b-words").onclick = askWords;
  root.getElementById("b-reset").onclick = reset;
  applyHints();
  renderPanel();
}
function resize(){
  dpr = window.devicePixelRatio || 1;
  W = innerWidth; H = innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function renderPanel(){
  const $ = id => root.getElementById(id);
  $("s-big").textContent = hits; $("s-bl").textContent = mode === "slop" ? "AI marks" : "matches"; $("s-p").textContent = pairs; $("s-n").textContent = postsSeen.size;
  $("mode").textContent = autoscroll ? "auto-scroll" : "manual";
  $("ttl").textContent = mode === "slop" ? "Style markers" : "Crawler";
  $("b-mode").classList.toggle("on", mode === "slop");
  $("b-scroll").classList.toggle("on", autoscroll);
  $("b-more").classList.toggle("on", expandOn);
  $("b-words").style.opacity = mode === "slop" ? .4 : 1;
  $("s-r").textContent = (unitsSeen.size ? Math.round(postsSeen.size / unitsSeen.size * 100) : 0) + "%";
  const mx = Math.max(1, ...shown);
  const u = Math.min(22, Math.floor(AREA_H / mx));
  words.forEach((w, i) => {
    const bar = $("bar" + i), num = $("num" + i);
    bar.style.setProperty("--u", u + "px");
    bar.style.height = (shown[i] * u) + "px";
    num.textContent = shown[i] || "";
    num.style.bottom = (shown[i] * u + 4) + "px";
  });
  const l = $("last");
  l.innerHTML = lastSnippet
    ? `\u2026${escHtml(lastSnippet.before)}<b style="color:${COLORS[lastSnippet.wi]}">${escHtml(lastSnippet.word)}</b>${escHtml(lastSnippet.after)}\u2026`
    : "";
}

/* ====================== crawler logic ====================== */
function layoutRefs(){
  const pc = document.querySelector('[data-testid="primaryColumn"],[data-testid="twitterArticleReadView"],main[role="main"]') ||
             (onX ? null : document.querySelector('main,[role="main"]'));
  if(pc){ const r = pc.getBoundingClientRect(); colLeft = r.left; colRight = r.right; colWidth = r.width; colCenter = r.left + r.width/2; }
  else { colLeft = 0; colRight = W; colWidth = W; colCenter = W/2; }
  lo = 140; hi = Math.max(lo + 200, H - 50);
}

function sweep(){
  bandPrev = bandY;
  const u = T * CONFIG.speed / 2.4;                          // one pass down and back up
  bandY = lo + (1 - Math.abs(2*(u % 1) - 1)) * (hi - lo);
  for(const m of current){
    if(m.caught || m.queued) continue;
    const r = rectOf(m);
    if(!r){ m.lastD = undefined; continue; }
    const y = r.top + r.height/2;
    if(y < lo - 40 || y > hi){ m.lastD = undefined; continue; }
    const d = y - bandY;
    const crossed = (m.lastD !== undefined && m.lastD * d <= 0) || Math.abs(d) < 10;
    const leaving = y < lo + 36;                             // about to scroll out unseen
    m.lastD = d;
    if((crossed || leaving) && pending.length < 12){ m.queued = true; pending.push(m); }
  }
}

function stepHead(){
  if(tgt){
    const r = rectOf(tgt.m);
    if(!r){ tgt.m.queued = false; tgt = null; return; }
    const u = clamp((T - tgt.t0) / tgt.dur, 0, 1), e = easeOut(u);
    head.x = lerp(tgt.fx, r.left + r.width/2, e); head.y = lerp(tgt.fy, r.top + r.height/2, e);
    if(u >= 1){ const m = tgt.m; tgt = null; onHit(m, r); }
  }else if(pending.length && T >= nextAt){
    const m = pending.shift();
    if(rectOf(m) && !m.caught){ tgt = {m, fx: head.x, fy: head.y, t0: T, dur: 0.18}; nextAt = T + 0.24; }
    else m.queued = false;
  }else{
    head.x += (colCenter + colWidth*0.34*Math.sin(T*1.7) - head.x) * 0.1;      // idle: ride the band
    head.y += (bandY - head.y) * 0.25;
  }
}

function barTop(i){                                           // where a chip should land for word i
  const area = root.getElementById("bar" + i).parentElement.getBoundingClientRect();
  const u = Math.min(22, Math.floor(AREA_H / Math.max(1, ...counts)));
  return {x: area.left + area.width/2, y: area.bottom - Math.max(1, counts[i]) * u + u/2};
}

function onHit(m, r){
  if(counted.has(m.key)){ m.caught = true; m.queued = false; return; }
  counted.add(m.key);
  m.caught = true; m.queued = false; m.caughtAt = T;
  counts[m.wi]++; hits++; postsSeen.add(m.post);
  head.bite = T;
  lastSnippet = m;
  for(const o of current){                                    // two different keywords in one sentence
    if(o !== m && o.caught && !o.quiet && o.sid === m.sid && o.wi !== m.wi){
      const pk = m.sid + ":" + Math.min(m.wi, o.wi) + "-" + Math.max(m.wi, o.wi);
      if(pairSeen.has(pk)) continue;
      pairSeen.add(pk); pairs++; links.push({a: m, b: o, born: T});
    }
  }
  const dest = barTop(m.wi);
  flights.push({x0: r.left + r.width/2, y0: r.top + r.height/2, x1: dest.x, y1: dest.y, t0: T, dur: 0.6, wi: m.wi, word: m.word.length > 22 ? m.word.slice(0, 21) + "\u2026" : m.word});
}

/* ====================== drawing ====================== */
function rrect(x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y); ctx.arcTo(x+w, y, x+w, y+h, r); ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r); ctx.arcTo(x, y, x+w, y, r); ctx.closePath();
}

function drawBoxes(){
  for(const m of current){
    if(!m.caught) continue;
    const r = rectOf(m);
    if(!r || r.bottom < 60 || r.top > H) continue;
    const age = T - m.caughtAt;
    const pop = m.quiet ? 0 : Math.max(0, 1 - age/0.3);
    const fs = clamp(r.height * 0.66, 11, 17);
    ctx.font = `600 ${fs}px ${MONO}`;
    const tw = ctx.measureText(m.word).width;
    const w = Math.max(r.width + 6, tw + 10), h = r.height + 2;
    const cx = r.left + r.width/2, cy = r.top + r.height/2, s = 1 + 0.4*pop;
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(s, s * (1 + 0.5*pop));
    ctx.globalAlpha = m.quiet ? 0.88 : Math.min(1, 0.3 + age*4);
    ctx.fillStyle = COLORS[m.wi];
    rrect(-w/2, -h/2, w, h, 4); ctx.fill();
    ctx.fillStyle = "#12091c"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(m.word, 0, 1);
    ctx.restore();
  }
}

function drawLinks(){
  links = links.filter(L => L.a.range.startContainer.isConnected || L.b.range.startContainer.isConnected);
  for(const L of links){
    const ra = rectOf(L.a), rb = rectOf(L.b);
    if(!ra || !rb) continue;
    ctx.save();
    ctx.strokeStyle = GREEN; ctx.lineWidth = 3; ctx.shadowColor = GREEN; ctx.shadowBlur = 10; ctx.lineCap = "round";
    const sameLine = Math.abs(ra.top - rb.top) < 6;
    ctx.beginPath();
    if(sameLine){
      const y = ra.bottom + 3;
      ctx.moveTo(Math.min(ra.left, rb.left) - 3, y); ctx.lineTo(Math.max(ra.right, rb.right) + 3, y);
    }else{
      const ax = ra.left + ra.width/2, ay = ra.top + ra.height/2, bx = rb.left + rb.width/2, by = rb.top + rb.height/2;
      ctx.moveTo(ax, ay); ctx.quadraticCurveTo(Math.max(ax, bx) + 40, (ay + by)/2, bx, by);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawBand(){
  const x = colLeft, w = colWidth;
  const g = ctx.createLinearGradient(0, bandY - 26, 0, bandY + 26);
  g.addColorStop(0, "rgba(255,47,142,0)"); g.addColorStop(.5, "rgba(255,47,142,.16)"); g.addColorStop(1, "rgba(255,47,142,0)");
  ctx.fillStyle = g; ctx.fillRect(x, bandY - 26, w, 52);
  ctx.fillStyle = "rgba(255,47,142,.7)"; ctx.fillRect(x, bandY - 1, w, 2);
}

/* ---------- spider: a glossy black glass widow that walks on the page; one front leg touches the scanned word ---------- */
const SC = 0.85, HOVER = 78 * SC;
const S1 = 118 * SC, S2 = 142 * SC;                    // upper and lower leg segment
const STEP_T = 0.1, STEP_D = 26 * SC;
const SPIDER_FONT = "ui-monospace,'JetBrains Mono',Menlo,Consolas,monospace";
const RIM = "rgba(150,215,255,.55)";                 // faint cool rim light, so the black body stays visible on dark pages
let legs = [], face = 1;
function initSpider(x, y){
  drone = {x, y, vx: 0, vy: 0}; face = 1; legs = [];
  const offs = [52, 92, 134, 176], oys = [-5, 6, -3, 8];
  for(const side of [-1, 1]) offs.forEach((o, i) => {
    legs.push({side, i, ox: o*SC, oy: oys[i]*SC, hunter: false,
               foot: {x: x + side*o*SC, y: y + HOVER + oys[i]*SC}, step: null, lift: 0, hx: x, hy: y});
  });
}
function updateSpider(dt){
  const tx = head.x, ty = head.y - HOVER;           // body hovers above the scanned point with a springy lag
  drone.vx += (tx - drone.x) * 70 * dt; drone.vy += (ty - drone.y) * 70 * dt;
  const damp = Math.exp(-9 * dt);
  drone.vx *= damp; drone.vy *= damp;
  drone.x += drone.vx * dt; drone.y += drone.vy * dt;
  if(drone.vx > 120) face = 1; else if(drone.vx < -120) face = -1;
  const hipY = drone.y + 2*SC, reach = (S1 + S2) * 0.985;
  let stepping = legs.filter(l => l.step).length;
  for(const lg of legs){
    lg.hunter = lg.side === face && lg.i === 0;      // the front leg on the side it is facing reaches for the word
    const hx = drone.x + lg.side * (4 + lg.i*2.5) * SC;
    if(lg.hunter){ lg.foot.x = head.x; lg.foot.y = head.y; lg.step = null; lg.lift = 0; }
    else{
      const lead = clamp(drone.vx * 0.08, -50, 50);
      const ix = drone.x + lg.side * lg.ox + lead, iy = head.y + lg.oy;
      if(lg.step){
        lg.step.t += dt;
        const u = clamp(lg.step.t / STEP_T, 0, 1), e = easeOut(u);
        lg.foot.x = lerp(lg.step.fx, ix, e); lg.foot.y = lerp(lg.step.fy, iy, e);
        lg.lift = Math.sin(u * Math.PI) * 18 * SC;
        if(u >= 1){ lg.step = null; lg.lift = 0; stepping--; }
      }else if(Math.hypot(lg.foot.x - ix, lg.foot.y - iy) > STEP_D && stepping < 3){
        lg.step = {t: 0, fx: lg.foot.x, fy: lg.foot.y}; stepping++;
      }
    }
    const dx = lg.foot.x - hx, dy = lg.foot.y - hipY, dd = Math.hypot(dx, dy);
    if(dd > reach){ lg.foot.x = hx + dx/dd*reach; lg.foot.y = hipY + dy/dd*reach; }
    lg.hx = hx; lg.hy = hipY;
  }
}
function legPts(lg){                                 // two-bone leg, knee always bends upward
  const hx = lg.hx, hy = lg.hy, fx = lg.foot.x, fy = lg.foot.y - lg.lift;
  const dx = fx - hx, dy = fy - hy;
  const d = Math.min(Math.hypot(dx, dy) || 1, (S1 + S2) * 0.999);
  const ux = dx / (Math.hypot(dx, dy) || 1), uy = dy / (Math.hypot(dx, dy) || 1);
  const a = (d*d + S1*S1 - S2*S2) / (2*d), h = Math.sqrt(Math.max(0, S1*S1 - a*a));
  let nx = -uy, ny = ux; if(ny > 0){ nx = -nx; ny = -ny; }
  return {hx, hy, kx: hx + ux*a + nx*h, ky: hy + uy*a + ny*h, fx: hx + ux*d, fy: hy + uy*d};
}
function drawSpider(alpha){
  if(alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const pulse = Math.max(0, 1 - (T - head.bite)/0.3);
  const bx = head.x, by = head.y;

  // legs: rim light, black glass, thin specular line
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for(const lg of legs){
    const p = legPts(lg);
    const wf = 3.7*SC, wt = 2.0*SC;
    ctx.shadowColor = "rgba(120,220,255,.6)"; ctx.shadowBlur = 8;
    ctx.strokeStyle = RIM;
    ctx.lineWidth = wf + 2.4; ctx.beginPath(); ctx.moveTo(p.hx, p.hy); ctx.lineTo(p.kx, p.ky); ctx.stroke();
    ctx.lineWidth = wt + 2.2; ctx.beginPath(); ctx.moveTo(p.kx, p.ky); ctx.lineTo(p.fx, p.fy); ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = "#07070b";
    ctx.lineWidth = wf; ctx.beginPath(); ctx.moveTo(p.hx, p.hy); ctx.lineTo(p.kx, p.ky); ctx.stroke();
    ctx.lineWidth = wt; ctx.beginPath(); ctx.moveTo(p.kx, p.ky); ctx.lineTo(p.fx, p.fy); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.lineWidth = Math.max(0.8, 0.8*SC);
    const sx = (p.ky - p.hy), sy = -(p.kx - p.hx), sl = Math.hypot(sx, sy) || 1;
    ctx.beginPath(); ctx.moveTo(p.hx + sx/sl*0.9*SC, p.hy + sy/sl*0.9*SC); ctx.lineTo(p.kx + sx/sl*0.9*SC, p.ky + sy/sl*0.9*SC); ctx.stroke();
  }

  // body
  ctx.save();
  ctx.translate(drone.x, drone.y + Math.sin(T*4) * 1.4 * SC);
  ctx.rotate(clamp(drone.vx / 2200, -0.18, 0.18));
  const sc = (1 + 0.07*pulse) * 1.05; ctx.scale(face * sc, sc);
  ctx.shadowColor = "rgba(120,220,255,.55)"; ctx.shadowBlur = 12;
  // abdomen
  const ag = ctx.createRadialGradient(-30*SC, -6*SC, 1, -22*SC, 4*SC, 28*SC);
  ag.addColorStop(0, "#5b5d69"); ag.addColorStop(.25, "#1b1b22"); ag.addColorStop(1, "#000");
  ctx.fillStyle = ag; ctx.strokeStyle = RIM; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.ellipse(-22*SC, 4*SC, 23*SC, 17*SC, 0, 0, 6.283); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#000"; ctx.lineWidth = 2*SC;                       // the tiny hook at the rear
  ctx.beginPath(); ctx.moveTo(-38*SC, 17*SC); ctx.quadraticCurveTo(-42*SC, 23*SC, -37*SC, 25*SC); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-32*SC, 21*SC); ctx.quadraticCurveTo(-34*SC, 27*SC, -29*SC, 28*SC); ctx.stroke();
  // joint ring, head, palps
  ctx.shadowColor = "rgba(120,220,255,.55)"; ctx.shadowBlur = 8;
  ctx.strokeStyle = "rgba(190,200,215,.85)"; ctx.lineWidth = 1.8*SC; ctx.fillStyle = "#0b0b10";
  ctx.beginPath(); ctx.arc(0, 3*SC, 4.6*SC, 0, 6.283); ctx.fill(); ctx.stroke();
  const hg = ctx.createRadialGradient(8*SC, -6*SC, 1, 14*SC, -1*SC, 15*SC);
  hg.addColorStop(0, "#5b5d69"); hg.addColorStop(.3, "#16161c"); hg.addColorStop(1, "#000");
  ctx.fillStyle = hg; ctx.strokeStyle = RIM; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.ellipse(14*SC, -1*SC, 13*SC, 8*SC, 0, 0, 6.283); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#000"; ctx.lineWidth = 2.2*SC;
  ctx.beginPath(); ctx.moveTo(24*SC, 3*SC); ctx.quadraticCurveTo(31*SC, 5*SC, 30*SC, 12*SC); ctx.stroke();
  ctx.fillStyle = `rgba(255,255,255,${.55 + .4*pulse})`;
  ctx.beginPath(); ctx.arc(21*SC, -5*SC, 1.3*SC, 0, 6.283); ctx.arc(24.5*SC, -2.5*SC, 1.3*SC, 0, 6.283); ctx.fill();
  ctx.restore();
  ctx.restore();
  ctx.restore();
}

function drawFlights(){
  const keep = [];
  for(const f of flights){
    const u = (T - f.t0) / f.dur;
    if(u >= 1){ shown[f.wi]++; renderPanel(); continue; }
    keep.push(f);
    const e = u*u*(3 - 2*u);
    const x = lerp(f.x0, f.x1, e), y = lerp(f.y0, f.y1, e) - Math.sin(u*Math.PI)*40;
    ctx.save();
    ctx.globalAlpha = 1 - u*u;
    ctx.font = `600 13px ${MONO}`;
    const w = ctx.measureText(f.word).width + 14;
    ctx.fillStyle = COLORS[f.wi]; rrect(x - w/2, y - 10, w, 20, 5); ctx.fill();
    ctx.fillStyle = "#12091c"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(f.word, x, y + 1);
    ctx.restore();
  }
  flights = keep;
}

/* ====================== main loop ====================== */
function frame(now){
  if(!active) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last)/1000 || 0); last = now; T += dt;

  if(autoscroll){
    scrollAcc += CONFIG.scrollPxPerSec * dt;
    const px = Math.floor(scrollAcc);
    if(px >= 1){ window.scrollBy(0, px); scrollAcc -= px; }
  }
  layoutRefs();
  if(now - lastScan > (onX ? 300 : 700)){ scanPosts(); lastScan = now; }
  expandOne(now);

  sweep();
  stepHead();
  updateSpider(dt);

  ctx.clearRect(0, 0, W, H);
  if(CONFIG.band) drawBand();
  drawBoxes();
  drawLinks();
  drawSpider(1);
  drawFlights();
}

/* ====================== "Show more" ====================== */
// Opens truncated posts so the whole text is read. Safe by design: it clicks only X's own show-more control,
// only when it is on screen, one per second, never twice on the same one, and never when it is a link to
// another page (that would navigate away from your feed).
function expandOne(now){
  if(!expandOn || !onX || now - lastExpand < 1000) return;
  for(const el of document.querySelectorAll('[data-testid="tweet-text-show-more-link"]')){
    if(el.dataset.crawlerDone) continue;
    const r = el.getBoundingClientRect();
    if(r.width < 2 || r.bottom < lo || r.top > hi) continue;
    el.dataset.crawlerDone = "1";
    const a = el.closest("a[href]") || (el.tagName === "A" ? el : null);
    if(a){
      let same = false;
      try{ same = new URL(a.getAttribute("href"), location.href).pathname === location.pathname; }catch(_){}
      if(!same){ el.dataset.crawlerDone = "skipped"; continue; }
    }
    el.click(); expanded++; lastExpand = now;
    return;
  }
}

/* ====================== controls ====================== */
function start(){
  if(!canvas) mount();
  canvas.style.display = ""; host.style.display = "";
  active = true; last = performance.now();
  cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
}
function stop(){
  active = false; cancelAnimationFrame(raf);
  if(canvas){ canvas.style.display = "none"; host.style.display = "none"; }
}
function toggle(){ active ? stop() : start(); }
function setAutoscroll(on){ autoscroll = !!on; if(root) renderPanel(); }
function reset(){ resetCounters(); if(root) renderPanel(); }
function applyMode(){
  words = mode === "slop" ? SLOP.map(pt => pt.label) : userWords.list.slice();
  setRegex(); resetCounters();
  if(root) rebuildPanel();
}
function setWords(list){
  const next = list.map(w => String(w).trim().toLowerCase()).filter(Boolean).slice(0, 8);
  if(!next.length) return;
  userWords.list = next; mode = "words"; applyMode();
}
function toggleSlop(){ mode = mode === "slop" ? "words" : "slop"; applyMode(); }

function askWords(){
  const v = prompt("Keywords, comma separated (up to 8)", userWords.list.join(", "));
  if(v) setWords(v.split(","));
}
function applyHints(){
  if(!root) return;
  root.getElementById("hint").style.display = hintsOn ? "" : "none";
  root.getElementById("btns").style.display = hintsOn ? "" : "none";
}
window.addEventListener("keydown", e => {
  if(!e.altKey) return;
  const K = CONFIG.keys;
  const act = {[K.toggle]: toggle, [K.scroll]: () => setAutoscroll(!autoscroll), [K.reset]: reset,
               [K.mode]: toggleSlop, [K.words]: askWords, [K.hints]: () => { hintsOn = !hintsOn; applyHints(); }}[e.code];
  if(!act) return;
  if(!active && e.code !== K.toggle) return;
  e.preventDefault(); e.stopPropagation();
  act();
}, true);
window.addEventListener("resize", () => { if(canvas) resize(); });

resetCounters();
window.__xCrawler = {start, stop, toggle, reset, setWords, slop: toggleSlop, hints: applyHints, showMore: v => { expandOn = !!v; if(root) renderPanel(); }, autoscroll: setAutoscroll,
                     state: () => ({active, hits, pairs, posts: postsSeen.size, counts: counts.slice(), shown: shown.slice(), words: words.slice(), visible: current.length, units: scannedUnits, article: isArticlePage(), generic: isGenericPage(), expanded, expandOn, mode, share: unitsSeen.size ? Math.round(postsSeen.size / unitsSeen.size * 100) : 0})};
if(CONFIG.autostart && (onX || CONFIG.autostartOthers)) start();
})();
