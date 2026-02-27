import { Room } from "colyseus.js";
import {
  ITEMS, ItemId, RECIPES, COOK_RECIPES, ADVANCED_COOK_RECIPES,
  FORGE_STONE_COST, FORGE_WOOD_COST, CHEST_WOOD_COST,
  BLAST_FURNACE_STONE_COST, BLAST_FURNACE_WOOD_COST,
  WATER_WELL_STONE_COST, WATER_WELL_WOOD_COST,
  LAND_PLOT_PRICE,
} from "@game/shared";
import type { GameState } from "../../../server/src/rooms/GameRoom";

export class CraftPanel {
  private room: Room<GameState>;
  private sessionId: string;

  public isOpen = false;
  private panel: HTMLElement;
  private scroll: HTMLElement;
  private keyHandler!: (e: KeyboardEvent) => void;

  constructor(_scene: unknown, room: Room<GameState>, sessionId: string) {
    this.room      = room;
    this.sessionId = sessionId;
    this.panel     = document.getElementById("craft-panel")!;
    this.scroll    = document.getElementById("craft-panel-scroll")!;

    document.getElementById("craft-panel-close")!
      .addEventListener("click", () => this.close());

    const me = room.state.players.get(sessionId);
    if (me) {
      let pending = false;
      const update = () => {
        if (pending || !this.isOpen) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; if (this.isOpen) this.render(); });
      };
      me.inventory.onAdd(update);
      me.inventory.onChange(update);
      me.inventory.onRemove(update);
    }
  }

  open() {
    this.isOpen = true;
    this.panel.style.display = "flex";
    this.render();
    this.keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") this.close(); };
    window.addEventListener("keydown", this.keyHandler);
  }

  close() {
    this.isOpen = false;
    this.panel.style.display = "none";
    window.removeEventListener("keydown", this.keyHandler);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  private render() {
    const me   = this.room.state.players.get(this.sessionId);
    const inv  = (id: string) => me?.inventory.get(id) ?? 0;
    const coins = (me as any)?.coins ?? 0;

    const ing = (id: string, qty: number) => {
      const have = inv(id);
      const ok   = have >= qty;
      const name = ITEMS[id as ItemId]?.name ?? id;
      return `<span class="cp-ing ${ok ? "ok" : "need"}">${name}: ${have}/${qty}</span>`;
    };

    let html = "";

    // ── Workbench ──────────────────────────────────────────────────────────
    html += `<div class="cp-section">Workbench</div>`;
    for (const [recipeId, recipe] of Object.entries(RECIPES)) {
      const name     = ITEMS[recipe.output]?.name ?? recipe.output;
      const canCraft = Object.entries(recipe.inputs).every(([id, qty]) => inv(id) >= (qty as number));
      const ings     = Object.entries(recipe.inputs).map(([id, qty]) => ing(id, qty as number)).join("");
      html += `<div class="cp-row">
        <button class="cp-btn" data-msg="craft" data-payload='${JSON.stringify({ recipeId })}' ${canCraft ? "" : "disabled"}>Craft</button>
        <div class="cp-name">${name} ×${recipe.outputQty}</div>
        <div class="cp-ings">${ings}</div>
      </div>`;
    }

    // ── Campfire cooking ───────────────────────────────────────────────────
    html += `<div class="cp-section">Campfire Cooking — [E] near campfire</div>`;
    for (const [itemId, recipe] of Object.entries(COOK_RECIPES)) {
      if (!recipe) continue;
      const inName  = ITEMS[itemId as ItemId]?.name ?? itemId;
      const outName = ITEMS[recipe.output]?.name ?? recipe.output;
      const have    = inv(itemId);
      const ok      = have >= recipe.inputQty;
      html += `<div class="cp-row">
        <div class="cp-name">${inName} ×${recipe.inputQty} → ${outName} ×${recipe.outputQty}</div>
        <div class="cp-ings">
          <span class="cp-ing ${ok ? "ok" : "need"}">Have: ${have}/${recipe.inputQty}</span>
          <span class="cp-time">${recipe.timeMs / 1000}s</span>
        </div>
      </div>`;
    }

    // ── Advanced cooking ───────────────────────────────────────────────────
    html += `<div class="cp-section">Advanced Cooking — [E] near campfire</div>`;
    for (const [, recipe] of Object.entries(ADVANCED_COOK_RECIPES)) {
      const outName = ITEMS[recipe.output]?.name ?? recipe.output;
      const ings    = Object.entries(recipe.inputs).map(([id, qty]) => ing(id, qty as number)).join("");
      html += `<div class="cp-row">
        <div class="cp-name" style="color:#88ccff">→ ${outName}</div>
        <div class="cp-ings">${ings} <span class="cp-time">${recipe.timeMs / 1000}s</span></div>
      </div>`;
    }

    // ── Structures ─────────────────────────────────────────────────────────
    html += `<div class="cp-section">Structures — placed at your feet</div>`;

    const structs: { name: string; desc: string; cost: Record<string, number>; msg: string }[] = [
      { name: "Forge",          desc: "smelt iron ore → iron ingot",        cost: { stone: FORGE_STONE_COST,          wood: FORGE_WOOD_COST },          msg: "place_forge" },
      { name: "Blast Furnace",  desc: "iron ingot + coal → steel ingot",    cost: { stone: BLAST_FURNACE_STONE_COST,  wood: BLAST_FURNACE_WOOD_COST },  msg: "place_blast_furnace" },
      { name: "Water Well",     desc: "[E] to draw 3 water",                cost: { stone: WATER_WELL_STONE_COST,     wood: WATER_WELL_WOOD_COST },     msg: "place_water_well" },
      { name: "Chest",          desc: "permanent storage, one per player",  cost: { wood: CHEST_WOOD_COST },                                            msg: "place_chest" },
    ];

    for (const s of structs) {
      const canBuild = Object.entries(s.cost).every(([id, qty]) => inv(id) >= qty);
      const ings     = Object.entries(s.cost).map(([id, qty]) => ing(id, qty)).join("");
      html += `<div class="cp-row">
        <button class="cp-btn" data-msg="${s.msg}" data-payload="{}" data-close="1" ${canBuild ? "" : "disabled"}>Build</button>
        <div class="cp-name">${s.name} <span class="cp-desc">${s.desc}</span></div>
        <div class="cp-ings">${ings}</div>
      </div>`;
    }

    // Land plot
    const canPlot = coins >= LAND_PLOT_PRICE;
    html += `<div class="cp-row">
      <button class="cp-btn" data-msg="buy_plot" data-payload="{}" data-close="1" ${canPlot ? "" : "disabled"}>Buy</button>
      <div class="cp-name">Land Plot <span class="cp-desc">128×128 area, blocks others from building</span></div>
      <div class="cp-ings"><span class="cp-ing ${canPlot ? "ok" : "need"}">Coins: ${coins}/${LAND_PLOT_PRICE}</span></div>
    </div>`;

    this.scroll.innerHTML = html;

    // Bind button events
    this.scroll.querySelectorAll<HTMLButtonElement>("button[data-msg]").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const payload = JSON.parse(btn.dataset.payload ?? "{}");
        this.room.send(btn.dataset.msg!, payload);
        if (btn.dataset.close) this.close();
      });
    });
  }
}
