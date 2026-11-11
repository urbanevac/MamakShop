# 🍵 MamakShop

> **🎮 Play Live in Your Browser (Desktop & Mobile):** [**https://urbanevac.github.io/MamakShop/**](https://urbanevac.github.io/MamakShop/)

**MamakShop** is a mobile-first Malaysian Mamak stall time-management web game built with **Vite**, **TypeScript**, and **Phaser 3**. Start from a humble roadside stall (*Gerai Tepi Jalan*) with two red plastic stools, pull frothy *Teh Tarik*, flip crispy *Roti Canai* before it burns, and grow your business into a bustling 24-hour *Corner Lot Mamak*!

---

## 🎮 Game Mechanics

### 1. Core Economy, Rush Hours & Customer Archetypes
- **Starting Capital & Reputation**: Begin on **Day 1** with **RM 50.00** cash and **70/100** reputation (auto-saved to `localStorage`).
- **90-Second Day/Night Cycle & Rush Hours**:
  - **🌅 Morning Breakfast Rush**: Customers crave *Teh Tarik*, *Roti Canai*, and *Roti Telur*.
  - **🌙 Evening/Night Supper Rush**: Faster customer arrivals with higher demand for *Maggi Goreng*, *Nasi Kandar*, and *Milo Ais*.
- **Customer Archetypes**:
  - **Regular Customer**: Standard **15s** patience timer; awards **+RM 1.00 tip** when served with `> 60%` patience.
  - **🛵 Tapau Delivery Rider**: Urgent **11s** patience timer, wears a green helmet & reflective vest, and pays a **+RM 2.00 priority tip** when served promptly.
  - **⚽ Lepak Bola Fan**: Relaxed **19s** patience timer, wears a striped football jersey, orders 2 items, and boosts reputation by **+5**.
- **🔥 Combo Streak**: Serving 3+ completed orders in a row without a walk-out or food waste activates a streak multiplier (`+RM 0.50` bonus tip per streak level, up to `+RM 2.50`).
- **Walk-Out Penalty**: If a customer's patience timer hits `0`, they yell *"😡 LAMBAT!"*, storm off, reset your combo streak, and drop reputation by **-5**.

---

### 2. Interactive Prep Station Dock, 1-Tap Recipe Pills & Discard Penalty
- **1-Tap Recipe Selector Pills**: Quickly switch between unlocked drinks (`Teh Tarik`, `Milo Ais`) and dishes (`Roti Canai`, `Maggi Grg`, `Roti Telur`, `Nasi Kandar`) with thumb-friendly pills at the top of the dock.
- **Teh Tarik / Drinks Station (Left Dock)**:
  1. Tap **`1. KETTLE`** to pour hot tea/drink into the cup (**1.5s** fill timer).
  2. Once full, tap **`2. TEA CUP`** to *'Tarik'* (pull) the drink and place it onto the Serving Tray.
- **Roti Canai / Hot Griddle Station (Right Dock)**:
  1. Tap **`1. DOUGH / PREP`** to place dough onto an open griddle slot.
  2. Wait **3.0s** for the dish to cook.
  3. **Flip Before It Burns**: Once cooked, a **3.0s burn countdown** begins (`⚠️ FLIP NOW!`). Tap the griddle in time to flip it, then tap again to plate onto the Serving Tray.
- **Serving Tray & Waste Penalty (`🗑️ DISCARD -50% RM`)**:
  - Holds up to **3 plated items** at once (`TRAY 1`, `TRAY 2`, `TRAY 3`).
  - Drag any unwanted plate onto the **`🗑️ DISCARD`** bin (or tap the bin) to clear a slot—or clear a burnt dish from the griddle.
  - **Food/Drink Waste Penalty**: Discarding or burning an item deducts **50% of its menu price** (min `RM 1.00`), drops reputation by **-1**, and resets your combo streak.

---

### 3. "Upgrade Kedai" Progression Tiers & Shift Receipt
Open the **`🏪 UPGRADE`** modal anytime from the Top HUD or automatically at the end of each 90-second shift to view your **🧾 Shift Receipt Summary** (`Served`, `Walk-outs`, `Wasted`, `Sales`, `Tips/Combo`, `Net Profit`) and purchase upgrades:

| Tier | Name | Cost | Visuals & Gameplay Upgrades |
| :--- | :--- | :--- | :--- |
| **Tier 1** | **Gerai Tepi Jalan** | *Starter* | • Roadside stall with checkered yellow awning & 2 red plastic stools<br>• Max **2** waiting customers & **1** griddle slot<br>• Menu: **Teh Tarik** (`RM 2.50`), **Roti Canai** (`RM 3.00`) |
| **Tier 2** | **Kedai Bawah Pokok** | **RM 300** | • Canopy stall under a shady tropical tree with **4 plastic tables**<br>• Increases max waiting customers from **2 → 4**<br>• Unlocks **Milo Ais** (`RM 3.50`) & **Maggi Goreng** (`RM 6.00`)<br>• **Doubles griddle capacity** (`SLOT 1` & `SLOT 2` — cook 2 dishes at once) |
| **Tier 3** | **Corner Lot Mamak** | **RM 1,200** | • Bright 24-hour shophouse corner lot with football flags & live TV (`⚽ LIVE 2-1`)<br>• Unlocks **Roti Telur** (`RM 4.50`) & **Nasi Kandar** (`RM 9.50`)<br>• Unlocks **🤖 Shop Helper** (smart auto-brews requested drinks without clogging all 3 tray slots) |

---

## 📱 Viewport & Project Structure

- **Viewport**: Mobile-first vertical aspect ratio (`390×844` logical resolution) with Retina High-DPI text rendering (`devicePixelRatio`), centered on desktop screens with 1:1 responsive pointer/touch coordinate scaling (`Phaser.Scale.FIT` + `Phaser.Scale.CENTER_BOTH`).

```text
MamakShop/
├── index.html
├── src/
│   ├── main.ts                      # Game bootstrapper
│   ├── style.css                    # Mobile safe-area & desktop viewport framing
│   ├── config/
│   │   ├── constants.ts             # Logical viewport dimensions (390x844)
│   │   ├── gameConfig.ts            # Phaser 3 High-DPI scale & input configuration
│   │   └── recipes.ts               # Menu definitions, prices, & prep times
│   ├── state/
│   │   └── GameState.ts             # Reactive event-emitter store + localStorage save
│   ├── entities/
│   │   ├── BaseEntity.ts            # Base Phaser container entity
│   │   ├── TopHud.ts                # Reactive HUD (Cash, Streak, Day/Phase, Rep bar)
│   │   ├── Customer.ts              # Customer AI, archetypes, staggered speech bubbles
│   │   ├── FoodTrayItem.ts          # Draggable/clickable plated items on Serving Tray
│   │   ├── PrepStationDock.ts       # 1-tap recipe pills & multi-step cooking stations
│   │   └── UpgradeKedaiModal.ts     # Shift receipt summary & Tier 2/3 upgrade modal
│   └── scenes/
│       ├── BootScene.ts             # Initial boot scene
│       └── MainScene.ts             # Main stall gameplay, trash bin, & tier renderer
```

---

## 🚀 Getting Started

```bash
# Install dependencies
npm install

# Start local Vite dev server
npm run dev

# Type-check and build for production
npm run build
```
