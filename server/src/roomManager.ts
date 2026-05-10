import { randomUUID } from "node:crypto";
import type {
  PlayerId_t,
  PlayerState_t,
  Quaternion_t,
  RoomId_t,
  SupplyCubeType_t,
} from "@cosmos/shared";
import {
  spawnSupplyCubesForRoom,
  type Explosion_t,
  type Missile_t,
  type Projectile_t,
  type SupplyCube_t,
  type Transport_t,
} from "./simulation.js";

export type Room_t = {
  id: RoomId_t;
  name: string;
  playerIds: Set<PlayerId_t>;
};

export type RoomManagerState_t = {
  rooms: Map<RoomId_t, Room_t>;
  playerRoomById: Map<PlayerId_t, RoomId_t | null>;
  projectiles: Map<string, Projectile_t>;
  missiles: Map<string, Missile_t>;
  explosions: Map<string, Explosion_t>;
  supplyCubes: Map<string, SupplyCube_t>;
  transports: Map<string, Transport_t>;
  players: Map<PlayerId_t, PlayerState_t>;
  inputs: Map<PlayerId_t, { forward: number; strafe: number }>;
  orientationByPlayerId: Map<PlayerId_t, Quaternion_t>;
  botPlayerIds: Set<PlayerId_t>;
};

export const leaveCurrentRoom = (playerId: PlayerId_t, state: RoomManagerState_t): void => {
  const roomId = state.playerRoomById.get(playerId);
  if (!roomId) {
    return;
  }

  const room = state.rooms.get(roomId);
  if (!room) {
    state.playerRoomById.set(playerId, null);
    return;
  }

  room.playerIds.delete(playerId);
  state.playerRoomById.set(playerId, null);

  for (const [projectileId, projectile] of state.projectiles.entries()) {
    if (projectile.ownerKind === "player" && projectile.ownerId === playerId) {
      state.projectiles.delete(projectileId);
    }
  }

  for (const [missileId, missile] of state.missiles.entries()) {
    if (missile.ownerId === playerId || missile.targetId === playerId) {
      state.missiles.delete(missileId);
    }
  }

  const hasHumanPlayers = [...room.playerIds].some((id) => !state.botPlayerIds.has(id));
  if (!hasHumanPlayers) {
    for (const [missileId, missile] of state.missiles.entries()) {
      if (missile.roomId === roomId) {
        state.missiles.delete(missileId);
      }
    }

    for (const [explosionId, explosion] of state.explosions.entries()) {
      if (explosion.roomId === roomId) {
        state.explosions.delete(explosionId);
      }
    }

    for (const [supplyCubeId, supplyCube] of state.supplyCubes.entries()) {
      if (supplyCube.roomId === roomId) {
        state.supplyCubes.delete(supplyCubeId);
      }
    }

    for (const [transportId, transport] of state.transports.entries()) {
      if (transport.roomId === roomId) {
        state.transports.delete(transportId);
      }
    }

    for (const roomPlayerId of room.playerIds) {
      if (!state.botPlayerIds.has(roomPlayerId)) {
        continue;
      }

      state.playerRoomById.set(roomPlayerId, null);
      state.players.delete(roomPlayerId);
      state.inputs.delete(roomPlayerId);
      state.orientationByPlayerId.delete(roomPlayerId);
      state.botPlayerIds.delete(roomPlayerId);
    }

    state.rooms.delete(roomId);
  }
};

export const joinRoom = (playerId: PlayerId_t, roomId: RoomId_t, state: RoomManagerState_t): boolean => {
  const room = state.rooms.get(roomId);
  if (!room) {
    return false;
  }

  leaveCurrentRoom(playerId, state);
  room.playerIds.add(playerId);
  state.playerRoomById.set(playerId, roomId);
  return true;
};

export const createRoom = (args: {
  creatorId: PlayerId_t;
  roomNameRaw: string;
  state: RoomManagerState_t;
  supplyCubesPerRoom: number;
  supplyCubeTypes: SupplyCubeType_t[];
  randomSpawnPosition: () => { x: number; y: number; z: number };
}): RoomId_t => {
  const roomId = randomUUID().slice(0, 8);
  const cleanName = args.roomNameRaw.trim();
  const roomName = cleanName.length > 0 ? cleanName.slice(0, 40) : `Room ${args.state.rooms.size + 1}`;

  args.state.rooms.set(roomId, {
    id: roomId,
    name: roomName,
    playerIds: new Set<PlayerId_t>(),
  });

  spawnSupplyCubesForRoom({
    roomId,
    supplyCubes: args.state.supplyCubes,
    supplyCubesPerRoom: args.supplyCubesPerRoom,
    supplyCubeTypes: args.supplyCubeTypes,
    randomSpawnPosition: args.randomSpawnPosition,
  });

  joinRoom(args.creatorId, roomId, args.state);
  return roomId;
};
