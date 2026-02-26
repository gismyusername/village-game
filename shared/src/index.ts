// ── Game constants ──────────────────────────────────────────────────────────

export const GAME_CONSTANTS = {
  MS_PER_GAME_DAY: 60 * 60 * 1000,
  // Full hunger bar (100) drains in 30 minutes (was 2 hours)
  HUNGER_DRAIN_PER_MS: 100 / (30 * 60 * 1000),
  HUNGER_MAX: 100,
  TILE_SIZE: 16,
  WORLD_SIZE: 3200,        // pixels
  SERVER_TICK_RATE: 20,
  GATHER_RANGE: 40,        // pixels, how close you must be to gather
} as const;

// ── Item types ──────────────────────────────────────────────────────────────

export type ItemId =
  | "raw_meat"
  | "cooked_meat"
  | "berries"
  | "wood"
  | "stone"
  | "iron_ore"
  | "iron_ingot"
  | "iron_axe"
  | "bread"
  | "wheat"
  | "water"
  | "stone_axe"
  | "coal"
  | "steel_ingot"
  | "steel_axe"
  | "stew"
  | "raw_fish"
  | "cooked_fish"
  | "fishing_rod";

export interface ItemDefinition {
  id: ItemId;
  name: string;
  hungerRestore?: number;
}

export const ITEMS: Record<ItemId, ItemDefinition> = {
  raw_meat:    { id: "raw_meat",    name: "Raw Meat" },
  cooked_meat: { id: "cooked_meat", name: "Cooked Meat", hungerRestore: 30 },
  berries:     { id: "berries",     name: "Berries",     hungerRestore: 10 },
  wood:        { id: "wood",        name: "Wood" },
  stone:       { id: "stone",       name: "Stone" },
  iron_ore:    { id: "iron_ore",    name: "Iron Ore" },
  bread:       { id: "bread",       name: "Bread",       hungerRestore: 40 },
  wheat:       { id: "wheat",       name: "Wheat" },
  water:       { id: "water",       name: "Water",       hungerRestore: 5 },
  stone_axe:   { id: "stone_axe",   name: "Stone Axe" },
  iron_ingot:  { id: "iron_ingot",  name: "Iron Ingot" },
  iron_axe:    { id: "iron_axe",    name: "Iron Axe" },
  coal:        { id: "coal",        name: "Coal" },
  steel_ingot: { id: "steel_ingot", name: "Steel Ingot" },
  steel_axe:   { id: "steel_axe",   name: "Steel Axe" },
  stew:        { id: "stew",        name: "Stew",        hungerRestore: 60 },
  raw_fish:    { id: "raw_fish",    name: "Raw Fish" },
  cooked_fish: { id: "cooked_fish", name: "Cooked Fish", hungerRestore: 35 },
  fishing_rod: { id: "fishing_rod", name: "Fishing Rod" },
};

// ── Resource types ──────────────────────────────────────────────────────────

export type ResourceKind = "tree" | "rock" | "berries" | "animal" | "wheat_field" | "coal_seam" | "fish_spot";

export interface ResourceDefinition {
  kind: ResourceKind;
  label: string;
  drops: { itemId: ItemId; min: number; max: number; toolRequired?: ItemId }[];
  respawnMs: number;
  gatherMs: number;
  color: number;
  width: number;
  height: number;
}

export const RESOURCES: Record<ResourceKind, ResourceDefinition> = {
  tree:        { kind: "tree",        label: "Tree",        drops: [{ itemId: "wood",     min: 1, max: 3 }],                                                                                              respawnMs: 300_000, gatherMs: 2500, color: 0x2d7a2d, width: 10, height: 16 },
  rock:        { kind: "rock",        label: "Rock",        drops: [{ itemId: "stone",    min: 1, max: 2 }, { itemId: "iron_ore", min: 0, max: 1 }],                                                      respawnMs: 480_000, gatherMs: 3000, color: 0x888888, width: 12, height: 10 },
  berries:     { kind: "berries",     label: "Berry Bush",  drops: [{ itemId: "berries",  min: 2, max: 5 }],                                                                                              respawnMs: 180_000, gatherMs: 1500, color: 0xcc2222, width: 8,  height: 8  },
  animal:      { kind: "animal",      label: "Animal",      drops: [{ itemId: "raw_meat", min: 1, max: 2 }],                                                                                              respawnMs: 600_000, gatherMs: 2000, color: 0x8b5a2b, width: 10, height: 8  },
  wheat_field: { kind: "wheat_field", label: "Wheat Field", drops: [{ itemId: "wheat",    min: 2, max: 5 }],                                                                                              respawnMs: 240_000, gatherMs: 2000, color: 0xd4a017, width: 12, height: 12 },
  coal_seam:   { kind: "coal_seam",   label: "Coal Seam",   drops: [{ itemId: "coal",     min: 1, max: 2 }],                                                                                              respawnMs: 480_000, gatherMs: 3500, color: 0x222222, width: 12, height: 10 },
  fish_spot:   { kind: "fish_spot",   label: "Fish Spot",   drops: [{ itemId: "water", min: 1, max: 2 }, { itemId: "raw_fish", min: 1, max: 2, toolRequired: "fishing_rod" }],                           respawnMs: 300_000, gatherMs: 2500, color: 0x1a7abf, width: 10, height: 10 },
};

// World generation counts
export const RESOURCE_COUNTS: Record<ResourceKind, number> = {
  tree:        400,
  rock:        150,
  berries:     250,
  animal:       80,
  wheat_field: 150,
  coal_seam:    50,
  fish_spot:    80,
};

// ── Crafting ────────────────────────────────────────────────────────────────

export const RECIPES: Record<string, { inputs: Partial<Record<ItemId, number>>; output: ItemId; outputQty: number }> = {
  stone_axe:   { inputs: { stone: 2, wood: 2 },            output: "stone_axe",   outputQty: 1 },
  iron_axe:    { inputs: { iron_ingot: 2, wood: 2 },        output: "iron_axe",    outputQty: 1 },
  steel_axe:   { inputs: { steel_ingot: 2, wood: 2 },       output: "steel_axe",   outputQty: 1 },
  fishing_rod: { inputs: { wood: 2, stone: 1 },             output: "fishing_rod", outputQty: 1 },
};

export const COOK_RECIPES: Partial<Record<ItemId, { output: ItemId; inputQty: number; outputQty: number; timeMs: number }>> = {
  raw_meat: { output: "cooked_meat", inputQty: 1, outputQty: 1, timeMs: 3_000 },
  wheat:    { output: "bread",       inputQty: 3, outputQty: 1, timeMs: 5_000 },
};

export const SMELT_RECIPES: Partial<Record<ItemId, { output: ItemId; inputQty: number; outputQty: number; timeMs: number }>> = {
  iron_ore: { output: "iron_ingot", inputQty: 1, outputQty: 1, timeMs: 5_000 },
};

export const BLAST_RECIPES: Record<string, { inputs: Partial<Record<ItemId, number>>; output: ItemId; outputQty: number; timeMs: number }> = {
  steel_ingot: { inputs: { iron_ingot: 2, coal: 1 }, output: "steel_ingot", outputQty: 1, timeMs: 10_000 },
};

export const ADVANCED_COOK_RECIPES: Record<string, { inputs: Partial<Record<ItemId, number>>; output: ItemId; outputQty: number; timeMs: number }> = {
  stew:        { inputs: { cooked_meat: 1, berries: 2, water: 1 }, output: "stew",        outputQty: 1, timeMs: 8_000 },
  cooked_fish: { inputs: { raw_fish: 1 },                           output: "cooked_fish",  outputQty: 1, timeMs: 3_000 },
};

// ── Network messages ────────────────────────────────────────────────────────

export const CAMPFIRE_WOOD_COST = 3;
export const FORGE_STONE_COST  = 5;
export const FORGE_WOOD_COST   = 3;
export const CHEST_WOOD_COST   = 5;
export const COOK_TIME_MS      = 3000;
export const MARKET_RANGE      = 80;
export const MARKET_X          = 560;
export const MARKET_Y          = 560;
export const STARTER_COINS     = 10;

export const BLAST_FURNACE_STONE_COST = 10;
export const BLAST_FURNACE_WOOD_COST  = 5;
export const WATER_WELL_STONE_COST    = 3;
export const WATER_WELL_WOOD_COST     = 2;
export const LAND_PLOT_PRICE          = 20;
export const LAND_PLOT_SIZE           = 128;
export const LAND_PLOT_MIN_DISTANCE   = 200;
export const TOOL_MAX_DURABILITY: Partial<Record<ItemId, number>> = {
  stone_axe:   30,
  iron_axe:    60,
  steel_axe:   100,
  fishing_rod: 40,
};

// Tech tree thresholds (human-player actions only)
export const TECH_IRON_GATHER_THRESHOLD  = 50;   // total human gathers → Iron Age
export const TECH_STEEL_SMELT_THRESHOLD  = 10;   // total human iron smeltings → Steel Age

export type ClientMessage =
  | { type: "move";           x: number; y: number }
  | { type: "gather";         resourceId: string }
  | { type: "eat";            itemId: ItemId }
  | { type: "place_campfire" }
  | { type: "cook";           campfireId: string; itemId: ItemId }
  | { type: "craft";          recipeId: string }
  | { type: "market_list";    itemId: ItemId; quantity: number; pricePerUnit: number }
  | { type: "market_buy";     listingId: string }
  | { type: "market_cancel";  listingId: string }
  | { type: "chat";           text: string }
  | { type: "place_forge" }
  | { type: "smelt";          forgeId: string; itemId: ItemId }
  | { type: "place_chest" }
  | { type: "chest_deposit";  itemId: ItemId; quantity: number }
  | { type: "chest_withdraw"; itemId: ItemId; quantity: number }
  | { type: "place_blast_furnace" }
  | { type: "blast";          blastFurnaceId: string; recipeId: string }
  | { type: "place_water_well" }
  | { type: "use_well";       wellId: string }
  | { type: "cook_advanced";  campfireId: string; recipeId: string }
  | { type: "buy_plot" }
  | { type: "demolish";       buildingType: "campfire" | "forge" | "chest" | "water_well" | "blast_furnace"; buildingId: string };
