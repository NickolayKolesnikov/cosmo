import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  ClientMessage_t,
  PlayerId_t,
  PlayerState_t,
  Quaternion_t,
  RoomId_t,
  ServerMessage_t,
  SupplyCubeType_t,
} from "@cosmos/shared";
import { WORLD_HALF_EXTENT } from "@cosmos/shared";
import {
  createRoom,
  joinRoom,
  leaveCurrentRoom,
  type RoomManagerState_t,
  type Room_t,
} from "./roomManager.js";
import {
  buildWorldStateForPlayer,
  getForwardVector,
  spawnTransportForRoom,
  tickSimulation,
  type Explosion_t,
  type InputState_t,
  type Missile_t,
  type Projectile_t,
  type SimulationSettings_t,
  type SimulationState_t,
  type SupplyCube_t,
  type Transport_t,
} from "./simulation.js";
import { normalizeAxisInput, normalizeVector, quaternionFromEulerYXZ, randomSpawnPosition } from "./math.js";

type Client_t = {
  playerId: PlayerId_t;
  socket: WebSocket;
};

const port = 5001;
const tickRateHz = 20;
const moveSpeed = 2.8;
const worldHalfExtent = WORLD_HALF_EXTENT;
const projectileSpeed = 8.5;
const projectileLifetimeTicks = tickRateHz * 4;
const maxHealth = 100;
const transportInitialHealth = 500;
const projectileDamage = 10;
const missileDamage = 100;
const initialProjectileAmmo = 100;
const initialMissileAmmo = 5;
const missileSpeed = 5.2;
const transportSpeed = 1.45;
const transportsPerRoom = 5;
const botsPerRoom = 5;
const transportAggroRange = 360;
const transportAttackCooldownMs = 334;
const transportProjectileLifetimeTicks = tickRateHz * 3;
const botMinStandoffDistance = 45;
const botPreferredDistance = 85;
const botAttackDistance = 110;
const botMaxYawTurnPerTick = 0.11;
const botMaxPitchTurnPerTick = 0.07;
const missileLifetimeTicks = tickRateHz * 6;
const missileTurnLerp = 0.18;
const missileLeadMaxTicks = tickRateHz * 1.25;
const missileProjectileEvasionRadius = 90;
const missileProjectileEvasionStrength = 0.5;
const explosionLifetimeTicks = Math.floor(tickRateHz * 0.6);
const shootCooldownMs = 180;
const homingCooldownMs = 1200;
const hitRadius = 5;
const playerCollisionRadius = 5;
const transportCollisionRadius = 7;
const missileHitRadius = 4.2;
const supplyCubePickupRadius = 6;
const supplyCubeHitRadius = 5;
const supplyCubesPerRoom = 5;
const respawnDelayMs = 3000;
const projectileSpawnOffset = 6;
const supplyCubeTypes: SupplyCubeType_t[] = ["projectile_ammo", "missile_ammo", "health"];

const httpServer = createServer((_, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "cosmos-server" }));
});

const wss = new WebSocketServer({ server: httpServer });

const clients = new Map<PlayerId_t, Client_t>();
const players = new Map<PlayerId_t, PlayerState_t>();
const playerVelocityById = new Map<PlayerId_t, { x: number; y: number; z: number }>();
const orientationByPlayerId = new Map<PlayerId_t, Quaternion_t>();
const inputs = new Map<PlayerId_t, InputState_t>();
const rooms = new Map<RoomId_t, Room_t>();
const playerRoomById = new Map<PlayerId_t, RoomId_t | null>();
const projectiles = new Map<string, Projectile_t>();
const missiles = new Map<string, Missile_t>();
const explosions = new Map<string, Explosion_t>();
const supplyCubes = new Map<string, SupplyCube_t>();
const transports = new Map<string, Transport_t>();
const lastShotAtMsByPlayer = new Map<PlayerId_t, number>();
const lastHomingAtMsByPlayer = new Map<PlayerId_t, number>();
const lastBotShotAtMsByPlayer = new Map<PlayerId_t, number>();
const lastBotHomingAtMsByPlayer = new Map<PlayerId_t, number>();
const botPlayerIds = new Set<PlayerId_t>();
const respawnTimerByPlayer = new Map<PlayerId_t, ReturnType<typeof setTimeout>>();

const simulationState: SimulationState_t = {
  players,
  playerVelocityById,
  orientationByPlayerId,
  inputs,
  playerRoomById,
  projectiles,
  missiles,
  explosions,
  supplyCubes,
  transports,
  botPlayerIds,
  lastBotShotAtMsByPlayer,
  lastBotHomingAtMsByPlayer,
  respawnTimerByPlayer,
};

const simulationSettings: SimulationSettings_t = {
  moveSpeed,
  worldHalfExtent,
  projectileSpeed,
  maxHealth,
  transportInitialHealth,
  projectileDamage,
  missileDamage,
  missileSpeed,
  missileTurnLerp,
  missileLeadMaxTicks,
  missileProjectileEvasionRadius,
  missileProjectileEvasionStrength,
  transportSpeed,
  playerCollisionRadius,
  transportCollisionRadius,
  hitRadius,
  missileHitRadius,
  supplyCubePickupRadius,
  supplyCubeHitRadius,
  explosionLifetimeTicks,
  respawnDelayMs,
  initialProjectileAmmo,
  initialMissileAmmo,
  transportsPerRoom,
  transportAggroRange,
  transportAttackCooldownMs,
  transportProjectileLifetimeTicks,
  projectileSpawnOffset,
  projectileLifetimeTicks,
  botMinStandoffDistance,
  botPreferredDistance,
  botAttackDistance,
  botMaxYawTurnPerTick,
  botMaxPitchTurnPerTick,
  supplyCubeTypes,
};

const roomState: RoomManagerState_t = {
  rooms,
  playerRoomById,
  projectiles,
  missiles,
  explosions,
  supplyCubes,
  transports,
  players,
  inputs,
  orientationByPlayerId,
  botPlayerIds,
};

const randomSpawn = (): { x: number; y: number; z: number } => randomSpawnPosition(worldHalfExtent);

const send = (socket: WebSocket, message: ServerMessage_t): void => {
  socket.send(JSON.stringify(message));
};

const sendWorldToPlayer = (playerId: PlayerId_t): void => {
  const client = clients.get(playerId);
  if (!client) {
    return;
  }

  send(client.socket, {
    type: "world",
    state: buildWorldStateForPlayer({
      playerId,
      state: roomState,
      players,
      transportAggroRange: simulationSettings.transportAggroRange,
    }),
  });
};

const broadcastWorld = (): void => {
  for (const client of clients.values()) {
    sendWorldToPlayer(client.playerId);
  }
};


const createPlayerState = (playerId: PlayerId_t): PlayerState_t => {
  const state: PlayerState_t = {
    id: playerId,
    position: randomSpawn(),
    yaw: 0,
    pitch: 0,
    roll: 0,
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    health: maxHealth,
    projectileAmmo: initialProjectileAmmo,
    missileAmmo: initialMissileAmmo,
    isAlive: true,
    killed: 0,
    dead: 0,
    color: `hsl(${Math.floor(Math.random() * 360)} 80% 55%)`,
  };
  state.orientation = quaternionFromEulerYXZ(state.pitch, state.yaw, state.roll);
  return state;
};

const createBotPlayerState = (botId: PlayerId_t): PlayerState_t => {
  const state = createPlayerState(botId);
  state.color = "hsl(38 88% 56%)";
  return state;
};

const ensureBotForRoom = (roomId: RoomId_t): void => {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  let botsInRoom = 0;
  for (const roomPlayerId of room.playerIds) {
    if (botPlayerIds.has(roomPlayerId)) {
      botsInRoom += 1;
    }
  }

  for (let i = botsInRoom; i < botsPerRoom; i += 1) {
    const botId = `bot-${randomUUID().slice(0, 8)}`;
    const botState = createBotPlayerState(botId);
    players.set(botId, botState);
    orientationByPlayerId.set(botId, botState.orientation);
    inputs.set(botId, { forward: 0, strafe: 0 });
    playerRoomById.set(botId, null);
    botPlayerIds.add(botId);
    joinRoom(botId, roomId, roomState);
  }
};

wss.on("connection", (socket) => {
  const playerId = randomUUID();

  const playerState = createPlayerState(playerId);
  players.set(playerId, playerState);
  orientationByPlayerId.set(playerId, playerState.orientation);
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
      state.orientation = quaternionFromEulerYXZ(state.pitch, state.yaw, state.roll);
      orientationByPlayerId.set(playerId, state.orientation);
      return;
    }

    if (message.type === "shoot") {
      const roomId = playerRoomById.get(playerId);
      if (!roomId || !state.isAlive) {
        return;
      }

      if (state.projectileAmmo <= 0) {
        return;
      }

      const nowMs = Date.now();
      const lastShotAtMs = lastShotAtMsByPlayer.get(playerId) ?? 0;
      if (nowMs - lastShotAtMs < shootCooldownMs) {
        return;
      }

      const forward = getForwardVector(playerId, state, orientationByPlayerId);
      const projectileId = randomUUID().slice(0, 12);

      projectiles.set(projectileId, {
        id: projectileId,
        ownerId: playerId,
        ownerKind: "player",
        roomId,
        position: {
          x: state.position.x + forward.x * projectileSpawnOffset,
          y: state.position.y + forward.y * projectileSpawnOffset,
          z: state.position.z + forward.z * projectileSpawnOffset,
        },
        velocity: forward,
        ticksLeft: projectileLifetimeTicks,
      });

      state.projectileAmmo -= 1;
      lastShotAtMsByPlayer.set(playerId, nowMs);
      return;
    }

    if (message.type === "launch_homing") {
      const roomId = playerRoomById.get(playerId);
      if (!roomId || !state.isAlive) {
        return;
      }

      if (state.missileAmmo <= 0) {
        return;
      }

      let targetId = message.targetId;
      if (message.targetKind === "player") {
        const targetPlayer = players.get(message.targetId as PlayerId_t);
        if (
          !targetPlayer ||
          !targetPlayer.isAlive ||
          targetPlayer.id === playerId ||
          playerRoomById.get(targetPlayer.id) !== roomId
        ) {
          return;
        }

        targetId = targetPlayer.id;
      } else {
        const targetTransport = transports.get(message.targetId);
        if (!targetTransport || targetTransport.roomId !== roomId || targetTransport.health <= 0) {
          return;
        }

        targetId = targetTransport.id;
      }

      const nowMs = Date.now();
      const lastHomingAtMs = lastHomingAtMsByPlayer.get(playerId) ?? 0;
      if (nowMs - lastHomingAtMs < homingCooldownMs) {
        return;
      }

      const forward = getForwardVector(playerId, state, orientationByPlayerId);
      const missileId = randomUUID().slice(0, 12);
      missiles.set(missileId, {
        id: missileId,
        ownerId: playerId,
        targetId,
        targetKind: message.targetKind,
        roomId,
        position: {
          x: state.position.x + forward.x * projectileSpawnOffset,
          y: state.position.y + forward.y * projectileSpawnOffset,
          z: state.position.z + forward.z * projectileSpawnOffset,
        },
        velocity: normalizeVector(forward),
        ticksLeft: missileLifetimeTicks,
        lostTarget: false,
      });

      state.missileAmmo -= 1;
      lastHomingAtMsByPlayer.set(playerId, nowMs);
      return;
    }

    if (message.type === "create_room") {
      createRoom({
        creatorId: playerId,
        roomNameRaw: message.roomName,
        state: roomState,
        supplyCubesPerRoom,
        supplyCubeTypes,
        randomSpawnPosition: randomSpawn,
      });
      const createdRoomId = playerRoomById.get(playerId);
      if (createdRoomId) {
        ensureBotForRoom(createdRoomId);
        for (let i = 0; i < transportsPerRoom; i += 1) {
          spawnTransportForRoom({
            roomId: createdRoomId,
            transports,
            worldHalfExtent,
            initialHealth: transportInitialHealth,
          });
        }
      }
      broadcastWorld();
      return;
    }

    if (message.type === "join_room") {
      const ok = joinRoom(playerId, message.roomId, roomState);
      if (!ok) {
        send(socket, { type: "error", message: "Room not found" });
        sendWorldToPlayer(playerId);
        return;
      }

      ensureBotForRoom(message.roomId);

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

    leaveCurrentRoom(playerId, roomState);
    playerRoomById.delete(playerId);
    inputs.delete(playerId);
    playerVelocityById.delete(playerId);
    orientationByPlayerId.delete(playerId);
    lastShotAtMsByPlayer.delete(playerId);
    lastHomingAtMsByPlayer.delete(playerId);
    clients.delete(playerId);
    players.delete(playerId);
    if (botPlayerIds.has(playerId)) {
      botPlayerIds.delete(playerId);
      lastBotShotAtMsByPlayer.delete(playerId);
      lastBotHomingAtMsByPlayer.delete(playerId);
    }
    broadcastWorld();
  });
});

setInterval(() => {
  tickSimulation(simulationState, simulationSettings);
  broadcastWorld();
}, 1000 / tickRateHz);

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${port}`);
});
