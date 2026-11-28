# DabbaDash v4 - LastMile Bite Battle

Hyperlocal delivery dashboard for a multi-brand cloud kitchen: one commissary kitchen, three virtual brands,
live order board, rider dispatch, 2.5 km batching, and a customer tracker that updates in real time.

## Run (30 seconds)
```
node server.js          # Node 14+, no npm install, no dependencies
```
Open http://localhost:8000/login.html (any valid email + 4+ character password; the login is a UI demo).
- **Customer page on another device:** open `http://<your-laptop-ip>:8000/track.html?order=104` on a phone on the same Wi-Fi.
- **No Node?** Open `login.html` directly. The app falls back to browser storage (two tabs of the same browser stay in sync; the sidebar says "Offline mode").
- **Tests:** `node test.js` (16 checks: business rules + every REST endpoint).
- Internet is only needed for Leaflet map tiles and fonts; without it the map section shows a simplified plot.

## Architecture
| File | Role |
|---|---|
| `core.js` | All business rules (lifecycle, capacity, courier recommendation, batcher, KPIs, payout surge). Runs in the browser and in Node, so offline mode and the server can never disagree. |
| `server.js` | Node REST API. Owns the state, stamps timestamps with the server clock, rejects invalid transitions (HTTP 409). |
| `data.js` | Browser data layer: calls the API, polls every 3 s, falls back to localStorage, corrects clock differences between devices, draws the tracker widget. |
| `index.html`, `script.js`, `style.css` | Manager dashboard |
| `track.html`, `track.js` | Customer tracking page (order lookup, animated scooter, ETA countdown) |
| `login.*` | Sign-in screen |
| `test.js` | Automated tests |

### REST API
`GET /api/state` · `GET /api/metrics` · `GET /api/riders` · `GET /api/orders[?status=&brand=&sector=]` · `GET /api/orders/:id` ·
`POST /api/orders` (simulate new) · `POST /api/orders/:id/advance | assign {riderId} | unassign | dispatch | sms` · `POST /api/reset`

## Brief coverage
**Core:** multi-brand feed (`brandId` on every order and menu item, one kitchen queue) · 5-state stepper
(Received -> In Kitchen -> Packed -> Out for Delivery -> Delivered) · rider console (sector proximity + vehicle capacity: Bike 2, Scooter 3) ·
radius batcher (2.5 km default, slider 1-6 km) · customer tracker with moving scooter and ETA countdown · live KPIs (active, in kitchen, computed avg prep, pending dispatch).
**Stretch:** Leaflet map (pins, couriers, batch circles) · bottleneck flag (red flashing at > 20 min in kitchen) · payout calculator with distance + surge · SMS tracking-link simulator.
**Data:** 3 brands, 20 menu items, 6 riders, 4 sectors (Sector A-D = Zone 1-4), 15 seeded orders.

## 2-minute demo script
1. Run `node server.js`, sign in, click **Reset Demo**. Say: "Vanilla HTML/CSS/JS front end, Node REST back end, shared rules module; the brief's stack is a suggestion."
2. Point at the KPI bar and the three brands. Point at the red bottleneck (#DD108).
3. Open the **customer page on a phone or second browser** for order 104 (the "Open customer page" button).
4. On the board, #DD104 (Burger Den: 2 Cheese Burger, Fries) is in **Cooking**. Click **Mark Packed**: it shows *Recommended: Ramesh (Zone 2)*.
5. Click **Assign**: the customer screen changes to *Courier Assigned - Ramesh is picking up your food!* within 3 s.
6. Click **Dispatch**: the scooter moves, the ETA counts down, an SMS appears in the outbox.
7. Finish with the batcher radius slider, the map and the payout calculator.
