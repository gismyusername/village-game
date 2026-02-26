import Phaser from "phaser";
import { Room } from "colyseus.js";
import { ITEMS, ItemId } from "@game/shared";
import type { GameState, ChestSchema } from "../../../server/src/rooms/GameRoom";

const PX = 130, PY = 100, PW = 540, PH = 360;
const COL_W = (PW - 24) / 2;

export class ChestPanel {
  private scene:     Phaser.Scene;
  private room:      Room<GameState>;
  private sessionId: string;
  private myUuid:    string;

  public  isOpen    = false;
  private chestId   = "";
  private objects:  Phaser.GameObjects.GameObject[] = [];
  private keyHandler!: (e: KeyboardEvent) => void;

  constructor(scene: Phaser.Scene, room: Room<GameState>, sessionId: string, myUuid: string) {
    this.scene     = scene;
    this.room      = room;
    this.sessionId = sessionId;
    this.myUuid    = myUuid;

    // Debounced re-render on inventory changes
    const me = room.state.players.get(sessionId);
    if (me) {
      let pending = false;
      const debouncedRender = () => {
        if (pending || !this.isOpen) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; if (this.isOpen) this.render(); });
      };
      me.inventory.onAdd(debouncedRender);
      me.inventory.onChange(debouncedRender);
      me.inventory.onRemove(debouncedRender);
    }

    // Re-render when chest inventory changes
    room.state.chests.onAdd((chest: ChestSchema) => {
      if (chest.ownerUuid !== myUuid) return;
      let pending = false;
      const debouncedRender = () => {
        if (pending || !this.isOpen) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; if (this.isOpen) this.render(); });
      };
      chest.inventory.onAdd(debouncedRender);
      chest.inventory.onChange(debouncedRender);
      chest.inventory.onRemove(debouncedRender);
    });
  }

  open(chestId: string) {
    this.chestId = chestId;
    this.isOpen  = true;
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.close();
    };
    window.addEventListener("keydown", this.keyHandler);
    this.render();
  }

  close() {
    this.isOpen = false;
    window.removeEventListener("keydown", this.keyHandler);
    this.clear();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

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

  // ── Render ──────────────────────────────────────────────────────────────

  private render() {
    this.clear();
    const me    = this.room.state.players.get(this.sessionId);
    const chest = this.room.state.chests.get(this.chestId) as ChestSchema | undefined;
    if (!me || !chest) { this.close(); return; }

    // Background + border
    this.bg(PX, PY, PW, PH, 0x0a0a18, 0.97);
    this.go(this.scene.add.rectangle(PX + PW / 2, PY + PH / 2, PW, PH)
      .setStrokeStyle(2, 0x8b5a2b, 1).setScrollFactor(0).setDepth(51).setFillStyle(0, 0));

    // Title + close
    this.txt(PX + 12, PY + 10, "CHEST", { fontSize: "13px", color: "#f0c040" });
    const closeX = this.go(this.scene.add.text(PX + PW - 22, PY + 10, "✕", { fontSize: "13px", color: "#ff4444" })
      .setScrollFactor(0).setDepth(54).setOrigin(1, 0).setInteractive());
    closeX.on("pointerdown", () => this.close());

    // Divider
    const g = this.go(this.scene.add.graphics().setScrollFactor(0).setDepth(51));
    (g as Phaser.GameObjects.Graphics).lineStyle(1, 0x8b5a2b).lineBetween(PX + 8, PY + 32, PX + PW - 8, PY + 32);

    // Column headers
    const col1X = PX + 12;
    const col2X = PX + 12 + COL_W + 12;
    this.txt(col1X, PY + 38, "BACKPACK", { fontSize: "9px", color: "#aaaaaa" });
    this.txt(col2X, PY + 38, "STORED", { fontSize: "9px", color: "#aaaaaa" });

    // Vertical divider between columns
    const vg = this.go(this.scene.add.graphics().setScrollFactor(0).setDepth(51));
    (vg as Phaser.GameObjects.Graphics).lineStyle(1, 0x2244aa).lineBetween(PX + 12 + COL_W, PY + 36, PX + 12 + COL_W, PY + PH - 10);

    let rowY = PY + 54;
    const ROW_H = 28;

    // ── Backpack column (left) ─────────────────────────────────────────
    me.inventory.forEach((qty: number, itemId: string) => {
      if (qty <= 0) return;
      const name = ITEMS[itemId as ItemId]?.name ?? itemId;
      this.bg(col1X, rowY, COL_W - 4, ROW_H - 2, 0x111122);
      this.txt(col1X + 4, rowY + 4, `${name}`, { fontSize: "9px" });
      this.txt(col1X + 4, rowY + 14, `×${qty}`, { fontSize: "9px", color: "#cccccc" });
      this.btn(col1X + COL_W - 72, rowY + 4, 64, 20, "→ Store", 0x2255aa, () => {
        this.room.send("chest_deposit", { itemId, quantity: qty });
      });
      rowY += ROW_H;
    });

    rowY = PY + 54;

    // ── Chest column (right) ──────────────────────────────────────────
    chest.inventory.forEach((qty: number, itemId: string) => {
      if (qty <= 0) return;
      const name = ITEMS[itemId as ItemId]?.name ?? itemId;
      this.bg(col2X, rowY, COL_W - 4, ROW_H - 2, 0x111122);
      this.txt(col2X + 4, rowY + 4, `${name}`, { fontSize: "9px" });
      this.txt(col2X + 4, rowY + 14, `×${qty}`, { fontSize: "9px", color: "#cccccc" });
      this.btn(col2X + COL_W - 72, rowY + 4, 64, 20, "← Take", 0x225522, () => {
        this.room.send("chest_withdraw", { itemId, quantity: qty });
      });
      rowY += ROW_H;
    });

    // Empty state hints
    if (me.inventory.size === 0) {
      this.txt(col1X + 4, PY + 54, "(empty backpack)", { fontSize: "9px", color: "#555566" });
    }
    if (chest.inventory.size === 0) {
      this.txt(col2X + 4, PY + 54, "(chest is empty)", { fontSize: "9px", color: "#555566" });
    }

    // Footer hint
    this.txt(PX + 12, PY + PH - 18, "[E] or [Esc] to close", { fontSize: "8px", color: "#555566" });
  }
}
