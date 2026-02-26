import Phaser from "phaser";
import { Client, Room } from "colyseus.js";
import {
  GAME_CONSTANTS, RESOURCES, ITEMS, ResourceKind, ItemId,
  CAMPFIRE_WOOD_COST, MARKET_X, MARKET_Y, MARKET_RANGE,
  COOK_RECIPES, SMELT_RECIPES, BLAST_RECIPES, ADVANCED_COOK_RECIPES,
  LAND_PLOT_SIZE, TOOL_MAX_DURABILITY,
} from "@game/shared";
import type { GameState, PlayerSchema, ResourceSchema, CampfireSchema, ForgeSchema, ChestSchema, BlastFurnaceSchema, WaterWellSchema, LandPlotSchema } from "../../../server/src/rooms/GameRoom";
import { MarketPanel } from "../ui/MarketPanel";
import { CraftPanel } from "../ui/CraftPanel";
import { ChestPanel } from "../ui/ChestPanel";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";


export class GameScene extends Phaser.Scene {
  private room!: Room<GameState>;
  private mySessionId: string = "";
  private myUuid: string = "";

  // Sprites
  private playerSprites       = new Map<string, { body: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text; bubble?: Phaser.GameObjects.Text }>();
  private resourceSprites     = new Map<string, Phaser.GameObjects.Image>();
  private campfireSprites     = new Map<string, Phaser.GameObjects.Container>();
  private forgeSprites        = new Map<string, Phaser.GameObjects.Container>();
  private chestSprites        = new Map<string, Phaser.GameObjects.Image>();
  private blastFurnaceSprites = new Map<string, Phaser.GameObjects.Container>();
  private waterWellSprites    = new Map<string, Phaser.GameObjects.Container>();
  private landPlotGraphics    = new Map<string, { gfx: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }>();

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private eKey!: Phaser.Input.Keyboard.Key;
  private fKey!: Phaser.Input.Keyboard.Key;
  private cKey!: Phaser.Input.Keyboard.Key;
  private mKey!: Phaser.Input.Keyboard.Key;
  private xKey!: Phaser.Input.Keyboard.Key;
  private zKey!: Phaser.Input.Keyboard.Key;
  private marketPanel!: MarketPanel;
  private craftPanel!: CraftPanel;
  private chestPanel!: ChestPanel;
  private chatOpen = false;

  // Smooth movement (client prediction)
  private localX = 0;
  private localY = 0;
  private moveTimer = 0;
  private readonly PLAYER_SPEED  = 120; // px/s
  private readonly SEND_INTERVAL =  50; // ms between server sends

  // Day/night
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  private timeText!: Phaser.GameObjects.Text;

  // Cooking / gathering state
  private cookingUntil    = 0;
  private cookingTotalMs  = 3_000;
  private gatheringUntil  = 0;
  private gatherDuration = 0;
  private actionBar!: Phaser.GameObjects.Rectangle;
  private actionBarBg!: Phaser.GameObjects.Rectangle;

  // Throttle prompt updates
  private promptTimer = 0;
  private readonly PROMPT_INTERVAL = 150; // ms between prompt recalculations
  private isMoving = false;

  // UI
  private hungerBar!: Phaser.GameObjects.Rectangle;
  private inventorySlots: Phaser.GameObjects.GameObject[] = [];
  private promptText!: Phaser.GameObjects.Text;
  private techText!: Phaser.GameObjects.Text;
  private playerCountText!: Phaser.GameObjects.Text;
  private mayorText!: Phaser.GameObjects.Text;

  constructor() { super({ key: "GameScene" }); }

  async create() {
    const W = GAME_CONSTANTS.WORLD_SIZE;

    this.createTextures();
    this.createAnimations();
    this.add.tileSprite(0, 0, W, W, "grass_tile").setOrigin(0, 0).setDepth(0);

    this.cameras.main.setBounds(0, 0, W, W);

    // Market board (fixed world object near spawn)
    this.add.rectangle(MARKET_X, MARKET_Y, 32, 28, 0x8b5e3c).setDepth(3);
    this.add.rectangle(MARKET_X, MARKET_Y - 20, 36, 10, 0xa0522d).setDepth(4);
    this.add.text(MARKET_X, MARKET_Y + 22, "MARKET", { fontSize: "7px", color: "#f0c040" })
      .setOrigin(0.5, 0).setDepth(5);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.eKey    = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.fKey    = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.cKey    = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.C);
    this.mKey    = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M);
    this.xKey    = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.X);
    this.zKey    = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Z);

    this.createUI();
    this.setupChat();
    await this.connectToServer();
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  private setupChat() {
    const wrap  = document.getElementById("chat-input-wrap")!;
    const input = document.getElementById("chat-input") as HTMLInputElement;
    const log   = document.getElementById("chat-log")!;

    const openChat = () => {
      if (this.chatOpen || this.marketPanel?.isOpen) return;
      this.chatOpen = true;
      wrap.style.display = "block";
      input.value = "";
      input.focus();
    };

    const closeChat = () => {
      this.chatOpen = false;
      wrap.style.display = "none";
      input.blur();
    };

    const sendChat = () => {
      const text = input.value.trim();
      if (text && this.room) this.room.send("chat", { text });
      closeChat();
    };

    window.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !this.chatOpen && !this.marketPanel?.isOpen) {
        e.preventDefault();
        openChat();
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter")  { e.preventDefault(); sendChat(); }
      if (e.key === "Escape") { e.preventDefault(); closeChat(); }
      e.stopPropagation();
    });

    (this as any)._chatLog = log;
  }

  private addChatMessage(name: string, text: string) {
    const log = (this as any)._chatLog as HTMLElement;
    const div = document.createElement("div");
    div.className = "chat-msg";
    div.innerHTML = `<span class="chat-name">${name}:</span> ${text}`;
    log.appendChild(div);
    while (log.children.length > 10) log.removeChild(log.firstChild!);
    setTimeout(() => { if (div.parentNode) log.removeChild(div); }, 6100);
  }

  private showSpeechBubble(sessionId: string, text: string) {
    const sprites = this.playerSprites.get(sessionId);
    if (!sprites) return;
    sprites.bubble?.destroy();
    const bubble = this.add.text(sprites.body.x, sprites.body.y - 32, text, {
      fontSize: "8px", color: "#ffffff",
      backgroundColor: "#000000cc",
      padding: { x: 3, y: 2 },
      wordWrap: { width: 120 },
    }).setOrigin(0.5, 1).setDepth(10);
    sprites.bubble = bubble;
    this.tweens.add({
      targets: bubble, alpha: 0,
      delay: 3500, duration: 800,
      onComplete: () => { bubble.destroy(); if (sprites.bubble === bubble) sprites.bubble = undefined; },
    });
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  private createUI() {
    this.add.rectangle(10, 10, 104, 14, 0x222222).setOrigin(0, 0).setScrollFactor(0).setDepth(20);
    this.hungerBar = this.add.rectangle(12, 12, 100, 10, 0x2ecc71).setOrigin(0, 0).setScrollFactor(0).setDepth(21);
    this.add.text(10, 26, "HUNGER", { fontSize: "8px", color: "#aaaaaa" }).setScrollFactor(0).setDepth(21);
    this.add.text(10, 38, "[E] Interact  [F] Eat  [C] Campfire  [X] Crafting  [M] Market  [Z] Demolish", { fontSize: "7px", color: "#666666" })
      .setScrollFactor(0).setDepth(20);

    this.actionBarBg = this.add.rectangle(10, 56, 104, 10, 0x333333).setOrigin(0, 0).setScrollFactor(0).setDepth(20).setVisible(false);
    this.actionBar   = this.add.rectangle(12, 58, 100, 6, 0xff8800).setOrigin(0, 0).setScrollFactor(0).setDepth(21).setVisible(false);

    this.promptText = this.add.text(0, 0, "", {
      fontSize: "9px", color: "#ffffff",
      backgroundColor: "#000000aa",
      padding: { x: 4, y: 2 },
    }).setDepth(30).setVisible(false);

    this.nightOverlay = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x050a20)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(50).setAlpha(0);

    this.timeText = this.add.text(this.scale.width - 8, 8, "Day 1  06:00", {
      fontSize: "8px", color: "#f0c040",
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(51);

    this.techText = this.add.text(this.scale.width - 8, 20, "Stone Age", {
      fontSize: "8px", color: "#aaaaff",
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(51);

    this.playerCountText = this.add.text(this.scale.width - 8, 32, "Players: 0", {
      fontSize: "8px", color: "#aaffaa",
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(51);

    this.mayorText = this.add.text(this.scale.width - 8, 44, "Mayor: Mayor", {
      fontSize: "8px", color: "#ffcc44",
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(51);
  }

  private updateHungerBar(hunger: number) {
    const pct   = Math.max(0, hunger / GAME_CONSTANTS.HUNGER_MAX);
    const color = pct > 0.5 ? 0x2ecc71 : pct > 0.25 ? 0xf39c12 : 0xe74c3c;
    this.hungerBar.setScale(pct, 1).setFillStyle(color);
  }

  private refreshInventory() {
    this.inventorySlots.forEach(o => (o as Phaser.GameObjects.GameObject).destroy());
    this.inventorySlots = [];
    const me = this.room?.state.players.get(this.mySessionId);
    if (!me) return;

    let i = 0;
    me.inventory.forEach((qty: number, itemId: string) => {
      const x  = 10 + i * 90;
      const y  = this.scale.height - 38;
      const bg = this.add.rectangle(x, y, 84, 28, 0x111111, 0.9).setOrigin(0, 0).setScrollFactor(0).setDepth(20);
      const nm  = ITEMS[itemId as ItemId]?.name ?? itemId;
      const max = TOOL_MAX_DURABILITY[itemId as ItemId];
      let label = `${nm}\nx${qty}`;
      if (max) {
        const dur = (me as any).toolDurability?.get(itemId) ?? max;
        label = `${nm} (${dur}/${max})\nx${qty}`;
      }
      const tx = this.add.text(x + 4, y + 4, label, { fontSize: "7px", color: "#ffffff" })
        .setScrollFactor(0).setDepth(21);
      this.inventorySlots.push(bg, tx);
      i++;
    });
  }

  // ── Pixel art textures ────────────────────────────────────────────────────

  private createTextures() {
    const g = this.add.graphics();

    // Color helpers
    const lerp = (a: number, b: number, t: number): number => {
      const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
      const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
      return (Math.round(ar+(br-ar)*t) << 16) | (Math.round(ag+(bg-ag)*t) << 8) | Math.round(ab+(bb-ab)*t);
    };
    const dark = (c: number, f: number) => lerp(c, 0x000000, f);
    const lite = (c: number, f: number) => lerp(c, 0xffffff, f);

    // ── Grass tile (64×64) ───────────────────────────────────────────────
    g.fillStyle(0x4a7c59); g.fillRect(0, 0, 64, 64);
    for (const [x, y, w, h] of [
      [6, 8, 12, 8], [26, 2, 10, 6], [44, 18, 14, 8], [2, 36, 12, 10], [30, 46, 14, 8],
      [50, 2, 12, 8], [14, 22, 8, 12], [42, 38, 16, 10], [18, 50, 10, 10], [56, 28, 8, 12],
    ] as [number, number, number, number][]) {
      g.fillStyle(0x3a6848); g.fillRect(x, y, w, h);
    }
    for (const [x, y, w, h] of [
      [14, 6, 8, 6], [38, 14, 10, 6], [8, 30, 10, 6], [28, 36, 8, 6], [52, 44, 10, 6],
    ] as [number, number, number, number][]) {
      g.fillStyle(0x5a9068); g.fillRect(x, y, w, h);
    }
    for (const [tx, ty] of [
      [5,12], [20,8], [32,4], [48,10], [12,24], [36,20], [58,14],
      [4,42], [22,38], [40,30], [54,36], [10,56], [30,58], [44,52], [60,48],
    ]) {
      g.fillStyle(0x3a6848); g.fillRect(tx, ty, 1, 3); g.fillRect(tx+2, ty+1, 1, 2);
    }
    for (const [fx, fy] of [[20,14], [50,34], [6,30], [32,52], [44,6]]) {
      g.fillStyle(0xf0c040); g.fillRect(fx, fy, 2, 2);
      g.fillStyle(0xfff060); g.fillRect(fx, fy, 1, 1);
    }
    for (const [fx, fy] of [[36,8], [14,46], [54,52], [8,16], [26,28]]) {
      g.fillStyle(0xdd6688); g.fillRect(fx, fy, 2, 2);
      g.fillStyle(0xff88aa); g.fillRect(fx, fy, 1, 1);
    }
    g.generateTexture("grass_tile", 64, 64);

    // ── Player sprites (16×26, 4 walk frames each) ────────────────────────
    const SKIN = 0xf4c98f, SKIN_S = 0xd4a06a;
    const HAIR = 0x5a3219, HAIR_H = 0x7a4e2d;
    const EYE  = 0x1a0a04;
    const MOUTH = 0xc27050;
    const BELT = 0x3d2a1a, BUCKLE = 0xc8a040;
    const PANTS = 0x2c3e5a, PANTS_S = 0x1a2a40;
    const BOOT = 0x1e1208, BOOT_H = 0x3a2618;

    const makePlayer = (shirt: number, baseKey: string) => {
      const shirtS = dark(shirt, 0.3), shirtH = lite(shirt, 0.2);
      // Per-frame: [leftLegX, rightLegX, leftArmYOffset, rightArmYOffset]
      const frames = [
        { lLx: 4, lRx: 9,  aLy:  0, aRy:  0 }, // 0: neutral/idle
        { lLx: 3, lRx: 10, aLy: -1, aRy:  1 }, // 1: left step
        { lLx: 5, lRx: 8,  aLy:  0, aRy:  0 }, // 2: mid-crossing
        { lLx: 4, lRx: 9,  aLy:  1, aRy: -1 }, // 3: right step
      ];
      frames.forEach(({ lLx, lRx, aLy, aRy }, phase) => {
        g.clear();
        // Hair
        g.fillStyle(HAIR_H); g.fillRect(5, 0, 6, 1);
        g.fillStyle(HAIR);   g.fillRect(4, 1, 8, 3);
        g.fillStyle(HAIR);   g.fillRect(4, 4, 1, 4); g.fillRect(11, 4, 1, 4);
        // Face
        g.fillStyle(SKIN);   g.fillRect(5, 3, 6, 7);
        g.fillStyle(SKIN);   g.fillRect(3, 5, 2, 3); g.fillRect(11, 5, 2, 3); // ears
        g.fillStyle(SKIN_S); g.fillRect(3, 7, 1, 1); g.fillRect(12, 7, 1, 1);
        // Eyes
        g.fillStyle(EYE);    g.fillRect(6, 5, 2, 1); g.fillRect(9, 5, 2, 1);
        g.fillStyle(0xffffff); g.fillRect(6, 5, 1, 1); g.fillRect(9, 5, 1, 1);
        // Mouth + chin
        g.fillStyle(MOUTH);  g.fillRect(7, 8, 3, 1);
        g.fillStyle(SKIN_S); g.fillRect(5, 9, 6, 1);
        // Neck
        g.fillStyle(SKIN);   g.fillRect(6, 10, 4, 2);
        // Torso/shirt
        g.fillStyle(shirtS); g.fillRect(4, 12, 8, 1);   // shoulder shadow
        g.fillStyle(shirt);  g.fillRect(4, 13, 8, 5);   // main shirt
        g.fillStyle(shirtH); g.fillRect(4, 13, 1, 4);   // left highlight
        g.fillStyle(shirtS); g.fillRect(11, 13, 1, 5);  // right shadow
        g.fillStyle(shirtS); g.fillRect(4, 17, 8, 1);   // lower edge
        // Arms
        g.fillStyle(shirt);  g.fillRect(2, 13 + aLy, 2, 5); // left arm
        g.fillStyle(SKIN);   g.fillRect(2, 17 + aLy, 2, 2); // left hand
        g.fillStyle(shirt);  g.fillRect(12, 13 + aRy, 2, 5); // right arm
        g.fillStyle(SKIN);   g.fillRect(12, 17 + aRy, 2, 2); // right hand
        // Belt
        g.fillStyle(BELT);   g.fillRect(4, 18, 8, 2);
        g.fillStyle(BUCKLE); g.fillRect(7, 18, 2, 2);
        g.fillStyle(0xe8c858); g.fillRect(7, 18, 1, 1);
        // Legs
        g.fillStyle(PANTS);  g.fillRect(lLx, 20, 3, 4);
        g.fillStyle(PANTS_S); g.fillRect(lLx+2, 20, 1, 4);
        g.fillStyle(PANTS);  g.fillRect(lRx, 20, 3, 4);
        g.fillStyle(PANTS_S); g.fillRect(lRx+2, 20, 1, 4);
        // Boots
        g.fillStyle(BOOT);   g.fillRect(lLx-1, 24, 5, 2);
        g.fillStyle(BOOT_H); g.fillRect(lLx,   24, 1, 1);
        g.fillStyle(BOOT);   g.fillRect(lRx-1, 24, 5, 2);
        g.fillStyle(BOOT_H); g.fillRect(lRx,   24, 1, 1);
        g.generateTexture(`${baseKey}_${phase}`, 16, 26);
      });
    };
    makePlayer(0x2980b9, "player_me");
    makePlayer(0x7f8c8d, "player_ai");
    makePlayer(0xc0392b, "player_other");

    // ── Tree (18×28) ─────────────────────────────────────────────────────
    g.clear();
    g.fillStyle(0x155020); g.fillRect(1, 10, 16, 6);            // canopy shadow
    g.fillStyle(0x1e6b1e); g.fillRect(1,  7, 16, 7); g.fillRect(3, 14, 12, 2); // dark canopy
    g.fillStyle(0x2d8b2d); g.fillRect(3,  4, 12, 8); g.fillRect(2,  8, 14, 4); // mid canopy
    g.fillStyle(0x3dab3d); g.fillRect(4,  1, 10, 8); g.fillRect(5,  5,  8, 4); // upper
    g.fillStyle(0x4dc04d); g.fillRect(6,  0,  6, 4); g.fillRect(7,  0,  4, 2); // tip
    g.fillStyle(0x6de06d); // highlight sparkles
    g.fillRect(8, 0, 1, 1); g.fillRect(6, 2, 1, 1); g.fillRect(11, 3, 1, 1);
    g.fillRect(5, 6, 1, 1); g.fillRect(13, 7, 1, 1); g.fillRect(3, 9, 1, 1);
    g.fillRect(14, 11, 1, 1); g.fillRect(4, 12, 1, 1);
    g.fillStyle(0x8b5a2b); g.fillRect(7, 15, 4, 9);             // trunk
    g.fillStyle(0xa07040); g.fillRect(7, 15, 1, 9);             // trunk highlight
    g.fillStyle(0x5a3a1b); g.fillRect(10, 15, 1, 9);            // trunk shadow
    g.fillStyle(0x7a5028); g.fillRect(8, 17, 1, 3); g.fillRect(9, 21, 1, 2); // bark
    g.fillStyle(0x6b3d1b); g.fillRect(3, 23, 4, 2); g.fillRect(2, 25, 3, 2); // left root
    g.fillStyle(0x6b3d1b); g.fillRect(11, 23, 4, 2); g.fillRect(13, 25, 3, 2); // right root
    g.fillStyle(0x8b5a2b); g.fillRect(3, 23, 1, 1); g.fillRect(13, 23, 1, 1);
    g.generateTexture("tree", 18, 28);

    // ── Rock (16×12) ─────────────────────────────────────────────────────
    g.clear();
    g.fillStyle(0x7a7a7a); g.fillRect(3, 1, 10, 2); g.fillRect(1, 3, 14, 6); g.fillRect(2, 9, 12, 2);
    g.fillStyle(0xb0b0b0); g.fillRect(4, 1, 5, 2); g.fillRect(3, 3, 4, 2); // top highlight
    g.fillStyle(0x999999); g.fillRect(1, 3, 2, 5);                          // left lighter face
    g.fillStyle(0x555555); g.fillRect(11, 5, 3, 4); g.fillRect(4, 9, 9, 2); // shadow
    g.fillStyle(0x444444); g.fillRect(7, 3, 1, 4); g.fillRect(8, 6, 2, 1);  // crack
    g.fillStyle(0x888888); g.fillRect(10, 2, 2, 2);  // pebble
    g.fillStyle(0xaaaaaa); g.fillRect(10, 2, 1, 1);
    g.generateTexture("rock", 16, 12);

    // ── Berry Bush (14×12) ───────────────────────────────────────────────
    g.clear();
    g.fillStyle(0x3d4a1a); g.fillRect(5, 9, 4, 3);            // stem
    g.fillStyle(0x1e5a1e); g.fillRect(1, 5, 12, 6); g.fillRect(2, 3, 10, 3); // dark base
    g.fillStyle(0x2d8b2d); g.fillRect(2, 2, 10, 6); g.fillRect(3, 1, 8, 3); // mid
    g.fillStyle(0x3dab3d); g.fillRect(3, 0, 8, 5); g.fillRect(5, 0, 4, 3);  // top
    g.fillStyle(0x5dcc5d); g.fillRect(4, 1, 1, 1); g.fillRect(9, 2, 1, 1); g.fillRect(6, 0, 1, 1);
    g.fillStyle(0xdd2222); g.fillRect(2, 6, 2, 2); g.fillRect(6, 7, 2, 2); g.fillRect(10, 6, 2, 2);
    g.fillStyle(0xff5555); g.fillRect(2, 6, 1, 1); g.fillRect(6, 7, 1, 1); g.fillRect(10, 6, 1, 1);
    g.generateTexture("berries", 14, 12);

    // ── Animal / Deer (18×14) ─────────────────────────────────────────────
    g.clear();
    g.fillStyle(0xa07040); g.fillRect(2, 4, 10, 6);               // body
    g.fillStyle(0xb88a56); g.fillRect(2, 4, 4, 3);                // chest lighter
    g.fillStyle(0x886030); g.fillRect(2, 9, 10, 1);               // body shadow
    g.fillStyle(0xa07040); g.fillRect(10, 2, 3, 4);               // neck
    g.fillStyle(0xa07040); g.fillRect(12, 1, 5, 5);               // head
    g.fillStyle(0xb88a56); g.fillRect(13, 2, 3, 3);               // face
    g.fillStyle(0x886030); g.fillRect(16, 3, 2, 2);               // snout
    g.fillStyle(0x1a0a04); g.fillRect(17, 3, 1, 1);               // nose
    g.fillStyle(0x1a0a04); g.fillRect(14, 2, 1, 1);               // eye
    g.fillStyle(0xffffff); g.fillRect(13, 2, 1, 1);               // eye shine
    g.fillStyle(0xc89868); g.fillRect(12, 0, 2, 2);               // ear
    g.fillStyle(0xffbbaa); g.fillRect(12, 0, 1, 1);               // inner ear
    g.fillStyle(0x7a5028); g.fillRect(13, 0, 1, 2); g.fillRect(15, 0, 1, 1); // antler
    g.fillStyle(0xf0e8d0); g.fillRect(1, 4, 2, 2);               // tail
    g.fillStyle(0xffffff); g.fillRect(1, 4, 1, 1);
    g.fillStyle(0x886030); g.fillRect(3, 10, 2, 4); g.fillRect(6, 10, 2, 3); g.fillRect(9, 10, 2, 4);
    g.fillStyle(0x7a5020); g.fillRect(3, 13, 2, 1); g.fillRect(9, 13, 2, 1); // hooves
    g.generateTexture("animal", 18, 14);

    // ── Wheat Field (16×14) ───────────────────────────────────────────────
    g.clear();
    g.fillStyle(0x6b4c1a); g.fillRect(0, 10, 16, 4);   // soil
    g.fillStyle(0x7a5a22); g.fillRect(1, 10, 14, 1);   // soil highlight
    for (const [sx, sy, sh] of [[1,3,8],[4,2,9],[7,1,10],[10,2,9],[13,3,8]] as [number,number,number][]) {
      g.fillStyle(0xc49a14); g.fillRect(sx, sy, 2, sh);
      g.fillStyle(0x9a7a0a); g.fillRect(sx+1, sy, 1, sh); // stalk shadow
    }
    for (const [hx, hy] of [[0,2],[3,1],[6,0],[9,1],[12,2]] as [number,number][]) {
      g.fillStyle(0xf0c040); g.fillRect(hx, hy, 3, 2);
      g.fillStyle(0xffd966); g.fillRect(hx, hy, 1, 1);
    }
    g.fillStyle(0x8ab030);
    g.fillRect(2, 5, 2, 1); g.fillRect(5, 4, 2, 1); g.fillRect(8, 5, 2, 1);
    g.fillRect(11, 4, 2, 1); g.fillRect(14, 5, 2, 1);
    g.generateTexture("wheat_field", 16, 14);

    // ── Chest (16×14) ─────────────────────────────────────────────────────
    g.clear();
    g.fillStyle(0x8b5a2b); g.fillRect(0, 0, 16, 14);  // base wood
    g.fillStyle(0x9a6a35); g.fillRect(0, 0, 16, 6);   // lid lighter
    g.fillStyle(0x5a3010); g.fillRect(0, 5, 16, 2);   // lid band
    g.fillStyle(0x707080); g.fillRect(0, 0, 2, 14); g.fillRect(14, 0, 2, 14); // metal corners
    g.fillStyle(0xa0a0b0); g.fillRect(0, 0, 1, 14); g.fillRect(0, 0, 16, 1); // shine
    g.fillStyle(0x707080); g.fillRect(0, 3, 16, 1); g.fillRect(0, 10, 16, 1); // straps
    g.fillStyle(0x7a5025);
    g.fillRect(3, 1, 1, 4); g.fillRect(7, 1, 1, 4); g.fillRect(11, 1, 1, 4); // lid grain
    g.fillRect(3, 7, 1, 6); g.fillRect(7, 7, 1, 6); g.fillRect(11, 7, 1, 6); // body grain
    g.fillStyle(0xc8a040); g.fillRect(7, 4, 2, 5);   // lock plate
    g.fillStyle(0xe0b850); g.fillRect(7, 5, 1, 1);
    g.fillStyle(0x222222); g.fillRect(7, 6, 2, 2);   // keyhole
    g.generateTexture("chest", 16, 14);

    // ── Coal Seam (16×12) ─────────────────────────────────────────────────
    g.clear();
    g.fillStyle(0x1a1a1a); g.fillRect(3, 1, 10, 2); g.fillRect(1, 3, 14, 6); g.fillRect(2, 9, 12, 2);
    g.fillStyle(0x333333); g.fillRect(4, 2, 4, 2); g.fillRect(8, 5, 3, 2);
    g.fillStyle(0xff6600, 0.9); g.fillRect(4, 4, 3, 2); g.fillRect(8, 3, 2, 3);
    g.fillStyle(0xff9900, 0.7); g.fillRect(5, 4, 1, 1); g.fillRect(9, 3, 1, 1);
    g.fillStyle(0x111111); g.fillRect(3, 9, 8, 2);
    g.generateTexture("coal_seam", 16, 12);

    // ── Fish Spot (14×14) ─────────────────────────────────────────────────
    g.clear();
    g.fillStyle(0x1a6a9f); g.fillCircle(7, 7, 7);
    g.fillStyle(0x2280bf); g.fillCircle(7, 7, 5);
    g.fillStyle(0x3a9fd4); g.fillCircle(7, 7, 3);
    g.fillStyle(0x50b8e8); g.fillCircle(7, 7, 1);
    g.fillStyle(0x2a90cf); g.fillRect(3, 6, 8, 1);
    g.fillStyle(0x3aa8e4); g.fillRect(4, 8, 6, 1);
    g.fillStyle(0xffffff, 0.8); g.fillRect(5, 4, 1, 1); g.fillRect(8, 5, 1, 1);
    g.generateTexture("fish_spot", 14, 14);

    g.destroy();
  }

  // ── Campfire sprite ───────────────────────────────────────────────────────

  private createCampfireSprite(x: number, y: number): Phaser.GameObjects.Container {
    const stone1 = this.add.rectangle(-8,  4, 5, 4, 0x777777);
    const stone2 = this.add.rectangle( 8,  4, 5, 4, 0x777777);
    const stone3 = this.add.rectangle( 0,  7, 12, 3, 0x666666);
    const sHigh1 = this.add.rectangle(-8,  3, 3, 2, 0x999999);
    const sHigh2 = this.add.rectangle( 8,  3, 3, 2, 0x999999);
    const log1   = this.add.rectangle(-3,  3, 14, 3, 0x5c3317).setAngle(20);
    const log2   = this.add.rectangle( 3,  3, 14, 3, 0x5c3317).setAngle(-20);
    const logH1  = this.add.rectangle(-3,  2, 14, 1, 0x7a4a25).setAngle(20);
    const logH2  = this.add.rectangle( 3,  2, 14, 1, 0x7a4a25).setAngle(-20);
    const ember  = this.add.rectangle( 0,  2, 10, 4, 0xcc3300);
    const emberH = this.add.rectangle( 0,  1,  6, 2, 0xff5500);
    const flameO = this.add.rectangle( 0, -4,  9, 13, 0xff4400);
    const flameM = this.add.rectangle( 0, -6,  6,  9, 0xff7700);
    const flameI = this.add.rectangle( 0, -8,  4,  7, 0xffaa00);
    const flameTip = this.add.rectangle(0,-11,  2,  5, 0xffdd00);
    const container = this.add.container(x, y, [
      stone3, stone1, stone2, sHigh1, sHigh2,
      log1, log2, logH1, logH2, ember, emberH,
      flameO, flameM, flameI, flameTip,
    ]).setDepth(4);
    this.tweens.add({
      targets: [flameO, flameM, flameI, flameTip],
      scaleX: { from: 1.0, to: 0.70 },
      scaleY: { from: 1.0, to: 0.85 },
      alpha:  { from: 1.0, to: 0.85 },
      duration: 100 + Math.random() * 80,
      yoyo: true, repeat: -1, ease: "Sine.easeInOut",
    });
    this.tweens.add({
      targets: [flameM, flameTip],
      x: { from: -1, to: 1 },
      duration: 160 + Math.random() * 100,
      yoyo: true, repeat: -1, ease: "Sine.easeInOut",
    });
    return container;
  }

  // ── Forge sprite ──────────────────────────────────────────────────────────

  private createForgeSprite(x: number, y: number): Phaser.GameObjects.Container {
    const g = this.add.graphics();
    g.fillStyle(0x4a4a4a); g.fillRect(-10, 0, 20, 12);   // base body
    g.fillStyle(0x3a3a3a); g.fillRect(-10, 0, 2, 12);    // left shadow
    g.fillStyle(0x5a5a5a); g.fillRect( -9, 0, 1, 12);    // left highlight
    g.fillStyle(0x5a5a5a); g.fillRect(-10, 0, 20, 2);    // top highlight
    g.fillStyle(0x3a3a3a);                                // stone lines
    g.fillRect(-8, 4, 16, 1); g.fillRect(-8, 8, 16, 1);
    g.fillRect(-4, 0, 1, 12); g.fillRect( 3, 0, 1, 12);
    g.fillStyle(0x222222); g.fillRect(-5, 2, 10, 8);     // fire opening
    g.fillStyle(0xff4400, 0.95); g.fillRect(-4, 4, 8, 5);
    g.fillStyle(0xff7700, 0.80); g.fillRect(-3, 5, 6, 3);
    g.fillStyle(0xffaa00, 0.70); g.fillRect(-2, 6, 4, 2);
    g.fillStyle(0x3a3a3a); g.fillRect(-4, -12, 8, 13);   // chimney
    g.fillStyle(0x4a4a4a); g.fillRect(-3, -12, 1, 13);
    g.fillStyle(0x2a2a2a); g.fillRect(-5, -14, 10, 4);   // chimney cap
    g.fillStyle(0x3a3a3a); g.fillRect(-4, -14, 8, 2);
    const container = this.add.container(x, y, [g]).setDepth(4);
    this.tweens.add({
      targets: g, alpha: { from: 0.95, to: 0.75 },
      duration: 350 + Math.random() * 200,
      yoyo: true, repeat: -1, ease: "Sine.easeInOut",
    });
    return container;
  }

  // ── Blast Furnace sprite ──────────────────────────────────────────────────

  private createBlastFurnaceSprite(x: number, y: number): Phaser.GameObjects.Container {
    const g = this.add.graphics();
    g.fillStyle(0x4a4a4a); g.fillRect(-12, -2, 24, 14);   // main body
    g.fillStyle(0x3a3a3a); g.fillRect(-12, -2,  3, 14);   // left shadow
    g.fillStyle(0x5a5a5a); g.fillRect(-11, -2,  1, 14);   // left highlight
    g.fillStyle(0x5a5a5a); g.fillRect(-12, -2, 24,  2);   // top highlight
    g.fillStyle(0x3a3a3a);
    g.fillRect(-10, 2, 20, 1); g.fillRect(-10, 6, 20, 1); g.fillRect(-10, 10, 20, 1);
    g.fillRect(-5, -2, 1, 14); g.fillRect(4, -2, 1, 14);
    g.fillStyle(0x222222); g.fillRect(-6,  0, 12, 10);    // large fire opening
    g.fillStyle(0xff5500, 0.95); g.fillRect(-5,  2, 10, 7);
    g.fillStyle(0xff8800, 0.85); g.fillRect(-4,  3,  8, 5);
    g.fillStyle(0xffbb00, 0.80); g.fillRect(-3,  4,  6, 3);
    g.fillStyle(0xffee00, 0.60); g.fillRect(-1,  5,  3, 2);
    g.fillStyle(0x3a3a3a); g.fillRect(-8, -16, 6, 15); g.fillRect(2, -16, 6, 15); // chimneys
    g.fillStyle(0x4a4a4a); g.fillRect(-7, -16, 1, 15); g.fillRect(3, -16, 1, 15);
    g.fillStyle(0x2a2a2a); g.fillRect(-9, -18, 8, 4); g.fillRect(1, -18, 8, 4);   // caps
    g.fillStyle(0x3a3a3a); g.fillRect(-8, -18, 6, 2); g.fillRect(2, -18, 6, 2);
    const container = this.add.container(x, y, [g]).setDepth(4);
    this.tweens.add({
      targets: g, alpha: { from: 1.0, to: 0.7 },
      duration: 300 + Math.random() * 200,
      yoyo: true, repeat: -1, ease: "Sine.easeInOut",
    });
    return container;
  }

  // ── Water Well sprite ─────────────────────────────────────────────────────

  private createWaterWellSprite(x: number, y: number): Phaser.GameObjects.Container {
    const g = this.add.graphics();
    g.fillStyle(0x888888); g.fillCircle(0, 5, 9);            // stone ring outer
    g.fillStyle(0xaaaaaa); g.fillRect(-6, 0, 3, 4); g.fillRect(3, 0, 3, 4); // highlights
    g.fillStyle(0x666666); g.fillCircle(0, 5, 7);            // stone ring inner
    g.fillStyle(0x1a6a9f); g.fillCircle(0, 5, 5);            // water
    g.fillStyle(0x2a8abf); g.fillCircle(0, 6, 3);
    g.fillStyle(0x60b8e8, 0.7); g.fillRect(-2, 3, 3, 1);     // water shine
    g.fillStyle(0x999999); g.fillRect(-8, 2, 3, 2); g.fillRect(5, 2, 3, 2);
    g.fillStyle(0x6b3d1b); g.fillRect(-12, -12, 3, 14); g.fillRect(9, -12, 3, 14); // posts
    g.fillStyle(0x8b5a2b); g.fillRect(-12, -12, 1, 14); g.fillRect(9, -12, 1, 14);
    g.fillStyle(0x8b5a2b); g.fillRect(-12, -5, 24, 3);       // cross beam
    g.fillStyle(0xa07040); g.fillRect(-12, -5, 24, 1);        // beam highlight
    g.fillStyle(0xc8a040); g.fillRect(-1, -5, 2, 10);         // rope
    g.fillStyle(0xe8c060); g.fillRect(-1, -5, 1, 3);
    g.fillStyle(0x7a4a22); g.fillRect(-14, -18, 28, 7);       // roof
    g.fillStyle(0x9a6a38); g.fillRect(-13, -18, 26, 2);
    g.fillStyle(0x5a3010); g.fillRect(-14, -12, 28, 1);
    const container = this.add.container(x, y, [g]).setDepth(4);
    return container;
  }

  // ── Walk animations ───────────────────────────────────────────────────────

  private createAnimations() {
    const makeAnims = (key: string) => {
      this.anims.create({
        key: `${key}_idle`,
        frames: [{ key: `${key}_0` }],
        frameRate: 1, repeat: -1,
      });
      this.anims.create({
        key: `${key}_walk`,
        frames: [{ key: `${key}_1` }, { key: `${key}_2` }, { key: `${key}_3` }, { key: `${key}_2` }],
        frameRate: 8, repeat: -1,
      });
    };
    makeAnims("player_me");
    makeAnims("player_ai");
    makeAnims("player_other");
  }

  // ── Hash color helper ─────────────────────────────────────────────────────

  private hashColor(s: string): number {
    return (parseInt(s.replace(/-/g, "").slice(0, 6), 16) | 0x202020) & 0xffffff;
  }

  // ── Server connection ─────────────────────────────────────────────────────

  private async connectToServer() {
    try {
      let uuid = localStorage.getItem("player_uuid");
      if (!uuid) { uuid = crypto.randomUUID(); localStorage.setItem("player_uuid", uuid); }
      let name = localStorage.getItem("player_name");
      if (!name) {
        name = `Player_${Math.floor(Math.random() * 9999)}`;
        localStorage.setItem("player_name", name);
      }

      const client = new Client(SERVER_URL);
      this.room = await client.joinOrCreate("game_room", { uuid, name });
      this.mySessionId = this.room.sessionId;

      // Players
      this.room.state.players.onAdd((player: PlayerSchema, sessionId: string) => {
        const isMe   = sessionId === this.mySessionId;
        const texKey = isMe ? "player_me" : player.isAI ? "player_ai" : "player_other";
        const body   = this.add.sprite(player.x, player.y, `${texKey}_0`).setDepth(5);
        body.play(isMe ? `${texKey}_idle` : `${texKey}_walk`);
        const label  = this.add.text(player.x, player.y - 17, player.name, { fontSize: "7px", color: "#ffffff" })
          .setOrigin(0.5, 1).setDepth(6);
        this.playerSprites.set(sessionId, { body, label });

        if (isMe) {
          this.localX = player.x;
          this.localY = player.y;
          this.cameras.main.centerOn(this.localX, this.localY);
        }

        player.onChange(() => {
          if (!isMe) {
            if (player.x !== body.x) body.setFlipX(player.x < body.x);
            body.setPosition(player.x, player.y);
            label.setPosition(player.x, player.y - 17);
            const s = this.playerSprites.get(sessionId);
            if (s?.bubble) s.bubble.setPosition(player.x, player.y - 32);
          }
          if (isMe) {
            this.updateHungerBar(player.hunger);
            if (Math.hypot(player.x - this.localX, player.y - this.localY) > 200) {
              this.localX = player.x;
              this.localY = player.y;
              body.setPosition(this.localX, this.localY);
              label.setPosition(this.localX, this.localY - 17);
              this.cameras.main.centerOn(this.localX, this.localY);
            }
          }
        });
        player.inventory.onAdd(()    => { if (isMe) this.refreshInventory(); });
        player.inventory.onChange(() => { if (isMe) this.refreshInventory(); });
        player.inventory.onRemove(() => { if (isMe) this.refreshInventory(); });
      });

      this.room.state.players.onRemove((_: PlayerSchema, sessionId: string) => {
        const s = this.playerSprites.get(sessionId);
        s?.body.destroy(); s?.label.destroy();
        this.playerSprites.delete(sessionId);
      });

      // Resources
      this.room.state.resources.onAdd((resource: ResourceSchema, id: string) => {
        const sprite = this.add.image(resource.x, resource.y, resource.kind).setDepth(3);
        this.resourceSprites.set(id, sprite);
        resource.onChange(() => sprite.setAlpha(resource.depleted ? 0.25 : 1.0));
      });
      this.room.state.resources.onRemove((_: ResourceSchema, id: string) => {
        this.resourceSprites.get(id)?.destroy();
        this.resourceSprites.delete(id);
      });

      // Campfires
      this.room.state.campfires.onAdd((cf: CampfireSchema, id: string) => {
        this.campfireSprites.set(id, this.createCampfireSprite(cf.x, cf.y));
      });
      this.room.state.campfires.onRemove((_: CampfireSchema, id: string) => {
        this.campfireSprites.get(id)?.destroy();
        this.campfireSprites.delete(id);
      });

      // Forges
      this.room.state.forges.onAdd((forge: ForgeSchema, id: string) => {
        this.forgeSprites.set(id, this.createForgeSprite(forge.x, forge.y));
      });
      this.room.state.forges.onRemove((_: ForgeSchema, id: string) => {
        this.forgeSprites.get(id)?.destroy();
        this.forgeSprites.delete(id);
      });

      // Chests
      this.room.state.chests.onAdd((chest: ChestSchema, id: string) => {
        this.chestSprites.set(id, this.add.image(chest.x, chest.y, "chest").setDepth(4));
      });
      this.room.state.chests.onRemove((_: ChestSchema, id: string) => {
        this.chestSprites.get(id)?.destroy();
        this.chestSprites.delete(id);
      });

      // Blast Furnaces
      this.room.state.blastFurnaces.onAdd((bf: BlastFurnaceSchema, id: string) => {
        this.blastFurnaceSprites.set(id, this.createBlastFurnaceSprite(bf.x, bf.y));
      });
      this.room.state.blastFurnaces.onRemove((_: BlastFurnaceSchema, id: string) => {
        this.blastFurnaceSprites.get(id)?.destroy();
        this.blastFurnaceSprites.delete(id);
      });

      // Water Wells
      this.room.state.waterWells.onAdd((well: WaterWellSchema, id: string) => {
        this.waterWellSprites.set(id, this.createWaterWellSprite(well.x, well.y));
      });
      this.room.state.waterWells.onRemove((_: WaterWellSchema, id: string) => {
        this.waterWellSprites.get(id)?.destroy();
        this.waterWellSprites.delete(id);
      });

      // Land Plots
      this.room.state.landPlots.onAdd((plot: LandPlotSchema, id: string) => {
        const color = this.hashColor(plot.ownerUuid);
        const half  = LAND_PLOT_SIZE / 2;
        const gfx   = this.add.graphics().setDepth(2);
        gfx.lineStyle(2, color, 0.7);
        gfx.strokeRect(plot.x - half, plot.y - half, LAND_PLOT_SIZE, LAND_PLOT_SIZE);
        gfx.fillStyle(color, 0.05);
        gfx.fillRect(plot.x - half, plot.y - half, LAND_PLOT_SIZE, LAND_PLOT_SIZE);
        const lbl = this.add.text(plot.x, plot.y - half + 4, plot.ownerName, {
          fontSize: "7px", color: "#ffffff", backgroundColor: "#00000066",
          padding: { x: 2, y: 1 },
        }).setOrigin(0.5, 0).setDepth(3);
        this.landPlotGraphics.set(id, { gfx, label: lbl });
      });
      this.room.state.landPlots.onRemove((_: LandPlotSchema, id: string) => {
        const entry = this.landPlotGraphics.get(id);
        if (entry) { entry.gfx.destroy(); entry.label.destroy(); }
        this.landPlotGraphics.delete(id);
      });

      // Chat
      this.room.onMessage("chat_message", ({ playerId, playerName, text }: { playerId: string; playerName: string; text: string }) => {
        this.showSpeechBubble(playerId, text);
        this.addChatMessage(playerName, text);
      });

      // Death
      this.room.onMessage("player_died", ({ playerId }: { playerId: string }) => {
        if (playerId === this.mySessionId) {
          this.cameras.main.flash(300, 255, 0, 0);
          this.cookingUntil = 0;
          this.gatheringUntil = 0;
        }
      });

      // Tech advance notification
      this.room.onMessage("tech_advance", ({ name }: { name: string }) => {
        const msg = this.add.text(this.scale.width / 2, this.scale.height / 2 - 40,
          `✦ ${name} Unlocked! ✦`, {
            fontSize: "20px", color: "#f0c040",
            backgroundColor: "#000000cc",
            padding: { x: 16, y: 10 },
          }).setScrollFactor(0).setDepth(100).setOrigin(0.5);
        this.tweens.add({
          targets: msg, alpha: 0, y: msg.y - 50, delay: 2500, duration: 1200,
          onComplete: () => msg.destroy(),
        });
      });

      // Mayor election notification
      this.room.onMessage("mayor_elected", ({ name }: { name: string }) => {
        this.addChatMessage("Town", `${name} has been elected Mayor!`);
      });

      const myPlayer = this.room.state.players.get(this.mySessionId) as any;
      this.myUuid = myPlayer?.uuid ?? uuid;
      this.marketPanel = new MarketPanel(this, this.room, this.mySessionId, this.myUuid);
      this.craftPanel  = new CraftPanel(this, this.room, this.mySessionId);
      this.chestPanel  = new ChestPanel(this, this.room, this.mySessionId, this.myUuid);

      this.room.state.players.onAdd((player: PlayerSchema, sessionId: string) => {
        if (sessionId === this.mySessionId) {
          let lastCoins = player.coins;
          player.onChange(() => {
            if (this.marketPanel.isOpen && player.coins !== lastCoins) {
              lastCoins = player.coins;
              this.marketPanel["render"]();
            }
          });
        }
      });

      console.log("[GameScene] Connected:", this.mySessionId);
    } catch (err) {
      console.error("[GameScene] Connection failed:", err);
    }
  }

  // ── Update loop ───────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (!this.room) return;

    this.updateDayNight();

    if (this.chatOpen) return;

    if (this.chestPanel?.isOpen) {
      if (Phaser.Input.Keyboard.JustDown(this.eKey)) this.chestPanel.close();
      return;
    }

    if (this.marketPanel?.isOpen) {
      if (Phaser.Input.Keyboard.JustDown(this.mKey)) this.marketPanel.close();
      return;
    }

    if (this.craftPanel?.isOpen) {
      if (Phaser.Input.Keyboard.JustDown(this.xKey)) this.craftPanel.close();
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.mKey)) this.tryOpenMarket();
    if (Phaser.Input.Keyboard.JustDown(this.xKey)) this.craftPanel?.open();
    if (Phaser.Input.Keyboard.JustDown(this.zKey)) this.tryDemolish();

    this.isMoving = false;
    this.tryMove(delta);
    const myEntry = this.playerSprites.get(this.mySessionId);
    if (myEntry) myEntry.body.play(this.isMoving ? "player_me_walk" : "player_me_idle", true);
    this.tryInteract();
    this.tryEat();
    this.tryBuildCampfire();
    this.updateActionBar();

    this.promptTimer -= delta;
    if (this.promptTimer <= 0) {
      this.promptTimer = this.PROMPT_INTERVAL;
      this.updatePrompt();
      this.updateHUD();
    }
  }

  private tryOpenMarket() {
    if (Math.hypot(MARKET_X - this.localX, MARKET_Y - this.localY) < MARKET_RANGE) {
      this.marketPanel.open();
    }
  }

  private tryMove(delta: number) {
    let dx = 0, dy = 0;
    if (this.cursors.left?.isDown)  dx = -1;
    if (this.cursors.right?.isDown) dx =  1;
    if (this.cursors.up?.isDown)    dy = -1;
    if (this.cursors.down?.isDown)  dy =  1;
    if (dx === 0 && dy === 0) return;

    if (this.gatheringUntil > Date.now()) this.gatheringUntil = 0;

    if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

    const moved = this.PLAYER_SPEED * delta / 1000;
    const W = GAME_CONSTANTS.WORLD_SIZE;
    this.localX = Math.max(0, Math.min(W, this.localX + dx * moved));
    this.localY = Math.max(0, Math.min(W, this.localY + dy * moved));

    this.isMoving = true;
    const s = this.playerSprites.get(this.mySessionId);
    if (s) {
      if (dx !== 0) s.body.setFlipX(dx < 0);
      s.body.setPosition(this.localX, this.localY);
      s.label.setPosition(this.localX, this.localY - 17);
      if (s.bubble) s.bubble.setPosition(this.localX, this.localY - 32);
    }
    this.cameras.main.centerOn(this.localX, this.localY);

    this.moveTimer -= delta;
    if (this.moveTimer <= 0) {
      this.room.send("move", { x: Math.round(this.localX), y: Math.round(this.localY) });
      this.moveTimer = this.SEND_INTERVAL;
    }
  }

  private updateDayNight() {
    if (!this.room) return;
    const MS  = GAME_CONSTANTS.MS_PER_GAME_DAY;
    const tod = (this.room.state.gameTime % MS) / MS;

    let alpha = 0;
    if      (tod < 0.15) alpha = 0.65 * (1 - tod / 0.15);
    else if (tod < 0.72) alpha = 0;
    else if (tod < 0.85) alpha = 0.65 * ((tod - 0.72) / 0.13);
    else                 alpha = 0.65;

    this.nightOverlay.setAlpha(alpha);

    const hours = Math.floor(tod * 24);
    const mins  = Math.floor((tod * 24 - hours) * 60);
    const day   = Math.floor(this.room.state.gameTime / MS) + 1;
    this.timeText.setText(`Day ${day}  ${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`);
  }

  // ── E key interact ────────────────────────────────────────────────────────

  private tryInteract() {
    if (!Phaser.Input.Keyboard.JustDown(this.eKey)) return;
    const now = Date.now();
    if (this.gatheringUntil > now || this.cookingUntil > now) return;
    const me = this.room.state.players.get(this.mySessionId);
    if (!me) return;
    const px = this.localX, py = this.localY;

    // Priority 0: own chest nearby
    let ownChestId = "", ownChestDist = Infinity;
    this.room.state.chests.forEach((chest: ChestSchema, id: string) => {
      if (chest.ownerUuid !== this.myUuid) return;
      const dist = Math.hypot(chest.x - px, chest.y - py);
      if (dist < GAME_CONSTANTS.GATHER_RANGE * 2 && dist < ownChestDist) {
        ownChestDist = dist; ownChestId = id;
      }
    });
    if (ownChestId) { this.chestPanel.open(ownChestId); return; }

    // Priority 1: forge nearby + have iron_ore → smelt
    let nearestForgeId = "", nearestForgeDist = Infinity;
    this.room.state.forges.forEach((forge: ForgeSchema, id: string) => {
      const dist = Math.hypot(forge.x - px, forge.y - py);
      if (dist < GAME_CONSTANTS.GATHER_RANGE * 2 && dist < nearestForgeDist) {
        nearestForgeDist = dist; nearestForgeId = id;
      }
    });
    if (nearestForgeId) {
      for (const itemId of ["iron_ore"] as ItemId[]) {
        const recipe = SMELT_RECIPES[itemId];
        if (recipe && (me.inventory.get(itemId) ?? 0) >= recipe.inputQty) {
          this.room.send("smelt", { forgeId: nearestForgeId, itemId });
          this.cookingUntil   = now + recipe.timeMs;
          this.cookingTotalMs = recipe.timeMs;
          return;
        }
      }
    }

    // Priority 2: blast furnace nearby + inputs → blast
    let nearestBfId = "", nearestBfDist = Infinity;
    this.room.state.blastFurnaces.forEach((bf: BlastFurnaceSchema, id: string) => {
      const dist = Math.hypot(bf.x - px, bf.y - py);
      if (dist < GAME_CONSTANTS.GATHER_RANGE * 2 && dist < nearestBfDist) {
        nearestBfDist = dist; nearestBfId = id;
      }
    });
    if (nearestBfId) {
      const recipe = BLAST_RECIPES["steel_ingot"];
      let canBlast = true;
      for (const [itemId, qty] of Object.entries(recipe.inputs)) {
        if ((me.inventory.get(itemId) ?? 0) < (qty as number)) { canBlast = false; break; }
      }
      if (canBlast) {
        this.room.send("blast", { blastFurnaceId: nearestBfId, recipeId: "steel_ingot" });
        this.cookingUntil   = now + recipe.timeMs;
        this.cookingTotalMs = recipe.timeMs;
        return;
      }
    }

    // Priority 3: water well nearby → use
    let nearestWellId = "", nearestWellDist = Infinity;
    this.room.state.waterWells.forEach((well: WaterWellSchema, id: string) => {
      const dist = Math.hypot(well.x - px, well.y - py);
      if (dist < GAME_CONSTANTS.GATHER_RANGE * 2 && dist < nearestWellDist) {
        nearestWellDist = dist; nearestWellId = id;
      }
    });
    if (nearestWellId) {
      this.room.send("use_well", { wellId: nearestWellId });
      return;
    }

    // Priority 4: campfire → advanced cook then basic cook
    let nearestCfId = "", nearestCfDist = Infinity;
    this.room.state.campfires.forEach((cf: CampfireSchema, id: string) => {
      const dist = Math.hypot(cf.x - px, cf.y - py);
      if (dist < GAME_CONSTANTS.GATHER_RANGE * 2 && dist < nearestCfDist) {
        nearestCfDist = dist; nearestCfId = id;
      }
    });
    if (nearestCfId) {
      for (const [recipeId, recipe] of Object.entries(ADVANCED_COOK_RECIPES)) {
        let canCook = true;
        for (const [itemId, qty] of Object.entries(recipe.inputs)) {
          if ((me.inventory.get(itemId) ?? 0) < (qty as number)) { canCook = false; break; }
        }
        if (canCook) {
          this.room.send("cook_advanced", { campfireId: nearestCfId, recipeId });
          this.cookingUntil   = now + recipe.timeMs;
          this.cookingTotalMs = recipe.timeMs;
          return;
        }
      }
      for (const itemId of ["raw_meat", "wheat"] as ItemId[]) {
        const recipe = COOK_RECIPES[itemId];
        if (recipe && (me.inventory.get(itemId) ?? 0) >= recipe.inputQty) {
          this.room.send("cook", { campfireId: nearestCfId, itemId });
          this.cookingUntil   = now + recipe.timeMs;
          this.cookingTotalMs = recipe.timeMs;
          return;
        }
      }
    }

    // Priority 5: gather resource
    let nearestId = "", nearestDist = Infinity;
    this.room.state.resources.forEach((res: ResourceSchema, id: string) => {
      if (res.depleted) return;
      const dist = Math.hypot(res.x - px, res.y - py);
      if (dist < GAME_CONSTANTS.GATHER_RANGE && dist < nearestDist) {
        nearestDist = dist; nearestId = id;
      }
    });
    if (nearestId) {
      const res = this.room.state.resources.get(nearestId) as ResourceSchema;
      const def = RESOURCES[res.kind as ResourceKind];
      this.room.send("gather", { resourceId: nearestId });
      this.gatheringUntil = now + def.gatherMs;
      this.gatherDuration = def.gatherMs;
    }
  }

  // ── Z key demolish ────────────────────────────────────────────────────────

  private tryDemolish() {
    const RANGE = GAME_CONSTANTS.GATHER_RANGE * 3;
    const px = this.localX, py = this.localY;
    let nearestId = "", nearestDist = Infinity;
    let nearestType: "campfire" | "forge" | "chest" | "water_well" | "blast_furnace" = "campfire";

    this.room.state.campfires.forEach((cf: CampfireSchema, id: string) => {
      if (cf.ownerId !== this.myUuid) return;
      const dist = Math.hypot(cf.x - px, cf.y - py);
      if (dist < RANGE && dist < nearestDist) { nearestDist = dist; nearestId = id; nearestType = "campfire"; }
    });
    this.room.state.forges.forEach((forge: ForgeSchema, id: string) => {
      if (forge.ownerId !== this.myUuid) return;
      const dist = Math.hypot(forge.x - px, forge.y - py);
      if (dist < RANGE && dist < nearestDist) { nearestDist = dist; nearestId = id; nearestType = "forge"; }
    });
    this.room.state.chests.forEach((chest: ChestSchema, id: string) => {
      if (chest.ownerUuid !== this.myUuid) return;
      const dist = Math.hypot(chest.x - px, chest.y - py);
      if (dist < RANGE && dist < nearestDist) { nearestDist = dist; nearestId = id; nearestType = "chest"; }
    });
    this.room.state.waterWells.forEach((well: WaterWellSchema, id: string) => {
      if (well.ownerId !== this.myUuid) return;
      const dist = Math.hypot(well.x - px, well.y - py);
      if (dist < RANGE && dist < nearestDist) { nearestDist = dist; nearestId = id; nearestType = "water_well"; }
    });
    this.room.state.blastFurnaces.forEach((bf: BlastFurnaceSchema, id: string) => {
      if (bf.ownerId !== this.myUuid) return;
      const dist = Math.hypot(bf.x - px, bf.y - py);
      if (dist < RANGE && dist < nearestDist) { nearestDist = dist; nearestId = id; nearestType = "blast_furnace"; }
    });

    if (nearestId) {
      this.room.send("demolish", { buildingType: nearestType, buildingId: nearestId });
    }
  }

  private tryEat() {
    if (!Phaser.Input.Keyboard.JustDown(this.fKey)) return;
    const me = this.room.state.players.get(this.mySessionId);
    if (!me) return;
    let bestItem: ItemId | null = null, bestRestore = 0;
    me.inventory.forEach((qty: number, itemId: string) => {
      if (qty <= 0) return;
      const def = ITEMS[itemId as ItemId];
      if (def?.hungerRestore && def.hungerRestore > bestRestore) {
        bestRestore = def.hungerRestore; bestItem = itemId as ItemId;
      }
    });
    if (bestItem) this.room.send("eat", { itemId: bestItem });
  }

  private tryBuildCampfire() {
    if (!Phaser.Input.Keyboard.JustDown(this.cKey)) return;
    const me = this.room.state.players.get(this.mySessionId);
    if (!me) return;
    if ((me.inventory.get("wood") ?? 0) < CAMPFIRE_WOOD_COST) return;
    this.room.send("place_campfire", {});
  }

  private updateActionBar() {
    const now       = Date.now();
    const cooking   = this.cookingUntil > now;
    const gathering = this.gatheringUntil > now;
    const active    = cooking || gathering;

    this.actionBarBg.setVisible(active);
    this.actionBar.setVisible(active);

    if (cooking) {
      const pct = (this.cookingUntil - now) / this.cookingTotalMs;
      this.actionBar.setScale(1 - pct, 1).setFillStyle(0xff8800);
    } else if (gathering) {
      const pct = (this.gatheringUntil - now) / this.gatherDuration;
      this.actionBar.setScale(1 - pct, 1).setFillStyle(0x44bb44);
    }
  }

  // ── HUD (tech / player count / mayor) ────────────────────────────────────

  private updateHUD() {
    if (!this.room) return;
    const state = this.room.state as any;

    const techNames = ["Stone Age", "Iron Age", "Steel Age"];
    const techLevel = state.techLevel ?? 0;
    const progress  = techLevel === 0
      ? ` (${state.totalGathers ?? 0}/50 gathers)`
      : techLevel === 1
      ? ` (${state.totalIronSmelted ?? 0}/10 smelts)`
      : "";
    this.techText.setText((techNames[techLevel] ?? "Stone Age") + progress);

    const onlinePlayers = state.onlinePlayers ?? 0;
    this.playerCountText.setText(`Players: ${onlinePlayers}`);

    const mayorName = state.mayorName ?? "Mayor";
    this.mayorText.setText(`Mayor: ${mayorName}`);
  }

  // ── Prompt ────────────────────────────────────────────────────────────────

  private updatePrompt() {
    const me = this.room?.state.players.get(this.mySessionId);
    if (!me) { this.promptText.setVisible(false); return; }

    const px = this.localX, py = this.localY;


    let ownChest: ChestSchema | null = null, ownChestDist = Infinity;
    this.room.state.chests.forEach((chest: ChestSchema) => {
      if (chest.ownerUuid !== this.myUuid) return;
      const dist = Math.hypot(chest.x - px, chest.y - py);
      if (dist < GAME_CONSTANTS.GATHER_RANGE * 2 && dist < ownChestDist) {
        ownChestDist = dist; ownChest = chest;
      }
    });

    let nearestForge: ForgeSchema | null = null, nearestForgeDist = Infinity;
    this.room.state.forges.forEach((forge: ForgeSchema) => {
      const dist = Math.hypot(forge.x - px, forge.y - py);
      if (dist < GAME_CONSTANTS.GATHER_RANGE * 2 && dist < nearestForgeDist) {
        nearestForgeDist = dist; nearestForge = forge;
      }
    });

    let nearestBf: BlastFurnaceSchema | null = null, nearestBfDist = Infinity;
    this.room.state.blastFurnaces.forEach((bf: BlastFurnaceSchema) => {
      const dist = Math.hypot(bf.x - px, bf.y - py);
      if (dist < GAME_CONSTANTS.GATHER_RANGE * 2 && dist < nearestBfDist) {
        nearestBfDist = dist; nearestBf = bf;
      }
    });

    let nearestWell: WaterWellSchema | null = null, nearestWellDist = Infinity;
    this.room.state.waterWells.forEach((well: WaterWellSchema) => {
      const dist = Math.hypot(well.x - px, well.y - py);
      if (dist < GAME_CONSTANTS.GATHER_RANGE * 2 && dist < nearestWellDist) {
        nearestWellDist = dist; nearestWell = well;
      }
    });

    let nearestCf: CampfireSchema | null = null, nearestCfDist = Infinity;
    this.room.state.campfires.forEach((cf: CampfireSchema) => {
      const dist = Math.hypot(cf.x - px, cf.y - py);
      if (dist < GAME_CONSTANTS.GATHER_RANGE * 2 && dist < nearestCfDist) {
        nearestCfDist = dist; nearestCf = cf;
      }
    });

    let nearestRes: ResourceSchema | null = null, nearestResDist = Infinity;
    this.room.state.resources.forEach((res: ResourceSchema) => {
      if (res.depleted) return;
      const dist = Math.hypot(res.x - px, res.y - py);
      if (dist < GAME_CONSTANTS.GATHER_RANGE && dist < nearestResDist) {
        nearestResDist = dist; nearestRes = res;
      }
    });

    const nearMarket = Math.hypot(MARKET_X - px, MARKET_Y - py) < MARKET_RANGE;

    // Demolishable building nearby?
    const DRANGE = GAME_CONSTANTS.GATHER_RANGE * 3;
    let demolishName = "";
    this.room.state.campfires.forEach((cf: CampfireSchema) => {
      if (cf.ownerId !== this.myUuid) return;
      if (Math.hypot(cf.x - px, cf.y - py) < DRANGE) demolishName = "Campfire";
    });
    this.room.state.forges.forEach((forge: ForgeSchema) => {
      if (forge.ownerId !== this.myUuid) return;
      if (Math.hypot(forge.x - px, forge.y - py) < DRANGE) demolishName = "Forge";
    });
    this.room.state.waterWells.forEach((well: WaterWellSchema) => {
      if (well.ownerId !== this.myUuid) return;
      if (Math.hypot(well.x - px, well.y - py) < DRANGE) demolishName = "Water Well";
    });
    this.room.state.blastFurnaces.forEach((bf: BlastFurnaceSchema) => {
      if (bf.ownerId !== this.myUuid) return;
      if (Math.hypot(bf.x - px, bf.y - py) < DRANGE) demolishName = "Blast Furnace";
    });

    const techLevel = (this.room.state as any).techLevel ?? 0;

    let smeltHint = "";
    if (nearestForge) {
      if (techLevel < 1) {
        smeltHint = `Forge (needs Iron Age — gather ${50 - Math.min(50, (this.room.state as any).totalGathers ?? 0)} more)`;
      } else if ((me.inventory.get("iron_ore") ?? 0) >= 1) {
        smeltHint = "[E] Smelt Iron Ore → Iron Ingot (5s)";
      }
    }

    let blastHint = "";
    if (nearestBf) {
      if (techLevel < 2) {
        blastHint = `Blast Furnace (needs Steel Age — smelt ${10 - Math.min(10, (this.room.state as any).totalIronSmelted ?? 0)} more iron)`;
      } else {
        const recipe = BLAST_RECIPES["steel_ingot"];
        let ok = true;
        for (const [it, q] of Object.entries(recipe.inputs)) {
          if ((me.inventory.get(it) ?? 0) < (q as number)) { ok = false; break; }
        }
        if (ok) blastHint = "[E] Blast → Steel Ingot (10s)";
      }
    }

    let cookHint = "";
    if (nearestCf) {
      for (const [, recipe] of Object.entries(ADVANCED_COOK_RECIPES)) {
        let ok = true;
        for (const [it, q] of Object.entries(recipe.inputs)) {
          if ((me.inventory.get(it) ?? 0) < (q as number)) { ok = false; break; }
        }
        if (ok) { cookHint = `[E] Cook → ${ITEMS[recipe.output]?.name} (${recipe.timeMs / 1000}s)`; break; }
      }
      if (!cookHint) {
        for (const itemId of ["raw_meat", "wheat"] as ItemId[]) {
          const recipe = COOK_RECIPES[itemId];
          if (recipe && (me.inventory.get(itemId) ?? 0) >= recipe.inputQty) {
            cookHint = `[E] Cook ${ITEMS[itemId].name} → ${ITEMS[recipe.output].name} (${recipe.timeMs / 1000}s)`;
            break;
          }
        }
      }
    }

    let text = "", tx = px, ty = py - 22;

    if (ownChest) {
      text = "[E] Open Chest";
      tx = (ownChest as ChestSchema).x; ty = (ownChest as ChestSchema).y - 18;
    } else if (nearMarket) {
      text = "[M] Open Market"; tx = MARKET_X; ty = MARKET_Y - 30;
    } else if (blastHint && nearestBf) {
      text = blastHint;
      tx = (nearestBf as BlastFurnaceSchema).x; ty = (nearestBf as BlastFurnaceSchema).y - 26;
    } else if (smeltHint && nearestForge) {
      text = smeltHint;
      tx = (nearestForge as ForgeSchema).x; ty = (nearestForge as ForgeSchema).y - 22;
    } else if (nearestWell) {
      text = "[E] Use Well (+3 water)";
      tx = (nearestWell as WaterWellSchema).x; ty = (nearestWell as WaterWellSchema).y - 20;
    } else if (cookHint && nearestCf) {
      text = cookHint;
      tx = (nearestCf as CampfireSchema).x; ty = (nearestCf as CampfireSchema).y - 20;
    } else if (nearestRes) {
      const def = RESOURCES[(nearestRes as ResourceSchema).kind as ResourceKind];
      const hasFishRod = (me.inventory.get("fishing_rod") ?? 0) > 0;
      if ((nearestRes as ResourceSchema).kind === "fish_spot" && !hasFishRod) {
        text = "[E] Fish (need fishing rod) — gets water only";
      } else {
        text = `[E] Gather ${def.label}`;
      }
      tx = (nearestRes as ResourceSchema).x; ty = (nearestRes as ResourceSchema).y - 16;
    }

    if (demolishName) {
      text += (text ? "\n" : "") + `[Z] Demolish ${demolishName} (50% refund)`;
    }

    if (text) {
      this.promptText.setText(text).setPosition(tx, ty).setVisible(true);
    } else {
      this.promptText.setVisible(false);
    }
  }
}
