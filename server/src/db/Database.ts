import BetterSqlite3 from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "game.db");

// ── Record types ──────────────────────────────────────────────────────────────

export interface PlayerRecord {
  uuid:           string;
  name:           string;
  coins:          number;
  inventory:      Record<string, number>;
  tool_durability: Record<string, number>;
}

export interface ListingRecord {
  id:            string;
  seller_uuid:   string;
  seller_name:   string;
  item_id:       string;
  quantity:      number;
  price_per_unit: number;
}

export interface CampfireRecord {
  id:         string;
  owner_uuid: string;
  x:          number;
  y:          number;
}

export interface ForgeRecord {
  id:         string;
  owner_uuid: string;
  x:          number;
  y:          number;
}

export interface ChestRecord {
  id:         string;
  owner_uuid: string;
  x:          number;
  y:          number;
  inventory:  string;
}

export interface BlastFurnaceRecord {
  id:         string;
  owner_uuid: string;
  x:          number;
  y:          number;
}

export interface WaterWellRecord {
  id:         string;
  owner_uuid: string;
  x:          number;
  y:          number;
}

export interface LandPlotRecord {
  id:         string;
  owner_uuid: string;
  owner_name: string;
  x:          number;
  y:          number;
}

// ── Database ──────────────────────────────────────────────────────────────────

class GameDB {
  private db: BetterSqlite3.Database;

  constructor() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new BetterSqlite3(DB_PATH);
    this.db.pragma("journal_mode = WAL"); // better concurrent read performance
    this.migrate();
    console.log(`[DB] SQLite database at ${DB_PATH}`);
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        uuid        TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        coins       INTEGER NOT NULL DEFAULT 10,
        inventory   TEXT NOT NULL DEFAULT '{}',
        updated_at  INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS market_listings (
        id             TEXT PRIMARY KEY,
        seller_uuid    TEXT NOT NULL,
        seller_name    TEXT NOT NULL,
        item_id        TEXT NOT NULL,
        quantity       INTEGER NOT NULL,
        price_per_unit INTEGER NOT NULL,
        created_at     INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS campfires (
        id         TEXT PRIMARY KEY,
        owner_uuid TEXT NOT NULL,
        x          REAL NOT NULL,
        y          REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS forges (
        id         TEXT PRIMARY KEY,
        owner_uuid TEXT NOT NULL,
        x          REAL NOT NULL,
        y          REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chests (
        id         TEXT PRIMARY KEY,
        owner_uuid TEXT NOT NULL,
        x          REAL NOT NULL,
        y          REAL NOT NULL,
        inventory  TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS blast_furnaces (
        id         TEXT PRIMARY KEY,
        owner_uuid TEXT NOT NULL,
        x          REAL NOT NULL,
        y          REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS water_wells (
        id         TEXT PRIMARY KEY,
        owner_uuid TEXT NOT NULL,
        x          REAL NOT NULL,
        y          REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS land_plots (
        id         TEXT PRIMARY KEY,
        owner_uuid TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        x          REAL NOT NULL,
        y          REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resources (
        id   TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        x    REAL NOT NULL,
        y    REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS world_state (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Migration-safe: add tool_durability column if it doesn't exist
    const cols = this.db.prepare("PRAGMA table_info(players)").all() as any[];
    if (!cols.find(c => c.name === "tool_durability")) {
      this.db.exec(`ALTER TABLE players ADD COLUMN tool_durability TEXT NOT NULL DEFAULT '{}'`);
    }
  }

  // ── Players ───────────────────────────────────────────────────────────────

  getPlayer(uuid: string): PlayerRecord | null {
    const row = this.db.prepare("SELECT * FROM players WHERE uuid = ?").get(uuid) as any;
    if (!row) return null;
    return {
      ...row,
      inventory:       JSON.parse(row.inventory ?? "{}"),
      tool_durability: JSON.parse(row.tool_durability ?? "{}"),
    };
  }

  savePlayer(p: PlayerRecord) {
    this.db.prepare(`
      INSERT INTO players (uuid, name, coins, inventory, tool_durability, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(uuid) DO UPDATE SET
        name            = excluded.name,
        coins           = excluded.coins,
        inventory       = excluded.inventory,
        tool_durability = excluded.tool_durability,
        updated_at      = excluded.updated_at
    `).run(p.uuid, p.name, p.coins, JSON.stringify(p.inventory), JSON.stringify(p.tool_durability), Date.now());
  }

  // ── Market listings ───────────────────────────────────────────────────────

  getAllListings(): ListingRecord[] {
    return this.db.prepare("SELECT * FROM market_listings").all() as ListingRecord[];
  }

  saveListing(l: ListingRecord) {
    this.db.prepare(`
      INSERT OR REPLACE INTO market_listings
        (id, seller_uuid, seller_name, item_id, quantity, price_per_unit, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(l.id, l.seller_uuid, l.seller_name, l.item_id, l.quantity, l.price_per_unit, Date.now());
  }

  updateListingQty(id: string, quantity: number) {
    if (quantity <= 0) {
      this.db.prepare("DELETE FROM market_listings WHERE id = ?").run(id);
    } else {
      this.db.prepare("UPDATE market_listings SET quantity = ? WHERE id = ?").run(quantity, id);
    }
  }

  deleteListing(id: string) {
    this.db.prepare("DELETE FROM market_listings WHERE id = ?").run(id);
  }

  // ── Campfires ─────────────────────────────────────────────────────────────

  getAllCampfires(): CampfireRecord[] {
    return this.db.prepare("SELECT * FROM campfires").all() as CampfireRecord[];
  }

  saveCampfire(c: CampfireRecord) {
    this.db.prepare(`
      INSERT OR REPLACE INTO campfires (id, owner_uuid, x, y)
      VALUES (?, ?, ?, ?)
    `).run(c.id, c.owner_uuid, c.x, c.y);
  }

  deleteCampfire(id: string) {
    this.db.prepare("DELETE FROM campfires WHERE id = ?").run(id);
  }

  // ── Forges ────────────────────────────────────────────────────────────────

  getAllForges(): ForgeRecord[] {
    return this.db.prepare("SELECT * FROM forges").all() as ForgeRecord[];
  }

  saveForge(f: ForgeRecord) {
    this.db.prepare(`
      INSERT OR REPLACE INTO forges (id, owner_uuid, x, y)
      VALUES (?, ?, ?, ?)
    `).run(f.id, f.owner_uuid, f.x, f.y);
  }

  deleteForge(id: string) {
    this.db.prepare("DELETE FROM forges WHERE id = ?").run(id);
  }

  // ── Chests ────────────────────────────────────────────────────────────────

  getAllChests(): ChestRecord[] {
    return this.db.prepare("SELECT * FROM chests").all() as ChestRecord[];
  }

  saveChest(c: ChestRecord) {
    this.db.prepare(`
      INSERT OR REPLACE INTO chests (id, owner_uuid, x, y, inventory)
      VALUES (?, ?, ?, ?, ?)
    `).run(c.id, c.owner_uuid, c.x, c.y, c.inventory);
  }

  deleteChest(id: string) {
    this.db.prepare("DELETE FROM chests WHERE id = ?").run(id);
  }

  // ── Blast Furnaces ────────────────────────────────────────────────────────

  getAllBlastFurnaces(): BlastFurnaceRecord[] {
    return this.db.prepare("SELECT * FROM blast_furnaces").all() as BlastFurnaceRecord[];
  }

  saveBlastFurnace(b: BlastFurnaceRecord) {
    this.db.prepare(`
      INSERT OR REPLACE INTO blast_furnaces (id, owner_uuid, x, y)
      VALUES (?, ?, ?, ?)
    `).run(b.id, b.owner_uuid, b.x, b.y);
  }

  deleteBlastFurnace(id: string) {
    this.db.prepare("DELETE FROM blast_furnaces WHERE id = ?").run(id);
  }

  // ── Water Wells ───────────────────────────────────────────────────────────

  getAllWaterWells(): WaterWellRecord[] {
    return this.db.prepare("SELECT * FROM water_wells").all() as WaterWellRecord[];
  }

  saveWaterWell(w: WaterWellRecord) {
    this.db.prepare(`
      INSERT OR REPLACE INTO water_wells (id, owner_uuid, x, y)
      VALUES (?, ?, ?, ?)
    `).run(w.id, w.owner_uuid, w.x, w.y);
  }

  deleteWaterWell(id: string) {
    this.db.prepare("DELETE FROM water_wells WHERE id = ?").run(id);
  }

  // ── Land Plots ────────────────────────────────────────────────────────────

  getAllLandPlots(): LandPlotRecord[] {
    return this.db.prepare("SELECT * FROM land_plots").all() as LandPlotRecord[];
  }

  saveLandPlot(p: LandPlotRecord) {
    this.db.prepare(`
      INSERT OR REPLACE INTO land_plots (id, owner_uuid, owner_name, x, y)
      VALUES (?, ?, ?, ?, ?)
    `).run(p.id, p.owner_uuid, p.owner_name, p.x, p.y);
  }

  deleteLandPlot(id: string) {
    this.db.prepare("DELETE FROM land_plots WHERE id = ?").run(id);
  }

  // ── Resources (world persistence) ─────────────────────────────────────────

  getAllResources(): { id: string; kind: string; x: number; y: number }[] {
    return this.db.prepare("SELECT * FROM resources").all() as any[];
  }

  saveAllResources(resources: { id: string; kind: string; x: number; y: number }[]) {
    const insert = this.db.prepare("INSERT OR REPLACE INTO resources (id, kind, x, y) VALUES (?, ?, ?, ?)");
    const many   = this.db.transaction((rows: { id: string; kind: string; x: number; y: number }[]) => {
      for (const r of rows) insert.run(r.id, r.kind, r.x, r.y);
    });
    many(resources);
  }

  // ── World state (tech level, totals, mayor) ───────────────────────────────

  getWorldState(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM world_state WHERE key = ?").get(key) as any;
    return row?.value ?? null;
  }

  setWorldState(key: string, value: string) {
    this.db.prepare("INSERT OR REPLACE INTO world_state (key, value) VALUES (?, ?)").run(key, value);
  }
}

export const db = new GameDB();
