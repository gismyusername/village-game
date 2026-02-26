import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene";

function startGame() {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    backgroundColor: "#4a7c59",
    scene: [GameScene],
    pixelArt: true,
    antialias: false,
    roundPixels: true,
  };
  new Phaser.Game(config);
}

// ── Name screen ───────────────────────────────────────────────────────────────

const screen    = document.getElementById("name-screen")!;
const nameInput = document.getElementById("name-input") as HTMLInputElement;
const playBtn   = document.getElementById("play-btn")!;
const nameError = document.getElementById("name-error")!;

// Pre-fill saved name
const savedName = localStorage.getItem("player_name");
if (savedName) nameInput.value = savedName;
nameInput.focus();

function submit() {
  const name = nameInput.value.trim();
  if (!name) { nameError.textContent = "Please enter a name."; return; }
  localStorage.setItem("player_name", name);
  screen.style.display = "none";
  startGame();
}

playBtn.addEventListener("click", submit);
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
