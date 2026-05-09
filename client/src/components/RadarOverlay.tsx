import type { SupplyCubeType_t } from "@cosmos/shared";

const radarRadiusPx = 64;
const radarHeightEpsilon = 2;

export type RadarContact_t = {
  id: string;
  xPx: number;
  yPx: number;
  altitudePx: number;
  isAbove: boolean;
};

export type RadarResourceContact_t = {
  id: string;
  xPx: number;
  yPx: number;
  cubeType: SupplyCubeType_t;
  altitudePx: number;
  isAbove: boolean;
};

export type RadarMissileContact_t = {
  id: string;
  xPx: number;
  yPx: number;
  altitudePx: number;
  isAbove: boolean;
};

const getRadarResourceClassName = (cubeType: SupplyCubeType_t): string => {
  if (cubeType === "projectile_ammo") {
    return "radar-resource-projectile";
  }

  if (cubeType === "missile_ammo") {
    return "radar-resource-missile";
  }

  return "radar-resource-health";
};

type RadarOverlayProps_t = {
  radarResourceContacts: RadarResourceContact_t[];
  radarMissileContacts: RadarMissileContact_t[];
  radarContacts: RadarContact_t[];
};

export const RadarOverlay = ({ radarResourceContacts, radarMissileContacts, radarContacts }: RadarOverlayProps_t) => {
  return (
    <div className="radar" aria-hidden="true">
      <div className="radar-forward-marker" />
      <div className="radar-ring radar-ring-inner" />
      <div className="radar-ring radar-ring-outer" />
      <div className="radar-axis radar-axis-x" />
      <div className="radar-axis radar-axis-y" />
      <div className="radar-center-dot" />
      {radarResourceContacts.map((resource) => {
        return (
          <div
            key={resource.id}
            className="radar-resource-contact"
            style={{
              left: `${radarRadiusPx + resource.xPx}px`,
              top: `${radarRadiusPx - resource.yPx}px`,
            }}
          >
            <div className={`radar-resource ${getRadarResourceClassName(resource.cubeType)}`} />
            {resource.altitudePx >= radarHeightEpsilon ? (
              <div
                className={`radar-resource-altitude ${
                  resource.isAbove ? "radar-resource-altitude-up" : "radar-resource-altitude-down"
                } ${getRadarResourceClassName(resource.cubeType)}`}
                style={{ height: `${resource.altitudePx}px` }}
              />
            ) : null}
          </div>
        );
      })}
      {radarMissileContacts.map((missile) => {
        return (
          <div
            key={missile.id}
            className="radar-missile-contact"
            style={{
              left: `${radarRadiusPx + missile.xPx}px`,
              top: `${radarRadiusPx - missile.yPx}px`,
            }}
          >
            <div className="radar-missile-dot" />
            {missile.altitudePx >= radarHeightEpsilon ? (
              <div
                className={`radar-missile-altitude ${
                  missile.isAbove ? "radar-missile-altitude-up" : "radar-missile-altitude-down"
                }`}
                style={{ height: `${missile.altitudePx}px` }}
              />
            ) : null}
          </div>
        );
      })}
      {radarContacts.map((contact) => {
        return (
          <div
            key={contact.id}
            className="radar-contact"
            style={{
              left: `${radarRadiusPx + contact.xPx}px`,
              top: `${radarRadiusPx - contact.yPx}px`,
            }}
          >
            <div className="radar-contact-dot" />
            {contact.altitudePx >= radarHeightEpsilon ? (
              <div
                className={`radar-altitude ${contact.isAbove ? "radar-altitude-up" : "radar-altitude-down"}`}
                style={{ height: `${contact.altitudePx}px` }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
