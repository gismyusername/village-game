import Phaser from "phaser";
import { Room } from "colyseus.js";
import { ITEMS, ItemId } from "@game/shared";
import type { GameState, MarketListingSchema, PlayerSchema } from "../../../server/src/rooms/GameRoom";

// Panel dimensions & position (centered in 800×600 canvas)
const PX = 130, PY = 110, PW = 540, PH = 380;

export class MarketPanel {
  private scene: Phaser.Scene;
  private room: Room<GameState>;
  private sessionId: string;
  private playerUuid: string;

  public isOpen = false;
  private objects: Phaser.GameObjects.GameObject[] = [];

  // Sell form state
  private tab: "buy" | "sell" = "buy";
  private sellKeys: string[] = [];
  private sellItemIdx = 0;
  private sellQty = 1;
  private sellPrice = 1;
  private sellField: "item" | "qty" | "price" = "item";

  private keyHandler!: (e: KeyboardEvent) => void;

  constructor(scene: Phaser.Scene, room: Room<GameState>, sessionId: string, playerUuid: string) {
    this.scene      = scene;
    this.room       = room;
    this.sessionId  = sessionId;
    this.playerUuid = playerUuid;

    // Auto-refresh when listings change (debounced)
    let renderPending = false;
    const debouncedRender = () => {
      if (renderPending || !this.isOpen) return;
      renderPending = true;
      requestAnimationFrame(() => { renderPending = false; if (this.isOpen) this.render(); });
    };
    room.state.listings.onAdd(debouncedRender);
    room.state.listings.onRemove(debouncedRender);
    room.state.listings.onChange(debouncedRender);
  }

  open() {
    this.isOpen = true;
    this.tab = "buy";
    this.keyHandler = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener("keydown", this.keyHandler);
    this.render();
  }

  close() {
    this.isOpen = false;
    window.removeEventListener("keydown", this.keyHandler);
    this.clear();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private clear() {
    this.objects.forEach(o => (o as any).destroy());
    this.objects = [];
  }

  private go<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.objects.push(obj);
    return obj;
  }

  private txt(x: number, y: number, s: string, style: Phaser.Types.GameObjects.Text.TextStyle = {}) {
    return this.go(this.scene.add.text(x, y, s, { fontSize: "10px", color: "#ffffff", ...style })
      .setScrollFactor(0).setDepth(52));
  }

  private bg(x: number, y: number, w: number, h: number, color: number, alpha = 1) {
    return this.go(this.scene.add.rectangle(x, y, w, h, color, alpha)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(51));
  }

  private btn(x: number, y: number, w: number, h: number, label: string, color: number, cb: () => void) {
    const r = this.go(this.scene.add.rectangle(x, y, w, h, color)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(53).setInteractive());
    const t = this.go(this.scene.add.text(x + w / 2, y + h / 2, label, { fontSize: "9px", color: "#fff" })
      .setScrollFactor(0).setDepth(54).setOrigin(0.5));
    r.on("pointerdown", cb);
    r.on("pointerover",  () => r.setFillStyle(Phaser.Display.Color.IntegerToColor(color).lighten(20).color));
    r.on("pointerout",   () => r.setFillStyle(color));
    return { r, t };
  }

  // ── Render ────────────────────────────────────────────────────────────────

  private render() {
    this.clear();
    const me = this.room.state.players.get(this.sessionId);

    // Panel background + border
    this.bg(PX, PY, PW, PH, 0x0a0a18, 0.97);
    this.go(this.scene.add.rectangle(PX + PW / 2, PY + PH / 2, PW, PH)
      .setStrokeStyle(2, 0x4a90d9, 1).setScrollFactor(0).setDepth(51).setFillStyle(0, 0));

    // Title + coins + close
    this.txt(PX + 12, PY + 10, "MARKET BOARD", { fontSize: "13px", color: "#f0c040" });
    this.txt(PX + PW - 160, PY + 12, `Coins: ${me?.coins ?? 0}c`, { color: "#f0c040" });
    const closeX = this.go(this.scene.add.text(PX + PW - 22, PY + 10, "✕", { fontSize: "13px", color: "#ff4444" })
      .setScrollFactor(0).setDepth(54).setOrigin(1, 0).setInteractive());
    closeX.on("pointerdown", () => this.close());

    // Tabs
    this.btn(PX + 12, PY + 32, 75, 22, "BUY",  this.tab === "buy"  ? 0x2980b9 : 0x333355, () => { this.tab = "buy";  this.render(); });
    this.btn(PX + 95, PY + 32, 75, 22, "SELL", this.tab === "sell" ? 0x2980b9 : 0x333355, () => { this.tab = "sell"; this.render(); });

    // Divider
    const g = this.go(this.scene.add.graphics().setScrollFactor(0).setDepth(51));
    (g as Phaser.GameObjects.Graphics).lineStyle(1, 0x2244aa).lineBetween(PX + 8, PY + 60, PX + PW - 8, PY + 60);

    if (this.tab === "buy") this.renderBuy(me);
    else                    this.renderSell(me);
  }

  private renderBuy(me: PlayerSchema | undefined) {
    const Y0 = PY + 68;
    // Headers
    this.txt(PX + 12,        Y0, "Item",       { fontSize: "8px", color: "#888" });
    this.txt(PX + 200,       Y0, "Qty",        { fontSize: "8px", color: "#888" });
    this.txt(PX + 260,       Y0, "Price/ea",   { fontSize: "8px", color: "#888" });
    this.txt(PX + 370,       Y0, "Seller",     { fontSize: "8px", color: "#888" });

    let row = 0;
    this.room.state.listings.forEach((lst: MarketListingSchema, id: string) => {
      if (row >= 9) return;
      const y = Y0 + 16 + row * 28;
      this.bg(PX + 8, y - 2, PW - 16, 24, row % 2 === 0 ? 0x111122 : 0x0d0d18);

      const name = ITEMS[lst.itemId as ItemId]?.name ?? lst.itemId;
      this.txt(PX + 12,  y + 4, name);
      this.txt(PX + 200, y + 4, `x${lst.quantity}`);
      this.txt(PX + 260, y + 4, `${lst.pricePerUnit}c`);
      this.txt(PX + 370, y + 4, lst.sellerName.slice(0, 12), { color: "#aaaaff" });

      const isMine    = lst.sellerId === this.playerUuid;
      const canAfford = (me?.coins ?? 0) >= lst.pricePerUnit;

      if (!isMine) {
        this.btn(PX + PW - 80, y, 65, 20, "Buy 1", canAfford ? 0x27ae60 : 0x444444, () => {
          if (!canAfford) return;
          this.room.send("market_buy", { listingId: id });
        });
      } else {
        this.txt(PX + PW - 70, y + 4, "(yours)", { color: "#666666" });
      }
      row++;
    });

    if (row === 0) {
      this.txt(PX + 12, Y0 + 20, "No listings yet — go to the SELL tab to list your items!", { color: "#555555" });
    }
  }

  private renderSell(me: PlayerSchema | undefined) {
    if (!me) return;
    const Y0 = PY + 68;

    // Build sellable inventory list
    this.sellKeys = [];
    me.inventory.forEach((qty: number, itemId: string) => { if (qty > 0) this.sellKeys.push(itemId); });

    if (this.sellKeys.length === 0) {
      this.txt(PX + 12, Y0 + 10, "Inventory empty — gather items first.", { color: "#555555" });
    } else {
      this.sellItemIdx = Math.min(this.sellItemIdx, this.sellKeys.length - 1);
      const selItemId  = this.sellKeys[this.sellItemIdx] as ItemId;
      const selItemQty = me.inventory.get(selItemId) ?? 0;
      this.sellQty     = Math.min(this.sellQty, selItemQty);

      const field = (label: string, value: string, y: number, field: "item"|"qty"|"price") => {
        this.txt(PX + 12, y + 5, label, { color: "#aaaaaa" });
        this.bg(PX + 90, y, 200, 24, this.sellField === field ? 0x1a3a5c : 0x111122);
        this.txt(PX + 94, y + 5, value);
      };

      field("Item:",    `← ${ITEMS[selItemId]?.name ?? selItemId} →`, Y0,      "item");
      this.txt(PX + 300, Y0 + 5, `have: ${selItemQty}`, { color: "#888888" });

      field("Qty:",     `← ${this.sellQty} →`,                        Y0 + 32, "qty");
      field("Price/ea:", `← ${this.sellPrice}c →`,                    Y0 + 64, "price");
      this.txt(PX + 300, Y0 + 69, `= ${this.sellQty * this.sellPrice}c total`, { color: "#888888" });

      this.txt(PX + 12, Y0 + 96, "Tab = next field   ←→ = adjust", { fontSize: "8px", color: "#444466" });

      this.btn(PX + PW - 140, Y0 + 88, 120, 24, "List for Sale", 0x27ae60, () => {
        this.room.send("market_list", { itemId: selItemId, quantity: this.sellQty, pricePerUnit: this.sellPrice });
        this.sellQty = 1; this.sellPrice = 1;
        this.render();
      });
    }

    // Divider + active listings
    const divY = PY + 210;
    const g2 = this.go(this.scene.add.graphics().setScrollFactor(0).setDepth(51));
    (g2 as Phaser.GameObjects.Graphics).lineStyle(1, 0x2244aa).lineBetween(PX + 8, divY, PX + PW - 8, divY);
    this.txt(PX + 12, divY + 6, "Your active listings:", { color: "#aaaaaa" });

    let myRow = 0;
    this.room.state.listings.forEach((lst: MarketListingSchema, id: string) => {
      if (lst.sellerId !== this.playerUuid) return;
      const y    = divY + 24 + myRow * 28;
      const name = ITEMS[lst.itemId as ItemId]?.name ?? lst.itemId;
      this.bg(PX + 8, y - 2, PW - 16, 24, myRow % 2 === 0 ? 0x111122 : 0x0d0d18);
      this.txt(PX + 12, y + 4, `${name} x${lst.quantity} @ ${lst.pricePerUnit}c each`);
      this.btn(PX + PW - 80, y, 65, 20, "Cancel", 0xc0392b, () => {
        this.room.send("market_cancel", { listingId: id });
      });
      myRow++;
    });

    if (myRow === 0) this.txt(PX + 12, divY + 24, "None.", { color: "#555555" });
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────

  private onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { this.close(); return; }

    if (this.tab === "sell") {
      if (e.key === "Tab") {
        e.preventDefault();
        this.sellField = this.sellField === "item" ? "qty" : this.sellField === "qty" ? "price" : "item";
        this.render(); return;
      }

      const me      = this.room.state.players.get(this.sessionId);
      const maxQty  = me?.inventory.get(this.sellKeys[this.sellItemIdx] ?? "") ?? 1;

      if (this.sellField === "item") {
        if (e.key === "ArrowLeft")  this.sellItemIdx = Math.max(0, this.sellItemIdx - 1);
        if (e.key === "ArrowRight") this.sellItemIdx = Math.min(this.sellKeys.length - 1, this.sellItemIdx + 1);
      } else if (this.sellField === "qty") {
        if (e.key === "ArrowLeft"  || e.key === "ArrowDown")  this.sellQty = Math.max(1, this.sellQty - 1);
        if (e.key === "ArrowRight" || e.key === "ArrowUp")    this.sellQty = Math.min(maxQty, this.sellQty + 1);
      } else {
        if (e.key === "ArrowLeft"  || e.key === "ArrowDown")  this.sellPrice = Math.max(1, this.sellPrice - 1);
        if (e.key === "ArrowRight" || e.key === "ArrowUp")    this.sellPrice = Math.min(9999, this.sellPrice + 1);
      }
      this.render();
    }
  }
}
