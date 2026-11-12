/**
 * team.ts — Team definitions and management.
 * Two opposing teams: Sandline Vanguard (attackers) and Desert Lock (defenders).
 */

export type TeamId = "attackers" | "defenders";

export interface TeamDefinition {
  id: TeamId;
  name: string;
  short: string;
  color: number;
}

export const TEAM_DEFINITIONS: Record<TeamId, TeamDefinition> = {
  attackers: {
    id: "attackers",
    name: "Sandline Vanguard",
    short: "VANG",
    color: 0x173f3d,
  },
  defenders: {
    id: "defenders",
    name: "Desert Lock",
    short: "LOCK",
    color: 0x5c4a3a,
  },
} as const;

export function teamColor(team: TeamId): number {
  return TEAM_DEFINITIONS[team].color;
}

export function teamName(team: TeamId): string {
  return TEAM_DEFINITIONS[team].name;
}

export function oppositeTeam(team: TeamId): TeamId {
  return team === "attackers" ? "defenders" : "attackers";
}

export interface TeamStats {
  kills: number;
  deaths: number;
  alive: number;
  score: number;
}

export class TeamManager {
  private attackerAlive = 0;
  private defenderAlive = 0;
  private attackerStats: TeamStats = { kills: 0, deaths: 0, alive: 0, score: 0 };
  private defenderStats: TeamStats = { kills: 0, deaths: 0, alive: 0, score: 0 };

  setAlive(team: TeamId, count: number): void {
    if (team === "attackers") this.attackerAlive = count;
    else this.defenderAlive = count;
  }

  getAlive(team: TeamId): number {
    return team === "attackers" ? this.attackerAlive : this.defenderAlive;
  }

  getStats(team: TeamId): TeamStats {
    return team === "attackers" ? this.attackerStats : this.defenderStats;
  }

  recordKill(attackerTeam: TeamId, victimTeam: TeamId): void {
    if (attackerTeam === "attackers") {
      this.attackerStats.kills++;
      this.defenderStats.deaths++;
    } else {
      this.defenderStats.kills++;
      this.attackerStats.deaths++;
    }
  }

  resetMatch(): void {
    this.attackerAlive = 0;
    this.defenderAlive = 0;
    this.attackerStats = { kills: 0, deaths: 0, alive: 0, score: 0 };
    this.defenderStats = { kills: 0, deaths: 0, alive: 0, score: 0 };
  }
}
