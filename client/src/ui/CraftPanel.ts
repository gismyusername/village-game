import Phaser from "phaser";
import { Room } from "colyseus.js";
import {
  ITEMS, ItemId, RECIPES, COOK_RECIPES, ADVANCED_COOK_RECIPES,
  FORGE_STONE_COST, FORGE_WOOD_COST, CHEST_WOOD_COST,
  BLAST_FURNACE_STONE_COST, BLAST_FURNACE_WOOD_COST,
  WATER_WELL_STONE_COST, WATER_WELL_WOOD_COST,
  LAND_PLOT_PRICE,
} from "@game/shared";
import type { GameState, PlayerSchema } from "../../../server/src/rooms/GameRoom";

const PX = 180, PY = 80, PW = 440, PH = 580;

export class CraftPanel {
  private scene: Phaser.Scene;
  private room: Room<GameState>;
  private sessionId: string;

  public isOpen = false;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private keyHandler!: (e: KeyboardEvent) => void;

  constructor(scene: Phaser.Scene, room: Room<GameState>, sessionId: string) {
    this.scene     = scene;
    this.room      = room;
    this.sessionId = sessionId;

    const me = room.state.players.get(sessionId);
    if (me) {
      let renderPending = false;
      const debouncedRender = () => {
        if (renderPending || !this.isOpen) return;
        renderPending = true;
        requestAnimationFrame(() => { renderPending = false; if (this.isOpen) this.render(); });
      };
      me.inventory.onAdd(debouncedRender);
      me.inventory.onChange(debouncedRender);
      me.inventory.onRemove(debouncedRender);
    }
  }

  open() {
    this.isOpen = true;
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

  private divider(y: number) {
    const g = this.go(this.scene.add.graphics().setScrollFactor(0).setDepth(51));
    (g as Phaser.GameObjects.Graphics).lineStyle(1, 0x2244aa).lineBetween(PX + 8, y, PX + PW - 8, y);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  private render() {
    this.clear();
    const me = this.room.state.players.get(this.sessionId);

    // Background + border
    this.bg(PX, PY, PW, PH, 0x0a0a18, 0.97);
    this.go(this.scene.add.rectangle(PX + PW / 2, PY + PH / 2, PW, PH)
      .setStrokeStyle(2, 0x4a90d9, 1).setScrollFactor(0).setDepth(51).setFillStyle(0, 0));

    // Title + close
    this.txt(PX + 12, PY + 10, "CRAFTING", { fontSize: "13px", color: "#f0c040" });
    const closeX = this.go(this.scene.add.text(PX + PW - 22, PY + 10, "✕", { fontSize: "13px", color: "#ff4444" })
      .setScrollFactor(0).setDepth(54).setOrigin(1, 0).setInteractive());
    closeX.on("pointerdown", () => this.close());

    this.divider(PY + 32);

    let y = PY + 40;

    // ── Workbench recipes ─────────────────────────────────────────────────
    this.txt(PX + 12, y, "WORKBENCH", { fontSize: "9px", color: "#aaaaaa" });
    y += 16;

    for (const [recipeId, recipe] of Object.entries(RECIPES)) {
      const outputName = ITEMS[recipe.output]?.name ?? recipe.output;
      this.bg(PX + 8, y - 2, PW - 16, 50, 0x111122);
      this.txt(PX + 12, y + 2, `${outputName} x${recipe.outputQty}`, { fontSize: "11px" });

      let ix = PX + 12;
      let canCraft = true;
      for (const [itemId, needed] of Object.entries(recipe.inputs)) {
        const have = me?.inventory.get(itemId) ?? 0;
        const name = ITEMS[itemId as ItemId]?.name ?? itemId;
        const ok   = have >= (needed as number);
        if (!ok) canCraft = false;
        this.txt(ix, y + 20, `${name}: ${have}/${needed}`, { fontSize: "9px", color: ok ? "#44bb44" : "#ff4444" });
        ix += 110;
      }

      this.btn(PX + PW - 80, y + 12, 65, 24, "Craft", canCraft ? 0x27ae60 : 0x444444, () => {
        if (canCraft) this.room.send("craft", { recipeId });
      });

      y += 54;
    }

    // ── Campfire cooking ──────────────────────────────────────────────────
    y += 4;
    this.divider(y);
    y += 8;

    this.txt(PX + 12, y, "CAMPFIRE COOKING  (use [E] at campfire)", { fontSize: "9px", color: "#aaaaaa" });
    y += 16;

    for (const [itemId, recipe] of Object.entries(COOK_RECIPES)) {
      if (!recipe) continue;
      const inputName  = ITEMS[itemId as ItemId]?.name ?? itemId;
      const outputName = ITEMS[recipe.output]?.name ?? recipe.output;
      const have       = me?.inventory.get(itemId) ?? 0;
      const enough     = have >= recipe.inputQty;

      this.bg(PX + 8, y - 2, PW - 16, 38, 0x111122);
      this.txt(PX + 12, y + 2, `${inputName} x${recipe.inputQty}  →  ${outputName} x${recipe.outputQty}`, { fontSize: "10px" });
      this.txt(PX + 12, y + 18, `Have: ${have}/${recipe.inputQty}`, { fontSize: "9px", color: enough ? "#44bb44" : "#ff4444" });
      this.txt(PX + 200, y + 18, `${recipe.timeMs / 1000}s`, { fontSize: "9px", color: "#666688" });

      y += 42;
    }

    // ── Advanced campfire cooking ─────────────────────────────────────────
    y += 4;
    this.txt(PX + 12, y, "ADVANCED COOKING  (multi-ingredient, use [E] at campfire)", { fontSize: "9px", color: "#aaaaaa" });
    y += 16;

    for (const [, recipe] of Object.entries(ADVANCED_COOK_RECIPES)) {
      const outputName = ITEMS[recipe.output]?.name ?? recipe.output;
      this.bg(PX + 8, y - 2, PW - 16, 44, 0x111133);
      this.txt(PX + 12, y + 2, `→  ${outputName}`, { fontSize: "10px", color: "#88ccff" });

      let ix = PX + 12;
      for (const [itemId, needed] of Object.entries(recipe.inputs)) {
        const have = me?.inventory.get(itemId) ?? 0;
        const name = ITEMS[itemId as ItemId]?.name ?? itemId;
        const ok   = have >= (needed as number);
        this.txt(ix, y + 20, `${name}: ${have}/${needed}`, { fontSize: "9px", color: ok ? "#44bb44" : "#ff4444" });
        ix += 120;
      }
      this.txt(PX + PW - 70, y + 20, `${recipe.timeMs / 1000}s`, { fontSize: "9px", color: "#666688" });

      y += 48;
    }

    // ── Structures ────────────────────────────────────────────────────────
    y += 4;
    this.divider(y);
    y += 8;

    this.txt(PX + 12, y, "STRUCTURES  (placed at your feet)", { fontSize: "9px", color: "#aaaaaa" });
    y += 16;

    // Forge row
    const haveStoneForge = me?.inventory.get("stone") ?? 0;
    const haveWoodForge  = me?.inventory.get("wood")  ?? 0;
    const canForge = haveStoneForge >= FORGE_STONE_COST && haveWoodForge >= FORGE_WOOD_COST;
    this.bg(PX + 8, y - 2, PW - 16, 42, 0x111122);
    this.txt(PX + 12, y + 2, "Forge  (smelt iron ore → iron ingot)", { fontSize: "10px" });
    this.txt(PX + 12, y + 20, `Stone: ${haveStoneForge}/${FORGE_STONE_COST}`, { fontSize: "9px", color: haveStoneForge >= FORGE_STONE_COST ? "#44bb44" : "#ff4444" });
    this.txt(PX + 120, y + 20, `Wood: ${haveWoodForge}/${FORGE_WOOD_COST}`, { fontSize: "9px", color: haveWoodForge >= FORGE_WOOD_COST ? "#44bb44" : "#ff4444" });
    this.btn(PX + PW - 100, y + 8, 85, 24, "Build Forge", canForge ? 0x8b4513 : 0x444444, () => {
      if (canForge) { this.room.send("place_forge", {}); this.close(); }
    });
    y += 46;

    // Blast Furnace row
    const haveStoneBF = me?.inventory.get("stone") ?? 0;
    const haveWoodBF  = me?.inventory.get("wood")  ?? 0;
    const canBF = haveStoneBF >= BLAST_FURNACE_STONE_COST && haveWoodBF >= BLAST_FURNACE_WOOD_COST;
    this.bg(PX + 8, y - 2, PW - 16, 42, 0x111122);
    this.txt(PX + 12, y + 2, "Blast Furnace  (smelt iron+coal → steel ingot)", { fontSize: "10px" });
    this.txt(PX + 12, y + 20, `Stone: ${haveStoneBF}/${BLAST_FURNACE_STONE_COST}`, { fontSize: "9px", color: haveStoneBF >= BLAST_FURNACE_STONE_COST ? "#44bb44" : "#ff4444" });
    this.txt(PX + 120, y + 20, `Wood: ${haveWoodBF}/${BLAST_FURNACE_WOOD_COST}`, { fontSize: "9px", color: haveWoodBF >= BLAST_FURNACE_WOOD_COST ? "#44bb44" : "#ff4444" });
    this.btn(PX + PW - 110, y + 8, 95, 24, "Build Blast Furnace", canBF ? 0x8b2500 : 0x444444, () => {
      if (canBF) { this.room.send("place_blast_furnace", {}); this.close(); }
    });
    y += 46;

    // Water Well row
    const haveStoneWell = me?.inventory.get("stone") ?? 0;
    const haveWoodWell  = me?.inventory.get("wood")  ?? 0;
    const canWell = haveStoneWell >= WATER_WELL_STONE_COST && haveWoodWell >= WATER_WELL_WOOD_COST;
    this.bg(PX + 8, y - 2, PW - 16, 42, 0x111122);
    this.txt(PX + 12, y + 2, "Water Well  (use [E] to get 3 water)", { fontSize: "10px" });
    this.txt(PX + 12, y + 20, `Stone: ${haveStoneWell}/${WATER_WELL_STONE_COST}`, { fontSize: "9px", color: haveStoneWell >= WATER_WELL_STONE_COST ? "#44bb44" : "#ff4444" });
    this.txt(PX + 120, y + 20, `Wood: ${haveWoodWell}/${WATER_WELL_WOOD_COST}`, { fontSize: "9px", color: haveWoodWell >= WATER_WELL_WOOD_COST ? "#44bb44" : "#ff4444" });
    this.btn(PX + PW - 100, y + 8, 85, 24, "Build Well", canWell ? 0x1a6a9a : 0x444444, () => {
      if (canWell) { this.room.send("place_water_well", {}); this.close(); }
    });
    y += 46;

    // Chest row
    const haveWoodChest = me?.inventory.get("wood") ?? 0;
    const canChest = haveWoodChest >= CHEST_WOOD_COST;
    this.bg(PX + 8, y - 2, PW - 16, 42, 0x111122);
    this.txt(PX + 12, y + 2, "Chest  (permanent storage, one per player)", { fontSize: "10px" });
    this.txt(PX + 12, y + 20, `Wood: ${haveWoodChest}/${CHEST_WOOD_COST}`, { fontSize: "9px", color: canChest ? "#44bb44" : "#ff4444" });
    this.btn(PX + PW - 100, y + 8, 85, 24, "Build Chest", canChest ? 0x27ae60 : 0x444444, () => {
      if (canChest) { this.room.send("place_chest", {}); this.close(); }
    });
    y += 46;

    // Buy Land Plot row
    const myCoins  = (me as any)?.coins ?? 0;
    const canPlot  = myCoins >= LAND_PLOT_PRICE;
    this.bg(PX + 8, y - 2, PW - 16, 42, 0x111122);
    this.txt(PX + 12, y + 2, "Land Plot  (128×128 area, blocks building by others)", { fontSize: "10px" });
    this.txt(PX + 12, y + 20, `Cost: ${LAND_PLOT_PRICE} coins  (you have ${myCoins})`, { fontSize: "9px", color: canPlot ? "#44bb44" : "#ff4444" });
    this.btn(PX + PW - 100, y + 8, 85, 24, "Buy Plot", canPlot ? 0x8b6914 : 0x444444, () => {
      if (canPlot) { this.room.send("buy_plot", {}); this.close(); }
    });
    y += 46;
  }
}
