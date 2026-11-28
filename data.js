// ==========================================================
// DABBADASH - CLIENT DATA LAYER (used by index.html and track.html)
// Business rules live in core.js. This file only:
//   * talks to the REST API (server.js) and polls it,
//   * falls back to localStorage when opened without the server,
//   * corrects for clock differences between devices (DD.now()),
//   * draws the shared customer tracker widget.
// ==========================================================
"use strict";

const DD = (function (C) {

    const KEY = "dabbaDashStateV3";
    let serverOn = /^https?:$/.test(location.protocol);
    let clockOffset = 0;                       // serverNow - local Date.now()
    let current = null;                        // latest known state

    const now = () => Date.now() + clockOffset;

    // ---------- local fallback (no server) ----------
    function readLocal() {
        try {
            const s = JSON.parse(localStorage.getItem(KEY));
            return C.validState(s) ? s : null;
        } catch (e) { return null; }
    }
    function writeLocal(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ } }

    function adopt(s) {
        if (s && typeof s.serverNow === "number") clockOffset = s.serverNow - Date.now();
        if (!Array.isArray(s.sms)) s.sms = [];
        current = s;
        return s;
    }

    // ---------- REST helpers ----------
    async function api(method, url, body) {
        const r = await fetch("api/" + url, {
            method, cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : undefined
        });
        let data = null;
        try { data = await r.json(); } catch (e) { /* non-JSON */ }
        if (!data) throw new Error("Bad response");
        return data;
    }

    async function load() {
        if (serverOn) {
            try { return adopt(await api("GET", "state")); }
            catch (e) { serverOn = false; }
        }
        let s = readLocal();
        if (!s) { s = C.freshState(Date.now()); writeLocal(s); }
        return adopt(s);
    }

    // Poll: returns true when something changed since the last call.
    async function refresh() {
        const before = current ? current.rev : -1;
        if (serverOn) {
            try { adopt(await api("GET", "state")); }
            catch (e) { serverOn = false; }                // server stopped: keep working locally
        }
        if (!serverOn) {
            const s = readLocal();
            if (s) adopt(s);
        }
        return current.rev !== before;
    }

    const ROUTES = { advance: "advance", assign: "assign", unassign: "unassign", dispatch: "dispatch", sms: "sms" };

    // Perform one action (advance / assign / dispatch / unassign / sms / newOrder).
    // Resolves to {ok, message|error}. `DD.state()` is updated afterwards.
    async function act(action) {
        if (serverOn) {
            try {
                const url = action.type === "newOrder" ? "orders" : `orders/${action.id}/${ROUTES[action.type]}`;
                const r = await api("POST", url, { riderId: action.riderId });
                if (r.state) adopt(r.state);
                return r;
            } catch (e) { serverOn = false; }
        }
        const s = readLocal() || current;
        const r = C.applyAction(s, action, Date.now());
        if (r.ok) writeLocal(s);
        adopt(s);
        return r;
    }

    async function reset() {
        if (serverOn) {
            try { const r = await api("POST", "reset"); adopt(r.state); return r; }
            catch (e) { serverOn = false; }
        }
        const s = C.freshState(Date.now());
        const old = readLocal();
        s.rev = ((old && old.rev) || 0) + 1;
        writeLocal(s); adopt(s);
        return { ok: true, message: "Demo data reset" };
    }

    function trackLink(orderId) {
        const base = location.href.replace(/[^/]*([?#].*)?$/, "");
        return base + "track.html?order=" + orderId;
    }

    // ---------- shared tracker widget (dashboard + customer page) ----------
    function buildTracker(root) {
        root.innerHTML = `
            <div class="tracking-header">
                <div>
                    <span class="tracking-label">TRACK YOUR ORDER</span>
                    <h2 data-t="id">#DD---</h2>
                </div>
                <span class="tracking-status" data-t="status">-</span>
            </div>
            <p class="tracking-headline" data-t="headline" aria-live="polite"></p>
            <div class="delivery-animation">
                <div class="track-line"><div class="track-progress" data-t="progress"></div></div>
                <div class="scooter" data-t="scooter" aria-hidden="true">🛵</div>
                <div class="home-pin" aria-hidden="true">🏠</div>
            </div>
            <div class="tracking-steps">
                ${["✓|Received", "♨|In Kitchen", "▣|Packed", "🛵|On the way", "★|Delivered"]
                    .map(s => `<div class="step"><div class="step-icon">${s.split("|")[0]}</div><span>${s.split("|")[1]}</span></div>`).join("")}
            </div>
            <div class="tracking-footer">
                <div><small>DELIVERY PARTNER</small><strong data-t="rider">Not assigned yet</strong></div>
                <div><small>ORDER</small><strong data-t="items">-</strong></div>
                <div><small data-t="etaLabel">ESTIMATED DELIVERY</small><strong class="eta" data-t="eta">-</strong></div>
            </div>`;
    }

    function updateTracker(root, order, at) {
        const q = k => root.querySelector(`[data-t="${k}"]`);
        if (!order) { q("headline").textContent = "Order not found. Check the order number."; return; }
        const rider = C.riderOf(order.riderId);
        const idx = C.STAGES.indexOf(order.status);
        let pct = idx * 25;
        let eta, etaLabel = "ESTIMATED DELIVERY";

        if (order.status === "Out for Delivery") {
            const total = (order.etaEndsAt - order.dispatchedAt) || 1;
            const f = Math.min(1, Math.max(0, (at - order.dispatchedAt) / total));
            pct = 75 + 25 * f * 0.96;                    // vehicle glides from "on the way" to the door
            const left = order.etaEndsAt - at;
            eta = left > 0 ? C.fmtClock(left) + " min remaining" : "Arriving now";
        } else if (order.status === "Delivered") {
            eta = "Delivered at " + new Date(order.deliveredAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
            etaLabel = "DELIVERED";
        } else if (order.status === "In Kitchen") {
            const cooked = (at - (order.kitchenAt || at)) / C.MIN;
            eta = "About " + Math.round(Math.max(2, 18 - cooked) + order.transitMin) + " min";
        } else if (order.status === "Packed") {
            eta = "About " + (order.transitMin + (rider ? 2 : 5)) + " min";
        } else {
            eta = "About " + (18 + order.transitMin) + " min";
        }

        q("id").textContent = "#DD" + order.id;
        q("status").textContent = order.status;
        q("headline").textContent = C.statusHeadline(order);
        q("progress").style.width = pct + "%";
        q("scooter").style.left = pct + "%";
        q("rider").textContent = rider ? `${rider.name} (${rider.vehicle}, ${C.zoneOf(rider.sector)})` : "Not assigned yet";
        q("items").textContent = C.itemsText(order);
        q("eta").textContent = eta;
        q("etaLabel").textContent = etaLabel;

        root.querySelectorAll(".tracking-steps .step").forEach((step, i) => {
            step.classList.toggle("completed", i < idx || order.status === "Delivered");
            step.classList.toggle("current", i === idx && order.status !== "Delivered");
        });
    }

    return Object.assign({}, C, {
        now, load, refresh, act, reset, trackLink, buildTracker, updateTracker,
        state: () => current,
        isOnline: () => serverOn
    });
})(DDCore);
