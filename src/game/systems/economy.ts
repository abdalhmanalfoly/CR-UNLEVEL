/**
 * economy.ts — Tactical economy system.
 * Money, kill rewards, round win/loss rewards, purchase validation.
 */

export type TeamId = "attackers" | "defenders";

export interface EconomyConfig {
  startCredits: number;
  killReward: number;
  winReward: number;
  lossReward: number;
  plantReward: number;
  defuseReward: number;
  maxCredits: number;
}

export const DEFAULT_ECONOMY: EconomyConfig = {
  startCredits: 800,
  killReward: 150,
  winReward: 1400,
  lossReward: 900,
  plantReward: 300,
  defuseReward: 300,
  maxCredits: 16000,
};

export class EconomyManager {
  private attackerCredits: number;
  private defenderCredits: number;
  private readonly config: EconomyConfig;

  constructor(config: Partial<EconomyConfig> = {}, startingTeam: TeamId = "attackers") {
    this.config = { ...DEFAULT_ECONOMY, ...config };
    this.attackerCredits = this.config.startCredits;
    this.defenderCredits = this.config.startCredits;
  }

  getCredits(team: TeamId): number {
    return team === "attackers" ? this.attackerCredits : this.defenderCredits;
  }

  setCredits(team: TeamId, amount: number): void {
    if (team === "attackers") this.attackerCredits = Math.min(this.config.maxCredits, Math.max(0, amount));
    else this.defenderCredits = Math.min(this.config.maxCredits, Math.max(0, amount));
  }

  addCredits(team: TeamId, amount: number): void {
    this.setCredits(team, this.getCredits(team) + amount);
  }

  canAfford(team: TeamId, cost: number): boolean {
    return this.getCredits(team) >= cost;
  }

  purchase(team: TeamId, cost: number): boolean {
    if (!this.canAfford(team, cost)) return false;
    this.setCredits(team, this.getCredits(team) - cost);
    return true;
  }

  rewardKill(team: TeamId): void {
    this.addCredits(team, this.config.killReward);
  }

  rewardRoundWin(team: TeamId): void {
    this.addCredits(team, this.config.winReward);
  }

  rewardRoundLoss(team: TeamId): void {
    this.addCredits(team, this.config.lossReward);
  }

  resetMatch(): void {
    this.attackerCredits = this.config.startCredits;
    this.defenderCredits = this.config.startCredits;
  }
}
