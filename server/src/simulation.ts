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
  TransportState_t,
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
import { tickBotPlayer } from "./botLogic.js";
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

export type Transport_t = TransportState_t & {
  roomId: RoomId_t;
  attackerPlayerIds: Set<PlayerId_t>;
  lastAttackShotAtMs: number;
};

export type SimulationState_t = {
  players: Map<PlayerId_t, PlayerState_t>;
  playerVelocityById: Map<PlayerId_t, Vec3_t>;
  orientationByPlayerId: Map<PlayerId_t, Quaternion_t>;
  inputs: Map<PlayerId_t, InputState_t>;
  playerRoomById: Map<PlayerId_t, RoomId_t | null>;
  projectiles: Map<string, Projectile_t>;
  missiles: Map<string, Missile_t>;
  explosions: Map<string, Explosion_t>;
  supplyCubes: Map<string, SupplyCube_t>;
  transports: Map<string, Transport_t>;
  botPlayerIds: Set<PlayerId_t>;
  lastBotShotAtMsByPlayer: Map<PlayerId_t, number>;
  respawnTimerByPlayer: Map<PlayerId_t, ReturnType<typeof setTimeout>>;
};

export type WorldBuildState_t = {
  rooms: Map<RoomId_t, Room_t>;
  playerRoomById: Map<PlayerId_t, RoomId_t | null>;
  projectiles: Map<string, Projectile_t>;
  missiles: Map<string, Missile_t>;
  explosions: Map<string, Explosion_t>;
  supplyCubes: Map<string, SupplyCube_t>;
  transports: Map<string, Transport_t>;
};

export type SimulationSettings_t = {
  moveSpeed: number;
  worldHalfExtent: number;
  projectileSpeed: number;
  maxHealth: number;
  transportInitialHealth: number;
  projectileDamage: number;
  missileDamage: number;
  missileSpeed: number;
  missileTurnLerp: number;
  transportSpeed: number;
  playerCollisionRadius: number;
  transportCollisionRadius: number;
  hitRadius: number;
  missileHitRadius: number;
  supplyCubePickupRadius: number;
  supplyCubeHitRadius: number;
  explosionLifetimeTicks: number;
  respawnDelayMs: number;
  initialProjectileAmmo: number;
  initialMissileAmmo: number;
  transportsPerRoom: number;
  transportAggroRange: number;
  transportAttackCooldownMs: number;
  transportProjectileLifetimeTicks: number;
  projectileSpawnOffset: number;
  projectileLifetimeTicks: number;
  missileLeadMaxTicks: number;
  missileProjectileEvasionRadius: number;
  missileProjectileEvasionStrength: number;
  botMinStandoffDistance: number;
  botPreferredDistance: number;
  botAttackDistance: number;
  supplyCubeTypes: SupplyCubeType_t[];
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
  transportAggroRange: number;
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
  const roomTransports: TransportState_t[] = [];

  if (roomId) {
    for (const projectile of args.state.projectiles.values()) {
      if (projectile.roomId === roomId) {
        roomProjectiles.push({
          id: projectile.id,
          ownerId: projectile.ownerId,
          ownerKind: projectile.ownerKind,
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
          targetKind: missile.targetKind,
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
          velocity: supplyCube.velocity,
          cubeType: supplyCube.cubeType,
          autoSpawn: supplyCube.autoSpawn,
          roomId: supplyCube.roomId,
        });
      }
    }

    for (const transport of args.state.transports.values()) {
      if (transport.roomId === roomId) {
        const isAggroOnPlayer = (() => {
          if (!transport.attackerPlayerIds.has(args.playerId)) {
            return false;
          }

          const player = args.players.get(args.playerId);
          if (!player || !player.isAlive || args.state.playerRoomById.get(args.playerId) !== transport.roomId) {
            return false;
          }

          const dx = player.position.x - transport.position.x;
          const dy = player.position.y - transport.position.y;
          const dz = player.position.z - transport.position.z;
          const distanceSq = dx * dx + dy * dy + dz * dz;
          return distanceSq <= args.transportAggroRange * args.transportAggroRange;
        })();

        roomTransports.push({
          id: transport.id,
          position: transport.position,
          velocity: transport.velocity,
          health: transport.health,
          isAggroOnPlayer,
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
    transports: roomTransports,
    serverTimeMs: Date.now(),
  };
};

type Damageable_t = {
  kind: "player" | "transport";
  id: string;
  roomId: RoomId_t;
  position: Vec3_t;
  health: number;
  projectileDamage: number;
  missileDamage: number;
  collisionRadius: number;
};

const createRandomTransportForRoom = (roomId: RoomId_t, worldHalfExtent: number, initialHealth: number): Transport_t => {
  const axis = Math.floor(Math.random() * 3);
  const sign = Math.random() < 0.5 ? -1 : 1;

  const start: Vec3_t = {
    x: Math.random() * worldHalfExtent * 2 - worldHalfExtent,
    y: Math.random() * worldHalfExtent * 2 - worldHalfExtent,
    z: Math.random() * worldHalfExtent * 2 - worldHalfExtent,
  };
  const target: Vec3_t = {
    x: Math.random() * worldHalfExtent * 2 - worldHalfExtent,
    y: Math.random() * worldHalfExtent * 2 - worldHalfExtent,
    z: Math.random() * worldHalfExtent * 2 - worldHalfExtent,
  };

  if (axis === 0) {
    start.x = sign * worldHalfExtent;
    target.x = -sign * worldHalfExtent;
  } else if (axis === 1) {
    start.y = sign * worldHalfExtent;
    target.y = -sign * worldHalfExtent;
  } else {
    start.z = sign * worldHalfExtent;
    target.z = -sign * worldHalfExtent;
  }

  return {
    id: randomUUID().slice(0, 12),
    roomId,
    position: start,
    velocity: normalizeVector({
      x: target.x - start.x,
      y: target.y - start.y,
      z: target.z - start.z,
    }),
    health: initialHealth,
    isAggroOnPlayer: false,
    attackerPlayerIds: new Set<PlayerId_t>(),
    lastAttackShotAtMs: 0,
  };
};

export const spawnTransportForRoom = (args: {
  roomId: RoomId_t;
  transports: Map<string, Transport_t>;
  worldHalfExtent: number;
  initialHealth: number;
}): void => {
  const transport = createRandomTransportForRoom(args.roomId, args.worldHalfExtent, args.initialHealth);
  args.transports.set(transport.id, transport);
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
      velocity: { x: 0, y: 0, z: 0 },
      cubeType: args.supplyCubeTypes[i % args.supplyCubeTypes.length] ?? "projectile_ammo",
      autoSpawn: true,
    });
  }
};

const randomInRange = (min: number, max: number): number => {
  return min + Math.random() * (max - min);
};

const getRandomSupplyCubeType = (types: SupplyCubeType_t[]): SupplyCubeType_t => {
  if (types.length === 0) {
    return "projectile_ammo";
  }

  const index = Math.floor(Math.random() * types.length);
  return types[index] ?? "projectile_ammo";
};

const spawnTransportLoot = (
  roomId: RoomId_t,
  center: Vec3_t,
  state: SimulationState_t,
  settings: SimulationSettings_t
): void => {
  const dropCount = 3 + Math.floor(Math.random() * 5);
  const minDropRadius = 6;
  const maxDropRadius = 16;
  const minScatterSpeed = 0.35;
  const maxScatterSpeed = 1.05;

  for (let i = 0; i < dropCount; i += 1) {
    const offset = {
      x: randomInRange(-1, 1),
      y: randomInRange(-1, 1),
      z: randomInRange(-1, 1),
    };
    const radius = randomInRange(minDropRadius, maxDropRadius);
    const scatterDirection = normalizeVector(offset);
    const scatterSpeed = randomInRange(minScatterSpeed, maxScatterSpeed);
    const position = {
      x: clamp(center.x + offset.x * radius, -settings.worldHalfExtent, settings.worldHalfExtent),
      y: clamp(center.y + offset.y * radius, -settings.worldHalfExtent, settings.worldHalfExtent),
      z: clamp(center.z + offset.z * radius, -settings.worldHalfExtent, settings.worldHalfExtent),
    };

    const id = randomUUID().slice(0, 12);
    state.supplyCubes.set(id, {
      id,
      roomId,
      position,
      velocity: {
        x: scatterDirection.x * scatterSpeed,
        y: scatterDirection.y * scatterSpeed,
        z: scatterDirection.z * scatterSpeed,
      },
      cubeType: getRandomSupplyCubeType(settings.supplyCubeTypes),
      autoSpawn: false,
    });
  }
};

const handleSupplyCubeConsumed = (supplyCube: SupplyCube_t, state: SimulationState_t, settings: SimulationSettings_t): void => {
  if (supplyCube.autoSpawn) {
    supplyCube.position = randomSpawnPosition(settings.worldHalfExtent);
    supplyCube.velocity = { x: 0, y: 0, z: 0 };
    return;
  }

  state.supplyCubes.delete(supplyCube.id);
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
  settings: SimulationSettings_t,
  attackerPlayerId: PlayerId_t | null = null
): void => {
  target.health = 0;
  target.isAlive = false;
  target.dead += 1;

  if (attackerPlayerId && attackerPlayerId !== target.id) {
    const attacker = state.players.get(attackerPlayerId);
    if (attacker) {
      attacker.killed += 1;
    }
  }

  state.inputs.set(target.id, { forward: 0, strafe: 0 });
  spawnExplosion(roomId, target.position, state, settings);
  scheduleRespawn(target.id, state, settings);
};

const roomHasActivePlayers = (roomId: RoomId_t, state: SimulationState_t): boolean => {
  for (const assignedRoomId of state.playerRoomById.values()) {
    if (assignedRoomId === roomId) {
      return true;
    }
  }

  return false;
};

const countTransportsInRoom = (roomId: RoomId_t, state: SimulationState_t): number => {
  let count = 0;
  for (const transport of state.transports.values()) {
    if (transport.roomId === roomId) {
      count += 1;
    }
  }

  return count;
};

const scheduleTransportRespawn = (roomId: RoomId_t, state: SimulationState_t, settings: SimulationSettings_t): void => {
  const respawnDelayMs = 1000 + Math.floor(Math.random() * 3000);
  setTimeout(() => {
    if (!roomHasActivePlayers(roomId, state)) {
      return;
    }

    const currentCount = countTransportsInRoom(roomId, state);
    if (currentCount >= settings.transportsPerRoom) {
      return;
    }

    const nextTransport = createRandomTransportForRoom(roomId, settings.worldHalfExtent, settings.transportInitialHealth);
    state.transports.set(nextTransport.id, nextTransport);
  }, respawnDelayMs);
};

const getDamageablesInRoom = (roomId: RoomId_t, state: SimulationState_t, settings: SimulationSettings_t): Damageable_t[] => {
  const damageables: Damageable_t[] = [];

  for (const player of state.players.values()) {
    if (!player.isAlive) {
      continue;
    }

    if (state.playerRoomById.get(player.id) !== roomId) {
      continue;
    }

    damageables.push({
      kind: "player",
      id: player.id,
      roomId,
      position: player.position,
      health: player.health,
      projectileDamage: settings.projectileDamage,
      missileDamage: settings.missileDamage,
      collisionRadius: settings.playerCollisionRadius,
    });
  }

  for (const transport of state.transports.values()) {
    if (transport.roomId !== roomId || transport.health <= 0) {
      continue;
    }

    damageables.push({
      kind: "transport",
      id: transport.id,
      roomId,
      position: transport.position,
      health: transport.health,
      projectileDamage: settings.projectileDamage,
      missileDamage: settings.missileDamage,
      collisionRadius: settings.transportCollisionRadius,
    });
  }

  return damageables;
};

const getCurrentDamageableHealth = (damageable: Damageable_t, state: SimulationState_t): number => {
  if (damageable.kind === "player") {
    const player = state.players.get(damageable.id as PlayerId_t);
    if (!player || !player.isAlive) {
      return 0;
    }

    return player.health;
  }

  const transport = state.transports.get(damageable.id);
  if (!transport) {
    return 0;
  }

  return transport.health;
};

const refreshTransportAttackers = (transport: Transport_t, state: SimulationState_t): void => {
  for (const attackerId of transport.attackerPlayerIds) {
    const attacker = state.players.get(attackerId);
    if (!attacker || !attacker.isAlive || state.playerRoomById.get(attackerId) !== transport.roomId) {
      transport.attackerPlayerIds.delete(attackerId);
    }
  }
};

const getTransportAttackTarget = (
  transport: Transport_t,
  state: SimulationState_t,
  settings: SimulationSettings_t
): PlayerState_t | null => {
  refreshTransportAttackers(transport, state);

  const aggroRangeSq = settings.transportAggroRange * settings.transportAggroRange;
  let nearestTarget: PlayerState_t | null = null;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;

  for (const attackerId of transport.attackerPlayerIds) {
    const attacker = state.players.get(attackerId);
    if (!attacker || !attacker.isAlive || state.playerRoomById.get(attackerId) !== transport.roomId) {
      continue;
    }

    const dx = attacker.position.x - transport.position.x;
    const dy = attacker.position.y - transport.position.y;
    const dz = attacker.position.z - transport.position.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq > aggroRangeSq || distanceSq >= nearestDistanceSq) {
      continue;
    }

    nearestDistanceSq = distanceSq;
    nearestTarget = attacker;
  }

  return nearestTarget;
};

const transportTryShootAtAttackers = (
  transport: Transport_t,
  state: SimulationState_t,
  settings: SimulationSettings_t,
  nowMs: number
): void => {
  if (nowMs - transport.lastAttackShotAtMs < settings.transportAttackCooldownMs) {
    return;
  }

  const target = getTransportAttackTarget(transport, state, settings);
  if (!target) {
    return;
  }

  const direction = normalizeVector({
    x: target.position.x - transport.position.x,
    y: target.position.y - transport.position.y,
    z: target.position.z - transport.position.z,
  });

  const projectileId = randomUUID().slice(0, 12);
  state.projectiles.set(projectileId, {
    id: projectileId,
    ownerId: transport.id,
    ownerKind: "transport",
    roomId: transport.roomId,
    position: {
      x: transport.position.x + direction.x * settings.projectileSpawnOffset,
      y: transport.position.y + direction.y * settings.projectileSpawnOffset,
      z: transport.position.z + direction.z * settings.projectileSpawnOffset,
    },
    velocity: direction,
    ticksLeft: settings.transportProjectileLifetimeTicks,
  });

  transport.lastAttackShotAtMs = nowMs;
};

const getMissileTargetState = (
  missile: Missile_t,
  state: SimulationState_t,
  settings: SimulationSettings_t
): { position: Vec3_t; velocity: Vec3_t } | null => {
  if (missile.targetKind === "player") {
    const targetPlayer = state.players.get(missile.targetId as PlayerId_t);
    if (!targetPlayer || !targetPlayer.isAlive || state.playerRoomById.get(targetPlayer.id) !== missile.roomId) {
      return null;
    }

    return {
      position: targetPlayer.position,
      velocity: state.playerVelocityById.get(targetPlayer.id) ?? { x: 0, y: 0, z: 0 },
    };
  }

  const targetTransport = state.transports.get(missile.targetId);
  if (!targetTransport || targetTransport.roomId !== missile.roomId || targetTransport.health <= 0) {
    return null;
  }

  return {
    position: targetTransport.position,
    velocity: {
      x: targetTransport.velocity.x * settings.transportSpeed,
      y: targetTransport.velocity.y * settings.transportSpeed,
      z: targetTransport.velocity.z * settings.transportSpeed,
    },
  };
};

const cross = (a: Vec3_t, b: Vec3_t): Vec3_t => {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
};

const getMissileLeadDirection = (
  missilePosition: Vec3_t,
  targetPosition: Vec3_t,
  targetVelocity: Vec3_t,
  projectileSpeed: number,
  maxLeadTicks: number
): Vec3_t => {
  const toTarget = {
    x: targetPosition.x - missilePosition.x,
    y: targetPosition.y - missilePosition.y,
    z: targetPosition.z - missilePosition.z,
  };

  const speedSq = projectileSpeed * projectileSpeed;
  const targetSpeedSq =
    targetVelocity.x * targetVelocity.x + targetVelocity.y * targetVelocity.y + targetVelocity.z * targetVelocity.z;
  const a = targetSpeedSq - speedSq;
  const b = 2 * (toTarget.x * targetVelocity.x + toTarget.y * targetVelocity.y + toTarget.z * targetVelocity.z);
  const c = toTarget.x * toTarget.x + toTarget.y * toTarget.y + toTarget.z * toTarget.z;

  let interceptTime = Number.POSITIVE_INFINITY;
  if (Math.abs(a) <= 0.000001) {
    if (Math.abs(b) > 0.000001) {
      const t = -c / b;
      if (t > 0) {
        interceptTime = t;
      }
    }
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const sqrtDiscriminant = Math.sqrt(discriminant);
      const t1 = (-b - sqrtDiscriminant) / (2 * a);
      const t2 = (-b + sqrtDiscriminant) / (2 * a);
      if (t1 > 0) {
        interceptTime = Math.min(interceptTime, t1);
      }
      if (t2 > 0) {
        interceptTime = Math.min(interceptTime, t2);
      }
    }
  }

  if (!Number.isFinite(interceptTime)) {
    return normalizeVector(toTarget);
  }

  const clampedInterceptTime = clamp(interceptTime, 0, maxLeadTicks);
  const predictedPoint = {
    x: targetPosition.x + targetVelocity.x * clampedInterceptTime,
    y: targetPosition.y + targetVelocity.y * clampedInterceptTime,
    z: targetPosition.z + targetVelocity.z * clampedInterceptTime,
  };

  return normalizeVector({
    x: predictedPoint.x - missilePosition.x,
    y: predictedPoint.y - missilePosition.y,
    z: predictedPoint.z - missilePosition.z,
  });
};

const getMissileProjectileEvasionDirection = (
  missile: Missile_t,
  missileDirection: Vec3_t,
  state: SimulationState_t,
  settings: SimulationSettings_t
): Vec3_t | null => {
  const worldUp = { x: 0, y: 1, z: 0 };
  const threatRadiusSq = settings.missileProjectileEvasionRadius * settings.missileProjectileEvasionRadius;
  let nearestThreatSq = Number.POSITIVE_INFINITY;
  let evasionDirection: Vec3_t | null = null;

  for (const projectile of state.projectiles.values()) {
    if (projectile.roomId !== missile.roomId) {
      continue;
    }

    if (projectile.ownerKind === "player" && projectile.ownerId === missile.ownerId) {
      continue;
    }

    const fromProjectileToMissile = {
      x: missile.position.x - projectile.position.x,
      y: missile.position.y - projectile.position.y,
      z: missile.position.z - projectile.position.z,
    };
    const distanceSq =
      fromProjectileToMissile.x * fromProjectileToMissile.x +
      fromProjectileToMissile.y * fromProjectileToMissile.y +
      fromProjectileToMissile.z * fromProjectileToMissile.z;
    if (distanceSq > threatRadiusSq || distanceSq >= nearestThreatSq) {
      continue;
    }

    const projectileDirection = normalizeVector(projectile.velocity);
    const towardsMissile = normalizeVector(fromProjectileToMissile);
    const approach =
      projectileDirection.x * towardsMissile.x +
      projectileDirection.y * towardsMissile.y +
      projectileDirection.z * towardsMissile.z;
    if (approach < 0.82) {
      continue;
    }

    let sideStep = cross(projectileDirection, missileDirection);
    const sideLengthSq = sideStep.x * sideStep.x + sideStep.y * sideStep.y + sideStep.z * sideStep.z;
    if (sideLengthSq <= 0.0001) {
      sideStep = cross(projectileDirection, worldUp);
    }

    evasionDirection = normalizeVector({
      x: sideStep.x * 1.2 + towardsMissile.x * 0.5,
      y: sideStep.y * 0.8 + towardsMissile.y * 0.3,
      z: sideStep.z * 1.2 + towardsMissile.z * 0.5,
    });
    nearestThreatSq = distanceSq;
  }

  return evasionDirection;
};

const applyDamageToDamageable = (
  damageable: Damageable_t,
  amount: number,
  state: SimulationState_t,
  settings: SimulationSettings_t,
  attackerPlayerId: PlayerId_t | null = null
): void => {
  const damage = Math.max(0, amount);
  if (damage <= 0) {
    return;
  }

  if (damageable.kind === "player") {
    const player = state.players.get(damageable.id as PlayerId_t);
    if (!player || !player.isAlive) {
      return;
    }

    player.health = clamp(player.health - damage, 0, settings.maxHealth);
    if (player.health <= 0) {
      handlePlayerDestroyed(damageable.roomId, player, state, settings, attackerPlayerId);
    }
    return;
  }

  const transport = state.transports.get(damageable.id);
  if (!transport) {
    return;
  }

  if (attackerPlayerId) {
    const attacker = state.players.get(attackerPlayerId);
    if (attacker && attacker.isAlive && state.playerRoomById.get(attackerPlayerId) === transport.roomId) {
      transport.attackerPlayerIds.add(attackerPlayerId);
    }
  }

  transport.health = clamp(transport.health - damage, 0, settings.transportInitialHealth);
  if (transport.health <= 0) {
    spawnExplosion(transport.roomId, transport.position, state, settings);
    spawnTransportLoot(transport.roomId, transport.position, state, settings);
    state.transports.delete(transport.id);
    scheduleTransportRespawn(transport.roomId, state, settings);
  }
};

export const tickSimulation = (state: SimulationState_t, settings: SimulationSettings_t): void => {
  const clampAxis = (value: number): number => {
    return clamp(value, -settings.worldHalfExtent, settings.worldHalfExtent);
  };

  const previousPositionByPlayerId = new Map<PlayerId_t, Vec3_t>();
  for (const [playerId, player] of state.players.entries()) {
    previousPositionByPlayerId.set(playerId, {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
    });
  }

  const nowMs = Date.now();
  for (const botId of state.botPlayerIds.values()) {
    const botState = state.players.get(botId);
    const roomId = state.playerRoomById.get(botId);
    if (!botState || !roomId || !botState.isAlive) {
      continue;
    }

    tickBotPlayer(botId, botState, roomId, state, settings, nowMs);
  }

  for (const [playerId, playerState] of state.players.entries()) {
    if (state.botPlayerIds.has(playerId)) {
      continue;
    }

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
    const projectileDamageables = getDamageablesInRoom(projectile.roomId, state, settings);
    for (const damageable of projectileDamageables) {
      if (damageable.kind === projectile.ownerKind && damageable.id === projectile.ownerId) {
        continue;
      }

      if (getCurrentDamageableHealth(damageable, state) <= 0) {
        continue;
      }

      const dx = damageable.position.x - projectile.position.x;
      const dy = damageable.position.y - projectile.position.y;
      const dz = damageable.position.z - projectile.position.z;
      if (dx * dx + dy * dy + dz * dz > settings.hitRadius * settings.hitRadius) {
        continue;
      }

      const projectileAttackerId = projectile.ownerKind === "player" ? (projectile.ownerId as PlayerId_t) : null;
      applyDamageToDamageable(damageable, damageable.projectileDamage, state, settings, projectileAttackerId);
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
      handleSupplyCubeConsumed(supplyCube, state, settings);
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

    let direction = normalizeVector(missile.velocity);
    if (!missile.lostTarget) {
      const targetState = getMissileTargetState(missile, state, settings);
      if (targetState) {
        const desiredDirection = getMissileLeadDirection(
          missile.position,
          targetState.position,
          targetState.velocity,
          settings.missileSpeed,
          settings.missileLeadMaxTicks
        );
        direction = normalizeVector(mixDirections(direction, desiredDirection, settings.missileTurnLerp));
      } else {
        missile.lostTarget = true;
      }
    }

    const evadeDirection = getMissileProjectileEvasionDirection(missile, direction, state, settings);
    if (evadeDirection) {
      direction = normalizeVector(mixDirections(direction, evadeDirection, settings.missileProjectileEvasionStrength));
    }

    missile.velocity = direction;

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
    const missileDamageables = getDamageablesInRoom(missile.roomId, state, settings);
    for (const damageable of missileDamageables) {
      if (getCurrentDamageableHealth(damageable, state) <= 0) {
        continue;
      }

      const dx = damageable.position.x - missile.position.x;
      const dy = damageable.position.y - missile.position.y;
      const dz = damageable.position.z - missile.position.z;
      if (dx * dx + dy * dy + dz * dz > settings.missileHitRadius * settings.missileHitRadius) {
        continue;
      }

      applyDamageToDamageable(damageable, damageable.missileDamage, state, settings, missile.ownerId);
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
      handleSupplyCubeConsumed(supplyCube, state, settings);
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

  for (const [supplyCubeId, supplyCube] of state.supplyCubes.entries()) {
    if (supplyCube.autoSpawn) {
      continue;
    }

    supplyCube.position.x += supplyCube.velocity.x;
    supplyCube.position.y += supplyCube.velocity.y;
    supplyCube.position.z += supplyCube.velocity.z;

    const hitWorldEdge =
      Math.abs(supplyCube.position.x) >= settings.worldHalfExtent ||
      Math.abs(supplyCube.position.y) >= settings.worldHalfExtent ||
      Math.abs(supplyCube.position.z) >= settings.worldHalfExtent;
    if (hitWorldEdge) {
      state.supplyCubes.delete(supplyCubeId);
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
      handleSupplyCubeConsumed(supplyCube, state, settings);
      break;
    }
  }

  for (const [transportId, transport] of state.transports.entries()) {
    transport.position.x += transport.velocity.x * settings.transportSpeed;
    transport.position.y += transport.velocity.y * settings.transportSpeed;
    transport.position.z += transport.velocity.z * settings.transportSpeed;

    const leftWorldBounds =
      Math.abs(transport.position.x) > settings.worldHalfExtent + 15 ||
      Math.abs(transport.position.y) > settings.worldHalfExtent + 15 ||
      Math.abs(transport.position.z) > settings.worldHalfExtent + 15;
    if (!leftWorldBounds) {
      continue;
    }

    state.transports.delete(transportId);
    scheduleTransportRespawn(transport.roomId, state, settings);
  }

  for (const transport of state.transports.values()) {
    transportTryShootAtAttackers(transport, state, settings, nowMs);
  }

  const roomIds = new Set<RoomId_t>();
  for (const roomId of state.playerRoomById.values()) {
    if (roomId) {
      roomIds.add(roomId);
    }
  }
  for (const transport of state.transports.values()) {
    roomIds.add(transport.roomId);
  }

  for (const roomId of roomIds.values()) {
    const roomDamageables = getDamageablesInRoom(roomId, state, settings);
    for (let i = 0; i < roomDamageables.length; i += 1) {
      const first = roomDamageables[i];
      if (!first || getCurrentDamageableHealth(first, state) <= 0) {
        continue;
      }

      for (let j = i + 1; j < roomDamageables.length; j += 1) {
        const second = roomDamageables[j];
        if (!second || getCurrentDamageableHealth(second, state) <= 0) {
          continue;
        }

        const dx = first.position.x - second.position.x;
        const dy = first.position.y - second.position.y;
        const dz = first.position.z - second.position.z;
        const collisionDistance = first.collisionRadius + second.collisionRadius;
        if (dx * dx + dy * dy + dz * dz > collisionDistance * collisionDistance) {
          continue;
        }

        const firstHealth = getCurrentDamageableHealth(first, state);
        const secondHealth = getCurrentDamageableHealth(second, state);
        const collisionDamage = Math.min(firstHealth, secondHealth);
        if (collisionDamage <= 0) {
          continue;
        }

        applyDamageToDamageable(first, collisionDamage, state, settings);
        applyDamageToDamageable(second, collisionDamage, state, settings);
      }
    }
  }

  for (const [playerId, player] of state.players.entries()) {
    const previous = previousPositionByPlayerId.get(playerId);
    if (!previous) {
      continue;
    }

    state.playerVelocityById.set(playerId, {
      x: player.position.x - previous.x,
      y: player.position.y - previous.y,
      z: player.position.z - previous.z,
    });
  }

  for (const velocityPlayerId of state.playerVelocityById.keys()) {
    if (!state.players.has(velocityPlayerId)) {
      state.playerVelocityById.delete(velocityPlayerId);
    }
  }
};
