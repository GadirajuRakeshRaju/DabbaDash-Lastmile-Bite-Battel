// Run: node test.js   (no dependencies). Tests the shared rules AND the live REST API.
const assert = require("assert");
const http = require("http");
const core = require("./core.js");

let passed = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log("  ok  " + name); },
    e => { console.error("FAIL  " + name + "\n      " + e.message); process.exitCode = 1; });

const NOW = Date.now();
const fresh = () => core.freshState(NOW);
const get = (s, id) => s.orders.find(o => o.id === id);

(async function main() {
    console.log("core rules");
    await t("seed matches the brief: 3 brands, 20 menu items, 4 sectors, 6 riders, 15 orders", () => {
        const s = fresh();
        assert.strictEqual(core.BRANDS.length, 3); assert.strictEqual(core.MENU.length, 20);
        assert.strictEqual(core.SECTOR_NAMES.length, 4); assert.strictEqual(core.RIDERS.length, 6);
        assert.strictEqual(s.orders.length, 15);
        assert(core.MENU.every(m => core.brandOf(m.brandId)));
        assert(s.orders.every(o => core.brandOf(o.brandId)));
    });
    await t("brief demo: #104 Burger Den (2 burgers + fries) -> Mark Packed -> recommends Ramesh (Zone 2)", () => {
        const s = fresh(); const o = get(s, 104);
        assert.strictEqual(o.status, "In Kitchen"); assert.strictEqual(o.brandId, "burger");
        const r = core.applyAction(s, { type: "advance", id: 104 }, NOW);
        assert(r.ok && o.status === "Packed");
        assert(r.message.includes("Ramesh (Zone 2)"), r.message);
        assert.strictEqual(core.recommendRiders(s, o, NOW)[0].rider.name, "Ramesh");
    });
    await t("full lifecycle: Received -> In Kitchen -> Packed -> Out for Delivery -> Delivered", () => {
        const s = fresh(); const id = 101;
        core.applyAction(s, { type: "advance", id }, NOW);
        core.applyAction(s, { type: "advance", id }, NOW + 1);
        assert.strictEqual(get(s, id).status, "Packed");
        assert(core.applyAction(s, { type: "assign", id, riderId: 2 }, NOW + 2).ok);
        assert(core.applyAction(s, { type: "dispatch", id }, NOW + 3).ok);
        assert.strictEqual(get(s, id).status, "Out for Delivery");
        assert(get(s, id).etaEndsAt > NOW);
        assert(core.applyAction(s, { type: "advance", id }, NOW + 4).ok);
        assert.strictEqual(get(s, id).status, "Delivered");
    });
    await t("customer headline after assigning courier", () => {
        const s = fresh();
        core.applyAction(s, { type: "advance", id: 104 }, NOW);
        core.applyAction(s, { type: "assign", id: 104, riderId: 1 }, NOW);
        assert.strictEqual(core.statusHeadline(get(s, 104)), "Courier Assigned - Ramesh is picking up your food!");
    });
    await t("vehicle capacity is enforced (Bike = 2)", () => {
        const s = fresh();
        assert(core.applyAction(s, { type: "assign", id: 103, riderId: 3 }, NOW).ok);   // Arjun has #115 on the road
        const r = core.applyAction(s, { type: "assign", id: 107, riderId: 3 }, NOW);
        assert(!r.ok && /capacity/.test(r.error), JSON.stringify(r));
    });
    await t("invalid transitions are rejected without changing state", () => {
        const s = fresh(); const rev = s.rev;
        assert(!core.applyAction(s, { type: "dispatch", id: 103 }, NOW).ok);            // packed, no courier
        assert(!core.applyAction(s, { type: "assign", id: 101, riderId: 1 }, NOW).ok);  // not packed
        assert(!core.applyAction(s, { type: "advance", id: 109 }, NOW).ok);             // already delivered
        assert(!core.applyAction(s, { type: "advance", id: 9999 }, NOW).ok);
        assert.strictEqual(s.rev, rev);
    });
    await t("bottleneck: only In Kitchen orders older than 20 min", () => {
        const s = fresh();
        assert.deepStrictEqual(core.bottlenecks(s, NOW).map(o => o.id).sort(), [108]);
    });
    await t("batcher groups close orders and splits far ones (2.5 km)", () => {
        const s = fresh(); const packed = s.orders.filter(o => o.status === "Packed");
        const batches = core.clusterOrders(packed, 2.5);
        assert(batches.length >= 1 && batches.reduce((n, b) => n + b.orders.length, 0) === packed.length);
        batches.forEach(b => b.orders.forEach(o => assert(core.kmBetween(b.center, o) <= 2.5 + 1e-9)));
        assert.strictEqual(core.clusterOrders(packed, 0.01).length, packed.length);
    });
    await t("KPIs: avg prep time, active orders, pending dispatch", () => {
        const m = core.metrics(fresh(), NOW);
        assert.strictEqual(m.totalOrders, 15); assert.strictEqual(m.activeOrders, 12);
        assert.strictEqual(m.inKitchen, 4); assert.strictEqual(m.pendingDispatch, 4);
        assert(m.avgPrepMin > 0);
    });
    await t("surge: on/off/auto (>= 4 packed orders)", () => {
        const s = fresh();
        assert(core.surgeActive(s, "on", NOW)); assert(!core.surgeActive(s, "off", NOW));
        assert(core.surgeActive(s, "auto", NOW));             // 4 packed in seed
    });

    console.log("REST API");
    const PORT = 18000 + Math.floor(Math.random() * 1000);
    process.env.PORT = PORT;
    const srv = require("child_process").spawn(process.execPath, ["server.js"], { env: process.env, cwd: __dirname, stdio: "ignore" });
    await new Promise(r => setTimeout(r, 700));
    const call = (method, url, body) => new Promise((resolve, reject) => {
        const req = http.request({ port: PORT, path: url, method, headers: { "Content-Type": "application/json" } }, res => {
            let d = ""; res.on("data", c => d += c); res.on("end", () => { let b = null; try { b = d ? JSON.parse(d) : null; } catch (e) { b = d; } resolve({ code: res.statusCode, body: b }); });
        });
        req.on("error", reject); if (body) req.write(JSON.stringify(body)); req.end();
    });
    try {
        await t("GET /api/state returns 15 orders and a server clock", async () => {
            const r = await call("GET", "/api/state"); assert.strictEqual(r.code, 200);
            assert.strictEqual(r.body.orders.length, 15); assert(Math.abs(r.body.serverNow - Date.now()) < 5000);
        });
        await t("demo over HTTP: pack #104 -> assign Ramesh -> dispatch; customer view sees each step", async () => {
            let r = await call("POST", "/api/orders/104/advance"); assert(r.body.ok);
            r = await call("POST", "/api/orders/104/assign", { riderId: 1 }); assert(r.body.ok);
            r = await call("GET", "/api/orders/104");
            assert.strictEqual(core.statusHeadline(r.body), "Courier Assigned - Ramesh is picking up your food!");
            r = await call("POST", "/api/orders/104/dispatch"); assert(r.body.ok);
            r = await call("GET", "/api/orders/104"); assert.strictEqual(r.body.status, "Out for Delivery");
        });
        await t("409 on a rule violation, 404 on unknown order", async () => {
            assert.strictEqual((await call("POST", "/api/orders/101/dispatch")).code, 409);
            assert.strictEqual((await call("GET", "/api/orders/99999")).code, 404);
        });
        await t("POST /api/orders creates an order; filter + metrics work", async () => {
            const r = await call("POST", "/api/orders"); assert.strictEqual(r.code, 201);
            const list = await call("GET", "/api/orders?status=Received"); assert(list.body.length >= 3);
            const m = await call("GET", "/api/metrics"); assert.strictEqual(m.body.totalOrders, 16);
        });
        await t("POST /api/reset restores the seed", async () => {
            await call("POST", "/api/reset");
            const r = await call("GET", "/api/orders/104"); assert.strictEqual(r.body.status, "In Kitchen");
        });
        await t("static files are whitelisted (no path traversal, no dotfiles)", async () => {
            assert.strictEqual((await call("GET", "/..%2fserver.js")).code, 404);
            assert.strictEqual((await call("GET", "/.state.json")).code, 404);
            assert.strictEqual((await call("GET", "/login.html")).code, 200);
        });
    } finally { srv.kill(); }
    console.log(`\n${passed} checks passed` + (process.exitCode ? " (with failures)" : ""));
})();
