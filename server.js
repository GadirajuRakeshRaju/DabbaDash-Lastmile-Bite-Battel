// DabbaDash backend: Node.js, zero dependencies (Node 14+). No npm install needed.
//   node server.js   ->  http://localhost:8000/login.html
//
// The server owns the order state. Every status change goes through core.js
// (the same rules the browser uses offline), timestamps are stamped by the
// server clock, and the dashboard + customer page poll every 3 s.
//
// REST API
//   GET  /api/health
//   GET  /api/state                 full snapshot {rev, serverNow, orders, sms}
//   GET  /api/metrics               live KPIs
//   GET  /api/orders[?status=&brand=&sector=]
//   GET  /api/orders/:id
//   POST /api/orders                simulate a new incoming order
//   POST /api/orders/:id/advance    Received->In Kitchen->Packed, Out for Delivery->Delivered
//   POST /api/orders/:id/assign     body {"riderId": 1}
//   POST /api/orders/:id/unassign
//   POST /api/orders/:id/dispatch
//   POST /api/orders/:id/sms        send the tracking-link SMS
//   GET  /api/riders                riders with live load
//   POST /api/reset                 back to the seeded demo data
const http = require("http");
const fs = require("fs");
const path = require("path");
const core = require("./core.js");

const PORT = process.env.PORT || 8000;
const ROOT = __dirname;
const TYPES = {
    ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
    ".json": "application/json", ".md": "text/plain"
};
const STATIC_OK = new Set(["login.html", "index.html", "track.html", "style.css", "login.css",
    "login.js", "script.js", "track.js", "data.js", "core.js", "README.md"]);

let state = core.freshState(Date.now());

function send(res, code, body) {
    res.statusCode = code;
    res.setHeader("Cache-Control", "no-store");
    if (body === undefined) return res.end();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

const snapshot = () => Object.assign({ serverNow: Date.now() }, state);

function readBody(req, cb) {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", () => {
        if (!body) return cb(null, {});
        try { cb(null, JSON.parse(body)); } catch (e) { cb(new Error("Invalid JSON")); }
    });
}

function ridersView() {
    const now = Date.now();
    return core.RIDERS.map(r => {
        const load = core.riderLoad(state, r);
        return Object.assign({}, r, {
            zone: core.zoneOf(r.sector), load, free: r.capacity - load,
            position: core.riderPosition(state, r, now)
        });
    });
}

function handleApi(req, res, url) {
    const parts = url.split("/").filter(Boolean);          // ["api", ...]
    const method = req.method;
    const query = new URLSearchParams((req.url.split("?")[1]) || "");

    if (parts[1] === "health" && method === "GET") return send(res, 200, { ok: true, rev: state.rev });
    if (parts[1] === "state" && method === "GET") return send(res, 200, snapshot());
    if (parts[1] === "metrics" && method === "GET") return send(res, 200, core.metrics(state, Date.now()));
    if (parts[1] === "riders" && method === "GET") return send(res, 200, ridersView());

    if (parts[1] === "reset" && method === "POST") {
        const rev = (state.rev || 0) + 1;
        state = core.freshState(Date.now());
        state.rev = rev;                                   // keep rev increasing so open pages refresh
        return send(res, 200, { ok: true, message: "Demo data reset", state: snapshot() });
    }

    if (parts[1] === "orders") {
        if (parts.length === 2 && method === "GET") {
            let list = state.orders;
            if (query.get("status")) list = list.filter(o => o.status === query.get("status"));
            if (query.get("brand")) list = list.filter(o => o.brandId === query.get("brand"));
            if (query.get("sector")) list = list.filter(o => o.sector === query.get("sector"));
            return send(res, 200, list);
        }
        if (parts.length === 2 && method === "POST") {
            const r = core.applyAction(state, { type: "newOrder" }, Date.now());
            return send(res, 201, Object.assign({}, r, { state: snapshot() }));
        }
        const id = Number(parts[2]);
        const order = state.orders.find(o => o.id === id);
        if (!order) return send(res, 404, { ok: false, error: "Order not found" });
        if (parts.length === 3 && method === "GET") return send(res, 200, order);

        const verb = parts[3];
        if (method === "POST" && ["advance", "assign", "unassign", "dispatch", "sms"].includes(verb)) {
            return readBody(req, (err, body) => {
                if (err) return send(res, 400, { ok: false, error: err.message });
                const r = core.applyAction(state, { type: verb, id, riderId: body.riderId }, Date.now());
                send(res, r.ok ? 200 : 409, Object.assign({}, r, { state: snapshot() }));
            });
        }
    }
    send(res, 404, { ok: false, error: "Unknown endpoint" });
}

http.createServer((req, res) => {
    let url;
    try { url = decodeURIComponent(req.url.split("?")[0]); } catch (e) { return send(res, 400, { error: "Bad URL" }); }

    if (url.startsWith("/api/")) {
        try { return handleApi(req, res, url); }
        catch (e) { console.error(e); return send(res, 500, { ok: false, error: "Server error" }); }
    }

    const name = url === "/" ? "login.html" : url.replace(/^\//, "");
    if (!STATIC_OK.has(name)) { res.statusCode = 404; return res.end("Not found"); }
    fs.readFile(path.join(ROOT, name), (err, data) => {
        if (err) { res.statusCode = 404; return res.end("Not found"); }
        res.setHeader("Content-Type", (TYPES[path.extname(name)] || "application/octet-stream") + "; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.end(data);
    });
}).listen(PORT, () => console.log("DabbaDash running on http://localhost:" + PORT + "/login.html"));
