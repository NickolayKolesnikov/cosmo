import { randomUUID } from "node:crypto";
import type {
  ExplosionState_t,
  MissileState_t,
  PlayerId_t,
  PlayerState_t,
  ProjectileState_t,
  Quaternion_t,
  RoomId_t,
  RoomSummary_t,
  SupplyCubeState_t,
  SupplyCubeType_t,
  Vec3_t,
  WorldState_t,
} from "@cosmos/shared";
import {
  clamp,
  mixDirections,
  normalizeVector,
  quaternionFromEulerYXZ,
  randomSpawnPosition,
  rotateVectorByQuaternion,
} from "./math.js";
import type { Room_t } from "./roomManager.js";

export type InputState_t = {
  forward: number;
  strafe: number;
};

export type Projectile_t = ProjectileState_t & {
  roomId: RoomId_t;
  ticksLeft: number;
};

export type Explosion_t = ExplosionState_t & {
  roomId: RoomId_t;
  ticksLeft: number;
  maxTicks: number;
};

export type Missile_t = MissileState_t & {
  roomId: RoomId_t;
  ticksLeft: number;
  lostTarget: boolean;
};

export type SupplyCube_t = SupplyCubeState_t & {
  roomId: RoomId_t;
};

export type SimulationState_t = {
  players: Map<PlayerId_t, PlayerState_t>;
  orientationByPlayerId: Map<PlayerId_t, Quaternion_t>;
  inputs: Map<PlayerId_t, InputState_t>;
  playerRoomById: Map<PlayerId_t, RoomId_t | null>;
  projectiles: Map<string, Projectile_t>;
  missiles: Map<string, Missile_t>;
  explosions: Map<string, Explosion_t>;
  supplyCubes: Map<string, SupplyCube_t>;
  respawnTimerByPlayer: Map<PlayerId_t, ReturnType<typeof setTimeout>>;
};

export type WorldBuildState_t = {
  rooms: Map<RoomId_t, Room_t>;
  playerRoomById: Map<PlayerId_t, RoomId_t | null>;
  projectiles: Map<string, Projectile_t>;
  missiles: Map<string, Missile_t>;
  explosions: Map<string, Explosion_t>;
  supplyCubes: Map<string, SupplyCube_t>;
};

export type SimulationSettings_t = {
  moveSpeed: number;
  worldHalfExtent: number;
  projectileSpeed: number;
  maxHealth: number;
  projectileDamage: number;
  missileDamage: number;
  missileSpeed: number;
  missileTurnLerp: number;
  hitRadius: number;
  missileHitRadius: number;
  supplyCubePickupRadius: number;
  supplyCubeHitRadius: number;
  explosionLifetimeTicks: number;
  respawnDelayMs: number;
  initialProjectileAmmo: number;
  initialMissileAmmo: number;
};

export const getRoomSummaries = (rooms: Map<RoomId_t, Room_t>): RoomSummary_t[] => {
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

export const buildWorldStateForPlayer = (args: {
  playerId: PlayerId_t;
  state: WorldBuildState_t;
  players: Map<PlayerId_t, PlayerState_t>;
}): WorldState_t => {
  const roomId = args.state.playerRoomById.get(args.playerId) ?? null;
  const room = roomId ? args.state.rooms.get(roomId) ?? null : null;
  const roomPlayerIds = room ? [...room.playerIds] : [];
  const roomPlayers: PlayerState_t[] = roomPlayerIds
    .map((id) => args.players.get(id))
    .filter((playerState): playerState is PlayerState_t => Boolean(playerState));
  const roomProjectiles: ProjectileState_t[] = [];
  const roomMissiles: MissileState_t[] = [];
  const roomExplosions: ExplosionState_t[] = [];
  const roomSupplyCubes: SupplyCube_t[] = [];

  if (roomId) {
    for (const projectile of args.state.projectiles.values()) {
      if (projectile.roomId === roomId) {
        roomProjectiles.push({
          id: projectile.id,
          ownerId: projectile.ownerId,
          position: projectile.position,
          velocity: projectile.velocity,
        });
      }
    }

    for (const missile of args.state.missiles.values()) {
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

    for (const explosion of args.state.explosions.values()) {
      if (explosion.roomId === roomId) {
        roomExplosions.push({
          id: explosion.id,
          position: explosion.position,
          life: explosion.life,
        });
      }
    }

    for (const supplyCube of args.state.supplyCubes.values()) {
      if (supplyCube.roomId === roomId) {
        roomSupplyCubes.push({
          id: supplyCube.id,
          position: supplyCube.position,
          cubeType: supplyCube.cubeType,
          roomId: supplyCube.roomId,
        });
      }
    }
  }

  return {
    roomId,
    roomName: room?.name ?? null,
    roomPlayerIds,
    availableRooms: getRoomSummaries(args.state.rooms),
    players: roomPlayers,
    projectiles: roomProjectiles,
    missiles: roomMissiles,
    explosions: roomExplosions,
    supplyCubes: roomSupplyCubes,
    serverTimeMs: Date.now(),
  };
};

export const spawnSupplyCubesForRoom = (args: {
  roomId: RoomId_t;
  supplyCubes: Map<string, SupplyCube_t>;
  supplyCubesPerRoom: number;
  supplyCubeTypes: SupplyCubeType_t[];
  randomSpawnPosition: () => { x: number; y: number; z: number };
}): void => {
  for (let i = 0; i < args.supplyCubesPerRoom; i += 1) {
    const id = randomUUID().slice(0, 12);
    args.supplyCubes.set(id, {
      id,
      roomId: args.roomId,
      position: args.randomSpawnPosition(),
      cubeType: args.supplyCubeTypes[i % args.supplyCubeTypes.length] ?? "projectile_ammo",
    });
  }
};


export const getPlayerOrientation = (
  playerId: PlayerId_t,
  state: PlayerState_t,
  orientationByPlayerId: Map<PlayerId_t, Quaternion_t>
): Quaternion_t => {
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

export const getForwardVector = (
  playerId: PlayerId_t,
  state: PlayerState_t,
  orientationByPlayerId: Map<PlayerId_t, Quaternion_t>
): Vec3_t => {
  const orientation = getPlayerOrientation(playerId, state, orientationByPlayerId);
  return rotateVectorByQuaternion({ x: 0, y: 0, z: -1 }, orientation);
};

export const getRightVector = (
  playerId: PlayerId_t,
  state: PlayerState_t,
  orientationByPlayerId: Map<PlayerId_t, Quaternion_t>
): Vec3_t => {
  const orientation = getPlayerOrientation(playerId, state, orientationByPlayerId);
  return rotateVectorByQuaternion({ x: 1, y: 0, z: 0 }, orientation);
};


const spawnExplosion = (roomId: RoomId_t, position: Vec3_t, state: SimulationState_t, settings: SimulationSettings_t): void => {
  const id = randomUUID().slice(0, 12);
  state.explosions.set(id, {
    id,
    roomId,
    position: { ...position },
    life: 1,
    ticksLeft: settings.explosionLifetimeTicks,
    maxTicks: settings.explosionLifetimeTicks,
  });
};

const scheduleRespawn = (playerId: PlayerId_t, state: SimulationState_t, settings: SimulationSettings_t): void => {
  const existing = state.respawnTimerByPlayer.get(playerId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    state.respawnTimerByPlayer.delete(playerId);

    const playerState = state.players.get(playerId);
    if (!playerState) {
      return;
    }

    if (!state.playerRoomById.get(playerId)) {
      return;
    }

    playerState.isAlive = true;
    playerState.health = settings.maxHealth;
    playerState.projectileAmmo = settings.initialProjectileAmmo;
    playerState.missileAmmo = settings.initialMissileAmmo;
    playerState.position = randomSpawnPosition(settings.worldHalfExtent);
  }, settings.respawnDelayMs);

  state.respawnTimerByPlayer.set(playerId, timer);
};

const handlePlayerDestroyed = (
  roomId: RoomId_t,
  target: PlayerState_t,
  state: SimulationState_t,
  settings: SimulationSettings_t
): void => {
  target.health = 0;
  target.isAlive = false;
  state.inputs.set(target.id, { forward: 0, strafe: 0 });
  spawnExplosion(roomId, target.position, state, settings);
  scheduleRespawn(target.id, state, settings);
};

const handleProjectileHit = (
  projectile: Projectile_t,
  target: PlayerState_t,
  state: SimulationState_t,
  settings: SimulationSettings_t
): void => {
  target.health = clamp(target.health - settings.projectileDamage, 0, settings.maxHealth);
  if (target.health <= 0) {
    handlePlayerDestroyed(projectile.roomId, target, state, settings);
  }
};

export const tickSimulation = (state: SimulationState_t, settings: SimulationSettings_t): void => {
  const clampAxis = (value: number): number => {
    return clamp(value, -settings.worldHalfExtent, settings.worldHalfExtent);
  };

  for (const [playerId, playerState] of state.players.entries()) {
    const roomId = state.playerRoomById.get(playerId);
    if (!roomId || !playerState.isAlive) {
      continue;
    }

    const input = state.inputs.get(playerId) ?? { forward: 0, strafe: 0 };
    if (input.forward === 0 && input.strafe === 0) {
      continue;
    }

    const forward = getForwardVector(playerId, playerState, state.orientationByPlayerId);
    const right = getRightVector(playerId, playerState, state.orientationByPlayerId);

    playerState.position.x = clampAxis(
      playerState.position.x + (forward.x * input.forward + right.x * input.strafe) * settings.moveSpeed
    );
    playerState.position.y = clampAxis(
      playerState.position.y + (forward.y * input.forward + right.y * input.strafe) * settings.moveSpeed
    );
    playerState.position.z = clampAxis(
      playerState.position.z + (forward.z * input.forward + right.z * input.strafe) * settings.moveSpeed
    );
  }

  for (const [projectileId, projectile] of state.projectiles.entries()) {
    projectile.position.x += projectile.velocity.x * settings.projectileSpeed;
    projectile.position.y += projectile.velocity.y * settings.projectileSpeed;
    projectile.position.z += projectile.velocity.z * settings.projectileSpeed;
    projectile.ticksLeft -= 1;

    const outOfBounds =
      Math.abs(projectile.position.x) > settings.worldHalfExtent ||
      Math.abs(projectile.position.y) > settings.worldHalfExtent ||
      Math.abs(projectile.position.z) > settings.worldHalfExtent;

    if (projectile.ticksLeft <= 0 || outOfBounds) {
      state.projectiles.delete(projectileId);
      continue;
    }

    let didHit = false;
    for (const player of state.players.values()) {
      if (!player.isAlive || player.id === projectile.ownerId) {
        continue;
      }

      if (state.playerRoomById.get(player.id) !== projectile.roomId) {
        continue;
      }

      const dx = player.position.x - projectile.position.x;
      const dy = player.position.y - projectile.position.y;
      const dz = player.position.z - projectile.position.z;
      if (dx * dx + dy * dy + dz * dz > settings.hitRadius * settings.hitRadius) {
        continue;
      }

      handleProjectileHit(projectile, player, state, settings);
      state.projectiles.delete(projectileId);
      didHit = true;
      break;
    }

    if (didHit) {
      continue;
    }

    for (const supplyCube of state.supplyCubes.values()) {
      if (supplyCube.roomId !== projectile.roomId) {
        continue;
      }

      const dx = supplyCube.position.x - projectile.position.x;
      const dy = supplyCube.position.y - projectile.position.y;
      const dz = supplyCube.position.z - projectile.position.z;
      if (dx * dx + dy * dy + dz * dz > settings.supplyCubeHitRadius * settings.supplyCubeHitRadius) {
        continue;
      }

      spawnExplosion(projectile.roomId, supplyCube.position, state, settings);
      supplyCube.position = randomSpawnPosition(settings.worldHalfExtent);
      state.projectiles.delete(projectileId);
      didHit = true;
      break;
    }

    if (didHit) {
      continue;
    }
  }

  for (const [missileId, missile] of state.missiles.entries()) {
    missile.ticksLeft -= 1;
    if (missile.ticksLeft <= 0) {
      state.missiles.delete(missileId);
      continue;
    }

    const target = state.players.get(missile.targetId);
    let direction = normalizeVector(missile.velocity);
    if (!missile.lostTarget) {
      if (target && target.isAlive && state.playerRoomById.get(target.id) === missile.roomId) {
        const desiredDirection = normalizeVector({
          x: target.position.x - missile.position.x,
          y: target.position.y - missile.position.y,
          z: target.position.z - missile.position.z,
        });
        direction = normalizeVector(mixDirections(direction, desiredDirection, settings.missileTurnLerp));
        missile.velocity = direction;
      } else {
        missile.lostTarget = true;
      }
    }

    missile.position.x += direction.x * settings.missileSpeed;
    missile.position.y += direction.y * settings.missileSpeed;
    missile.position.z += direction.z * settings.missileSpeed;

    const outOfBounds =
      Math.abs(missile.position.x) > settings.worldHalfExtent ||
      Math.abs(missile.position.y) > settings.worldHalfExtent ||
      Math.abs(missile.position.z) > settings.worldHalfExtent;
    if (outOfBounds) {
      state.missiles.delete(missileId);
      continue;
    }

    let exploded = false;
    for (const player of state.players.values()) {
      if (!player.isAlive) {
        continue;
      }

      if (state.playerRoomById.get(player.id) !== missile.roomId) {
        continue;
      }

      const dx = player.position.x - missile.position.x;
      const dy = player.position.y - missile.position.y;
      const dz = player.position.z - missile.position.z;
      if (dx * dx + dy * dy + dz * dz > settings.missileHitRadius * settings.missileHitRadius) {
        continue;
      }

      player.health = clamp(player.health - settings.missileDamage, 0, settings.maxHealth);
      if (player.health <= 0) {
        handlePlayerDestroyed(missile.roomId, player, state, settings);
      }
      state.missiles.delete(missileId);
      exploded = true;
      break;
    }

    if (exploded) {
      continue;
    }

    for (const [projectileId, projectile] of state.projectiles.entries()) {
      if (projectile.roomId !== missile.roomId) {
        continue;
      }

      const dx = projectile.position.x - missile.position.x;
      const dy = projectile.position.y - missile.position.y;
      const dz = projectile.position.z - missile.position.z;
      if (dx * dx + dy * dy + dz * dz > settings.missileHitRadius * settings.missileHitRadius) {
        continue;
      }

      spawnExplosion(missile.roomId, missile.position, state, settings);
      state.projectiles.delete(projectileId);
      state.missiles.delete(missileId);
      exploded = true;
      break;
    }

    if (exploded) {
      continue;
    }

    for (const supplyCube of state.supplyCubes.values()) {
      if (supplyCube.roomId !== missile.roomId) {
        continue;
      }

      const dx = supplyCube.position.x - missile.position.x;
      const dy = supplyCube.position.y - missile.position.y;
      const dz = supplyCube.position.z - missile.position.z;
      if (dx * dx + dy * dy + dz * dz > settings.supplyCubeHitRadius * settings.supplyCubeHitRadius) {
        continue;
      }

      spawnExplosion(missile.roomId, supplyCube.position, state, settings);
      supplyCube.position = randomSpawnPosition(settings.worldHalfExtent);
      state.missiles.delete(missileId);
      exploded = true;
      break;
    }

    if (exploded) {
      continue;
    }
  }

  for (const [explosionId, explosion] of state.explosions.entries()) {
    explosion.ticksLeft -= 1;
    explosion.life = clamp(explosion.ticksLeft / explosion.maxTicks, 0, 1);
    if (explosion.ticksLeft <= 0) {
      state.explosions.delete(explosionId);
    }
  }

  for (const supplyCube of state.supplyCubes.values()) {
    for (const player of state.players.values()) {
      if (!player.isAlive) {
        continue;
      }

      if (state.playerRoomById.get(player.id) !== supplyCube.roomId) {
        continue;
      }

      const dx = player.position.x - supplyCube.position.x;
      const dy = player.position.y - supplyCube.position.y;
      const dz = player.position.z - supplyCube.position.z;
      if (dx * dx + dy * dy + dz * dz > settings.supplyCubePickupRadius * settings.supplyCubePickupRadius) {
        continue;
      }

      if (supplyCube.cubeType === "health") {
        player.health = settings.maxHealth;
      } else if (supplyCube.cubeType === "projectile_ammo") {
        player.projectileAmmo = settings.initialProjectileAmmo;
      } else {
        player.missileAmmo = settings.initialMissileAmmo;
      }
      supplyCube.position = randomSpawnPosition(settings.worldHalfExtent);
      break;
    }
  }
};
