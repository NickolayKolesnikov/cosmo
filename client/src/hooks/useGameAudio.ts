import { useEffect, useRef, useState } from "react";
import type { WorldState_t } from "@cosmos/shared";

type SoundEffect_t =
  | "projectile_shot"
  | "missile_launch"
  | "projectile_hit"
  | "missile_hit"
  | "resource_pickup"
  | "damage_taken";

type SelfStatsSnapshot_t = {
  health: number;
  projectileAmmo: number;
  missileAmmo: number;
  isAlive: boolean;
};

export const useGameAudio = (playerId: string, world: WorldState_t) => {
  const [damageFlashId, setDamageFlashId] = useState<number>(0);

  const lastSelfHealthRef = useRef<number | null>(null);
  const previousWorldRef = useRef<WorldState_t | null>(null);
  const previousSelfStatsRef = useRef<SelfStatsSnapshot_t | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const ensureAudioContext = (): AudioContext | null => {
    const existing = audioContextRef.current;
    if (existing) {
      if (existing.state === "suspended") {
        void existing.resume();
      }
      return existing;
    }

    const audioCtor =
      window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!audioCtor) {
      return null;
    }

    const context = new audioCtor();
    audioContextRef.current = context;
    return context;
  };

  const playTone = (
    context: AudioContext,
    options: {
      frequencyStart: number;
      frequencyEnd: number;
      gainStart: number;
      gainEnd: number;
      durationSec: number;
      type: OscillatorType;
      startDelaySec?: number;
    }
  ): void => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startDelay = options.startDelaySec ?? 0;
    const startTime = context.currentTime + startDelay;
    const endTime = startTime + options.durationSec;

    oscillator.type = options.type;
    oscillator.frequency.setValueAtTime(options.frequencyStart, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.frequencyEnd), endTime);

    gain.gain.setValueAtTime(options.gainStart, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, options.gainEnd), endTime);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startTime);
    oscillator.stop(endTime + 0.02);
  };

  const playSoundEffect = (effect: SoundEffect_t): void => {
    const context = ensureAudioContext();
    if (!context) {
      return;
    }

    if (effect === "projectile_shot") {
      playTone(context, {
        frequencyStart: 620,
        frequencyEnd: 420,
        gainStart: 0.07,
        gainEnd: 0.0001,
        durationSec: 0.09,
        type: "square",
      });
      return;
    }

    if (effect === "missile_launch") {
      playTone(context, {
        frequencyStart: 190,
        frequencyEnd: 85,
        gainStart: 0.1,
        gainEnd: 0.0001,
        durationSec: 0.24,
        type: "sawtooth",
      });
      return;
    }

    if (effect === "projectile_hit") {
      playTone(context, {
        frequencyStart: 320,
        frequencyEnd: 140,
        gainStart: 0.08,
        gainEnd: 0.0001,
        durationSec: 0.12,
        type: "triangle",
      });
      return;
    }

    if (effect === "damage_taken") {
      playTone(context, {
        frequencyStart: 240,
        frequencyEnd: 95,
        gainStart: 0.1,
        gainEnd: 0.0001,
        durationSec: 0.16,
        type: "triangle",
      });
      return;
    }

    if (effect === "missile_hit") {
      playTone(context, {
        frequencyStart: 140,
        frequencyEnd: 52,
        gainStart: 0.12,
        gainEnd: 0.0001,
        durationSec: 0.3,
        type: "sawtooth",
      });
      return;
    }

    playTone(context, {
      frequencyStart: 460,
      frequencyEnd: 620,
      gainStart: 0.07,
      gainEnd: 0.0001,
      durationSec: 0.09,
      type: "sine",
    });
    playTone(context, {
      frequencyStart: 620,
      frequencyEnd: 780,
      gainStart: 0.05,
      gainEnd: 0.0001,
      durationSec: 0.09,
      type: "sine",
      startDelaySec: 0.09,
    });
  };

  useEffect(() => {
    const self = world.players.find((player) => player.id === playerId);
    if (!self) {
      lastSelfHealthRef.current = null;
      return;
    }

    const previousHealth = lastSelfHealthRef.current;
    if (previousHealth !== null && self.health < previousHealth) {
      setDamageFlashId((value) => value + 1);
      playSoundEffect("damage_taken");
    }

    lastSelfHealthRef.current = self.health;
  }, [playerId, world]);

  useEffect(() => {
    const self = world.players.find((player) => player.id === playerId);
    const previousSelf = previousSelfStatsRef.current;
    const previousWorld = previousWorldRef.current;

    if (self && previousSelf) {
      if (self.projectileAmmo < previousSelf.projectileAmmo) {
        playSoundEffect("projectile_shot");
      }

      if (self.missileAmmo < previousSelf.missileAmmo) {
        playSoundEffect("missile_launch");
      }

      const resourceIncreased =
        self.health > previousSelf.health ||
        self.projectileAmmo > previousSelf.projectileAmmo ||
        self.missileAmmo > previousSelf.missileAmmo;
      if (resourceIncreased && self.isAlive && previousSelf.isAlive) {
        playSoundEffect("resource_pickup");
      }
    }

    if (previousWorld && world.roomId && previousWorld.roomId === world.roomId) {
      const explosionIncreased = world.explosions.length > previousWorld.explosions.length;
      if (explosionIncreased && world.missiles.length < previousWorld.missiles.length) {
        playSoundEffect("missile_hit");
      } else if (explosionIncreased && world.projectiles.length < previousWorld.projectiles.length) {
        playSoundEffect("projectile_hit");
      }
    }

    previousSelfStatsRef.current = self
      ? {
          health: self.health,
          projectileAmmo: self.projectileAmmo,
          missileAmmo: self.missileAmmo,
          isAlive: self.isAlive,
        }
      : null;
    previousWorldRef.current = world;
  }, [playerId, world]);

  useEffect(() => {
    return () => {
      const context = audioContextRef.current;
      if (context) {
        void context.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  return {
    damageFlashId,
    ensureAudioContext,
  };
};
