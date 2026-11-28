// DABBADASH - CUSTOMER TRACKING PAGE
// Polls the same REST API as the manager dashboard (every 3 s) so a status
// change made by the kitchen shows up here without a refresh.
"use strict";

const root = document.getElementById("trackerRoot");
const params = new URLSearchParams(location.search);
const orderId = Number((params.get("order") || "").replace(/\D/g, "")) || 104;

let state = null;

function render() {
    if (!state) return;
    const order = state.orders.find(o => o.id === orderId);
    DD.updateTracker(root, order, DD.now());
    if (order) document.title = `#DD${order.id} - ${order.status} | DabbaDash`;
    document.getElementById("syncNote").textContent = DD.isOnline()
        ? "Live. Updates automatically every few seconds."
        : "Offline mode: updates only when the kitchen dashboard is open in this browser.";
}

async function poll() {
    if (await DD.refresh()) { state = DD.state(); render(); }
}

// order lookup (customers can type their order number)
const form = document.getElementById("lookupForm");
const input = document.getElementById("lookupInput");
input.value = orderId;
form.addEventListener("submit", e => {
    e.preventDefault();
    const n = Number(input.value.replace(/\D/g, ""));
    if (n) location.search = "?order=" + n;
});

(async function init() {
    DD.buildTracker(root);
    await DD.load();
    state = DD.state();
    render();
    setInterval(poll, 3000);                 // lightweight polling (every 3 s)
    window.addEventListener("storage", poll); // instant when another tab saves (offline mode)
    setInterval(render, 1000);               // smooth countdown + moving scooter
})();
