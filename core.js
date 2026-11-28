// ==========================================================
// DABBADASH CORE - pure business logic, no DOM, no network.
// Loaded by the browser (as window.DDCore) AND by server.js
// (require("./core.js")), so the kitchen dashboard, the customer
// page and the REST API all follow exactly the same rules.
// ==========================================================
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.DDCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const MIN = 60000;
    const STAGES = ["Received", "In Kitchen", "Packed", "Out for Delivery", "Delivered"];
    const KITCHEN_ALERT_MIN = 20;            // bottleneck threshold (brief)
    const CLUSTER_RADIUS_KM = 2.5;           // batching radius (brief)
    const SURGE_MULTIPLIER = 1.5;
    const HUB = { name: "DabbaDash Central Kitchen", lat: 17.4440, lng: 78.4670 };

    // ---------- 3 virtual brands ----------
    const BRANDS = [
        { id: "biryani", name: "Biryani Box", emoji: "🍛", cuisine: "Indian Cuisine" },
        { id: "burger",  name: "Burger Den",  emoji: "🍔", cuisine: "Fast Food" },
        { id: "chai",    name: "Chai Point",  emoji: "☕", cuisine: "Beverages & Snacks" }
    ];

    // ---------- 20 menu items, every one tagged with brandId ----------
    const MENU = [
        { id: "b1", brandId: "biryani", name: "Chicken Biryani", price: 249 },
        { id: "b2", brandId: "biryani", name: "Mutton Biryani",  price: 299 },
        { id: "b3", brandId: "biryani", name: "Veg Biryani",     price: 179 },
        { id: "b4", brandId: "biryani", name: "Paneer Biryani",  price: 219 },
        { id: "b5", brandId: "biryani", name: "Egg Biryani",     price: 199 },
        { id: "b6", brandId: "biryani", name: "Raita",           price: 39 },
        { id: "b7", brandId: "biryani", name: "Double Ka Meetha", price: 79 },
        { id: "g1", brandId: "burger",  name: "Cheese Burger",   price: 199 },
        { id: "g2", brandId: "burger",  name: "Chicken Burger",  price: 229 },
        { id: "g3", brandId: "burger",  name: "Veg Burger",      price: 159 },
        { id: "g4", brandId: "burger",  name: "Double Burger",   price: 279 },
        { id: "g5", brandId: "burger",  name: "Fries",           price: 99 },
        { id: "g6", brandId: "burger",  name: "Peri Peri Wings", price: 189 },
        { id: "g7", brandId: "burger",  name: "Coke",            price: 49 },
        { id: "c1", brandId: "chai",    name: "Masala Chai",     price: 49 },
        { id: "c2", brandId: "chai",    name: "Ginger Tea",      price: 59 },
        { id: "c3", brandId: "chai",    name: "Cold Coffee",     price: 129 },
        { id: "c4", brandId: "chai",    name: "Samosa (2 pcs)",  price: 40 },
        { id: "c5", brandId: "chai",    name: "Bun Maska",       price: 60 },
        { id: "c6", brandId: "chai",    name: "Veg Puff",        price: 45 }
    ];

    // ---------- 4 delivery zones (brief says "Zone 2" in its demo = Sector B) ----------
    const SECTORS = {
        "Sector A": { zone: 1, area: "Banjara Hills", lat: 17.4156, lng: 78.4347 },
        "Sector B": { zone: 2, area: "Secunderabad",  lat: 17.4399, lng: 78.4983 },
        "Sector C": { zone: 3, area: "Madhapur",      lat: 17.4486, lng: 78.3908 },
        "Sector D": { zone: 4, area: "Gachibowli",    lat: 17.4401, lng: 78.3489 }
    };
    const SECTOR_NAMES = Object.keys(SECTORS);

    // ---------- 6 riders; capacity depends on vehicle (Bike 2, Scooter 3) ----------
    const RIDERS = [
        { id: 1, name: "Ramesh", sector: "Sector B", vehicle: "Bike",    capacity: 2, off: [0.3, 0.2] },
        { id: 2, name: "Suresh", sector: "Sector A", vehicle: "Scooter", capacity: 3, off: [0.2, -0.3] },
        { id: 3, name: "Arjun",  sector: "Sector C", vehicle: "Bike",    capacity: 2, off: [-0.3, 0.3] },
        { id: 4, name: "Kiran",  sector: "Sector D", vehicle: "Bike",    capacity: 2, off: [0.3, 0.3] },
        { id: 5, name: "Rahul",  sector: "Sector A", vehicle: "Scooter", capacity: 3, off: [-0.5, 0.4] },
        { id: 6, name: "Vikram", sector: "Sector B", vehicle: "Bike",    capacity: 2, off: [1.2, 0.9] }
    ];

    // ---------- helpers ----------
    const brandOf = id => BRANDS.find(b => b.id === id);
    const menuOf = id => MENU.find(m => m.id === id);
    const riderOf = id => RIDERS.find(r => r.id === Number(id)) || null;
    const zoneOf = sector => (SECTORS[sector] ? "Zone " + SECTORS[sector].zone : sector);

    function esc(value) {
        return String(value).replace(/[&<>"']/g, c => (
            { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function kmBetween(a, b) {
        const R = 6371, rad = d => d * Math.PI / 180;
        const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
        const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    function offsetPoint(base, dxKm, dyKm) {
        return {
            lat: base.lat + dyKm / 111,
            lng: base.lng + dxKm / (111 * Math.cos(base.lat * Math.PI / 180))
        };
    }

    function orderTotal(order) {
        return order.items.reduce((sum, i) => sum + ((menuOf(i.menuId) || {}).price || 0) * i.qty, 0);
    }

    function itemsText(order) {
        return order.items.map(i => `${i.qty}× ${(menuOf(i.menuId) || {}).name || i.menuId}`).join(", ");
    }

    function transitMinutes(distKm) {
        return Math.min(15, Math.max(6, Math.round(4 + distKm * 1.5)));
    }

    function fmtClock(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    }

    // ---------- 15 seeded orders ----------
    // [id, customer, brandId, items, sector, dx, dy, status, riderId,
    //  createdAgo, kitchenAgo, packedAgo, dispatchedAgo, deliveredAgo]
    function makeSeed(now) {
        const rows = [
            [101, "Rahul Sharma", "biryani", [["b1", 1], ["b6", 1]], "Sector A", 0.3, 0.2, "Received", null, 3, null, null, null, null],
            [102, "Priya Reddy",  "burger",  [["g1", 1], ["g5", 1]], "Sector B", 0.4, -0.3, "In Kitchen", null, 14, 12, null, null, null],
            [103, "Arjun Kumar",  "chai",    [["c1", 2], ["c4", 1]], "Sector C", 0.3, 0.2, "Packed", null, 22, 17, 8, null, null],
            [104, "Vishal Reddy", "burger",  [["g1", 2], ["g5", 1]], "Sector B", 0.5, 0.4, "In Kitchen", null, 17, 15, null, null, null],
            [105, "Sneha Rao",    "biryani", [["b3", 1], ["b7", 1]], "Sector A", -0.4, 0.3, "Received", null, 2, null, null, null, null],
            [106, "Karthik Raju", "chai",    [["c2", 1], ["c4", 1]], "Sector D", 0.2, -0.2, "Out for Delivery", 4, 30, 25, 15, 4, null],
            [107, "Ananya Das",   "burger",  [["g2", 1], ["g5", 1]], "Sector C", -0.6, 0.5, "Packed", null, 31, 25, 6, null, null],
            [108, "Sai Charan",   "biryani", [["b2", 1]],            "Sector B", -0.3, 0.3, "In Kitchen", null, 24, 22, null, null, null],
            [109, "Meghana",      "chai",    [["c3", 1]],            "Sector A", 0.2, -0.4, "Delivered", 2, 55, 50, 40, 35, 22],
            [110, "Nikhil",       "burger",  [["g3", 1], ["g7", 1]], "Sector D", 0.4, 0.3, "Packed", null, 28, 22, 6, null, null],
            [111, "Pooja",        "biryani", [["b1", 1]],            "Sector C", 0.5, -0.4, "Delivered", 3, 70, 65, 50, 45, 30],
            [112, "Manoj",        "chai",    [["c2", 1]],            "Sector B", -0.2, 0.5, "Delivered", 1, 60, 56, 48, 44, 33],
            [113, "Divya",        "burger",  [["g4", 1], ["g5", 1]], "Sector A", 0.1, 0.5, "In Kitchen", null, 21, 19, null, null, null],
            [114, "Rohit",        "biryani", [["b3", 1], ["b6", 1]], "Sector D", -0.5, -0.6, "Packed", null, 26, 22, 10, null, null],
            [115, "Keerthi",      "chai",    [["c2", 1], ["c6", 1]], "Sector C", 0.2, 0.1, "Out for Delivery", 3, 20, 16, 8, 6, null]
        ];
        const ago = m => (m == null ? null : now - m * MIN);

        return rows.map(r => {
            const pt = offsetPoint(SECTORS[r[4]], r[5], r[6]);
            const distKm = kmBetween(HUB, pt);
            const transit = transitMinutes(distKm);
            const dispatchedAt = ago(r[12]);
            return {
                id: r[0], customer: r[1], phone: "+91 98" + String(r[0] * 7919).padStart(8, "0").slice(-8),
                brandId: r[2], items: r[3].map(i => ({ menuId: i[0], qty: i[1] })),
                sector: r[4], lat: pt.lat, lng: pt.lng, distKm: Math.round(distKm * 10) / 10,
                status: r[7], riderId: r[8],
                createdAt: ago(r[9]), kitchenAt: ago(r[10]), packedAt: ago(r[11]),
                dispatchedAt, deliveredAt: ago(r[13]),
                transitMin: transit,
                etaEndsAt: r[7] === "Out for Delivery" ? dispatchedAt + transit * MIN : null
            };
        });
    }

    function freshState(now) {
        return { version: 2, rev: 1, orders: makeSeed(now == null ? Date.now() : now), sms: [] };
    }

    function validState(s) {
        return !!(s && s.version === 2 && Array.isArray(s.orders));
    }

    // ---------- rider logic ----------
    function riderLoad(state, rider) {
        return state.orders.filter(o => o.riderId === rider.id &&
            (o.status === "Packed" || o.status === "Out for Delivery")).length;
    }

    function riderPosition(state, rider, now) {
        const home = offsetPoint(SECTORS[rider.sector], rider.off[0], rider.off[1]);
        const live = state.orders.find(o => o.riderId === rider.id && o.status === "Out for Delivery");
        if (live) {
            const total = (live.etaEndsAt - live.dispatchedAt) || 1;
            const f = Math.min(1, Math.max(0, (now - live.dispatchedAt) / total));
            return { lat: HUB.lat + (live.lat - HUB.lat) * f, lng: HUB.lng + (live.lng - HUB.lng) * f };
        }
        if (state.orders.some(o => o.riderId === rider.id && o.status === "Packed")) return { lat: HUB.lat, lng: HUB.lng };
        return home;
    }

    // Courier recommendation: free capacity first, then same delivery sector, then nearest.
    function recommendRiders(state, order, now) {
        return RIDERS.map(rider => {
            const load = riderLoad(state, rider);
            const free = rider.capacity - load;
            const km = kmBetween(riderPosition(state, rider, now), order);
            const sameSector = rider.sector === order.sector;
            return { rider, load, free, km, sameSector };
        }).sort((a, b) => {
            if ((b.free > 0) - (a.free > 0)) return (b.free > 0) - (a.free > 0);
            if (b.sameSector - a.sameSector) return b.sameSector - a.sameSector;
            return a.km - b.km;
        });
    }

    // ---------- hyperlocal batcher (radius clustering) ----------
    function centroid(group) {
        return {
            lat: group.reduce((s, o) => s + o.lat, 0) / group.length,
            lng: group.reduce((s, o) => s + o.lng, 0) / group.length
        };
    }

    // Greedy: take the first unclustered order, pull in every order within
    // `radiusKm` of the growing centroid, repeat. Each group = one multi-drop trip.
    function clusterOrders(orders, radiusKm) {
        const left = orders.slice().sort((a, b) => a.id - b.id);
        const clusters = [];
        while (left.length) {
            const group = [left.shift()];
            let grew = true;
            while (grew) {
                grew = false;
                const c = centroid(group);
                for (let i = left.length - 1; i >= 0; i--) {
                    if (kmBetween(c, left[i]) <= radiusKm) { group.push(left.splice(i, 1)[0]); grew = true; }
                }
            }
            const c = centroid(group);
            const counts = {};
            group.forEach(o => { counts[o.sector] = (counts[o.sector] || 0) + 1; });
            const sector = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
            clusters.push({
                orders: group.sort((a, b) => a.id - b.id), center: c, sector,
                spreadKm: Math.max(...group.map(o => kmBetween(c, o)))
            });
        }
        return clusters;
    }

    // ---------- payout ----------
    function isPeakHour(date) {
        const h = date.getHours();
        return (h >= 12 && h < 15) || (h >= 19 && h < 23);
    }

    function surgeActive(state, mode, now) {
        if (mode === "on") return true;
        if (mode === "off") return false;
        const pending = state.orders.filter(o => o.status === "Packed").length;
        return isPeakHour(new Date(now)) || pending >= 4;
    }

    // ---------- KPIs (used by dashboard AND GET /api/metrics) ----------
    function kitchenMinutes(order, now) {
        return order.kitchenAt ? (now - order.kitchenAt) / MIN : 0;
    }

    function bottlenecks(state, now) {
        return state.orders.filter(o => o.status === "In Kitchen" && kitchenMinutes(o, now) > KITCHEN_ALERT_MIN);
    }

    function metrics(state, now) {
        const o = state.orders;
        const done = o.filter(x => x.kitchenAt && x.packedAt);
        const avgPrepMin = done.length
            ? done.reduce((s, x) => s + (x.packedAt - x.kitchenAt) / MIN, 0) / done.length : 0;
        const packed = o.filter(x => x.status === "Packed");
        return {
            totalOrders: o.length,
            activeOrders: o.filter(x => x.status !== "Delivered").length,
            inKitchen: o.filter(x => x.status === "In Kitchen").length,
            avgPrepMin: Math.round(avgPrepMin * 10) / 10,
            completedTickets: done.length,
            pendingDispatch: packed.length,
            needCourier: packed.filter(x => !x.riderId).length,
            outForDelivery: o.filter(x => x.status === "Out for Delivery").length,
            bottlenecks: bottlenecks(state, now).map(x => x.id)
        };
    }

    // ---------- customer status text ----------
    function statusHeadline(order) {
        const rider = riderOf(order.riderId);
        const brand = (brandOf(order.brandId) || {}).name || "the kitchen";
        switch (order.status) {
            case "Received": return `${brand} has received your order.`;
            case "In Kitchen": return "Your food is being freshly prepared.";
            case "Packed": return rider
                ? `Courier Assigned - ${rider.name} is picking up your food!`
                : "Your order is packed and waiting for a courier.";
            case "Out for Delivery": return `${rider ? rider.name : "Your courier"} is on the way to you!`;
            case "Delivered": return "Delivered. Enjoy your meal!";
            default: return "";
        }
    }

    // ---------- state transitions (the ONE place rules live) ----------
    const NAMES = ["Aarav Mehta", "Ishita Nair", "Farhan Ali", "Lakshmi Devi", "Tarun Gupta", "Zoya Khan", "Bharat Yadav", "Nisha Iyer"];
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];

    function makeRandomOrder(state, now) {
        const brand = pick(BRANDS);
        const menu = MENU.filter(m => m.brandId === brand.id).sort(() => Math.random() - 0.5)
            .slice(0, 1 + Math.floor(Math.random() * 3));
        const sector = pick(SECTOR_NAMES);
        const pt = offsetPoint(SECTORS[sector], (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6);
        const dist = kmBetween(HUB, pt);
        return {
            id: Math.max(100, ...state.orders.map(o => o.id)) + 1,
            customer: pick(NAMES), phone: "+91 9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0"),
            brandId: brand.id, items: menu.map(m => ({ menuId: m.id, qty: 1 + Math.floor(Math.random() * 2) })),
            sector, lat: pt.lat, lng: pt.lng, distKm: Math.round(dist * 10) / 10,
            status: "Received", riderId: null,
            createdAt: now, kitchenAt: null, packedAt: null, dispatchedAt: null, deliveredAt: null,
            transitMin: transitMinutes(dist), etaEndsAt: null
        };
    }

    function pushSms(state, order, text, now) {
        state.sms.unshift({ at: now, orderId: order.id, to: order.customer, phone: order.phone, text });
        state.sms = state.sms.slice(0, 30);
    }

    /**
     * applyAction(state, action, now) -> { ok, message?, error?, orderId? }
     * Mutates `state` only when ok. action.type is one of:
     *   advance | assign | dispatch | unassign | sms | newOrder
     */
    function applyAction(state, action, now) {
        if (!Array.isArray(state.sms)) state.sms = [];
        const fail = error => ({ ok: false, error });
        const find = id => state.orders.find(o => o.id === Number(id));
        const done = (message, orderId) => { state.rev = (state.rev || 0) + 1; return { ok: true, message, orderId }; };

        if (!action || typeof action.type !== "string") return fail("Missing action type");

        if (action.type === "newOrder") {
            const order = makeRandomOrder(state, now);
            state.orders.push(order);
            return done(`New ${brandOf(order.brandId).name} order #DD${order.id} received`, order.id);
        }

        const o = find(action.id);
        if (!o) return fail("Order not found");
        const brandName = brandOf(o.brandId).name;

        switch (action.type) {
            case "advance":
                if (o.status === "Received") {
                    o.status = "In Kitchen"; o.kitchenAt = now;
                    return done(`#DD${o.id} sent to the kitchen`, o.id);
                }
                if (o.status === "In Kitchen") {
                    o.status = "Packed"; o.packedAt = now;
                    const rec = recommendRiders(state, o, now)[0];
                    return done(`#DD${o.id} packed.` + (rec && rec.free > 0
                        ? ` Recommended courier: ${rec.rider.name} (${zoneOf(rec.rider.sector)}).`
                        : " No free courier yet."), o.id);
                }
                if (o.status === "Out for Delivery") {
                    o.status = "Delivered"; o.deliveredAt = now; o.etaEndsAt = null;
                    pushSms(state, o, `Delivered! Thanks for ordering from ${brandName}, ${o.customer}.`, now);
                    return done(`#DD${o.id} delivered`, o.id);
                }
                if (o.status === "Packed") return fail(`#DD${o.id} is packed: assign a courier and dispatch it`);
                return fail(`#DD${o.id} is already delivered`);

            case "assign": {
                const r = riderOf(action.riderId);
                if (!r) return fail("Courier not found");
                if (o.status !== "Packed") return fail("Only packed orders can be assigned a courier");
                if (o.riderId) return fail(`#DD${o.id} already has a courier`);
                if (riderLoad(state, r) >= r.capacity) return fail(`${r.name} is at full capacity (${r.capacity}).`);
                o.riderId = r.id;
                pushSms(state, o, `Hi ${o.customer}, courier ${r.name} will pick up your ${brandName} order #DD${o.id} shortly.`, now);
                return done(`${r.name} assigned to #DD${o.id}`, o.id);
            }

            case "unassign":
                if (o.status !== "Packed") return fail("Courier can only be removed before dispatch");
                o.riderId = null;
                return done(`Courier removed from #DD${o.id}`, o.id);

            case "dispatch": {
                if (o.status !== "Packed") return fail("Only packed orders can be dispatched");
                if (!o.riderId) return fail("Assign a courier before dispatching");
                const r = riderOf(o.riderId);
                o.status = "Out for Delivery"; o.dispatchedAt = now; o.etaEndsAt = now + o.transitMin * MIN;
                pushSms(state, o, `Your order #DD${o.id} is out for delivery with ${r.name}. ETA ${o.transitMin} min.`, now);
                return done(`#DD${o.id} dispatched with ${r.name}`, o.id);
            }

            case "sms":
                pushSms(state, o, `Hi ${o.customer}, track your ${brandName} order #DD${o.id} live:`, now);
                return done(`Tracking SMS sent to ${o.phone}`, o.id);

            default:
                return fail("Unknown action: " + action.type);
        }
    }

    return {
        MIN, STAGES, KITCHEN_ALERT_MIN, CLUSTER_RADIUS_KM, SURGE_MULTIPLIER, HUB,
        BRANDS, MENU, SECTORS, SECTOR_NAMES, RIDERS,
        brandOf, menuOf, riderOf, zoneOf, esc, kmBetween, offsetPoint, orderTotal, itemsText,
        transitMinutes, fmtClock, makeSeed, freshState, validState,
        riderLoad, riderPosition, recommendRiders, centroid, clusterOrders,
        isPeakHour, surgeActive, kitchenMinutes, bottlenecks, metrics, statusHeadline,
        applyAction
    };
});
