import { useCallback, useEffect, useRef } from "react";
import type { ClientMessage_t, WorldState_t } from "@cosmos/shared";
import { WORLD_HALF_EXTENT } from "@cosmos/shared";
import { Quaternion, Vector3, Euler } from "three";
import { SidebarPanel } from "./components/SidebarPanel";
import { ViewportHud } from "./components/ViewportHud";
import { wsUrl } from "./config";
import { useGameAudio } from "./hooks/useGameAudio";
import { useHudData } from "./hooks/useHudData";
import { usePlayerControls } from "./hooks/usePlayerControls";
import { useRoomActions } from "./hooks/useRoomActions";
import { useServerConnection } from "./hooks/useServerConnection";
import { useThreeScene } from "./hooks/useThreeScene";
import { extractLookAnglesFromOrientation } from "./three/orientation";
import { getSupplyCubeMaterialByType } from "./three/supplyCubeMaterials";

export function App() {
  const { connection, playerId, world, latencyMs, errorText, setErrorText, sendMessage } = useServerConnection(wsUrl);
  const { roomName, setRoomName, createRoom, joinRoom } = useRoomActions({ sendMessage, setErrorText });
  const { damageFlashId, ensureAudioContext } = useGameAudio(playerId, world);

  const worldRef = useRef<WorldState_t>(world);
  const playerIdRef = useRef<string>("");
  const selfPositionRef = useRef(new Vector3(0, 0, 0));
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const rollRef = useRef(0);
  const orientationRef = useRef(new Quaternion());
  const eulerRef = useRef(new Euler(0, 0, 0, "YXZ"));
  const qYawRef = useRef(new Quaternion());
  const qPitchRef = useRef(new Quaternion());
  const localUpRef = useRef(new Vector3(0, 1, 0));
  const localRightRef = useRef(new Vector3(1, 0, 0));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const keyStateRef = useRef({ w: false, a: false, s: false, d: false, q: false, e: false });

  const sendLook = useCallback((): void => {
    sendMessage({
      type: "look",
      yaw: yawRef.current,
      pitch: pitchRef.current,
      roll: rollRef.current,
    });
  }, [sendMessage]);

  const syncLookRefsFromOrientation = useCallback((): void => {
    const look = extractLookAnglesFromOrientation(orientationRef.current, eulerRef.current);
    yawRef.current = look.yaw;
    pitchRef.current = look.pitch;
    rollRef.current = look.roll;
  }, []);

  const getPointerLockTarget = useCallback((): HTMLElement | null => {
    return threeRef.current?.renderer.domElement ?? null;
  }, []);

  const qRollRef = useRef(new Quaternion());
  const localForwardRef = useRef(new Vector3(0, 0, -1));

  const { threeRef, isCrosshairHot, isCrosshairHotRef, hoveredTargetIdRef } = useThreeScene({
    world,
    worldRef,
    playerId,
    playerIdRef,
    containerRef,
    orientationRef,
    selfPositionRef,
    localForwardRef,
    qRollRef,
    keyStateRef,
    sendLook,
    syncLookRefsFromOrientation,
    getSupplyCubeMaterialByType,
  });

  const { isPointerLocked } = usePlayerControls({
    worldRef,
    keyStateRef,
    getPointerLockTarget,
    sendMessage,
    ensureAudioContext,
    hoveredTargetIdRef,
    isCrosshairHotRef,
    orientationRef,
    qYawRef,
    qPitchRef,
    localUpRef,
    localRightRef,
    syncLookRefsFromOrientation,
    sendLook,
  });

  useEffect(() => {
    worldRef.current = world;
  }, [world]);

  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  const {
    selfHealth,
    selfMissileAmmo,
    selfProjectileAmmo,
    isSelfDestroyed,
    hasIncomingMissileLock,
    isCrosshairLockedByEnemy,
    radarContacts,
    radarResourceContacts,
    radarMissileContacts,
  } = useHudData(world, playerId);

  return (
    <main className="page">
      <SidebarPanel
        connection={connection}
        playerId={playerId}
        latencyMs={latencyMs}
        roomName={roomName}
        errorText={errorText}
        isPointerLocked={isPointerLocked}
        world={world}
        onRoomNameChange={setRoomName}
        onCreateRoom={createRoom}
        onJoinRoom={joinRoom}
      />

      <section className="arena3d" aria-label="3D world">
        <div
          className="viewport3d"
          ref={containerRef}
          onClick={() => {
            ensureAudioContext();
            const rendererElement = threeRef.current?.renderer.domElement;
            if (rendererElement) {
              rendererElement.requestPointerLock();
            }
          }}
        >
          <ViewportHud
            isCrosshairHot={isCrosshairHot}
            isSelfDestroyed={isSelfDestroyed}
            damageFlashId={damageFlashId}
            isCrosshairLockedByEnemy={isCrosshairLockedByEnemy}
            hasIncomingMissileLock={hasIncomingMissileLock}
            radarContacts={radarContacts}
            radarResourceContacts={radarResourceContacts}
            radarMissileContacts={radarMissileContacts}
            selfHealth={selfHealth}
            selfMissileAmmo={selfMissileAmmo}
            selfProjectileAmmo={selfProjectileAmmo}
          />
        </div>
      </section>
    </main>
  );
}
