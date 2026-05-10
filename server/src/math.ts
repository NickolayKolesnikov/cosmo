import type { PlayerState_t, Quaternion_t, Vec3_t } from "@cosmos/shared";

export const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
};

export const normalizeAxisInput = (value: number): number => {
  return clamp(value, -1, 1);
};

export const normalizeQuaternion = (q: Quaternion_t): Quaternion_t => {
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

export const quaternionFromEulerYXZ = (pitch: number, yaw: number, roll: number): Quaternion_t => {
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

export const rotateVectorByQuaternion = (vector: Vec3_t, quaternion: Quaternion_t): Vec3_t => {
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

export const randomSpawnPosition = (worldHalfExtent: number): Vec3_t => {
  return {
    x: Math.floor(Math.random() * (worldHalfExtent * 2 + 1)) - worldHalfExtent,
    y: Math.floor(Math.random() * (worldHalfExtent * 2 + 1)) - worldHalfExtent,
    z: Math.floor(Math.random() * (worldHalfExtent * 2 + 1)) - worldHalfExtent,
  };
};

export const vectorLength = (vector: Vec3_t): number => {
  return Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
};

export const normalizeVector = (vector: Vec3_t): Vec3_t => {
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

export const mixDirections = (a: Vec3_t, b: Vec3_t, lerp: number): Vec3_t => {
  const t = clamp(lerp, 0, 1);
  return {
    x: a.x * (1 - t) + b.x * t,
    y: a.y * (1 - t) + b.y * t,
    z: a.z * (1 - t) + b.z * t,
  };
};

export const movePlayerToward = (
  player: PlayerState_t,
  direction: Vec3_t,
  moveSpeed: number,
  worldHalfExtent: number
): void => {
  const normalized = normalizeVector(direction);
  player.position.x = clamp(player.position.x + normalized.x * moveSpeed, -worldHalfExtent, worldHalfExtent);
  player.position.y = clamp(player.position.y + normalized.y * moveSpeed, -worldHalfExtent, worldHalfExtent);
  player.position.z = clamp(player.position.z + normalized.z * moveSpeed, -worldHalfExtent, worldHalfExtent);
};
