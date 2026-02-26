import express from "express";
import { createServer } from "http";
import { Server } from "colyseus";
import { GameRoom } from "./rooms/GameRoom";

const PORT = Number(process.env.PORT) || 2567;

const app = express();
const httpServer = createServer(app);

const gameServer = new Server({ server: httpServer });

// Register game room
gameServer.define("game_room", GameRoom);

httpServer.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
});
