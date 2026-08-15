import { EMPLOYEES, colorFor } from "./org";

export type TeamUser = {
  id: string;
  name: string;
  role: string;
  studio: string;
  initials: string;
  color: string;
};

const PRIORITY_IDS = [
  "zahur-physique57mumbai-com",
  "saachi-physique57india-com",
  "jimmeey-physique57india-com",
  "shifa-physique57bengaluru-com",
  "imran-physique57mumbai-com",
  "vahishta-physique57mumbai-com",
  "mrigakshi-physique57mumbai-com",
  "sachin-physique57mumbai-com",
  "reyna-physique57india-com",
  "mitali-physique57india-com",
];

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Internal team members who file tickets, ordered with the most likely first. */
export const TEAM_USERS: TeamUser[] = [...EMPLOYEES]
  .sort((a, b) => {
    const ai = PRIORITY_IDS.indexOf(a.id);
    const bi = PRIORITY_IDS.indexOf(b.id);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.name.localeCompare(b.name);
  })
  .map((e) => ({
    id: e.id,
    name: e.name,
    role: e.role,
    studio: e.location.replace("Physique 57, ", ""),
    initials: initials(e.name),
    color: colorFor(e.id),
  }));

export const DEFAULT_USER = TEAM_USERS[0];
