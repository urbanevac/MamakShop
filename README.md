# 🍵 MamakShop

**MamakShop** is a mobile-first Malaysian Mamak stall time-management web game built with **Vite**, **TypeScript**, and **Phaser 3**. Start from a humble roadside stall (*Gerai Tepi Jalan*) with two red plastic stools, pull frothy *Teh Tarik*, flip crispy *Roti Canai* before it burns, and grow your business into a bustling 24-hour *Corner Lot Mamak*!

---

## 🎮 Game Mechanics

### 1. Core Economy & Shift Loop
- **Starting Capital & Reputation**: Begin on **Day 1** with **RM 50.00** cash and **70/100** reputation.
- **90-Second Day/Night Cycle**: Each shift lasts **90 seconds**, progressing dynamically through **Morning 🌅 → Afternoon ☀️ → Evening 🌇 → Night 🌙**.
- **Customer Queue & Patience**:
  - Customers walk up to the stall and order 1–2 items from your currently unlocked menu.
  - Each customer has a **15-second patience bar** above their head that transitions from green (`> 60%`) to yellow (`30%–60%`) to red (`<= 30%`).
  - **Fast Service Tip**: Serving an item while customer patience is **above 60%** earns the item price plus a **+RM 1.00 tip** and boosts stall reputation.
  - **Walk-Out Penalty**: If the 15-second timer hits `0`, the customer yells *"😡 LAMBAT!"*, storms off, and your reputation drops by **-5**.

---

### 2. Interactive Prep Station Dock & Serving Tray
- **Teh Tarik / Drinks Station (Left Dock)**:
  1. Tap **`1. KETTLE`** to pour hot tea/drink into the cup (**1.5s** fill timer).
  2. Once full, tap **`2. TEA CUP`** to *'Tarik'* (pull) the drink and place it onto the Serving Tray.
  3. Tap the top **`🔄 DRINK`** selector bar to switch between unlocked drinks.
- **Roti Canai / Hot Griddle Station (Right Dock)**:
  1. Tap **`1. DOUGH / PREP`** to place dough onto an open griddle slot.
  2. Wait **3.0s** for the dish to cook.
  3. **Flip Before It Burns**: Once cooked, a **3.0s burn countdown** begins (`⚠️ FLIP NOW!`). Tap the griddle in time to flip it—otherwise it chars (`🔥 BURNED!`) and must be tapped to discard.
  4. Tap the flipped dish to plate it with dhal onto the Serving Tray.
  5. Tap the top **`🔄 DISH`** selector bar to cycle through unlocked food dishes.
- **Stainless Steel Serving Tray**:
  - Holds up to **3 plated items** at once (`TRAY 1`, `TRAY 2`, `TRAY 3`).
  - **Drag** any plated dish onto a customer with a matching order (or **tap** the plate for quick-serve) to fulfill their request.

---

### 3. "Upgrade Kedai" Progression Tiers
Open the **`🏪 UPGRADE`** modal anytime from the Top HUD or automatically at the end of each 90-second shift:

| Tier | Name | Cost | Visuals & Gameplay Upgrades |
| :--- | :--- | :--- | :--- |
| **Tier 1** | **Gerai Tepi Jalan** | *Starter* | • Roadside stall with checkered yellow awning & 2 red plastic stools<br>• Max **2** waiting customers & **1** griddle slot<br>• Menu: **Teh Tarik** (`RM 2.50`), **Roti Canai** (`RM 3.00`) |
| **Tier 2** | **Kedai Bawah Pokok** | **RM 300** | • Canopy stall under a shady tropical tree with **4 plastic tables**<br>• Increases max waiting customers from **2 → 4**<br>• Unlocks **Milo Ais** (`RM 3.50`) & **Maggi Goreng** (`RM 6.00`)<br>• **Doubles griddle capacity** (`SLOT 1` & `SLOT 2` — cook 2 dishes at once) |
| **Tier 3** | **Corner Lot Mamak** | **RM 1,200** | • Bright 24-hour shophouse corner lot with football flags & live TV (`⚽ LIVE 2-1`)<br>• Unlocks **Roti Telur** (`RM 4.50`) & **Nasi Kandar** (`RM 9.50`)<br>• Unlocks **🤖 Ane Helper** (automatically brews & pulls requested drinks onto the Serving Tray) |

---

## 📱 Viewport & Project Structure

- **Viewport**: Mobile-first vertical aspect ratio (`390×844` logical resolution) centered on desktop screens with 1:1 responsive pointer/touch coordinate scaling (`Phaser.Scale.FIT` + `Phaser.Scale.CENTER_BOTH`).

```text
MamakShop/
├── index.html
├── src/
│   ├── main.ts                      # Game bootstrapper
│   ├── style.css                    # Mobile & desktop viewport framing
│   ├── config/
│   │   ├── constants.ts             # Logical viewport dimensions (390x844)
│   │   ├── gameConfig.ts            # Phaser 3 scale & input configuration
│   │   └── recipes.ts               # Menu definitions, prices, & prep times
│   ├── state/
│   │   └── GameState.ts             # Isolated reactive event-emitter state store
│   ├── entities/
│   │   ├── BaseEntity.ts            # Base Phaser container entity
│   │   ├── TopHud.ts                # Reactive HUD (Cash, Day/Phase, Rep bar, Shop btn)
│   │   ├── Customer.ts              # Customer AI, 15s patience bar, speech bubbles
│   │   ├── FoodTrayItem.ts          # Draggable/clickable plated items on Serving Tray
│   │   ├── PrepStationDock.ts       # Multi-step Teh Tarik & Roti Canai stations
│   │   └── UpgradeKedaiModal.ts     # Tier 2 & Tier 3 shop upgrade modal overlay
│   └── scenes/
│       ├── BootScene.ts             # Initial boot scene
│       └── MainScene.ts             # Main stall gameplay & tier environment renderer
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
