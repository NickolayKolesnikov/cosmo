import { useEffect, useState, type MutableRefObject } from "react";
import type { ClientMessage_t, WorldState_t } from "@cosmos/shared";
import { Quaternion, Vector3 } from "three";

const mouseSensitivity = 0.0022;

type KeyState_t = {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  q: boolean;
  e: boolean;
};

type UsePlayerControlsArgs_t = {
  worldRef: MutableRefObject<WorldState_t>;
  keyStateRef: MutableRefObject<KeyState_t>;
  getPointerLockTarget: () => HTMLElement | null;
  sendMessage: (payload: ClientMessage_t) => boolean;
  ensureAudioContext: () => AudioContext | null;
  hoveredTargetIdRef: MutableRefObject<string | null>;
  isCrosshairHotRef: MutableRefObject<boolean>;
  orientationRef: MutableRefObject<Quaternion>;
  qYawRef: MutableRefObject<Quaternion>;
  qPitchRef: MutableRefObject<Quaternion>;
  localUpRef: MutableRefObject<Vector3>;
  localRightRef: MutableRefObject<Vector3>;
  syncLookRefsFromOrientation: () => void;
  sendLook: () => void;
};

export const usePlayerControls = ({
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
}: UsePlayerControlsArgs_t) => {
  const [isPointerLocked, setIsPointerLocked] = useState<boolean>(false);

  useEffect(() => {
    const onPointerLockChange = () => {
      const target = getPointerLockTarget();
      setIsPointerLocked(Boolean(target && document.pointerLockElement === target));
    };

    document.addEventListener("pointerlockchange", onPointerLockChange);
    return () => {
      document.removeEventListener("pointerlockchange", onPointerLockChange);
    };
  }, [getPointerLockTarget]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!isPointerLocked || !worldRef.current.roomId) {
        return;
      }

      const yawAngle = -event.movementX * mouseSensitivity;
      const pitchAngle = -event.movementY * mouseSensitivity;

      qYawRef.current.setFromAxisAngle(localUpRef.current, yawAngle);
      qPitchRef.current.setFromAxisAngle(localRightRef.current, pitchAngle);
      orientationRef.current.multiply(qYawRef.current).multiply(qPitchRef.current).normalize();

      syncLookRefsFromOrientation();
      sendLook();
    };

    window.addEventListener("mousemove", onMouseMove);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, [
    isPointerLocked,
    localRightRef,
    localUpRef,
    orientationRef,
    qPitchRef,
    qYawRef,
    sendLook,
    syncLookRefsFromOrientation,
    worldRef,
  ]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 && event.button !== 2) {
        return;
      }

      if (!isPointerLocked || !worldRef.current.roomId) {
        return;
      }

      ensureAudioContext();

      if (event.button === 0) {
        sendMessage({ type: "shoot" });
        return;
      }

      const targetId = hoveredTargetIdRef.current;
      if (!targetId || !isCrosshairHotRef.current) {
        return;
      }

      sendMessage({
        type: "launch_homing",
        targetId,
      });
    };

    const onContextMenu = (event: MouseEvent) => {
      if (isPointerLocked) {
        event.preventDefault();
      }
    };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, [ensureAudioContext, hoveredTargetIdRef, isCrosshairHotRef, isPointerLocked, sendMessage, worldRef]);

  useEffect(() => {
    const sendInput = () => {
      if (!worldRef.current.roomId) {
        return;
      }

      const forward = (keyStateRef.current.w ? 1 : 0) + (keyStateRef.current.s ? -1 : 0);
      const strafe = (keyStateRef.current.d ? 1 : 0) + (keyStateRef.current.a ? -1 : 0);

      sendMessage({
        type: "input",
        forward,
        strafe,
      });
    };

    const resetKeysAndStopInput = () => {
      keyStateRef.current.w = false;
      keyStateRef.current.a = false;
      keyStateRef.current.s = false;
      keyStateRef.current.d = false;
      keyStateRef.current.q = false;
      keyStateRef.current.e = false;
      sendInput();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!["w", "a", "s", "d", "q", "e"].includes(key)) {
        return;
      }

      event.preventDefault();
      keyStateRef.current[key as keyof KeyState_t] = true;
      sendInput();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!["w", "a", "s", "d", "q", "e"].includes(key)) {
        return;
      }

      event.preventDefault();
      keyStateRef.current[key as keyof KeyState_t] = false;
      sendInput();
    };

    const onWindowBlur = () => {
      resetKeysAndStopInput();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        resetKeysAndStopInput();
      }
    };

    const pulseId = window.setInterval(sendInput, 250);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(pulseId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [keyStateRef, sendMessage, worldRef]);

  return {
    isPointerLocked,
  };
};
