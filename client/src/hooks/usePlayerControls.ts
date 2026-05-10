import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ClientMessage_t, MissileTarget_t, WorldState_t } from "@cosmos/shared";
import { Quaternion, Vector3 } from "three";

const mouseSensitivity = 0.0022;
const arrowLookStep = 0.04;

type KeyState_t = {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  q: boolean;
  e: boolean;
};

const codeToKeyStateField: Partial<Record<string, keyof KeyState_t>> = {
  KeyW: "w",
  KeyA: "a",
  KeyS: "s",
  KeyD: "d",
  KeyQ: "q",
  KeyE: "e",
};

type LookKeyState_t = {
  arrowUp: boolean;
  arrowDown: boolean;
  arrowLeft: boolean;
  arrowRight: boolean;
};

const codeToLookKeyStateField: Partial<Record<string, keyof LookKeyState_t>> = {
  ArrowUp: "arrowUp",
  ArrowDown: "arrowDown",
  ArrowLeft: "arrowLeft",
  ArrowRight: "arrowRight",
};

type UsePlayerControlsArgs_t = {
  worldRef: MutableRefObject<WorldState_t>;
  keyStateRef: MutableRefObject<KeyState_t>;
  getPointerLockTarget: () => HTMLElement | null;
  sendMessage: (payload: ClientMessage_t) => boolean;
  ensureAudioContext: () => AudioContext | null;
  hoveredTargetRef: MutableRefObject<MissileTarget_t | null>;
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
  hoveredTargetRef,
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
  const lookKeyStateRef = useRef<LookKeyState_t>({
    arrowUp: false,
    arrowDown: false,
    arrowLeft: false,
    arrowRight: false,
  });

  const tryLaunchHomingMissile = (): void => {
    if (!worldRef.current.roomId) {
      return;
    }

    const target = hoveredTargetRef.current;
    if (!target || !isCrosshairHotRef.current) {
      return;
    }

    sendMessage({
      type: "launch_homing",
      targetId: target.targetId,
      targetKind: target.targetKind,
    });
  };

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
    const tickArrowLook = () => {
      if (!isPointerLocked || !worldRef.current.roomId) {
        return;
      }

      const yawAngle =
        (lookKeyStateRef.current.arrowLeft ? arrowLookStep : 0) +
        (lookKeyStateRef.current.arrowRight ? -arrowLookStep : 0);
      const pitchAngle =
        (lookKeyStateRef.current.arrowUp ? arrowLookStep : 0) +
        (lookKeyStateRef.current.arrowDown ? -arrowLookStep : 0);
      if (yawAngle === 0 && pitchAngle === 0) {
        return;
      }

      qYawRef.current.setFromAxisAngle(localUpRef.current, yawAngle);
      qPitchRef.current.setFromAxisAngle(localRightRef.current, pitchAngle);
      orientationRef.current.multiply(qYawRef.current).multiply(qPitchRef.current).normalize();

      syncLookRefsFromOrientation();
      sendLook();
    };

    const lookTickId = window.setInterval(tickArrowLook, 16);
    return () => {
      window.clearInterval(lookTickId);
    };
  }, [isPointerLocked, localRightRef, localUpRef, orientationRef, qPitchRef, qYawRef, sendLook, syncLookRefsFromOrientation, worldRef]);

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

      tryLaunchHomingMissile();
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
  }, [ensureAudioContext, isPointerLocked, sendMessage, worldRef]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) {
        return false;
      }

      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return true;
      }

      return target instanceof HTMLElement && target.isContentEditable;
    };

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
      lookKeyStateRef.current.arrowUp = false;
      lookKeyStateRef.current.arrowDown = false;
      lookKeyStateRef.current.arrowLeft = false;
      lookKeyStateRef.current.arrowRight = false;
      sendInput();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPointerLocked) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) {
          ensureAudioContext();
          sendMessage({ type: "shoot" });
        }
        return;
      }

      if (event.code === "KeyR") {
        event.preventDefault();
        if (!event.repeat) {
          ensureAudioContext();
          tryLaunchHomingMissile();
        }
        return;
      }

      const mappedKey = codeToKeyStateField[event.code];
      if (mappedKey) {
        event.preventDefault();
        keyStateRef.current[mappedKey] = true;
        sendInput();
        return;
      }

      const mappedLookKey = codeToLookKeyStateField[event.code];
      if (!mappedLookKey) {
        return;
      }

      event.preventDefault();
      lookKeyStateRef.current[mappedLookKey] = true;
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!isPointerLocked) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.code === "Space" || event.code === "KeyR") {
        event.preventDefault();
        return;
      }

      const mappedKey = codeToKeyStateField[event.code];
      if (mappedKey) {
        event.preventDefault();
        keyStateRef.current[mappedKey] = false;
        sendInput();
        return;
      }

      const mappedLookKey = codeToLookKeyStateField[event.code];
      if (!mappedLookKey) {
        return;
      }

      event.preventDefault();
      lookKeyStateRef.current[mappedLookKey] = false;
    };

    const onWindowBlur = () => {
      resetKeysAndStopInput();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        resetKeysAndStopInput();
      }
    };

    if (!isPointerLocked) {
      resetKeysAndStopInput();
    }

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
  }, [ensureAudioContext, isPointerLocked, keyStateRef, sendMessage, worldRef]);

  return {
    isPointerLocked,
  };
};
