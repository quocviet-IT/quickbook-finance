/* The guide videos' overlay (3.0.28), injected into every page before the app's own scripts:
   a pointer that moves and clicks, an orange ring that follows the control a step names (the
   step pictures' orange), and the opening card. Nothing here takes a click: the root ignores
   the pointer, and every real click is Playwright's own. Captions are not drawn here; they are
   the film's own WebVTT track, which the reader can turn off.

   It also keeps real names off the screen: the recorder hands it pairs of [real, invented] and
   every text and field on every page is swapped as it appears, the way the step pictures are. */
(() => {
  if (window.__vt) return;
  const RING = "#f59e0b";
  const INK = "#0f172a";

  const css = `
  html { scrollbar-width: none !important; }
  html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; }
  .assistant-launcher, nextjs-portal, [data-nextjs-toast] { visibility: hidden !important; }
  #vt-root, #vt-root * { box-sizing: border-box; }
  #vt-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483640;
             font-family: "Segoe UI", system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }
  #vt-cur { position: fixed; left: 0; top: 0; width: 28px; height: 28px; z-index: 2147483647; transform: translate(-60px, -60px);
            transition-property: transform; transition-timing-function: cubic-bezier(.25,.8,.25,1); filter: drop-shadow(0 3px 4px rgba(0,0,0,.35)); }
  :root:has(#vt-card) #vt-cur { display: none; }
  .vt-ripple { position: fixed; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; border: 3px solid ${RING};
               background: rgba(245,158,11,.18); z-index: 2147483646; animation: vt-ripple .6s ease-out forwards; }
  @keyframes vt-ripple { from { transform: scale(.35); opacity: 1 } to { transform: scale(3); opacity: 0 } }
  .vt-ring { position: fixed; border: 3px solid ${RING}; border-radius: 10px; box-shadow: 0 0 0 4px rgba(245,158,11,.22), 0 0 22px rgba(245,158,11,.45);
             animation: vt-ring-in .45s cubic-bezier(.2,.9,.3,1.25); z-index: 2147483642; }
  @keyframes vt-ring-in { from { transform: scale(1.14); opacity: 0 } to { transform: scale(1); opacity: 1 } }
  #vt-back { position: fixed; inset: 0; z-index: 2147483643; background: rgba(15,23,42,.45); backdrop-filter: blur(5px) saturate(.9); animation: vt-fade .4s ease-out; }
  @keyframes vt-fade { from { opacity: 0 } to { opacity: 1 } }
  #vt-card { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 820px; z-index: 2147483644; background: #fff; color: ${INK};
             border-radius: 18px; box-shadow: 0 30px 80px rgba(2,6,23,.45); padding: 26px 32px 24px; animation: vt-card-in .55s cubic-bezier(.2,.9,.3,1.12); }
  @keyframes vt-card-in { from { opacity: 0; transform: translate(-50%, -46%) scale(.97) } to { opacity: 1; transform: translate(-50%, -50%) } }
  #vt-card .vt-k { font-size: 12.5px; letter-spacing: 1.6px; font-weight: 700; color: #0f766e; text-transform: uppercase; }
  #vt-card h1 { margin: 6px 0 4px; font-size: 30px; line-height: 1.18; font-weight: 700; letter-spacing: -.3px; }
  #vt-card .vt-s { color: #475569; font-size: 16px; line-height: 1.45; margin-bottom: 14px; }
  #vt-card ol { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; }
  #vt-card li { display: grid; grid-template-columns: 26px 1fr; gap: 10px; align-items: center; font-size: 15px; line-height: 1.3;
                padding: 6px 10px; border-radius: 10px; background: #f8fafc; border: 1px solid #e2e8f0; opacity: 0; animation: vt-row-in .45s ease-out forwards; }
  #vt-card li b { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: #0f766e; color: #fff; font-size: 13px; }
  @keyframes vt-row-in { from { opacity: 0; transform: translateX(-12px) } to { opacity: 1; transform: none } }
  `;

  const root = document.createElement("div");
  root.id = "vt-root";
  const style = document.createElement("style");
  style.textContent = css;
  root.appendChild(style);
  const cur = document.createElement("div");
  cur.id = "vt-cur";
  cur.innerHTML =
    '<svg viewBox="0 0 32 32" width="28" height="28"><path d="M6 3 L6 25 L11.5 19.8 L15.4 28.4 L19.4 26.6 L15.6 18.2 L23 18.2 Z" fill="#fff" stroke="#0f172a" stroke-width="2" stroke-linejoin="round"/></svg>';
  root.appendChild(cur);

  const store = {
    get(key) {
      try {
        return JSON.parse(sessionStorage.getItem(key) ?? "null");
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        sessionStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* a page without storage still draws */
      }
    },
  };

  // ---- the pointer: it keeps its place across a page load, as a real one would
  function placeCursor(x, y, ms) {
    cur.style.transitionDuration = `${ms}ms`;
    // The arrow's tip is at (6,3) of its box.
    cur.style.transform = `translate(${x - 6}px, ${y - 3}px)`;
    store.set("vt-cur", [x, y]);
  }
  const saved = store.get("vt-cur");
  if (saved) placeCursor(saved[0], saved[1], 0);

  // ---- rings follow the element they mark, so a scroll or a re-render never leaves one behind
  const rings = new Map();
  function layoutRings() {
    // React may render the whole body again after a page loads (a report does), taking this with it.
    if (!root.isConnected && document.body) {
      document.body.appendChild(root);
      observer.disconnect();
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      scrubNode(document.body);
    }
    for (const [id, ring] of rings) {
      const el = document.querySelector(`[data-vt~="${id}"]`);
      const box = el?.isConnected ? el.getBoundingClientRect() : null;
      if (!box || (box.width === 0 && box.height === 0)) {
        ring.style.display = "none";
        continue;
      }
      const pad = 5;
      ring.style.display = "block";
      ring.style.left = `${box.left - pad}px`;
      ring.style.top = `${box.top - pad}px`;
      ring.style.width = `${box.width + pad * 2}px`;
      ring.style.height = `${box.height + pad * 2}px`;
    }
    requestAnimationFrame(layoutRings);
  }
  requestAnimationFrame(layoutRings);

  // ---- real names, swapped as they appear
  let rules = [];
  const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
  function setSwaps(pairs) {
    rules = (pairs ?? []).map(([from, to]) => [
      new RegExp(`(?<![A-Za-z0-9_])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "g"),
      to,
    ]);
  }
  setSwaps(store.get("vt-swaps"));
  function swapText(text) {
    let next = text;
    for (const [pattern, to] of rules) next = next.replace(pattern, to);
    return next.replace(email, (address) => (address.endsWith("@example.com") ? address : "alex.morgan@example.com"));
  }
  function scrubNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.parentElement?.closest("#vt-root")) return;
      const next = swapText(node.nodeValue ?? "");
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches?.("input, textarea")) {
      const next = swapText(node.value ?? "");
      if (next !== node.value) node.value = next;
    }
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) scrubNode(text);
    for (const field of node.querySelectorAll?.("input, textarea") ?? []) scrubNode(field);
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") scrubNode(record.target);
      for (const added of record.addedNodes) scrubNode(added);
    }
  });

  const api = {
    swaps(pairs) {
      store.set("vt-swaps", pairs);
      setSwaps(pairs);
      scrubNode(document.body);
    },
    cursor(x, y, ms = 650) {
      placeCursor(x, y, ms);
    },
    ripple(x, y) {
      const dot = document.createElement("div");
      dot.className = "vt-ripple";
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      root.appendChild(dot);
      setTimeout(() => dot.remove(), 700);
    },
    ring(id) {
      if (rings.has(id)) return;
      const ring = document.createElement("div");
      ring.className = "vt-ring";
      root.appendChild(ring);
      rings.set(id, ring);
    },
    unring(id) {
      for (const [key, ring] of [...rings]) {
        if (id && key !== id) continue;
        ring.remove();
        rings.delete(key);
      }
    },
    /** The opening card: the guide's title, what it is for, and its steps. Null takes it away. */
    card(data) {
      document.getElementById("vt-back")?.remove();
      document.getElementById("vt-card")?.remove();
      if (!data) return;
      const back = document.createElement("div");
      back.id = "vt-back";
      const card = document.createElement("div");
      card.id = "vt-card";
      const kicker = document.createElement("div");
      kicker.className = "vt-k";
      kicker.textContent = data.kicker;
      const title = document.createElement("h1");
      title.textContent = data.title;
      const purpose = document.createElement("div");
      purpose.className = "vt-s";
      purpose.textContent = data.purpose;
      const list = document.createElement("ol");
      data.steps.forEach((step, index) => {
        const item = document.createElement("li");
        item.style.animationDelay = `${0.25 + index * 0.08}s`;
        const n = document.createElement("b");
        n.textContent = String(index + 1);
        const text = document.createElement("span");
        text.textContent = step;
        item.append(n, text);
        list.appendChild(item);
      });
      card.append(kicker, title, purpose, list);
      root.append(back, card);
    },
    /** What is on screen that should not be: a real name or an email address not invented. */
    leaks(real) {
      const text = `${document.body.innerText}\n${[...document.querySelectorAll("input, textarea")].map((f) => f.value).join("\n")}`;
      const names = real.filter((from) =>
        new RegExp(`(?<![A-Za-z0-9_])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`).test(text),
      ).length;
      const emails = (text.match(email) ?? []).filter((address) => !address.endsWith("@example.com")).length;
      return { names, emails };
    },
  };
  window.__vt = api;

  function mount() {
    if (!document.body) return requestAnimationFrame(mount);
    document.body.appendChild(root);
    scrubNode(document.body);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  }
  mount();
})();
