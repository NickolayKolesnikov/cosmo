import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  ClientMessage_t,
  ExplosionState_t,
  PlayerId_t,
  PlayerState_t,
  ProjectileState_t,
  RoomId_t,
  RoomSummary_t,
  ServerMessage_t,
  Vec3_t,
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
const projectileSpeed = 8.5;
const projectileLifetimeTicks = tickRateHz * 4;
const explosionLifetimeTicks = Math.floor(tickRateHz * 0.6);
const shootCooldownMs = 180;
const hitRadius = 5;
const respawnDelayMs = 1400;
const projectileSpawnOffset = 6;

type InputState_t = {
  forward: number;
  strafe: number;
};

type Projectile_t = ProjectileState_t & {
  roomId: RoomId_t;
  ticksLeft: number;
};

type Explosion_t = ExplosionState_t & {
  roomId: RoomId_t;
  ticksLeft: number;
  maxTicks: number;
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
const projectiles = new Map<string, Projectile_t>();
const explosions = new Map<string, Explosion_t>();
const lastShotAtMsByPlayer = new Map<PlayerId_t, number>();
const respawnTimerByPlayer = new Map<PlayerId_t, ReturnType<typeof setTimeout>>();

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
  const roomProjectiles: ProjectileState_t[] = [];
  const roomExplosions: ExplosionState_t[] = [];

  if (roomId) {
    for (const projectile of projectiles.values()) {
      if (projectile.roomId === roomId) {
        roomProjectiles.push({
          id: projectile.id,
          ownerId: projectile.ownerId,
          position: projectile.position,
          velocity: projectile.velocity,
        });
      }
    }

    for (const explosion of explosions.values()) {
      if (explosion.roomId === roomId) {
        roomExplosions.push({
          id: explosion.id,
          position: explosion.position,
          life: explosion.life,
        });
      }
    }
  }

  return {
    roomId,
    roomName: room?.name ?? null,
    roomPlayerIds,
    availableRooms: getRoomSummaries(),
    players: roomPlayers,
    projectiles: roomProjectiles,
    explosions: roomExplosions,
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

  for (const [projectileId, projectile] of projectiles.entries()) {
    if (projectile.ownerId === playerId) {
      projectiles.delete(projectileId);
    }
  }

  if (room.playerIds.size === 0) {
    for (const [explosionId, explosion] of explosions.entries()) {
      if (explosion.roomId === roomId) {
        explosions.delete(explosionId);
      }
    }

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

const randomSpawnPosition = (): Vec3_t => {
  return {
    x: Math.floor(Math.random() * (worldHalfExtent * 2 + 1)) - worldHalfExtent,
    y: Math.floor(Math.random() * (worldHalfExtent * 2 + 1)) - worldHalfExtent,
    z: Math.floor(Math.random() * (worldHalfExtent * 2 + 1)) - worldHalfExtent,
  };
};

const getForwardVector = (state: PlayerState_t): Vec3_t => {
  const cosPitch = Math.cos(state.pitch);
  return {
    x: -Math.sin(state.yaw) * cosPitch,
    y: Math.sin(state.pitch),
    z: -Math.cos(state.yaw) * cosPitch,
  };
};

const spawnExplosion = (roomId: RoomId_t, position: Vec3_t): void => {
  const id = randomUUID().slice(0, 12);
  explosions.set(id, {
    id,
    roomId,
    position: { ...position },
    life: 1,
    ticksLeft: explosionLifetimeTicks,
    maxTicks: explosionLifetimeTicks,
  });
};

const scheduleRespawn = (playerId: PlayerId_t): void => {
  const existing = respawnTimerByPlayer.get(playerId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    respawnTimerByPlayer.delete(playerId);

    const state = players.get(playerId);
    if (!state) {
      return;
    }

    if (!playerRoomById.get(playerId)) {
      return;
    }

    state.isAlive = true;
    state.position = randomSpawnPosition();
  }, respawnDelayMs);

  respawnTimerByPlayer.set(playerId, timer);
};

const handleProjectileHit = (projectile: Projectile_t, target: PlayerState_t): void => {
  target.isAlive = false;
  inputs.set(target.id, { forward: 0, strafe: 0 });
  spawnExplosion(projectile.roomId, target.position);
  scheduleRespawn(target.id);
};

const tickSimulation = (): void => {
  for (const [playerId, state] of players.entries()) {
    const roomId = playerRoomById.get(playerId);
    if (!roomId || !state.isAlive) {
      continue;
    }

    const input = inputs.get(playerId) ?? { forward: 0, strafe: 0 };
    if (input.forward === 0 && input.strafe === 0) {
      continue;
    }

    const forward = getForwardVector(state);

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

    state.position.x = clampAxis(state.position.x + (forward.x * input.forward + rightX * input.strafe) * moveSpeed);
    state.position.y = clampAxis(state.position.y + (forward.y * input.forward + rightY * input.strafe) * moveSpeed);
    state.position.z = clampAxis(state.position.z + (forward.z * input.forward + rightZ * input.strafe) * moveSpeed);
  }

  for (const [projectileId, projectile] of projectiles.entries()) {
    projectile.position.x += projectile.velocity.x * projectileSpeed;
    projectile.position.y += projectile.velocity.y * projectileSpeed;
    projectile.position.z += projectile.velocity.z * projectileSpeed;
    projectile.ticksLeft -= 1;

    const outOfBounds =
      Math.abs(projectile.position.x) > worldHalfExtent ||
      Math.abs(projectile.position.y) > worldHalfExtent ||
      Math.abs(projectile.position.z) > worldHalfExtent;

    if (projectile.ticksLeft <= 0 || outOfBounds) {
      projectiles.delete(projectileId);
      continue;
    }

    let didHit = false;
    for (const player of players.values()) {
      if (!player.isAlive || player.id === projectile.ownerId) {
        continue;
      }

      if (playerRoomById.get(player.id) !== projectile.roomId) {
        continue;
      }

      const dx = player.position.x - projectile.position.x;
      const dy = player.position.y - projectile.position.y;
      const dz = player.position.z - projectile.position.z;
      if (dx * dx + dy * dy + dz * dz > hitRadius * hitRadius) {
        continue;
      }

      handleProjectileHit(projectile, player);
      projectiles.delete(projectileId);
      didHit = true;
      break;
    }

    if (didHit) {
      continue;
    }
  }

  for (const [explosionId, explosion] of explosions.entries()) {
    explosion.ticksLeft -= 1;
    explosion.life = clamp(explosion.ticksLeft / explosion.maxTicks, 0, 1);
    if (explosion.ticksLeft <= 0) {
      explosions.delete(explosionId);
    }
  }
};

wss.on("connection", (socket) => {
  const playerId = randomUUID();

  const playerState: PlayerState_t = {
    id: playerId,
    position: randomSpawnPosition(),
    yaw: 0,
    pitch: 0,
    roll: 0,
    isAlive: true,
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

    if (message.type === "shoot") {
      const roomId = playerRoomById.get(playerId);
      if (!roomId || !state.isAlive) {
        return;
      }

      const nowMs = Date.now();
      const lastShotAtMs = lastShotAtMsByPlayer.get(playerId) ?? 0;
      if (nowMs - lastShotAtMs < shootCooldownMs) {
        return;
      }

      const forward = getForwardVector(state);
      const projectileId = randomUUID().slice(0, 12);

      projectiles.set(projectileId, {
        id: projectileId,
        ownerId: playerId,
        roomId,
        position: {
          x: state.position.x + forward.x * projectileSpawnOffset,
          y: state.position.y + forward.y * projectileSpawnOffset,
          z: state.position.z + forward.z * projectileSpawnOffset,
        },
        velocity: forward,
        ticksLeft: projectileLifetimeTicks,
      });

      lastShotAtMsByPlayer.set(playerId, nowMs);
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
    const respawnTimer = respawnTimerByPlayer.get(playerId);
    if (respawnTimer) {
      clearTimeout(respawnTimer);
      respawnTimerByPlayer.delete(playerId);
    }

    leaveCurrentRoom(playerId);
    playerRoomById.delete(playerId);
    inputs.delete(playerId);
    lastShotAtMsByPlayer.delete(playerId);
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
