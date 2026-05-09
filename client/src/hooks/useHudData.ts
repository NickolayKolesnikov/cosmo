import { useMemo } from "react";
import { WORLD_HALF_EXTENT } from "@cosmos/shared";
import type { WorldState_t } from "@cosmos/shared";
import { Quaternion, Vector3 } from "three";
import type {
  RadarContact_t,
  RadarMissileContact_t,
  RadarResourceContact_t,
  RadarTransportContact_t,
} from "../components/RadarOverlay";

const radarRange = WORLD_HALF_EXTENT * 1.35;
const radarMaxAltitudePx = 26;

export const useHudData = (world: WorldState_t, playerId: string) => {
  return useMemo(() => {
    const selfPlayer = world.players.find((player) => player.id === playerId);
    const selfHealth = selfPlayer?.health ?? 100;
    const selfMissileAmmo = selfPlayer?.missileAmmo ?? 5;
    const selfProjectileAmmo = selfPlayer?.projectileAmmo ?? 100;
    const isSelfDestroyed = Boolean(selfPlayer && !selfPlayer.isAlive);
    const hasIncomingMissileLock = Boolean(
      selfPlayer &&
        world.missiles.some((missile) => missile.targetKind === "player" && missile.targetId === selfPlayer.id)
    );
    const hasTransportLock = Boolean(
      selfPlayer && selfPlayer.isAlive && world.transports.some((transport) => transport.isAggroOnPlayer)
    );

    const isCrosshairLockedByEnemy = (() => {
      if (!selfPlayer || !selfPlayer.isAlive) {
        return false;
      }

      const selfPosition = new Vector3(selfPlayer.position.x, selfPlayer.position.y, selfPlayer.position.z);
      const forwardBasis = new Vector3(0, 0, -1);
      for (const enemy of world.players) {
        if (enemy.id === selfPlayer.id || !enemy.isAlive) {
          continue;
        }

        const enemyToSelf = new Vector3(
          selfPosition.x - enemy.position.x,
          selfPosition.y - enemy.position.y,
          selfPosition.z - enemy.position.z
        );
        const distanceSq = enemyToSelf.lengthSq();
        if (distanceSq <= 0.0001) {
          continue;
        }

        const enemyForward = new Vector3(forwardBasis.x, forwardBasis.y, forwardBasis.z)
          .applyQuaternion(new Quaternion(enemy.orientation.x, enemy.orientation.y, enemy.orientation.z, enemy.orientation.w))
          .normalize();
        enemyToSelf.normalize();

        const alignment = enemyForward.dot(enemyToSelf);
        if (alignment >= 0.992) {
          return true;
        }
      }

      return false;
    })();

    const radarContacts: RadarContact_t[] = [];
    const radarResourceContacts: RadarResourceContact_t[] = [];
    const radarMissileContacts: RadarMissileContact_t[] = [];
    const radarTransportContacts: RadarTransportContact_t[] = [];

    if (selfPlayer) {
      const selfQuaternion = new Quaternion(
        selfPlayer.orientation.x,
        selfPlayer.orientation.y,
        selfPlayer.orientation.z,
        selfPlayer.orientation.w
      );
      const rightAxis = new Vector3(1, 0, 0).applyQuaternion(selfQuaternion).normalize();
      const forwardAxis = new Vector3(0, 0, -1).applyQuaternion(selfQuaternion).normalize();
      const planeNormal = new Vector3().crossVectors(rightAxis, forwardAxis).normalize();
      const projectToRadar = (delta: Vector3): { xPx: number; yPx: number } => {
        const lateralX = delta.dot(rightAxis);
        const lateralY = delta.dot(forwardAxis);
        const planarDistance = Math.sqrt(lateralX * lateralX + lateralY * lateralY);
        const normalizedPlanar = planarDistance > 0 ? Math.min(1, planarDistance / radarRange) : 0;
        const planarScale = planarDistance > 0 ? normalizedPlanar / planarDistance : 0;

        return {
          xPx: lateralX * planarScale * 64,
          yPx: lateralY * planarScale * 64,
        };
      };

      for (const player of world.players) {
        if (player.id === selfPlayer.id || !player.isAlive) {
          continue;
        }

        const toEnemy = new Vector3(
          player.position.x - selfPlayer.position.x,
          player.position.y - selfPlayer.position.y,
          player.position.z - selfPlayer.position.z
        );

        const projected = projectToRadar(toEnemy);
        const altitude = toEnemy.dot(planeNormal);
        const altitudePx = Math.min(radarMaxAltitudePx, Math.abs(altitude) * (radarMaxAltitudePx / radarRange));

        radarContacts.push({
          id: player.id,
          xPx: projected.xPx,
          yPx: projected.yPx,
          altitudePx,
          isAbove: altitude > 0,
        });
      }

      for (const supplyCube of world.supplyCubes) {
        const toResource = new Vector3(
          supplyCube.position.x - selfPlayer.position.x,
          supplyCube.position.y - selfPlayer.position.y,
          supplyCube.position.z - selfPlayer.position.z
        );
        const projected = projectToRadar(toResource);
        const altitude = toResource.dot(planeNormal);
        const altitudePx = Math.min(radarMaxAltitudePx, Math.abs(altitude) * (radarMaxAltitudePx / radarRange));

        radarResourceContacts.push({
          id: supplyCube.id,
          xPx: projected.xPx,
          yPx: projected.yPx,
          cubeType: supplyCube.cubeType,
          altitudePx,
          isAbove: altitude > 0,
        });
      }

      for (const missile of world.missiles) {
        const toMissile = new Vector3(
          missile.position.x - selfPlayer.position.x,
          missile.position.y - selfPlayer.position.y,
          missile.position.z - selfPlayer.position.z
        );
        const projected = projectToRadar(toMissile);
        const altitude = toMissile.dot(planeNormal);
        const altitudePx = Math.min(radarMaxAltitudePx, Math.abs(altitude) * (radarMaxAltitudePx / radarRange));

        radarMissileContacts.push({
          id: missile.id,
          xPx: projected.xPx,
          yPx: projected.yPx,
          altitudePx,
          isAbove: altitude > 0,
        });
      }

      for (const transport of world.transports) {
        const toTransport = new Vector3(
          transport.position.x - selfPlayer.position.x,
          transport.position.y - selfPlayer.position.y,
          transport.position.z - selfPlayer.position.z
        );
        const projected = projectToRadar(toTransport);
        const altitude = toTransport.dot(planeNormal);
        const altitudePx = Math.min(radarMaxAltitudePx, Math.abs(altitude) * (radarMaxAltitudePx / radarRange));

        radarTransportContacts.push({
          id: transport.id,
          xPx: projected.xPx,
          yPx: projected.yPx,
          altitudePx,
          isAbove: altitude > 0,
        });
      }
    }

    return {
      selfHealth,
      selfMissileAmmo,
      selfProjectileAmmo,
      isSelfDestroyed,
      hasIncomingMissileLock,
      hasTransportLock,
      isCrosshairLockedByEnemy,
      radarContacts,
      radarResourceContacts,
      radarMissileContacts,
      radarTransportContacts,
    };
  }, [playerId, world]);
};
