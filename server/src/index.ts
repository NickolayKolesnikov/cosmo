import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  ClientMessage_t,
  PlayerId_t,
  PlayerState_t,
  RoomId_t,
  RoomSummary_t,
  ServerMessage_t,
  WorldState_t,
} from "@cosmos/shared";
import { WORLD_HALF_EXTENT } from "@cosmos/shared";

type Client_t = {
  playerId: PlayerId_t;
  socket: WebSocket;
};

type Room_t = {
  id: RoomId_t;
  name: string;
  playerIds: Set<PlayerId_t>;
};

const port = 5001;
const tickRateHz = 20;
const moveSpeed = 2.8;
const worldHalfExtent = WORLD_HALF_EXTENT;

type InputState_t = {
  forward: number;
  strafe: number;
};

const httpServer = createServer((_, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "cosmos-server" }));
});

const wss = new WebSocketServer({ server: httpServer });

const clients = new Map<PlayerId_t, Client_t>();
const players = new Map<PlayerId_t, PlayerState_t>();
const inputs = new Map<PlayerId_t, InputState_t>();
const rooms = new Map<RoomId_t, Room_t>();
const playerRoomById = new Map<PlayerId_t, RoomId_t | null>();

const send = (socket: WebSocket, message: ServerMessage_t): void => {
  socket.send(JSON.stringify(message));
};

const getRoomSummaries = (): RoomSummary_t[] => {
  const summaries: RoomSummary_t[] = [];

  for (const room of rooms.values()) {
    summaries.push({
      id: room.id,
      name: room.name,
      playerCount: room.playerIds.size,
    });
  }

  return summaries;
};

const buildWorldStateForPlayer = (playerId: PlayerId_t): WorldState_t => {
  const roomId = playerRoomById.get(playerId) ?? null;
  const room = roomId ? rooms.get(roomId) ?? null : null;
  const roomPlayerIds = room ? [...room.playerIds] : [];
  const roomPlayers: PlayerState_t[] = roomPlayerIds
    .map((id) => players.get(id))
    .filter((state): state is PlayerState_t => Boolean(state));

  return {
    roomId,
    roomName: room?.name ?? null,
    roomPlayerIds,
    availableRooms: getRoomSummaries(),
    players: roomPlayers,
    serverTimeMs: Date.now(),
  };
};

const sendWorldToPlayer = (playerId: PlayerId_t): void => {
  const client = clients.get(playerId);
  if (!client) {
    return;
  }

  send(client.socket, {
    type: "world",
    state: buildWorldStateForPlayer(playerId),
  });
};

const broadcastWorld = (): void => {
  for (const client of clients.values()) {
    sendWorldToPlayer(client.playerId);
  }
};

const leaveCurrentRoom = (playerId: PlayerId_t): void => {
  const roomId = playerRoomById.get(playerId);
  if (!roomId) {
    return;
  }

  const room = rooms.get(roomId);
  if (!room) {
    playerRoomById.set(playerId, null);
    return;
  }

  room.playerIds.delete(playerId);
  playerRoomById.set(playerId, null);

  if (room.playerIds.size === 0) {
    rooms.delete(roomId);
  }
};

const joinRoom = (playerId: PlayerId_t, roomId: RoomId_t): boolean => {
  const room = rooms.get(roomId);
  if (!room) {
    return false;
  }

  leaveCurrentRoom(playerId);
  room.playerIds.add(playerId);
  playerRoomById.set(playerId, roomId);
  return true;
};

const createRoom = (creatorId: PlayerId_t, roomNameRaw: string): RoomId_t => {
  const roomId = randomUUID().slice(0, 8);
  const cleanName = roomNameRaw.trim();
  const roomName = cleanName.length > 0 ? cleanName.slice(0, 40) : `Room ${rooms.size + 1}`;

  rooms.set(roomId, {
    id: roomId,
    name: roomName,
    playerIds: new Set<PlayerId_t>(),
  });

  joinRoom(creatorId, roomId);
  return roomId;
};

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
};

const clampAxis = (value: number): number => {
  return clamp(value, -worldHalfExtent, worldHalfExtent);
};

const normalizeAxisInput = (value: number): number => {
  return clamp(value, -1, 1);
};

const tickSimulation = (): void => {
  for (const [playerId, state] of players.entries()) {
    const roomId = playerRoomById.get(playerId);
    if (!roomId) {
      continue;
    }

    const input = inputs.get(playerId) ?? { forward: 0, strafe: 0 };
    if (input.forward === 0 && input.strafe === 0) {
      continue;
    }

    const cosPitch = Math.cos(state.pitch);
    const forwardX = -Math.sin(state.yaw) * cosPitch;
    const forwardY = Math.sin(state.pitch);
    const forwardZ = -Math.cos(state.yaw) * cosPitch;

    const baseRightX = Math.cos(state.yaw);
    const baseRightY = 0;
    const baseRightZ = -Math.sin(state.yaw);

    const baseUpX = Math.sin(state.yaw) * Math.sin(state.pitch);
    const baseUpY = Math.cos(state.pitch);
    const baseUpZ = Math.cos(state.yaw) * Math.sin(state.pitch);

    const cosRoll = Math.cos(state.roll);
    const sinRoll = Math.sin(state.roll);

    const rightX = baseRightX * cosRoll + baseUpX * sinRoll;
    const rightY = baseRightY * cosRoll + baseUpY * sinRoll;
    const rightZ = baseRightZ * cosRoll + baseUpZ * sinRoll;

    state.position.x = clampAxis(state.position.x + (forwardX * input.forward + rightX * input.strafe) * moveSpeed);
    state.position.y = clampAxis(state.position.y + (forwardY * input.forward + rightY * input.strafe) * moveSpeed);
    state.position.z = clampAxis(state.position.z + (forwardZ * input.forward + rightZ * input.strafe) * moveSpeed);
  }
};

wss.on("connection", (socket) => {
  const playerId = randomUUID();

  const playerState: PlayerState_t = {
    id: playerId,
    position: {
      x: Math.floor(Math.random() * (worldHalfExtent * 2 + 1)) - worldHalfExtent,
      y: 0,
      z: Math.floor(Math.random() * (worldHalfExtent * 2 + 1)) - worldHalfExtent,
    },
    yaw: 0,
    pitch: 0,
    roll: 0,
    color: `hsl(${Math.floor(Math.random() * 360)} 80% 55%)`,
  };

  players.set(playerId, playerState);
  clients.set(playerId, { playerId, socket });
  inputs.set(playerId, { forward: 0, strafe: 0 });
  playerRoomById.set(playerId, null);

  send(socket, { type: "welcome", playerId });
  sendWorldToPlayer(playerId);
  broadcastWorld();

  socket.on("message", (raw) => {
    let message: ClientMessage_t;

    try {
      message = JSON.parse(String(raw)) as ClientMessage_t;
    } catch {
      return;
    }

    const state = players.get(playerId);
    if (!state) {
      return;
    }

    if (message.type === "input") {
      if (!playerRoomById.get(playerId)) {
        return;
      }

      inputs.set(playerId, {
        forward: normalizeAxisInput(message.forward),
        strafe: normalizeAxisInput(message.strafe),
      });
      return;
    }

    if (message.type === "look") {
      state.yaw = message.yaw;
      state.pitch = message.pitch;
      state.roll = message.roll;
      return;
    }

    if (message.type === "create_room") {
      createRoom(playerId, message.roomName);
      broadcastWorld();
      return;
    }

    if (message.type === "join_room") {
      const ok = joinRoom(playerId, message.roomId);
      if (!ok) {
        send(socket, { type: "error", message: "Room not found" });
        sendWorldToPlayer(playerId);
        return;
      }

      broadcastWorld();
      return;
    }

    if (message.type === "ping") {
      send(socket, {
        type: "pong",
        sentAtMs: message.sentAtMs,
        serverTimeMs: Date.now(),
      });
    }
  });

  socket.on("close", () => {
    leaveCurrentRoom(playerId);
    playerRoomById.delete(playerId);
    inputs.delete(playerId);
    clients.delete(playerId);
    players.delete(playerId);
    broadcastWorld();
  });
});

setInterval(() => {
  tickSimulation();
  broadcastWorld();
}, 1000 / tickRateHz);

httpServer.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
