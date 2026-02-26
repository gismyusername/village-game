import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";
import {
  GAME_CONSTANTS, ITEMS, RESOURCES, RESOURCE_COUNTS, ClientMessage, ItemId, ResourceKind,
  CAMPFIRE_WOOD_COST, STARTER_COINS, COOK_RECIPES, RECIPES, SMELT_RECIPES,
  FORGE_STONE_COST, FORGE_WOOD_COST, CHEST_WOOD_COST,
  BLAST_RECIPES, ADVANCED_COOK_RECIPES,
  BLAST_FURNACE_STONE_COST, BLAST_FURNACE_WOOD_COST,
  WATER_WELL_STONE_COST, WATER_WELL_WOOD_COST,
  LAND_PLOT_PRICE, LAND_PLOT_SIZE, LAND_PLOT_MIN_DISTANCE,
  TOOL_MAX_DURABILITY,
  TECH_IRON_GATHER_THRESHOLD, TECH_STEEL_SMELT_THRESHOLD,
} from "@game/shared";
import { AIManager } from "../ai/AIManager";
import { db } from "../db/Database";

// ── Schemas ───────────────────────────────────────────────────────────────────

export class MarketListingSchema extends Schema {
  @type("string") id: string = "";
  @type("string") sellerId: string = "";   // persistent UUID
  @type("string") sellerName: string = "";
  @type("string") itemId: string = "";
  @type("number") quantity: number = 0;
  @type("number") pricePerUnit: number = 0;
}

export class CampfireSchema extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") ownerId: string = "";
}

export class ForgeSchema extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") ownerId: string = "";
}

export class ChestSchema extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") ownerUuid: string = "";
  @type({ map: "number" }) inventory = new MapSchema<number>();
}

export class BlastFurnaceSchema extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") ownerId: string = "";
}

export class WaterWellSchema extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") ownerId: string = "";
}

export class LandPlotSchema extends Schema {
  @type("string") id: string = "";
  @type("string") ownerUuid: string = "";
  @type("string") ownerName: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
}

export class ResourceSchema extends Schema {
  @type("string")  id: string = "";
  @type("string")  kind: string = "";
  @type("number")  x: number = 0;
  @type("number")  y: number = 0;
  @type("boolean") depleted: boolean = false;
}

export class PlayerSchema extends Schema {
  @type("string")  id: string = "";       // session id
  @type("string")  uuid: string = "";     // persistent player id
  @type("string")  name: string = "";
  @type("number")  x: number = 0;
  @type("number")  y: number = 0;
  @type("number")  hunger: number = GAME_CONSTANTS.HUNGER_MAX;
  @type("number")  coins: number = 0;
  @type("boolean") isAI: boolean = false;
  @type({ map: "number" }) inventory     = new MapSchema<number>();
  @type({ map: "number" }) toolDurability = new MapSchema<number>();
}

export class GameState extends Schema {
  @type({ map: PlayerSchema })        players       = new MapSchema<PlayerSchema>();
  @type({ map: ResourceSchema })      resources     = new MapSchema<ResourceSchema>();
  @type({ map: CampfireSchema })      campfires     = new MapSchema<CampfireSchema>();
  @type({ map: ForgeSchema })         forges        = new MapSchema<ForgeSchema>();
  @type({ map: ChestSchema })         chests        = new MapSchema<ChestSchema>();
  @type({ map: BlastFurnaceSchema })  blastFurnaces = new MapSchema<BlastFurnaceSchema>();
  @type({ map: WaterWellSchema })     waterWells    = new MapSchema<WaterWellSchema>();
  @type({ map: LandPlotSchema })      landPlots     = new MapSchema<LandPlotSchema>();
  @type({ map: MarketListingSchema }) listings      = new MapSchema<MarketListingSchema>();
  @type("number") gameTime:          number = 0;
  // Tech tree
  @type("number") techLevel:         number = 0;
  @type("number") totalGathers:      number = 0;
  @type("number") totalIronSmelted:  number = 0;
  // Mayor
  @type("string") mayorUuid:         string = "npc_mayor";
  @type("string") mayorName:         string = "Mayor";
  // Online count (real players only)
  @type("number") onlinePlayers:     number = 0;
}

// ── Room ──────────────────────────────────────────────────────────────────────

export class GameRoom extends Room<GameState> {
  private lastTick        = Date.now();
  private aiManager!:       AIManager;
  private gatheringTimers = new Map<string, { timer: NodeJS.Timeout; resourceId: string }>();
  private lastElectionDay = -1;

  // UUID ↔ sessionId lookups for offline-seller payments
  private playerUUIDs    = new Map<string, string>(); // sessionId → uuid
  private playerSessions = new Map<string, string>(); // uuid → sessionId

  onCreate() {
    this.setState(new GameState());
    this.loadOrGenerateResources();
    this.loadPersisted();

    this.aiManager = new AIManager({
      createPlayer: (id, name, x, y) => {
        const p = new PlayerSchema();
        p.id = id; p.name = name; p.x = x; p.y = y;
        p.hunger = GAME_CONSTANTS.HUNGER_MAX;
        return p;
      },
      createCampfire: (x, y, ownerId, id) => {
        const cf = new CampfireSchema();
        cf.id = id; cf.x = x; cf.y = y; cf.ownerId = ownerId;
        return cf;
      },
      createListing: (sellerId, sellerName, itemId, qty, price, id) => {
        const lst = new MarketListingSchema();
        lst.id = id; lst.sellerId = sellerId; lst.sellerName = sellerName;
        lst.itemId = itemId; lst.quantity = qty; lst.pricePerUnit = price;
        return lst;
      },
    });
    this.aiManager.spawnAll(this.state);

    this.setSimulationInterval(() => this.tick(), 1000 / GAME_CONSTANTS.SERVER_TICK_RATE);
    this.onMessage("*", (client, type, message) => {
      this.handleMessage(client, { type, ...message } as ClientMessage);
    });

    // Autosave all online real players every 60s
    setInterval(() => this.autoSave(), 60_000);

    console.log(`[GameRoom] Room ${this.roomId} ready — ${this.state.resources.size} resources, ${this.state.campfires.size} campfires, ${this.state.listings.size} listings`);
  }

  onJoin(client: Client, options: { name?: string; uuid?: string }) {
    const uuid    = options?.uuid ?? client.sessionId;
    const saved   = db.getPlayer(uuid);

    const player  = new PlayerSchema();
    player.id     = client.sessionId;
    player.uuid   = uuid;
    player.name   = options?.name ?? saved?.name ?? `Player_${uuid.slice(0, 6)}`;
    player.x      = 400 + Math.floor(Math.random() * 12) * GAME_CONSTANTS.TILE_SIZE;
    player.y      = 400 + Math.floor(Math.random() * 12) * GAME_CONSTANTS.TILE_SIZE;
    player.hunger = GAME_CONSTANTS.HUNGER_MAX;
    player.coins  = saved?.coins ?? STARTER_COINS;

    if (saved?.inventory) {
      for (const [itemId, qty] of Object.entries(saved.inventory)) {
        if (qty > 0) player.inventory.set(itemId, qty);
      }
    }

    if (saved?.tool_durability) {
      for (const [toolId, dur] of Object.entries(saved.tool_durability)) {
        if (dur > 0) player.toolDurability.set(toolId, dur);
      }
    }

    this.playerUUIDs.set(client.sessionId, uuid);
    this.playerSessions.set(uuid, client.sessionId);
    this.state.players.set(client.sessionId, player);
    console.log(`[GameRoom] ${player.name} joined (${saved ? "returning" : "new"})`);
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const uuid   = this.playerUUIDs.get(client.sessionId);
    if (player && uuid) this.savePlayerToDB(player, uuid);

    this.cancelGathering(client.sessionId);
    this.playerUUIDs.delete(client.sessionId);
    this.playerSessions.delete(uuid ?? "");
    this.state.players.delete(client.sessionId);
  }

  // ── Persistence helpers ───────────────────────────────────────────────────

  private loadPersisted() {
    // Restore campfires
    for (const row of db.getAllCampfires()) {
      const cf = new CampfireSchema();
      cf.id = row.id; cf.x = row.x; cf.y = row.y; cf.ownerId = row.owner_uuid;
      this.state.campfires.set(cf.id, cf);
    }
    // Restore forges
    for (const row of db.getAllForges()) {
      const forge = new ForgeSchema();
      forge.id = row.id; forge.x = row.x; forge.y = row.y; forge.ownerId = row.owner_uuid;
      this.state.forges.set(forge.id, forge);
    }
    // Restore chests
    for (const row of db.getAllChests()) {
      const chest = new ChestSchema();
      chest.id = row.id; chest.x = row.x; chest.y = row.y; chest.ownerUuid = row.owner_uuid;
      const inv = JSON.parse(row.inventory) as Record<string, number>;
      for (const [itemId, qty] of Object.entries(inv)) {
        if (qty > 0) chest.inventory.set(itemId, qty);
      }
      this.state.chests.set(chest.id, chest);
    }
    // Restore blast furnaces
    for (const row of db.getAllBlastFurnaces()) {
      const bf = new BlastFurnaceSchema();
      bf.id = row.id; bf.x = row.x; bf.y = row.y; bf.ownerId = row.owner_uuid;
      this.state.blastFurnaces.set(bf.id, bf);
    }
    // Restore water wells
    for (const row of db.getAllWaterWells()) {
      const well = new WaterWellSchema();
      well.id = row.id; well.x = row.x; well.y = row.y; well.ownerId = row.owner_uuid;
      this.state.waterWells.set(well.id, well);
    }
    // Restore land plots
    for (const row of db.getAllLandPlots()) {
      const plot = new LandPlotSchema();
      plot.id = row.id; plot.ownerUuid = row.owner_uuid; plot.ownerName = row.owner_name;
      plot.x = row.x; plot.y = row.y;
      this.state.landPlots.set(plot.id, plot);
    }
    // Restore market listings
    for (const row of db.getAllListings()) {
      const lst = new MarketListingSchema();
      lst.id = row.id; lst.sellerId = row.seller_uuid; lst.sellerName = row.seller_name;
      lst.itemId = row.item_id; lst.quantity = row.quantity; lst.pricePerUnit = row.price_per_unit;
      this.state.listings.set(lst.id, lst);
    }

    // Restore world state (tech tree, mayor)
    const techLevel = db.getWorldState("techLevel");
    if (techLevel) this.state.techLevel = parseInt(techLevel) || 0;
    const totalGathers = db.getWorldState("totalGathers");
    if (totalGathers) this.state.totalGathers = parseInt(totalGathers) || 0;
    const totalIronSmelted = db.getWorldState("totalIronSmelted");
    if (totalIronSmelted) this.state.totalIronSmelted = parseInt(totalIronSmelted) || 0;
    const mayorUuid = db.getWorldState("mayorUuid");
    if (mayorUuid) this.state.mayorUuid = mayorUuid;
    const mayorName = db.getWorldState("mayorName");
    if (mayorName) this.state.mayorName = mayorName;
  }

  private savePlayerToDB(player: PlayerSchema, uuid: string) {
    const inventory: Record<string, number> = {};
    player.inventory.forEach((qty, itemId) => { inventory[itemId] = qty; });
    const tool_durability: Record<string, number> = {};
    player.toolDurability.forEach((dur, toolId) => { tool_durability[toolId] = dur; });
    db.savePlayer({ uuid, name: player.name, coins: player.coins, inventory, tool_durability });
  }

  private autoSave() {
    let count = 0;
    this.state.players.forEach((player, sessionId) => {
      if (player.isAI) return;
      const uuid = this.playerUUIDs.get(sessionId);
      if (uuid) { this.savePlayerToDB(player, uuid); count++; }
    });
    // Save world state
    db.setWorldState("techLevel",        String(this.state.techLevel));
    db.setWorldState("totalGathers",     String(this.state.totalGathers));
    db.setWorldState("totalIronSmelted", String(this.state.totalIronSmelted));
    db.setWorldState("mayorUuid",        this.state.mayorUuid);
    db.setWorldState("mayorName",        this.state.mayorName);
    if (count > 0) console.log(`[GameRoom] Autosaved ${count} players`);
  }

  private cancelGathering(sessionId: string) {
    const gathering = this.gatheringTimers.get(sessionId);
    if (gathering) {
      clearTimeout(gathering.timer);
      const res = this.state.resources.get(gathering.resourceId);
      if (res) res.depleted = false;
      this.gatheringTimers.delete(sessionId);
    }
  }

  // ── Land plot guard ───────────────────────────────────────────────────────

  private isBlockedByOtherPlot(x: number, y: number, placerUuid: string): boolean {
    const half = LAND_PLOT_SIZE / 2;
    let blocked = false;
    this.state.landPlots.forEach((plot) => {
      if (plot.ownerUuid === placerUuid) return;
      if (Math.abs(plot.x - x) < half && Math.abs(plot.y - y) < half) blocked = true;
    });
    return blocked;
  }

  // ── World generation / persistence ───────────────────────────────────────

  private loadOrGenerateResources() {
    const saved = db.getAllResources();
    if (saved.length > 0) {
      for (const row of saved) {
        const res    = new ResourceSchema();
        res.id       = row.id;
        res.kind     = row.kind;
        res.x        = row.x;
        res.y        = row.y;
        res.depleted = false;
        this.state.resources.set(res.id, res);
      }
      console.log(`[GameRoom] Restored ${saved.length} resources from DB`);
    } else {
      const W = GAME_CONSTANTS.WORLD_SIZE;
      const T = GAME_CONSTANTS.TILE_SIZE;
      let i   = 0;
      for (const kind of Object.keys(RESOURCE_COUNTS) as ResourceKind[]) {
        for (let j = 0; j < RESOURCE_COUNTS[kind]; j++) {
          const res    = new ResourceSchema();
          res.id       = `res_${i++}`;
          res.kind     = kind;
          res.x        = Math.floor(Math.random() * (W / T)) * T + T / 2;
          res.y        = Math.floor(Math.random() * (W / T)) * T + T / 2;
          res.depleted = false;
          this.state.resources.set(res.id, res);
        }
      }
      const toSave: { id: string; kind: string; x: number; y: number }[] = [];
      this.state.resources.forEach((res) => {
        toSave.push({ id: res.id, kind: res.kind, x: res.x, y: res.y });
      });
      db.saveAllResources(toSave);
      console.log(`[GameRoom] Generated and saved ${toSave.length} resources to DB`);
    }
  }

  // ── Tick ──────────────────────────────────────────────────────────────────

  private tick() {
    const now   = Date.now();
    const delta = now - this.lastTick;
    this.lastTick = now;
    this.state.gameTime += delta;
    this.tickHunger(delta);
    this.tickElection();
    // Update online player count
    let onlineCount = 0;
    this.state.players.forEach(p => { if (!p.isAI) onlineCount++; });
    this.state.onlinePlayers = onlineCount;
    this.aiManager.tick(this.state, delta, now);
  }

  // ── Tech tree ─────────────────────────────────────────────────────────────

  private checkTechAdvance() {
    if (this.state.techLevel < 1 && this.state.totalGathers >= TECH_IRON_GATHER_THRESHOLD) {
      this.state.techLevel = 1;
      this.broadcast("tech_advance", { level: 1, name: "Iron Age" });
      console.log("[GameRoom] Tech advanced to Iron Age!");
    }
    if (this.state.techLevel < 2 && this.state.totalIronSmelted >= TECH_STEEL_SMELT_THRESHOLD) {
      this.state.techLevel = 2;
      this.broadcast("tech_advance", { level: 2, name: "Steel Age" });
      console.log("[GameRoom] Tech advanced to Steel Age!");
    }
  }

  // ── Mayor elections ───────────────────────────────────────────────────────

  private tickElection() {
    const dayNum = Math.floor(this.state.gameTime / GAME_CONSTANTS.MS_PER_GAME_DAY);
    if (dayNum <= this.lastElectionDay || dayNum === 0) return;
    if (dayNum % 5 !== 0) return;
    this.lastElectionDay = dayNum;
    this.runElection();
  }

  private runElection() {
    let richest: PlayerSchema | null = null;
    let richestCoins = 50; // minimum coins to become Mayor
    this.state.players.forEach((player) => {
      if (player.isAI) return;
      if (player.coins > richestCoins) { richestCoins = player.coins; richest = player; }
    });
    if (richest) {
      const p = richest as PlayerSchema;
      if (p.uuid === this.state.mayorUuid) return; // already Mayor, no change
      this.state.mayorUuid = p.uuid;
      this.state.mayorName = p.name;
      db.setWorldState("mayorUuid", p.uuid);
      db.setWorldState("mayorName", p.name);
      this.broadcast("mayor_elected", { name: p.name });
      console.log(`[GameRoom] ${p.name} elected as Mayor!`);
    } else if (this.state.mayorUuid !== "npc_mayor") {
      this.state.mayorUuid = "npc_mayor";
      this.state.mayorName = "Mayor";
      db.setWorldState("mayorUuid", "npc_mayor");
      db.setWorldState("mayorName", "Mayor");
    }
  }

  private tickHunger(delta: number) {
    this.state.players.forEach((player, sessionId) => {
      player.hunger -= GAME_CONSTANTS.HUNGER_DRAIN_PER_MS * delta;
      if (player.hunger <= 0) {
        // Save cleared state to DB before resetting (real players only)
        if (!player.isAI) {
          const uuid = this.playerUUIDs.get(sessionId);
          if (uuid) db.savePlayer({ uuid, name: player.name, coins: 0, inventory: {}, tool_durability: {} });
        }
        this.cancelGathering(sessionId);
        player.hunger = GAME_CONSTANTS.HUNGER_MAX;
        player.coins  = 0;
        player.inventory.clear();
        player.toolDurability.clear();
        player.x = 400 + Math.floor(Math.random() * 12) * GAME_CONSTANTS.TILE_SIZE;
        player.y = 400 + Math.floor(Math.random() * 12) * GAME_CONSTANTS.TILE_SIZE;
        this.broadcast("player_died", { playerId: player.id });
        console.log(`[GameRoom] ${player.name} starved`);
      }
    });
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  private handleMessage(client: Client, message: ClientMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    switch (message.type) {

      case "move":
        player.x = Math.max(0, Math.min(GAME_CONSTANTS.WORLD_SIZE, message.x));
        player.y = Math.max(0, Math.min(GAME_CONSTANTS.WORLD_SIZE, message.y));
        break;

      case "gather": {
        const resource = this.state.resources.get(message.resourceId);
        if (!resource || resource.depleted) return;
        if (Math.hypot(resource.x - player.x, resource.y - player.y) > GAME_CONSTANTS.GATHER_RANGE) return;

        // Cancel any existing gather
        this.cancelGathering(client.sessionId);

        const def = RESOURCES[resource.kind as ResourceKind];
        resource.depleted = true; // Lock resource immediately

        const sid   = client.sessionId;
        const resId = message.resourceId;
        const timer = setTimeout(() => {
          this.gatheringTimers.delete(sid);
          const p   = this.state.players.get(sid);
          const res = this.state.resources.get(resId);
          if (!p || !res) return;

          // Check player is still in range
          if (Math.hypot(res.x - p.x, res.y - p.y) > GAME_CONSTANTS.GATHER_RANGE * 1.5) {
            res.depleted = false; // Player moved away — unlock resource
            return;
          }

          const hasSteelAxe = (p.inventory.get("steel_axe") ?? 0) > 0;
          const hasIronAxe  = (p.inventory.get("iron_axe")  ?? 0) > 0;
          const hasStoneAxe = (p.inventory.get("stone_axe") ?? 0) > 0;
          const multiplier  = hasSteelAxe ? 3.0 : hasIronAxe ? 2.0 : hasStoneAxe ? 1.5 : 1.0;

          for (const drop of def.drops) {
            if (drop.toolRequired && (p.inventory.get(drop.toolRequired) ?? 0) === 0) continue;
            let qty = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
            if (qty === 0) continue;
            if (multiplier > 1) qty = Math.ceil(qty * multiplier);
            p.inventory.set(drop.itemId, (p.inventory.get(drop.itemId) ?? 0) + qty);
          }

          // Tool durability
          const toolOrder: ItemId[] = ["steel_axe", "iron_axe", "stone_axe", "fishing_rod"];
          for (const toolId of toolOrder) {
            if ((p.inventory.get(toolId) ?? 0) > 0 && TOOL_MAX_DURABILITY[toolId]) {
              const cur  = p.toolDurability.get(toolId) ?? TOOL_MAX_DURABILITY[toolId]!;
              const next = cur - 1;
              if (next <= 0) {
                p.inventory.delete(toolId);
                p.toolDurability.delete(toolId);
              } else {
                p.toolDurability.set(toolId, next);
              }
              break;
            }
          }

          // Tech tree tracking (human players only — AI uses a different code path)
          if (!p.isAI) {
            this.state.totalGathers++;
            this.checkTechAdvance();
          }

          setTimeout(() => { res.depleted = false; }, def.respawnMs);
        }, def.gatherMs);

        this.gatheringTimers.set(sid, { timer, resourceId: resId });
        break;
      }

      case "place_campfire": {
        if (this.isBlockedByOtherPlot(player.x, player.y, player.uuid)) return;
        const wood = player.inventory.get("wood") ?? 0;
        if (wood < CAMPFIRE_WOOD_COST) return;

        let tooClose = false;
        this.state.campfires.forEach((cf) => {
          if (Math.hypot(cf.x - player.x, cf.y - player.y) < GAME_CONSTANTS.TILE_SIZE * 3) tooClose = true;
        });
        if (tooClose) return;

        const cf   = new CampfireSchema();
        cf.id      = `cf_${Date.now()}_${client.sessionId}`;
        cf.x       = player.x; cf.y = player.y;
        cf.ownerId = player.uuid;

        const q = wood - CAMPFIRE_WOOD_COST;
        if (q === 0) player.inventory.delete("wood"); else player.inventory.set("wood", q);

        this.state.campfires.set(cf.id, cf);
        db.saveCampfire({ id: cf.id, owner_uuid: player.uuid, x: cf.x, y: cf.y });
        break;
      }

      case "cook": {
        const campfire = this.state.campfires.get(message.campfireId);
        if (!campfire) return;
        if (Math.hypot(campfire.x - player.x, campfire.y - player.y) > GAME_CONSTANTS.GATHER_RANGE * 2) return;

        const recipe = COOK_RECIPES[message.itemId as ItemId];
        if (!recipe) return;
        const have = player.inventory.get(message.itemId) ?? 0;
        if (have < recipe.inputQty) return;

        const remaining = have - recipe.inputQty;
        if (remaining === 0) player.inventory.delete(message.itemId); else player.inventory.set(message.itemId, remaining);

        const sid = client.sessionId;
        const { output, outputQty, timeMs } = recipe;
        setTimeout(() => {
          const p = this.state.players.get(sid);
          if (!p) return;
          p.inventory.set(output, (p.inventory.get(output) ?? 0) + outputQty);
        }, timeMs);
        break;
      }

      case "cook_advanced": {
        const campfire = this.state.campfires.get(message.campfireId);
        if (!campfire) return;
        if (Math.hypot(campfire.x - player.x, campfire.y - player.y) > GAME_CONSTANTS.GATHER_RANGE * 2) return;

        const recipe = ADVANCED_COOK_RECIPES[message.recipeId];
        if (!recipe) return;

        // Check all inputs
        for (const [itemId, qty] of Object.entries(recipe.inputs)) {
          if ((player.inventory.get(itemId) ?? 0) < (qty as number)) return;
        }
        // Deduct all inputs
        for (const [itemId, qty] of Object.entries(recipe.inputs)) {
          const left = (player.inventory.get(itemId) ?? 0) - (qty as number);
          if (left === 0) player.inventory.delete(itemId); else player.inventory.set(itemId, left);
        }

        const sid = client.sessionId;
        const { output, outputQty, timeMs } = recipe;
        setTimeout(() => {
          const p = this.state.players.get(sid);
          if (!p) return;
          p.inventory.set(output, (p.inventory.get(output) ?? 0) + outputQty);
        }, timeMs);
        break;
      }

      case "craft": {
        const recipe = RECIPES[message.recipeId];
        if (!recipe) return;
        for (const [itemId, qty] of Object.entries(recipe.inputs)) {
          if ((player.inventory.get(itemId) ?? 0) < (qty as number)) return;
        }
        for (const [itemId, qty] of Object.entries(recipe.inputs)) {
          const left = (player.inventory.get(itemId) ?? 0) - (qty as number);
          if (left === 0) player.inventory.delete(itemId); else player.inventory.set(itemId, left);
        }
        player.inventory.set(recipe.output, (player.inventory.get(recipe.output) ?? 0) + recipe.outputQty);
        break;
      }

      case "market_list": {
        const { itemId, quantity, pricePerUnit } = message;
        if (quantity < 1 || pricePerUnit < 1) return;
        const inBag = player.inventory.get(itemId) ?? 0;
        if (inBag < quantity) return;

        const q = inBag - quantity;
        if (q === 0) player.inventory.delete(itemId); else player.inventory.set(itemId, q);

        const lst        = new MarketListingSchema();
        lst.id           = `lst_${Date.now()}_${client.sessionId}`;
        lst.sellerId     = player.uuid;  // UUID, not sessionId
        lst.sellerName   = player.name;
        lst.itemId       = itemId;
        lst.quantity     = quantity;
        lst.pricePerUnit = pricePerUnit;
        this.state.listings.set(lst.id, lst);
        db.saveListing({ id: lst.id, seller_uuid: player.uuid, seller_name: player.name, item_id: itemId, quantity, price_per_unit: pricePerUnit });
        break;
      }

      case "market_buy": {
        const listing = this.state.listings.get(message.listingId);
        if (!listing || listing.quantity < 1) return;
        if (listing.sellerId === player.uuid) return;
        if (player.coins < listing.pricePerUnit) return;

        player.coins -= listing.pricePerUnit;
        player.inventory.set(listing.itemId, (player.inventory.get(listing.itemId) ?? 0) + 1);

        // Pay seller — AI (sellerId = player.id key in state.players),
        // online real player (UUID → sessionId lookup), or offline real player (DB)
        const sellerSid = this.playerSessions.get(listing.sellerId);
        const seller    = sellerSid
          ? this.state.players.get(sellerSid)          // real player online
          : this.state.players.get(listing.sellerId);  // AI (id is the map key)
        if (seller) {
          seller.coins += listing.pricePerUnit;
        } else {
          // Seller is an offline real player → credit their DB record directly
          const rec = db.getPlayer(listing.sellerId);
          if (rec) { rec.coins += listing.pricePerUnit; db.savePlayer(rec); }
        }

        listing.quantity -= 1;
        if (listing.quantity <= 0) {
          this.state.listings.delete(message.listingId);
          db.deleteListing(message.listingId);
        } else {
          db.updateListingQty(message.listingId, listing.quantity);
        }
        break;
      }

      case "market_cancel": {
        const listing = this.state.listings.get(message.listingId);
        if (!listing || listing.sellerId !== player.uuid) return;

        player.inventory.set(listing.itemId, (player.inventory.get(listing.itemId) ?? 0) + listing.quantity);
        this.state.listings.delete(message.listingId);
        db.deleteListing(message.listingId);
        break;
      }

      case "chat": {
        const text = message.text?.toString().trim().slice(0, 100);
        if (!text) return;
        this.broadcast("chat_message", { playerId: player.id, playerName: player.name, text });
        break;
      }

      case "eat": {
        const item = ITEMS[message.itemId];
        if (!item?.hungerRestore) return;
        const qty = player.inventory.get(message.itemId) ?? 0;
        if (qty <= 0) return;
        const q = qty - 1;
        if (q === 0) player.inventory.delete(message.itemId); else player.inventory.set(message.itemId, q);
        player.hunger = Math.min(GAME_CONSTANTS.HUNGER_MAX, player.hunger + item.hungerRestore);
        break;
      }

      case "place_forge": {
        if (this.state.techLevel < 1) return; // Iron Age required
        if (this.isBlockedByOtherPlot(player.x, player.y, player.uuid)) return;
        const stone = player.inventory.get("stone") ?? 0;
        const wood  = player.inventory.get("wood")  ?? 0;
        if (stone < FORGE_STONE_COST || wood < FORGE_WOOD_COST) return;

        const sLeft = stone - FORGE_STONE_COST;
        const wLeft = wood  - FORGE_WOOD_COST;
        if (sLeft === 0) player.inventory.delete("stone"); else player.inventory.set("stone", sLeft);
        if (wLeft === 0) player.inventory.delete("wood");  else player.inventory.set("wood",  wLeft);

        const forge    = new ForgeSchema();
        forge.id       = `forge_${Date.now()}_${client.sessionId}`;
        forge.x        = player.x;
        forge.y        = player.y;
        forge.ownerId  = player.uuid;
        this.state.forges.set(forge.id, forge);
        db.saveForge({ id: forge.id, owner_uuid: player.uuid, x: forge.x, y: forge.y });
        break;
      }

      case "smelt": {
        if (this.state.techLevel < 1) return; // Iron Age required
        const forge = this.state.forges.get(message.forgeId);
        if (!forge) return;
        if (Math.hypot(forge.x - player.x, forge.y - player.y) > GAME_CONSTANTS.GATHER_RANGE * 2) return;

        const recipe = SMELT_RECIPES[message.itemId as ItemId];
        if (!recipe) return;
        const have = player.inventory.get(message.itemId) ?? 0;
        if (have < recipe.inputQty) return;

        const remaining = have - recipe.inputQty;
        if (remaining === 0) player.inventory.delete(message.itemId); else player.inventory.set(message.itemId, remaining);

        const sid = client.sessionId;
        const { output, outputQty, timeMs } = recipe;
        setTimeout(() => {
          const p = this.state.players.get(sid);
          if (!p) return;
          p.inventory.set(output, (p.inventory.get(output) ?? 0) + outputQty);
          if (output === "iron_ingot" && !p.isAI) {
            this.state.totalIronSmelted++;
            this.checkTechAdvance();
          }
        }, timeMs);
        break;
      }

      case "place_chest": {
        if (this.isBlockedByOtherPlot(player.x, player.y, player.uuid)) return;
        // One chest per player
        let alreadyHas = false;
        this.state.chests.forEach((ch) => { if (ch.ownerUuid === player.uuid) alreadyHas = true; });
        if (alreadyHas) return;

        const wood = player.inventory.get("wood") ?? 0;
        if (wood < CHEST_WOOD_COST) return;
        const wLeft = wood - CHEST_WOOD_COST;
        if (wLeft === 0) player.inventory.delete("wood"); else player.inventory.set("wood", wLeft);

        const chest       = new ChestSchema();
        chest.id          = `chest_${Date.now()}_${client.sessionId}`;
        chest.x           = player.x;
        chest.y           = player.y;
        chest.ownerUuid   = player.uuid;
        this.state.chests.set(chest.id, chest);
        db.saveChest({ id: chest.id, owner_uuid: player.uuid, x: chest.x, y: chest.y, inventory: "{}" });
        break;
      }

      case "chest_deposit": {
        let myChest: ChestSchema | null = null;
        this.state.chests.forEach((ch) => { if (ch.ownerUuid === player.uuid) myChest = ch; });
        if (!myChest) return;
        if (Math.hypot((myChest as ChestSchema).x - player.x, (myChest as ChestSchema).y - player.y) > GAME_CONSTANTS.GATHER_RANGE * 2) return;

        const { itemId, quantity } = message;
        const have = player.inventory.get(itemId) ?? 0;
        const toMove = Math.min(have, quantity);
        if (toMove <= 0) return;

        const pLeft = have - toMove;
        if (pLeft === 0) player.inventory.delete(itemId); else player.inventory.set(itemId, pLeft);
        (myChest as ChestSchema).inventory.set(itemId, ((myChest as ChestSchema).inventory.get(itemId) ?? 0) + toMove);

        const inv: Record<string, number> = {};
        (myChest as ChestSchema).inventory.forEach((q, k) => { inv[k] = q; });
        db.saveChest({ id: (myChest as ChestSchema).id, owner_uuid: player.uuid, x: (myChest as ChestSchema).x, y: (myChest as ChestSchema).y, inventory: JSON.stringify(inv) });
        break;
      }

      case "chest_withdraw": {
        let myChest: ChestSchema | null = null;
        this.state.chests.forEach((ch) => { if (ch.ownerUuid === player.uuid) myChest = ch; });
        if (!myChest) return;
        if (Math.hypot((myChest as ChestSchema).x - player.x, (myChest as ChestSchema).y - player.y) > GAME_CONSTANTS.GATHER_RANGE * 2) return;

        const { itemId, quantity } = message;
        const inChest = (myChest as ChestSchema).inventory.get(itemId) ?? 0;
        const toMove = Math.min(inChest, quantity);
        if (toMove <= 0) return;

        const cLeft = inChest - toMove;
        if (cLeft === 0) (myChest as ChestSchema).inventory.delete(itemId); else (myChest as ChestSchema).inventory.set(itemId, cLeft);
        player.inventory.set(itemId, (player.inventory.get(itemId) ?? 0) + toMove);

        const inv: Record<string, number> = {};
        (myChest as ChestSchema).inventory.forEach((q, k) => { inv[k] = q; });
        db.saveChest({ id: (myChest as ChestSchema).id, owner_uuid: player.uuid, x: (myChest as ChestSchema).x, y: (myChest as ChestSchema).y, inventory: JSON.stringify(inv) });
        break;
      }

      case "place_blast_furnace": {
        if (this.state.techLevel < 2) return; // Steel Age required
        if (this.isBlockedByOtherPlot(player.x, player.y, player.uuid)) return;
        const stone = player.inventory.get("stone") ?? 0;
        const wood  = player.inventory.get("wood")  ?? 0;
        if (stone < BLAST_FURNACE_STONE_COST || wood < BLAST_FURNACE_WOOD_COST) return;

        const sLeft = stone - BLAST_FURNACE_STONE_COST;
        const wLeft = wood  - BLAST_FURNACE_WOOD_COST;
        if (sLeft === 0) player.inventory.delete("stone"); else player.inventory.set("stone", sLeft);
        if (wLeft === 0) player.inventory.delete("wood");  else player.inventory.set("wood",  wLeft);

        const bf   = new BlastFurnaceSchema();
        bf.id      = `bf_${Date.now()}_${client.sessionId}`;
        bf.x       = player.x;
        bf.y       = player.y;
        bf.ownerId = player.uuid;
        this.state.blastFurnaces.set(bf.id, bf);
        db.saveBlastFurnace({ id: bf.id, owner_uuid: player.uuid, x: bf.x, y: bf.y });
        break;
      }

      case "blast": {
        if (this.state.techLevel < 2) return; // Steel Age required
        const bf = this.state.blastFurnaces.get(message.blastFurnaceId);
        if (!bf) return;
        if (Math.hypot(bf.x - player.x, bf.y - player.y) > GAME_CONSTANTS.GATHER_RANGE * 2) return;

        const recipe = BLAST_RECIPES[message.recipeId];
        if (!recipe) return;

        // Check all inputs
        for (const [itemId, qty] of Object.entries(recipe.inputs)) {
          if ((player.inventory.get(itemId) ?? 0) < (qty as number)) return;
        }
        // Deduct all inputs
        for (const [itemId, qty] of Object.entries(recipe.inputs)) {
          const left = (player.inventory.get(itemId) ?? 0) - (qty as number);
          if (left === 0) player.inventory.delete(itemId); else player.inventory.set(itemId, left);
        }

        const sid = client.sessionId;
        const { output, outputQty, timeMs } = recipe;
        setTimeout(() => {
          const p = this.state.players.get(sid);
          if (!p) return;
          p.inventory.set(output, (p.inventory.get(output) ?? 0) + outputQty);
        }, timeMs);
        break;
      }

      case "place_water_well": {
        if (this.isBlockedByOtherPlot(player.x, player.y, player.uuid)) return;
        const stone = player.inventory.get("stone") ?? 0;
        const wood  = player.inventory.get("wood")  ?? 0;
        if (stone < WATER_WELL_STONE_COST || wood < WATER_WELL_WOOD_COST) return;

        const sLeft = stone - WATER_WELL_STONE_COST;
        const wLeft = wood  - WATER_WELL_WOOD_COST;
        if (sLeft === 0) player.inventory.delete("stone"); else player.inventory.set("stone", sLeft);
        if (wLeft === 0) player.inventory.delete("wood");  else player.inventory.set("wood",  wLeft);

        const well   = new WaterWellSchema();
        well.id      = `well_${Date.now()}_${client.sessionId}`;
        well.x       = player.x;
        well.y       = player.y;
        well.ownerId = player.uuid;
        this.state.waterWells.set(well.id, well);
        db.saveWaterWell({ id: well.id, owner_uuid: player.uuid, x: well.x, y: well.y });
        break;
      }

      case "use_well": {
        const well = this.state.waterWells.get(message.wellId);
        if (!well) return;
        if (Math.hypot(well.x - player.x, well.y - player.y) > GAME_CONSTANTS.GATHER_RANGE * 2) return;
        player.inventory.set("water", (player.inventory.get("water") ?? 0) + 3);
        break;
      }

      case "buy_plot": {
        if (player.coins < LAND_PLOT_PRICE) return;

        // Check no existing plot center within min distance
        let tooClose = false;
        this.state.landPlots.forEach((plot) => {
          if (Math.hypot(plot.x - player.x, plot.y - player.y) < LAND_PLOT_MIN_DISTANCE) tooClose = true;
        });
        if (tooClose) return;

        player.coins -= LAND_PLOT_PRICE;

        // Pay Mayor (real player Mayor or NPC sink)
        if (this.state.mayorUuid !== "npc_mayor") {
          const mayorSid = this.playerSessions.get(this.state.mayorUuid);
          const mayor    = mayorSid ? this.state.players.get(mayorSid) : null;
          if (mayor) {
            mayor.coins += LAND_PLOT_PRICE;
          } else {
            const rec = db.getPlayer(this.state.mayorUuid);
            if (rec) { rec.coins += LAND_PLOT_PRICE; db.savePlayer(rec); }
          }
        }

        const plot      = new LandPlotSchema();
        plot.id         = `plot_${Date.now()}_${client.sessionId}`;
        plot.ownerUuid  = player.uuid;
        plot.ownerName  = player.name;
        plot.x          = player.x;
        plot.y          = player.y;
        this.state.landPlots.set(plot.id, plot);
        db.saveLandPlot({ id: plot.id, owner_uuid: player.uuid, owner_name: player.name, x: plot.x, y: plot.y });
        break;
      }

      case "demolish": {
        const RANGE = GAME_CONSTANTS.GATHER_RANGE * 3;
        const { buildingType, buildingId } = message;

        if (buildingType === "campfire") {
          const cf = this.state.campfires.get(buildingId);
          if (!cf || cf.ownerId !== player.uuid) return;
          if (Math.hypot(cf.x - player.x, cf.y - player.y) > RANGE) return;
          this.state.campfires.delete(buildingId);
          db.deleteCampfire(buildingId);
          // 50% refund: 1 wood
          player.inventory.set("wood", (player.inventory.get("wood") ?? 0) + 1);
        } else if (buildingType === "forge") {
          const forge = this.state.forges.get(buildingId);
          if (!forge || forge.ownerId !== player.uuid) return;
          if (Math.hypot(forge.x - player.x, forge.y - player.y) > RANGE) return;
          this.state.forges.delete(buildingId);
          db.deleteForge(buildingId);
          // 50% refund: 2 stone + 1 wood
          player.inventory.set("stone", (player.inventory.get("stone") ?? 0) + 2);
          player.inventory.set("wood",  (player.inventory.get("wood")  ?? 0) + 1);
        } else if (buildingType === "chest") {
          const chest = this.state.chests.get(buildingId);
          if (!chest || chest.ownerUuid !== player.uuid) return;
          if (Math.hypot(chest.x - player.x, chest.y - player.y) > RANGE) return;
          this.state.chests.delete(buildingId);
          db.deleteChest(buildingId);
          // 50% refund: 2 wood
          player.inventory.set("wood", (player.inventory.get("wood") ?? 0) + 2);
        } else if (buildingType === "water_well") {
          const well = this.state.waterWells.get(buildingId);
          if (!well || well.ownerId !== player.uuid) return;
          if (Math.hypot(well.x - player.x, well.y - player.y) > RANGE) return;
          this.state.waterWells.delete(buildingId);
          db.deleteWaterWell(buildingId);
          // 50% refund: 1 stone + 1 wood
          player.inventory.set("stone", (player.inventory.get("stone") ?? 0) + 1);
          player.inventory.set("wood",  (player.inventory.get("wood")  ?? 0) + 1);
        } else if (buildingType === "blast_furnace") {
          const bf = this.state.blastFurnaces.get(buildingId);
          if (!bf || bf.ownerId !== player.uuid) return;
          if (Math.hypot(bf.x - player.x, bf.y - player.y) > RANGE) return;
          this.state.blastFurnaces.delete(buildingId);
          db.deleteBlastFurnace(buildingId);
          // 50% refund: 5 stone + 2 wood
          player.inventory.set("stone", (player.inventory.get("stone") ?? 0) + 5);
          player.inventory.set("wood",  (player.inventory.get("wood")  ?? 0) + 2);
        }
        break;
      }
    }
  }
}
