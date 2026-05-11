import { randomUUID } from "node:crypto";
import type { PlayerId_t, PlayerState_t, RoomId_t, SupplyCubeType_t, Vec3_t } from "@cosmos/shared";
import { clamp, movePlayerToward, normalizeVector, quaternionFromEulerYXZ, rotateVectorByQuaternion } from "./math.js";
import type { SimulationSettings_t, SimulationState_t, SupplyCube_t } from "./simulation.js";

type BotDeficit_t = "health" | "projectile_ammo" | "missile_ammo";
type CombatTarget_t = {
  kind: "player" | "transport";
  id: string;
  position: Vec3_t;
  velocity: Vec3_t;
};

const normalizeAngle = (angle: number): number => {
  const fullTurn = Math.PI * 2;
  const wrapped = (angle + Math.PI) % fullTurn;
  const positiveWrapped = wrapped < 0 ? wrapped + fullTurn : wrapped;
  return positiveWrapped - Math.PI;
};

const approachAngle = (current: number, target: number, maxDelta: number): number => {
  const delta = normalizeAngle(target - current);
  return current + clamp(delta, -maxDelta, maxDelta);
};

const getBotDeficitType = (player: PlayerState_t, settings: SimulationSettings_t): BotDeficit_t | null => {
  const healthRatio = player.health / settings.maxHealth;
  const projectileRatio = player.projectileAmmo / settings.initialProjectileAmmo;
  const missileRatio = player.missileAmmo / settings.initialMissileAmmo;
  const deficits: Array<{ type: BotDeficit_t; ratio: number }> = [];

  if (healthRatio < 0.5) {
    deficits.push({ type: "health", ratio: healthRatio });
  }
  if (projectileRatio < 0.5) {
    deficits.push({ type: "projectile_ammo", ratio: projectileRatio });
  }
  if (missileRatio < 0.5) {
    deficits.push({ type: "missile_ammo", ratio: missileRatio });
  }

  if (deficits.length === 0) {
    return null;
  }

  deficits.sort((a, b) => a.ratio - b.ratio);
  return deficits[0]?.type ?? null;
};

const getNearestSupplyCube = (
  roomId: RoomId_t,
  origin: Vec3_t,
  state: SimulationState_t,
  preferredType: SupplyCubeType_t
): SupplyCube_t | null => {
  let nearestPreferred: SupplyCube_t | null = null;
  let nearestPreferredDistanceSq = Number.POSITIVE_INFINITY;
  let nearestAny: SupplyCube_t | null = null;
  let nearestAnyDistanceSq = Number.POSITIVE_INFINITY;

  for (const cube of state.supplyCubes.values()) {
    if (cube.roomId !== roomId) {
      continue;
    }

    const dx = cube.position.x - origin.x;
    const dy = cube.position.y - origin.y;
    const dz = cube.position.z - origin.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;

    if (distanceSq < nearestAnyDistanceSq) {
      nearestAnyDistanceSq = distanceSq;
      nearestAny = cube;
    }

    if (cube.cubeType === preferredType && distanceSq < nearestPreferredDistanceSq) {
      nearestPreferredDistanceSq = distanceSq;
      nearestPreferred = cube;
    }
  }

  return nearestPreferred ?? nearestAny;
};

const getNearestCombatTarget = (
  botId: PlayerId_t,
  roomId: RoomId_t,
  origin: Vec3_t,
  state: SimulationState_t,
  settings: SimulationSettings_t
): CombatTarget_t | null => {
  let nearest: CombatTarget_t | null = null;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;

  for (const enemy of state.players.values()) {
    if (!enemy.isAlive || enemy.id === botId) {
      continue;
    }

    if (state.playerRoomById.get(enemy.id) !== roomId) {
      continue;
    }

    const dx = enemy.position.x - origin.x;
    const dy = enemy.position.y - origin.y;
    const dz = enemy.position.z - origin.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq >= nearestDistanceSq) {
      continue;
    }

    nearestDistanceSq = distanceSq;
    nearest = {
      kind: "player",
      id: enemy.id,
      position: enemy.position,
      velocity: state.playerVelocityById.get(enemy.id) ?? { x: 0, y: 0, z: 0 },
    };
  }

  for (const transport of state.transports.values()) {
    if (transport.roomId !== roomId || transport.health <= 0) {
      continue;
    }

    const dx = transport.position.x - origin.x;
    const dy = transport.position.y - origin.y;
    const dz = transport.position.z - origin.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq >= nearestDistanceSq) {
      continue;
    }

    nearestDistanceSq = distanceSq;
    nearest = {
      kind: "transport",
      id: transport.id,
      position: transport.position,
      velocity: {
        x: transport.velocity.x * settings.transportSpeed,
        y: transport.velocity.y * settings.transportSpeed,
        z: transport.velocity.z * settings.transportSpeed,
      },
    };
  }

  return nearest;
};

const setPlayerFacingDirection = (
  playerId: PlayerId_t,
  player: PlayerState_t,
  direction: Vec3_t,
  state: SimulationState_t,
  settings: SimulationSettings_t
): void => {
  const normalized = normalizeVector(direction);
  if (normalized.x === 0 && normalized.y === 0 && normalized.z === 0) {
    return;
  }

  const targetYaw = Math.atan2(-normalized.x, -normalized.z);
  const targetPitch = Math.asin(clamp(normalized.y, -1, 1));
  player.yaw = approachAngle(player.yaw, targetYaw, settings.botMaxYawTurnPerTick);
  player.pitch = clamp(
    approachAngle(player.pitch, targetPitch, settings.botMaxPitchTurnPerTick),
    -Math.PI / 2,
    Math.PI / 2
  );
  player.roll = 0;
  player.orientation = quaternionFromEulerYXZ(player.pitch, player.yaw, player.roll);
  state.orientationByPlayerId.set(playerId, player.orientation);
};

const cross = (a: Vec3_t, b: Vec3_t): Vec3_t => {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
};

const dot = (a: Vec3_t, b: Vec3_t): number => {
  return a.x * b.x + a.y * b.y + a.z * b.z;
};

const moveBotNoBackward = (
  bot: PlayerState_t,
  desiredDirection: Vec3_t,
  settings: SimulationSettings_t
): void => {
  const forward = normalizeVector(rotateVectorByQuaternion({ x: 0, y: 0, z: -1 }, bot.orientation));
  const right = normalizeVector(rotateVectorByQuaternion({ x: 1, y: 0, z: 0 }, bot.orientation));
  const desired = normalizeVector(desiredDirection);
  const strafeFactor = clamp(dot(right, desired), -1, 1);

  // Keep forward input at 1.0 always, matching player forward-thrust behavior.
  bot.position.x = clamp(
    bot.position.x + (forward.x + right.x * strafeFactor) * settings.moveSpeed,
    -settings.worldHalfExtent,
    settings.worldHalfExtent
  );
  bot.position.y = clamp(
    bot.position.y + (forward.y + right.y * strafeFactor) * settings.moveSpeed,
    -settings.worldHalfExtent,
    settings.worldHalfExtent
  );
  bot.position.z = clamp(
    bot.position.z + (forward.z + right.z * strafeFactor) * settings.moveSpeed,
    -settings.worldHalfExtent,
    settings.worldHalfExtent
  );
};

const getMissileEvasionDirection = (
  botId: PlayerId_t,
  roomId: RoomId_t,
  bot: PlayerState_t,
  state: SimulationState_t
): Vec3_t | null => {
  let nearestMissileDistanceSq = Number.POSITIVE_INFINITY;
  let bestDirection: Vec3_t | null = null;
  const worldUp = { x: 0, y: 1, z: 0 };

  for (const missile of state.missiles.values()) {
    if (missile.roomId !== roomId || missile.ownerId === botId) {
      continue;
    }

    if (missile.targetKind !== "player" || missile.targetId !== botId) {
      continue;
    }

    const fromMissileToBot = {
      x: bot.position.x - missile.position.x,
      y: bot.position.y - missile.position.y,
      z: bot.position.z - missile.position.z,
    };
    const distanceSq =
      fromMissileToBot.x * fromMissileToBot.x + fromMissileToBot.y * fromMissileToBot.y + fromMissileToBot.z * fromMissileToBot.z;
    if (distanceSq >= nearestMissileDistanceSq) {
      continue;
    }

    const missileDirection = normalizeVector(missile.velocity);
    let sideStep = cross(missileDirection, worldUp);
    const sideLengthSq = sideStep.x * sideStep.x + sideStep.y * sideStep.y + sideStep.z * sideStep.z;
    if (sideLengthSq <= 0.0001) {
      sideStep = cross(missileDirection, { x: 1, y: 0, z: 0 });
    }

    bestDirection = normalizeVector({
      x: fromMissileToBot.x * 0.9 + sideStep.x * 1.1,
      y: fromMissileToBot.y * 0.9 + sideStep.y * 0.6,
      z: fromMissileToBot.z * 0.9 + sideStep.z * 1.1,
    });
    nearestMissileDistanceSq = distanceSq;
  }

  return bestDirection;
};

const getProjectileEvasionDirection = (
  botId: PlayerId_t,
  roomId: RoomId_t,
  bot: PlayerState_t,
  state: SimulationState_t
): Vec3_t | null => {
  let nearestThreatDistanceSq = Number.POSITIVE_INFINITY;
  let bestDirection: Vec3_t | null = null;
  const projectileThreatRadiusSq = 220 * 220;
  const approachThreshold = 0.82;
  const worldUp = { x: 0, y: 1, z: 0 };

  for (const projectile of state.projectiles.values()) {
    if (projectile.roomId !== roomId || projectile.ownerId === botId) {
      continue;
    }

    const fromProjectileToBot = {
      x: bot.position.x - projectile.position.x,
      y: bot.position.y - projectile.position.y,
      z: bot.position.z - projectile.position.z,
    };
    const distanceSq =
      fromProjectileToBot.x * fromProjectileToBot.x +
      fromProjectileToBot.y * fromProjectileToBot.y +
      fromProjectileToBot.z * fromProjectileToBot.z;
    if (distanceSq > projectileThreatRadiusSq || distanceSq >= nearestThreatDistanceSq) {
      continue;
    }

    const projectileDirection = normalizeVector(projectile.velocity);
    const towardsBot = normalizeVector(fromProjectileToBot);
    const approach =
      projectileDirection.x * towardsBot.x + projectileDirection.y * towardsBot.y + projectileDirection.z * towardsBot.z;
    if (approach < approachThreshold) {
      continue;
    }

    let sideStep = cross(projectileDirection, towardsBot);
    const sideLengthSq = sideStep.x * sideStep.x + sideStep.y * sideStep.y + sideStep.z * sideStep.z;
    if (sideLengthSq <= 0.0001) {
      sideStep = cross(projectileDirection, worldUp);
    }

    bestDirection = normalizeVector({
      x: sideStep.x * 1.2 + towardsBot.x * 0.6,
      y: sideStep.y * 0.7 + towardsBot.y * 0.4,
      z: sideStep.z * 1.2 + towardsBot.z * 0.6,
    });
    nearestThreatDistanceSq = distanceSq;
  }

  return bestDirection;
};

const tryBotEvasion = (
  botId: PlayerId_t,
  bot: PlayerState_t,
  roomId: RoomId_t,
  state: SimulationState_t,
  settings: SimulationSettings_t,
  target: CombatTarget_t | null,
  nowMs: number
): boolean => {
  const evadeDirection =
    getMissileEvasionDirection(botId, roomId, bot, state) ?? getProjectileEvasionDirection(botId, roomId, bot, state);
  if (!evadeDirection) {
    return false;
  }

  if (target) {
    const toEnemy = {
      x: target.position.x - bot.position.x,
      y: target.position.y - bot.position.y,
      z: target.position.z - bot.position.z,
    };
    const distanceSq = toEnemy.x * toEnemy.x + toEnemy.y * toEnemy.y + toEnemy.z * toEnemy.z;
    if (distanceSq > 0.0001) {
      const leadDirection = getInterceptDirection(bot.position, target.position, target.velocity, settings.projectileSpeed);

      const attackDistance = settings.botAttackDistance;
      const attackDistanceSq = attackDistance * attackDistance;

      setPlayerFacingDirection(botId, bot, evadeDirection, state, settings);
      moveBotNoBackward(bot, evadeDirection, settings);
      setPlayerFacingDirection(botId, bot, leadDirection, state, settings);
      if (distanceSq <= attackDistanceSq) {
        botTryShootProjectile(botId, roomId, bot, state, settings, nowMs);
      }
      return true;
    }
  }

  setPlayerFacingDirection(botId, bot, evadeDirection, state, settings);
  moveBotNoBackward(bot, evadeDirection, settings);
  return true;
};

const getInterceptDirection = (
  shooterPosition: Vec3_t,
  targetPosition: Vec3_t,
  targetVelocity: Vec3_t,
  projectileSpeed: number
): Vec3_t => {
  const toTarget = {
    x: targetPosition.x - shooterPosition.x,
    y: targetPosition.y - shooterPosition.y,
    z: targetPosition.z - shooterPosition.z,
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

  const predictedPoint = {
    x: targetPosition.x + targetVelocity.x * interceptTime,
    y: targetPosition.y + targetVelocity.y * interceptTime,
    z: targetPosition.z + targetVelocity.z * interceptTime,
  };

  return normalizeVector({
    x: predictedPoint.x - shooterPosition.x,
    y: predictedPoint.y - shooterPosition.y,
    z: predictedPoint.z - shooterPosition.z,
  });
};

const botTryShootProjectile = (
  botId: PlayerId_t,
  roomId: RoomId_t,
  bot: PlayerState_t,
  state: SimulationState_t,
  settings: SimulationSettings_t,
  nowMs: number
): void => {
  if (bot.projectileAmmo <= 0) {
    return;
  }

  const cooldownMs = 334;
  const lastShotAtMs = state.lastBotShotAtMsByPlayer.get(botId) ?? 0;
  if (nowMs - lastShotAtMs < cooldownMs) {
    return;
  }

  const forward = rotateVectorByQuaternion({ x: 0, y: 0, z: -1 }, bot.orientation);
  const normalized = normalizeVector(forward);
  const projectileId = randomUUID().slice(0, 12);
  state.projectiles.set(projectileId, {
    id: projectileId,
    ownerId: botId,
    ownerKind: "player",
    roomId,
    position: {
      x: bot.position.x + normalized.x * settings.projectileSpawnOffset,
      y: bot.position.y + normalized.y * settings.projectileSpawnOffset,
      z: bot.position.z + normalized.z * settings.projectileSpawnOffset,
    },
    velocity: normalized,
    ticksLeft: settings.projectileLifetimeTicks,
  });

  bot.projectileAmmo -= 1;
  state.lastBotShotAtMsByPlayer.set(botId, nowMs);
};

const botTryLaunchMissile = (
  botId: PlayerId_t,
  roomId: RoomId_t,
  bot: PlayerState_t,
  target: CombatTarget_t,
  state: SimulationState_t,
  settings: SimulationSettings_t,
  nowMs: number
): void => {
  if (bot.missileAmmo <= 0) {
    return;
  }

  const cooldownMs = 1200;
  const lastHomingAtMs = state.lastBotHomingAtMsByPlayer.get(botId) ?? 0;
  if (nowMs - lastHomingAtMs < cooldownMs) {
    return;
  }

  const forward = rotateVectorByQuaternion({ x: 0, y: 0, z: -1 }, bot.orientation);
  const normalized = normalizeVector(forward);
  const missileId = randomUUID().slice(0, 12);
  state.missiles.set(missileId, {
    id: missileId,
    ownerId: botId,
    targetId: target.id,
    targetKind: target.kind,
    roomId,
    position: {
      x: bot.position.x + normalized.x * settings.projectileSpawnOffset,
      y: bot.position.y + normalized.y * settings.projectileSpawnOffset,
      z: bot.position.z + normalized.z * settings.projectileSpawnOffset,
    },
    velocity: normalized,
    ticksLeft: settings.projectileLifetimeTicks,
    lostTarget: false,
  });

  bot.missileAmmo -= 1;
  state.lastBotHomingAtMsByPlayer.set(botId, nowMs);
};

export const tickBotPlayer = (
  botId: PlayerId_t,
  bot: PlayerState_t,
  roomId: RoomId_t,
  state: SimulationState_t,
  settings: SimulationSettings_t,
  nowMs: number
): void => {
  const enemy = getNearestCombatTarget(botId, roomId, bot.position, state, settings);

  if (tryBotEvasion(botId, bot, roomId, state, settings, enemy, nowMs)) {
    return;
  }

  const deficitType = getBotDeficitType(bot, settings);
  if (deficitType) {
    const targetCube = getNearestSupplyCube(roomId, bot.position, state, deficitType);
    if (!targetCube) {
      return;
    }

    const toCube = {
      x: targetCube.position.x - bot.position.x,
      y: targetCube.position.y - bot.position.y,
      z: targetCube.position.z - bot.position.z,
    };
    setPlayerFacingDirection(botId, bot, toCube, state, settings);
    moveBotNoBackward(bot, toCube, settings);
    return;
  }

  if (!enemy) {
    return;
  }

  const toEnemy = {
    x: enemy.position.x - bot.position.x,
    y: enemy.position.y - bot.position.y,
    z: enemy.position.z - bot.position.z,
  };
  const enemyVelocity = enemy.velocity;
  const leadDirection = getInterceptDirection(bot.position, enemy.position, enemyVelocity, settings.projectileSpeed);
  const distanceSq = toEnemy.x * toEnemy.x + toEnemy.y * toEnemy.y + toEnemy.z * toEnemy.z;
  if (distanceSq <= 0.0001) {
    return;
  }

  const minStandoffDistance = settings.botMinStandoffDistance;
  const preferredDistance = settings.botPreferredDistance;
  const attackDistance = settings.botAttackDistance;
  const minStandoffSq = minStandoffDistance * minStandoffDistance;
  const preferredDistanceSq = preferredDistance * preferredDistance;
  const attackDistanceSq = attackDistance * attackDistance;

  if (distanceSq < minStandoffSq) {
    const awayFromEnemy = { x: -toEnemy.x, y: -toEnemy.y, z: -toEnemy.z };
    setPlayerFacingDirection(botId, bot, awayFromEnemy, state, settings);
    moveBotNoBackward(bot, awayFromEnemy, settings);
  } else if (distanceSq > preferredDistanceSq) {
    setPlayerFacingDirection(botId, bot, toEnemy, state, settings);
    moveBotNoBackward(bot, toEnemy, settings);
  } else {
    setPlayerFacingDirection(botId, bot, toEnemy, state, settings);
  }

  setPlayerFacingDirection(botId, bot, leadDirection, state, settings);

  if (distanceSq <= attackDistanceSq) {
    botTryShootProjectile(botId, roomId, bot, state, settings, nowMs);
    botTryLaunchMissile(botId, roomId, bot, enemy, state, settings, nowMs);
  }
};
