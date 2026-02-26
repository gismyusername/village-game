import { GAME_CONSTANTS, ITEMS, RESOURCES, MARKET_X, MARKET_Y, COOK_RECIPES, RECIPES, SMELT_RECIPES, BLAST_RECIPES, ADVANCED_COOK_RECIPES, ResourceKind, ItemId } from "@game/shared";

// ── Constants ─────────────────────────────────────────────────────────────────

const AI_COUNT    = 15;
const AI_SPEED    = 80;    // px/sec (slightly faster)
const AI_TICK_MS  = 1000;  // ms between decisions (down from 1500)
const STUCK_MS    = 4000;  // re-decide if target hasn't been reached in this long

const AI_NAMES = [
  "Alice", "Bob", "Charlie", "Diana", "Erik",
  "Fiona", "George", "Hannah", "Ivan", "Julia",
  "Karl", "Luna", "Marco", "Nina", "Oscar",
];

// Sell prices (coins per unit)
const SELL_PRICES: Partial<Record<string, number>> = {
  berries: 2, raw_meat: 2, cooked_meat: 7, bread: 8, wood: 1, stone: 2, wheat: 2,
  coal: 3, steel_ingot: 8, stew: 12, cooked_fish: 5, raw_fish: 2,
};

// Role distribution (by spawn index)
type AIRole = "gatherer" | "cook" | "farmer" | "trader";
const ROLE_MAP: AIRole[] = [
  "gatherer", "gatherer", "gatherer", "gatherer",  // 0-3
  "cook",     "cook",     "cook",                  // 4-6
  "farmer",   "farmer",   "farmer",                // 7-9
  "trader",   "trader",   "trader",   "trader",   "trader", // 10-14
];

// ── Types ─────────────────────────────────────────────────────────────────────

type AIState = "wandering" | "gathering" | "cooking" | "buying" | "selling" | "building" | "eating" | "trading" | "smelting" | "blasting" | "at_well" | "cooking_advanced";

interface AIAgent {
  playerId:      string;
  role:          AIRole;
  state:         AIState;
  targetX:       number;
  targetY:       number;
  targetId:      string;
  nextDecision:  number;
  cookingUntil:  number;
  gatheringUntil:    number;
  gatherResourceId:  string;
  targetSetAt:   number;  // for stuck detection
}

export interface AIFactories {
  createPlayer:   (id: string, name: string, x: number, y: number) => any;
  createCampfire: (x: number, y: number, ownerId: string, id: string) => any;
  createListing:  (sellerId: string, sellerName: string, itemId: string, qty: number, price: number, id: string) => any;
}

// ── AIManager ─────────────────────────────────────────────────────────────────

export class AIManager {
  private agents = new Map<string, AIAgent>();

  constructor(private factories: AIFactories) {}

  spawnAll(state: any) {
    const W = GAME_CONSTANTS.WORLD_SIZE;
    for (let i = 0; i < AI_COUNT; i++) {
      const id     = `ai_${i}`;
      const x      = 200 + Math.random() * (W - 400);
      const y      = 200 + Math.random() * (W - 400);
      const player = this.factories.createPlayer(id, AI_NAMES[i], x, y);
      player.coins  = 5 + Math.floor(Math.random() * 20);
      player.hunger = 40 + Math.random() * 60;
      player.isAI   = true;
      state.players.set(id, player);

      this.agents.set(id, {
        playerId:     id,
        role:         ROLE_MAP[i] ?? "gatherer",
        state:        "wandering",
        targetX:      x,
        targetY:      y,
        targetId:     "",
        nextDecision: Date.now() + Math.random() * 3000,
        cookingUntil: 0,
        gatheringUntil:   0,
        gatherResourceId: "",
        targetSetAt:  Date.now(),
      });
    }
    console.log(`[AIManager] Spawned ${AI_COUNT} AI players`);
  }

  tick(state: any, delta: number, now: number) {
    this.agents.forEach((agent) => {
      const player = state.players.get(agent.playerId);
      if (!player) return;

      // Finish cooking / smelting / blasting
      if (agent.cookingUntil > 0 && now >= agent.cookingUntil) {
        if (agent.state === "blasting") {
          const recipe = BLAST_RECIPES[agent.targetId];
          if (recipe) {
            player.inventory.set(recipe.output, (player.inventory.get(recipe.output) ?? 0) + recipe.outputQty);
          }
          agent.state = "wandering";
        } else if (agent.state === "smelting") {
          const recipe = SMELT_RECIPES[agent.targetId as ItemId];
          if (recipe) {
            player.inventory.set(recipe.output, (player.inventory.get(recipe.output) ?? 0) + recipe.outputQty);
          }
          agent.state = "wandering";
        } else if (agent.state === "cooking_advanced") {
          const recipe = ADVANCED_COOK_RECIPES[agent.targetId];
          if (recipe) {
            player.inventory.set(recipe.output, (player.inventory.get(recipe.output) ?? 0) + recipe.outputQty);
          }
          agent.state = "wandering";
        } else {
          const recipe = COOK_RECIPES[agent.targetId as ItemId];
          if (recipe) {
            player.inventory.set(recipe.output, (player.inventory.get(recipe.output) ?? 0) + recipe.outputQty);
          }
        }
        agent.cookingUntil = 0;
      }

      // Finish gathering
      if (agent.gatheringUntil > 0 && now >= agent.gatheringUntil) {
        const res = state.resources.get(agent.gatherResourceId);
        if (res) {
          const def          = RESOURCES[res.kind as ResourceKind];
          const hasSteelAxe  = (player.inventory.get("steel_axe") ?? 0) > 0;
          const hasIronAxe   = (player.inventory.get("iron_axe")  ?? 0) > 0;
          const hasStoneAxe  = (player.inventory.get("stone_axe") ?? 0) > 0;
          const multiplier   = hasSteelAxe ? 3.0 : hasIronAxe ? 2.0 : hasStoneAxe ? 1.5 : 1.0;
          for (const drop of def.drops) {
            // Skip toolRequired drops if AI doesn't have the tool
            if (drop.toolRequired && (player.inventory.get(drop.toolRequired) ?? 0) === 0) continue;
            let qty = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
            if (qty === 0) continue;
            if (multiplier > 1) qty = Math.ceil(qty * multiplier);
            player.inventory.set(drop.itemId, (player.inventory.get(drop.itemId) ?? 0) + qty);
          }
          setTimeout(() => { res.depleted = false; }, def.respawnMs);
        }
        agent.gatheringUntil = 0;
        agent.gatherResourceId = "";
      }

      // Smooth movement toward target
      const dx   = agent.targetX - player.x;
      const dy   = agent.targetY - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 8) {
        const step  = (AI_SPEED * delta) / 1000;
        const ratio = Math.min(1, step / dist);
        player.x = Math.max(0, Math.min(GAME_CONSTANTS.WORLD_SIZE, player.x + dx * ratio));
        player.y = Math.max(0, Math.min(GAME_CONSTANTS.WORLD_SIZE, player.y + dy * ratio));
      }

      const atTarget = dist <= 40;
      const stuck    = !atTarget && now - agent.targetSetAt > STUCK_MS;

      // Decision cycle (skip while gathering or cooking)
      if (now >= agent.nextDecision || stuck) {
        if (agent.gatheringUntil > 0 || agent.cookingUntil > 0) {
          agent.nextDecision = now + AI_TICK_MS;
        } else {
          if (atTarget) this.execute(player, agent, state, now);
          this.decide(player, agent, state, now);
          agent.nextDecision = now + AI_TICK_MS + Math.random() * 250;
        }
      }
    });
  }

  // ── Decision ───────────────────────────────────────────────────────────────

  private decide(player: any, agent: AIAgent, state: any, now: number) {
    const hunger    = player.hunger as number;
    const inv       = player.inventory;
    const cooked    = inv.get("cooked_meat") ?? 0;
    const bread     = inv.get("bread")       ?? 0;
    const berries   = inv.get("berries")     ?? 0;
    const raw       = inv.get("raw_meat")    ?? 0;
    const wood      = inv.get("wood")        ?? 0;
    const stone     = inv.get("stone")       ?? 0;
    const wheat     = inv.get("wheat")       ?? 0;
    const totalFood = cooked + bread + berries;
    const W         = GAME_CONSTANTS.WORLD_SIZE;

    // ── Universal: craft stone axe if possible ───────────────────────────
    if (!inv.get("stone_axe") && !inv.get("iron_axe") && !inv.get("steel_axe") && stone >= 2 && wood >= 2) {
      const sLeft = stone - 2, wLeft = wood - 2;
      if (sLeft === 0) inv.delete("stone"); else inv.set("stone", sLeft);
      if (wLeft === 0) inv.delete("wood");  else inv.set("wood", wLeft);
      inv.set("stone_axe", 1);
      console.log(`[AI] ${player.name} crafted stone axe`);
    }

    // ── Universal: craft iron axe if possible ────────────────────────────
    const ironIngot = inv.get("iron_ingot") ?? 0;
    if (!inv.get("iron_axe") && !inv.get("steel_axe") && ironIngot >= 2 && wood >= 2) {
      const iLeft = ironIngot - 2, wLeft2 = wood - 2;
      if (iLeft === 0) inv.delete("iron_ingot"); else inv.set("iron_ingot", iLeft);
      if (wLeft2 === 0) inv.delete("wood"); else inv.set("wood", wLeft2);
      inv.set("iron_axe", 1);
      // Remove stone_axe if upgrading
      if (inv.get("stone_axe")) inv.delete("stone_axe");
      console.log(`[AI] ${player.name} crafted iron axe`);
    }

    // ── Universal: craft steel axe if possible ───────────────────────────
    const steelIngot = inv.get("steel_ingot") ?? 0;
    if (!inv.get("steel_axe") && steelIngot >= 2 && wood >= 2) {
      const siLeft = steelIngot - 2, wLeft3 = wood - 2;
      if (siLeft === 0) inv.delete("steel_ingot"); else inv.set("steel_ingot", siLeft);
      if (wLeft3 === 0) inv.delete("wood"); else inv.set("wood", wLeft3);
      inv.set("steel_axe", 1);
      // Remove iron_axe/stone_axe if upgrading
      if (inv.get("iron_axe"))  inv.delete("iron_axe");
      if (inv.get("stone_axe")) inv.delete("stone_axe");
      console.log(`[AI] ${player.name} crafted steel axe`);
    }

    // ── Universal: craft fishing rod (gatherers only) ─────────────────────
    if (agent.role === "gatherer" && !inv.get("fishing_rod") && wood >= 2 && stone >= 1) {
      const wLeft = wood - 2, sLeft = stone - 1;
      if (wLeft === 0) inv.delete("wood"); else inv.set("wood", wLeft);
      if (sLeft === 0) inv.delete("stone"); else inv.set("stone", sLeft);
      inv.set("fishing_rod", 1);
      console.log(`[AI] ${player.name} crafted fishing rod`);
    }

    // ── Universal: cook raw_fish → cooked_fish at campfire ────────────────
    const rawFish = inv.get("raw_fish") ?? 0;
    if (rawFish >= 1 && agent.cookingUntil === 0 && agent.state !== "cooking_advanced") {
      const cf = this.findNearest(state.campfires, player);
      if (cf) { this.setTarget(agent, cf.x, cf.y, "cooking_advanced", "cooked_fish", now); return; }
    }

    // ── Universal: cook stew if have all ingredients ───────────────────────
    const cookedMeat = inv.get("cooked_meat") ?? 0;
    const berries2   = inv.get("berries")     ?? 0;
    const water2     = inv.get("water")       ?? 0;
    if (cookedMeat >= 1 && berries2 >= 2 && agent.cookingUntil === 0 && agent.state !== "cooking_advanced") {
      if (water2 >= 1) {
        const cf = this.findNearest(state.campfires, player);
        if (cf) { this.setTarget(agent, cf.x, cf.y, "cooking_advanced", "stew", now); return; }
      } else {
        // Need water — go to nearest well
        const well = this.findNearest(state.waterWells, player);
        if (well) { this.setTarget(agent, well.x, well.y, "at_well", well.id, now); return; }
      }
    }

    // ── Universal: smelt steel if have inputs and blast furnace exists ────
    const ironIngotCount = inv.get("iron_ingot") ?? 0;
    const coalCount      = inv.get("coal")        ?? 0;
    if (ironIngotCount >= 2 && coalCount >= 1 && agent.cookingUntil === 0 && agent.state !== "blasting") {
      const bf = this.findNearest(state.blastFurnaces, player);
      if (bf) {
        this.setTarget(agent, bf.x, bf.y, "blasting", "steel_ingot", now);
        return;
      }
    }

    // ── Universal: smelt iron ore at forge ───────────────────────────────
    const ironOre = inv.get("iron_ore") ?? 0;
    if (ironOre > 0 && agent.cookingUntil === 0 && agent.state !== "smelting") {
      const forge = this.findNearest(state.forges, player);
      if (forge) {
        this.setTarget(agent, forge.x, forge.y, "smelting", "iron_ore", now);
        return;
      }
    }

    // ── Universal: eat if starving ───────────────────────────────────────
    if (hunger < 30 && totalFood > 0) {
      this.setTarget(agent, player.x, player.y, "eating", "", now);
      return;
    }

    // ── Universal: buy food if hungry and market has any ────────────────
    if (hunger < 50 && totalFood === 0 && raw === 0 && wheat < 3 && player.coins > 0) {
      const listing = this.findCheapestFood(state, player.coins, player.id);
      if (listing) {
        this.setTarget(agent, MARKET_X, MARKET_Y, "buying", listing.id, now);
        return;
      }
    }

    // ── Role-specific logic ──────────────────────────────────────────────
    switch (agent.role) {

      case "gatherer":
        return this.decideGatherer(player, agent, state, now, { wood, stone, totalFood, raw });

      case "cook":
        return this.decideCook(player, agent, state, now, { raw, cooked, wood, totalFood });

      case "farmer":
        return this.decideFarmer(player, agent, state, now, { wheat, bread, totalFood, wood });

      case "trader":
        return this.decideTrader(player, agent, state, now, { totalFood });
    }
  }

  private decideGatherer(player: any, agent: AIAgent, state: any, now: number,
    { wood, stone, totalFood, raw }: { wood: number; stone: number; totalFood: number; raw: number }) {
    const inv = player.inventory;
    const W = GAME_CONSTANTS.WORLD_SIZE;

    // Sell surplus at market
    let totalItems = 0;
    inv.forEach((q: number) => { totalItems += q; });
    if (totalItems > 15) {
      this.setTarget(agent, MARKET_X, MARKET_Y, "selling", "", now);
      return;
    }

    // Cook raw meat if campfire nearby
    if (raw > 0 && agent.cookingUntil === 0) {
      const cf = this.findNearest(state.campfires, player);
      if (cf) { this.setTarget(agent, cf.x, cf.y, "cooking", "raw_meat", now); return; }
      if (wood >= 3) {
        const wx = player.x + (Math.random() * 80 - 40);
        const wy = player.y + (Math.random() * 80 - 40);
        this.setTarget(agent, wx, wy, "building", "", now);
        return;
      }
    }

    // Need food? Gather animals or berries
    if (totalFood < 2 && raw < 2) {
      const res = this.findNearestResource(player, state, "animal")
               ?? this.findNearestResource(player, state, "berries");
      if (res) { this.setTarget(agent, res.x, res.y, "gathering", res.id, now); return; }
    }

    // Fish if carrying a fishing rod
    if ((inv.get("fishing_rod") ?? 0) > 0) {
      const fishSpot = this.findNearestResource(player, state, "fish_spot");
      if (fishSpot) { this.setTarget(agent, fishSpot.x, fishSpot.y, "gathering", fishSpot.id, now); return; }
    }

    // Primary role: gather wood and stone
    const kind: ResourceKind = stone < wood ? "rock" : "tree";
    const res = this.findNearestResource(player, state, kind)
             ?? this.findNearestResource(player, state);
    if (res) { this.setTarget(agent, res.x, res.y, "gathering", res.id, now); return; }

    this.setTarget(agent, 100 + Math.random() * (W - 200), 100 + Math.random() * (W - 200), "wandering", "", now);
  }

  private decideCook(player: any, agent: AIAgent, state: any, now: number,
    { raw, cooked, wood, totalFood }: { raw: number; cooked: number; wood: number; totalFood: number }) {
    const W = GAME_CONSTANTS.WORLD_SIZE;

    // Sell cooked meat if have surplus
    if (cooked >= 3) {
      this.setTarget(agent, MARKET_X, MARKET_Y, "selling", "", now);
      return;
    }

    // Cook raw meat if have it and campfire nearby
    if (raw > 0 && agent.cookingUntil === 0) {
      const cf = this.findNearest(state.campfires, player);
      if (cf) { this.setTarget(agent, cf.x, cf.y, "cooking", "raw_meat", now); return; }
      if (wood >= 3) {
        this.setTarget(agent, player.x + (Math.random() * 80 - 40), player.y + (Math.random() * 80 - 40), "building", "", now);
        return;
      }
    }

    // Gather animals for raw meat
    if (raw < 4) {
      const res = this.findNearestResource(player, state, "animal");
      if (res) { this.setTarget(agent, res.x, res.y, "gathering", res.id, now); return; }
    }

    // Gather wood for campfires
    if (wood < 3) {
      const res = this.findNearestResource(player, state, "tree");
      if (res) { this.setTarget(agent, res.x, res.y, "gathering", res.id, now); return; }
    }

    this.setTarget(agent, 100 + Math.random() * (W - 200), 100 + Math.random() * (W - 200), "wandering", "", now);
  }

  private decideFarmer(player: any, agent: AIAgent, state: any, now: number,
    { wheat, bread, totalFood, wood }: { wheat: number; bread: number; totalFood: number; wood: number }) {
    const W = GAME_CONSTANTS.WORLD_SIZE;

    // Sell bread surplus
    if (bread >= 3) {
      this.setTarget(agent, MARKET_X, MARKET_Y, "selling", "", now);
      return;
    }

    // Bake bread: need 3 wheat + campfire
    if (wheat >= 3 && agent.cookingUntil === 0) {
      const cf = this.findNearest(state.campfires, player);
      if (cf) { this.setTarget(agent, cf.x, cf.y, "cooking", "wheat", now); return; }
      if (wood >= 3) {
        this.setTarget(agent, player.x + (Math.random() * 80 - 40), player.y + (Math.random() * 80 - 40), "building", "", now);
        return;
      }
    }

    // Gather wheat
    if (wheat < 6) {
      const res = this.findNearestResource(player, state, "wheat_field");
      if (res) { this.setTarget(agent, res.x, res.y, "gathering", res.id, now); return; }
    }

    // Get wood for campfire if needed
    if (wood < 3) {
      const res = this.findNearestResource(player, state, "tree");
      if (res) { this.setTarget(agent, res.x, res.y, "gathering", res.id, now); return; }
    }

    this.setTarget(agent, 100 + Math.random() * (W - 200), 100 + Math.random() * (W - 200), "wandering", "", now);
  }

  private decideTrader(player: any, agent: AIAgent, state: any, now: number,
    { totalFood }: { totalFood: number }) {
    const W = GAME_CONSTANTS.WORLD_SIZE;

    // Market arbitrage: find underpriced listings and resell
    let arbitrage: any = null;
    state.listings.forEach((lst: any) => {
      if (lst.sellerId === player.id) return;
      const marketPrice = SELL_PRICES[lst.itemId];
      if (!marketPrice) return;
      if (lst.pricePerUnit < marketPrice && player.coins >= lst.pricePerUnit) {
        if (!arbitrage || lst.pricePerUnit < arbitrage.pricePerUnit) arbitrage = lst;
      }
    });
    if (arbitrage) {
      this.setTarget(agent, MARKET_X, MARKET_Y, "trading", arbitrage.id, now);
      return;
    }

    // If holding items worth selling, sell them
    let hasGoods = false;
    player.inventory.forEach((qty: number, itemId: string) => {
      if (qty >= 2 && SELL_PRICES[itemId]) hasGoods = true;
    });
    if (hasGoods) {
      this.setTarget(agent, MARKET_X, MARKET_Y, "selling", "", now);
      return;
    }

    // Gather anything nearby
    const res = this.findNearestResource(player, state);
    if (res) { this.setTarget(agent, res.x, res.y, "gathering", res.id, now); return; }

    this.setTarget(agent, 100 + Math.random() * (W - 200), 100 + Math.random() * (W - 200), "wandering", "", now);
  }

  // ── Execution ──────────────────────────────────────────────────────────────

  private execute(player: any, agent: AIAgent, state: any, now: number) {
    switch (agent.state) {

      case "eating": {
        let best: string | null = null, bestRestore = 0;
        player.inventory.forEach((qty: number, id: string) => {
          const def = ITEMS[id as ItemId];
          if (qty > 0 && def?.hungerRestore && def.hungerRestore > bestRestore) {
            best = id; bestRestore = def.hungerRestore;
          }
        });
        if (best) {
          const q = (player.inventory.get(best) ?? 1) - 1;
          if (q === 0) player.inventory.delete(best); else player.inventory.set(best, q);
          player.hunger = Math.min(GAME_CONSTANTS.HUNGER_MAX, player.hunger + bestRestore);
        }
        break;
      }

      case "gathering": {
        const res = state.resources.get(agent.targetId);
        if (res && !res.depleted) {
          const def = RESOURCES[res.kind as ResourceKind];
          res.depleted = true;
          agent.gatheringUntil = now + def.gatherMs;
          agent.gatherResourceId = agent.targetId;
        }
        break;
      }

      case "cooking": {
        const itemId = agent.targetId as ItemId;
        const recipe = COOK_RECIPES[itemId];
        if (!recipe) break;
        const have = player.inventory.get(itemId) ?? 0;
        if (have >= recipe.inputQty && agent.cookingUntil === 0) {
          const remaining = have - recipe.inputQty;
          if (remaining === 0) player.inventory.delete(itemId); else player.inventory.set(itemId, remaining);
          agent.cookingUntil = now + recipe.timeMs;
        }
        break;
      }

      case "smelting": {
        const itemId = agent.targetId as ItemId;
        const recipe = SMELT_RECIPES[itemId];
        if (!recipe) break;
        const have = player.inventory.get(itemId) ?? 0;
        if (have >= recipe.inputQty && agent.cookingUntil === 0) {
          const remaining = have - recipe.inputQty;
          if (remaining === 0) player.inventory.delete(itemId); else player.inventory.set(itemId, remaining);
          agent.cookingUntil = now + recipe.timeMs;
        }
        break;
      }

      case "blasting": {
        const recipe = BLAST_RECIPES[agent.targetId];
        if (!recipe) break;
        // Check all inputs
        let canBlast = true;
        for (const [itemId, qty] of Object.entries(recipe.inputs)) {
          if ((player.inventory.get(itemId) ?? 0) < (qty as number)) { canBlast = false; break; }
        }
        if (canBlast && agent.cookingUntil === 0) {
          for (const [itemId, qty] of Object.entries(recipe.inputs)) {
            const left = (player.inventory.get(itemId) ?? 0) - (qty as number);
            if (left === 0) player.inventory.delete(itemId); else player.inventory.set(itemId, left);
          }
          agent.cookingUntil = now + recipe.timeMs;
        }
        break;
      }

      case "at_well": {
        // Give water directly (server-side simulation)
        player.inventory.set("water", (player.inventory.get("water") ?? 0) + 3);
        agent.state = "wandering";
        break;
      }

      case "cooking_advanced": {
        const recipe = ADVANCED_COOK_RECIPES[agent.targetId];
        if (!recipe) break;
        let canCook = true;
        for (const [itemId, qty] of Object.entries(recipe.inputs)) {
          if ((player.inventory.get(itemId) ?? 0) < (qty as number)) { canCook = false; break; }
        }
        if (canCook && agent.cookingUntil === 0) {
          for (const [itemId, qty] of Object.entries(recipe.inputs)) {
            const left = (player.inventory.get(itemId) ?? 0) - (qty as number);
            if (left === 0) player.inventory.delete(itemId); else player.inventory.set(itemId, left);
          }
          agent.cookingUntil = now + recipe.timeMs;
        }
        break;
      }

      case "building": {
        const wood = player.inventory.get("wood") ?? 0;
        if (wood >= 3) {
          const q = wood - 3;
          if (q === 0) player.inventory.delete("wood"); else player.inventory.set("wood", q);
          const cfId = `cf_ai_${now}_${agent.playerId}`;
          state.campfires.set(cfId, this.factories.createCampfire(player.x, player.y, player.id, cfId));
        }
        break;
      }

      case "buying": {
        const listing = state.listings.get(agent.targetId);
        if (listing && listing.quantity > 0 && player.coins >= listing.pricePerUnit && listing.sellerId !== player.id) {
          player.coins -= listing.pricePerUnit;
          player.inventory.set(listing.itemId, (player.inventory.get(listing.itemId) ?? 0) + 1);
          const seller = state.players.get(listing.sellerId);
          if (seller) seller.coins += listing.pricePerUnit;
          listing.quantity -= 1;
          if (listing.quantity <= 0) state.listings.delete(agent.targetId);
        }
        break;
      }

      case "trading": {
        // Buy underpriced listing then immediately relist at market price
        const listing = state.listings.get(agent.targetId);
        if (listing && listing.quantity > 0 && player.coins >= listing.pricePerUnit && listing.sellerId !== player.id) {
          player.coins -= listing.pricePerUnit;
          const itemId = listing.itemId;
          player.inventory.set(itemId, (player.inventory.get(itemId) ?? 0) + 1);
          const seller = state.players.get(listing.sellerId);
          if (seller) seller.coins += listing.pricePerUnit;
          listing.quantity -= 1;
          if (listing.quantity <= 0) state.listings.delete(agent.targetId);

          // Immediately relist at market price
          const price  = SELL_PRICES[itemId] ?? listing.pricePerUnit + 1;
          const lstId  = `lst_ai_${now}_${agent.playerId}_${itemId}`;
          state.listings.set(lstId, this.factories.createListing(player.id, player.name, itemId, 1, price, lstId));
        }
        break;
      }

      case "selling": {
        player.inventory.forEach((qty: number, itemId: string) => {
          const price = SELL_PRICES[itemId];
          if (!price) return;
          // Role-specific keep amounts
          const keepQty = (agent.role === "cook"    && itemId === "cooked_meat") ? 1
                        : (agent.role === "farmer"  && itemId === "bread")       ? 1
                        : (agent.role === "gatherer")                            ? 2
                        : 0;
          if (qty <= keepQty) return;
          const toList = Math.min(qty - keepQty, 5);
          if (toList <= 0) return;
          const remaining = qty - toList;
          if (remaining === 0) player.inventory.delete(itemId); else player.inventory.set(itemId, remaining);
          const lstId = `lst_ai_${now}_${agent.playerId}_${itemId}`;
          state.listings.set(lstId, this.factories.createListing(player.id, player.name, itemId, toList, price, lstId));
        });
        break;
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private setTarget(agent: AIAgent, x: number, y: number, state: AIState, targetId: string, now: number) {
    agent.state      = state;
    agent.targetX    = x;
    agent.targetY    = y;
    agent.targetId   = targetId;
    agent.targetSetAt = now;
  }

  private findNearestResource(player: any, state: any, kind?: string): any {
    let nearest: any = null, nearestDist = Infinity;
    state.resources.forEach((res: any) => {
      if (res.depleted || (kind && res.kind !== kind)) return;
      const d = Math.hypot(res.x - player.x, res.y - player.y);
      if (d < nearestDist) { nearestDist = d; nearest = res; }
    });
    return nearest;
  }

  private findNearest(collection: any, player: any): any {
    let nearest: any = null, nearestDist = Infinity;
    collection.forEach((item: any) => {
      const d = Math.hypot(item.x - player.x, item.y - player.y);
      if (d < nearestDist) { nearestDist = d; nearest = item; }
    });
    return nearest;
  }

  private findCheapestFood(state: any, coins: number, playerId: string): any {
    let best: any = null, bestPrice = Infinity;
    state.listings.forEach((lst: any) => {
      if (!ITEMS[lst.itemId as ItemId]?.hungerRestore) return;
      if (lst.sellerId === playerId || lst.pricePerUnit > coins) return;
      if (lst.pricePerUnit < bestPrice) { bestPrice = lst.pricePerUnit; best = lst; }
    });
    return best;
  }
}
