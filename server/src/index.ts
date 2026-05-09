import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  ClientMessage_t,
  ExplosionState_t,
  MissileState_t,
  PlayerId_t,
  PlayerState_t,
  ProjectileState_t,
  Quaternion_t,
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
const maxHealth = 100;
const projectileDamage = 10;
const missileDamage = 100;
const initialProjectileAmmo = 100;
const initialMissileAmmo = 5;
const missileSpeed = 5.2;
const missileLifetimeTicks = tickRateHz * 6;
const missileTurnLerp = 0.18;
const explosionLifetimeTicks = Math.floor(tickRateHz * 0.6);
const shootCooldownMs = 180;
const homingCooldownMs = 1200;
const hitRadius = 5;
const missileHitRadius = 4.2;
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

type Missile_t = MissileState_t & {
  roomId: RoomId_t;
  ticksLeft: number;
  lostTarget: boolean;
};

const httpServer = createServer((_, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "cosmos-server" }));
});

const wss = new WebSocketServer({ server: httpServer });

const clients = new Map<PlayerId_t, Client_t>();
const players = new Map<PlayerId_t, PlayerState_t>();
const orientationByPlayerId = new Map<PlayerId_t, Quaternion_t>();
const inputs = new Map<PlayerId_t, InputState_t>();
const rooms = new Map<RoomId_t, Room_t>();
const playerRoomById = new Map<PlayerId_t, RoomId_t | null>();
const projectiles = new Map<string, Projectile_t>();
const missiles = new Map<string, Missile_t>();
const explosions = new Map<string, Explosion_t>();
const lastShotAtMsByPlayer = new Map<PlayerId_t, number>();
const lastHomingAtMsByPlayer = new Map<PlayerId_t, number>();
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
  const roomMissiles: MissileState_t[] = [];
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

    for (const missile of missiles.values()) {
      if (missile.roomId === roomId) {
        roomMissiles.push({
          id: missile.id,
          ownerId: missile.ownerId,
          targetId: missile.targetId,
          position: missile.position,
          velocity: missile.velocity,
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
    missiles: roomMissiles,
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

  for (const [missileId, missile] of missiles.entries()) {
    if (missile.ownerId === playerId || missile.targetId === playerId) {
      missiles.delete(missileId);
    }
  }

  if (room.playerIds.size === 0) {
    for (const [missileId, missile] of missiles.entries()) {
      if (missile.roomId === roomId) {
        missiles.delete(missileId);
      }
    }

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

const normalizeQuaternion = (q: Quaternion_t): Quaternion_t => {
  const length = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (length <= 0.000001) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  return {
    x: q.x / length,
    y: q.y / length,
    z: q.z / length,
    w: q.w / length,
  };
};

const quaternionFromEulerYXZ = (pitch: number, yaw: number, roll: number): Quaternion_t => {
  const c1 = Math.cos(pitch / 2);
  const c2 = Math.cos(yaw / 2);
  const c3 = Math.cos(roll / 2);
  const s1 = Math.sin(pitch / 2);
  const s2 = Math.sin(yaw / 2);
  const s3 = Math.sin(roll / 2);

  return normalizeQuaternion({
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 - s1 * s2 * c3,
    w: c1 * c2 * c3 + s1 * s2 * s3,
  });
};

const rotateVectorByQuaternion = (vector: Vec3_t, quaternion: Quaternion_t): Vec3_t => {
  const u = { x: quaternion.x, y: quaternion.y, z: quaternion.z };
  const s = quaternion.w;
  const dotUV = u.x * vector.x + u.y * vector.y + u.z * vector.z;
  const dotUU = u.x * u.x + u.y * u.y + u.z * u.z;

  const cross = {
    x: u.y * vector.z - u.z * vector.y,
    y: u.z * vector.x - u.x * vector.z,
    z: u.x * vector.y - u.y * vector.x,
  };

  return {
    x: 2 * dotUV * u.x + (s * s - dotUU) * vector.x + 2 * s * cross.x,
    y: 2 * dotUV * u.y + (s * s - dotUU) * vector.y + 2 * s * cross.y,
    z: 2 * dotUV * u.z + (s * s - dotUU) * vector.z + 2 * s * cross.z,
  };
};

const randomSpawnPosition = (): Vec3_t => {
  return {
    x: Math.floor(Math.random() * (worldHalfExtent * 2 + 1)) - worldHalfExtent,
    y: Math.floor(Math.random() * (worldHalfExtent * 2 + 1)) - worldHalfExtent,
    z: Math.floor(Math.random() * (worldHalfExtent * 2 + 1)) - worldHalfExtent,
  };
};

const getPlayerOrientation = (playerId: PlayerId_t, state: PlayerState_t): Quaternion_t => {
  if (state.orientation) {
    return state.orientation;
  }

  const orientation = orientationByPlayerId.get(playerId);
  if (orientation) {
    return orientation;
  }

  const computed = quaternionFromEulerYXZ(state.pitch, state.yaw, state.roll);
  orientationByPlayerId.set(playerId, computed);
  return computed;
};

const getForwardVector = (playerId: PlayerId_t, state: PlayerState_t): Vec3_t => {
  const orientation = getPlayerOrientation(playerId, state);
  return rotateVectorByQuaternion({ x: 0, y: 0, z: -1 }, orientation);
};

const getRightVector = (playerId: PlayerId_t, state: PlayerState_t): Vec3_t => {
  const orientation = getPlayerOrientation(playerId, state);
  return rotateVectorByQuaternion({ x: 1, y: 0, z: 0 }, orientation);
};

const vectorLength = (vector: Vec3_t): number => {
  return Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
};

const normalizeVector = (vector: Vec3_t): Vec3_t => {
  const length = vectorLength(vector);
  if (length <= 0.00001) {
    return { x: 0, y: 0, z: -1 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
};

const mixDirections = (a: Vec3_t, b: Vec3_t, lerp: number): Vec3_t => {
  const t = clamp(lerp, 0, 1);
  return {
    x: a.x * (1 - t) + b.x * t,
    y: a.y * (1 - t) + b.y * t,
    z: a.z * (1 - t) + b.z * t,
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
    state.health = maxHealth;
    state.projectileAmmo = initialProjectileAmmo;
    state.missileAmmo = initialMissileAmmo;
    state.position = randomSpawnPosition();
  }, respawnDelayMs);

  respawnTimerByPlayer.set(playerId, timer);
};

const handleProjectileHit = (projectile: Projectile_t, target: PlayerState_t): void => {
  target.health = clamp(target.health - projectileDamage, 0, maxHealth);
  if (target.health <= 0) {
    handlePlayerDestroyed(projectile.roomId, target);
  }
};

const handlePlayerDestroyed = (roomId: RoomId_t, target: PlayerState_t): void => {
  target.health = 0;
  target.isAlive = false;
  inputs.set(target.id, { forward: 0, strafe: 0 });
  spawnExplosion(roomId, target.position);
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

    const forward = getForwardVector(playerId, state);
    const right = getRightVector(playerId, state);

    state.position.x = clampAxis(state.position.x + (forward.x * input.forward + right.x * input.strafe) * moveSpeed);
    state.position.y = clampAxis(state.position.y + (forward.y * input.forward + right.y * input.strafe) * moveSpeed);
    state.position.z = clampAxis(state.position.z + (forward.z * input.forward + right.z * input.strafe) * moveSpeed);
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

  for (const [missileId, missile] of missiles.entries()) {
    missile.ticksLeft -= 1;
    if (missile.ticksLeft <= 0) {
      missiles.delete(missileId);
      continue;
    }

    const target = players.get(missile.targetId);
    let direction = normalizeVector(missile.velocity);
    if (!missile.lostTarget) {
      if (target && target.isAlive && playerRoomById.get(target.id) === missile.roomId) {
        const desiredDirection = normalizeVector({
          x: target.position.x - missile.position.x,
          y: target.position.y - missile.position.y,
          z: target.position.z - missile.position.z,
        });
        direction = normalizeVector(mixDirections(direction, desiredDirection, missileTurnLerp));
        missile.velocity = direction;
      } else {
        missile.lostTarget = true;
      }
    }

    missile.position.x += direction.x * missileSpeed;
    missile.position.y += direction.y * missileSpeed;
    missile.position.z += direction.z * missileSpeed;

    const outOfBounds =
      Math.abs(missile.position.x) > worldHalfExtent ||
      Math.abs(missile.position.y) > worldHalfExtent ||
      Math.abs(missile.position.z) > worldHalfExtent;
    if (outOfBounds) {
      missiles.delete(missileId);
      continue;
    }

    let exploded = false;
    for (const player of players.values()) {
      if (!player.isAlive) {
        continue;
      }

      if (playerRoomById.get(player.id) !== missile.roomId) {
        continue;
      }

      const dx = player.position.x - missile.position.x;
      const dy = player.position.y - missile.position.y;
      const dz = player.position.z - missile.position.z;
      if (dx * dx + dy * dy + dz * dz > missileHitRadius * missileHitRadius) {
        continue;
      }

      player.health = clamp(player.health - missileDamage, 0, maxHealth);
      if (player.health <= 0) {
        handlePlayerDestroyed(missile.roomId, player);
      }
      missiles.delete(missileId);
      exploded = true;
      break;
    }

    if (exploded) {
      continue;
    }

    for (const [projectileId, projectile] of projectiles.entries()) {
      if (projectile.roomId !== missile.roomId) {
        continue;
      }

      const dx = projectile.position.x - missile.position.x;
      const dy = projectile.position.y - missile.position.y;
      const dz = projectile.position.z - missile.position.z;
      if (dx * dx + dy * dy + dz * dz > missileHitRadius * missileHitRadius) {
        continue;
      }

      spawnExplosion(missile.roomId, missile.position);
      projectiles.delete(projectileId);
      missiles.delete(missileId);
      exploded = true;
      break;
    }

    if (exploded) {
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
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    health: maxHealth,
    projectileAmmo: initialProjectileAmmo,
    missileAmmo: initialMissileAmmo,
    isAlive: true,
    color: `hsl(${Math.floor(Math.random() * 360)} 80% 55%)`,
  };

  playerState.orientation = quaternionFromEulerYXZ(playerState.pitch, playerState.yaw, playerState.roll);
  players.set(playerId, playerState);
  orientationByPlayerId.set(playerId, quaternionFromEulerYXZ(playerState.pitch, playerState.yaw, playerState.roll));
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

      const forward = getForwardVector(playerId, state);
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

      const target = players.get(message.targetId);
      if (!target || !target.isAlive || target.id === playerId || playerRoomById.get(target.id) !== roomId) {
        return;
      }

      const nowMs = Date.now();
      const lastHomingAtMs = lastHomingAtMsByPlayer.get(playerId) ?? 0;
      if (nowMs - lastHomingAtMs < homingCooldownMs) {
        return;
      }

      const forward = getForwardVector(playerId, state);
      const missileId = randomUUID().slice(0, 12);
      missiles.set(missileId, {
        id: missileId,
        ownerId: playerId,
        targetId: target.id,
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
    orientationByPlayerId.delete(playerId);
    lastShotAtMsByPlayer.delete(playerId);
    lastHomingAtMsByPlayer.delete(playerId);
    clients.delete(playerId);
    players.delete(playerId);
    broadcastWorld();
  });
});

setInterval(() => {
  tickSimulation();
  broadcastWorld();
}, 1000 / tickRateHz);

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${port}`);
});
