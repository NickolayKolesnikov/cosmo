import { RadarOverlay, type RadarContact_t, type RadarMissileContact_t, type RadarResourceContact_t } from "./RadarOverlay";

type ViewportHudProps_t = {
  isCrosshairHot: boolean;
  isSelfDestroyed: boolean;
  damageFlashId: number;
  isCrosshairLockedByEnemy: boolean;
  hasIncomingMissileLock: boolean;
  radarContacts: RadarContact_t[];
  radarResourceContacts: RadarResourceContact_t[];
  radarMissileContacts: RadarMissileContact_t[];
  selfHealth: number;
  selfMissileAmmo: number;
  selfProjectileAmmo: number;
};

export const ViewportHud = ({
  isCrosshairHot,
  isSelfDestroyed,
  damageFlashId,
  isCrosshairLockedByEnemy,
  hasIncomingMissileLock,
  radarContacts,
  radarResourceContacts,
  radarMissileContacts,
  selfHealth,
  selfMissileAmmo,
  selfProjectileAmmo,
}: ViewportHudProps_t) => {
  return (
    <>
      <div className={`crosshair ${isCrosshairHot ? "hot" : ""}`} aria-hidden="true" />
      {isSelfDestroyed ? <div className="death-overlay" aria-hidden="true" /> : null}
      {damageFlashId > 0 ? <div key={damageFlashId} className="damage-flash-overlay" aria-hidden="true" /> : null}
      <div className="lock-indicators" aria-live="polite">
        {isCrosshairLockedByEnemy ? <div className="lock-indicator lock-indicator-aim">AIM LOCK</div> : null}
        {hasIncomingMissileLock ? <div className="lock-indicator lock-indicator-missile">MISSILE LOCK</div> : null}
      </div>
      <RadarOverlay
        radarResourceContacts={radarResourceContacts}
        radarMissileContacts={radarMissileContacts}
        radarContacts={radarContacts}
      />
      <div className="hud-stats" aria-hidden="true">
        <div className="hud-stat-line">HP {Math.round(selfHealth)}</div>
        <div className="hud-stat-line">Rockets {selfMissileAmmo}</div>
        <div className="hud-stat-line">Shells {selfProjectileAmmo}</div>
      </div>
    </>
  );
};
