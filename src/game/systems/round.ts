/**
 * round.ts — Round state machine.
 * States: buy -> freeze -> active -> bombPlanted -> ending -> summary -> sideSwitch -> matchOver
 * Every transition is guarded; a round cannot end twice, bomb cannot explode after defuse.
 */

export type RoundState =
  | "menu"
  | "loading"
  | "buy"
  | "freeze"
  | "active"
  | "bombPlanted"
  | "ending"
  | "summary"
  | "sideSwitch"
  | "matchOver";

export interface RoundConfig {
  roundTime: number;
  buyTime: number;
  freezeTime: number;
  bombTimer: number;
  plantSeconds: number;
  defuseSeconds: number;
  defuseKitSeconds: number;
  maxRounds: number;
  winScore: number;
}

export const DEFAULT_ROUND_CONFIG: RoundConfig = {
  roundTime: 75,
  buyTime: 20,
  freezeTime: 3,
  bombTimer: 40,
  plantSeconds: 3,
  defuseSeconds: 5,
  defuseKitSeconds: 3,
  maxRounds: 12,
  winScore: 7,
};

export class RoundManager {
  private state: RoundState = "menu";
  private round = 1;
  private attackerScore = 0;
  private defenderScore = 0;
  private roundTimer = 0;
  private buyTimer = 0;
  private bombTimer = 0;
  private plantProgress = 0;
  private defuseProgress = 0;
  private bombPlanted = false;
  private bombDefused = false;
  private bombExploded = false;
  private roundEnded = false;
  private sideSwitched = false;
  private readonly config: RoundConfig;
  private readonly onChange: (state: RoundState) => void;
  private readonly onRoundEnd: (winner: TeamId, reason: string) => void;

  constructor(
    config: Partial<RoundConfig> = {},
    onChange: (state: RoundState) => void = () => {},
    onRoundEnd: (winner: TeamId, reason: string) => void = () => {},
  ) {
    this.config = { ...DEFAULT_ROUND_CONFIG, ...config };
    this.onChange = onChange;
    this.onRoundEnd = onRoundEnd;
  }

  get stateName(): RoundState { return this.state; }
  get roundNumber(): number { return this.round; }
  get scores(): { attackers: number; defenders: number } {
    return { attackers: this.attackerScore, defenders: this.defenderScore };
  }
  get roundTimeLeft(): number { return Math.max(0, this.roundTimer); }
  get buyTimeLeft(): number { return Math.max(0, this.buyTimer); }
  get bombTimeLeft(): number { return Math.max(0, this.bombTimer); }
  get isBombPlanted(): boolean { return this.bombPlanted; }
  get isBombDefused(): boolean { return this.bombDefused; }
  get isBombExploded(): boolean { return this.bombExploded; }
  get plantProgressPct(): number { return this.plantProgress; }
  get defuseProgressPct(): number { return this.defuseProgress; }
  get isMatchOver(): boolean { return this.state === "matchOver"; }
  get winner(): TeamId | null {
    if (this.attackerScore >= this.config.winScore) return "attackers";
    if (this.defenderScore >= this.config.winScore) return "defenders";
    return null;
  }

  private transition(next: RoundState): void {
    if (this.state === next) return;
    this.state = next;
    this.onChange(next);
  }

  startMatch(): void {
    this.round = 1;
    this.attackerScore = 0;
    this.defenderScore = 0;
    this.bombPlanted = false;
    this.bombDefused = false;
    this.bombExploded = false;
    this.roundEnded = false;
    this.sideSwitched = false;
    this.transition("buy");
    this.buyTimer = this.config.buyTime;
    this.roundTimer = this.config.roundTime;
  }

  update(dt: number): void {
    if (this.state === "menu" || this.state === "loading" || this.state === "matchOver") return;

    if (this.state === "buy") {
      this.buyTimer = Math.max(0, this.buyTimer - dt);
      if (this.buyTimer <= 0) {
        this.transition("freeze");
        this.roundTimer = this.config.roundTime;
        this.bombTimer = this.config.bombTimer;
        this.plantProgress = 0;
        this.defuseProgress = 0;
        this.bombPlanted = false;
        this.bombDefused = false;
        this.bombExploded = false;
        this.roundEnded = false;
      }
      return;
    }

    if (this.state === "freeze") {
      this.roundTimer = Math.max(0, this.roundTimer - dt);
      if (this.roundTimer <= 0) {
        this.transition("active");
        this.roundTimer = this.config.roundTime;
      }
      return;
    }

    if (this.state === "active") {
      this.roundTimer = Math.max(0, this.roundTimer - dt);
      if (this.roundTimer <= 0 && !this.bombPlanted) {
        this.endRound("defenders", "time_expired");
      }
      return;
    }

    if (this.state === "bombPlanted") {
      this.bombTimer = Math.max(0, this.bombTimer - dt);
      if (this.bombTimer <= 0 && !this.bombExploded && !this.bombDefused) {
        this.explodeBomb();
      }
      return;
    }

    if (this.state === "ending") {
      this.roundTimer = Math.max(0, this.roundTimer - dt);
      if (this.roundTimer <= 0) this.nextRound();
      return;
    }

    if (this.state === "summary" || this.state === "sideSwitch") {
      this.roundTimer = Math.max(0, this.roundTimer - dt);
      if (this.roundTimer <= 0) this.nextRound();
      return;
    }
  }

  startRound(): void {
    if (this.state !== "buy" && this.state !== "summary" && this.state !== "sideSwitch" && this.state !== "menu") return;
    this.transition("freeze");
    this.roundTimer = this.config.freezeTime;
    this.bombPlanted = false;
    this.bombDefused = false;
    this.bombExploded = false;
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.roundEnded = false;
  }

  public endRound(winner: TeamId, reason: string): void {
    if (this.roundEnded) return;
    this.roundEnded = true;
    if (winner === "attackers") this.attackerScore++;
    else this.defenderScore++;
    this.transition("ending");
    this.roundTimer = 8;
    this.onRoundEnd(winner, reason);
  }

  plantBomb(): boolean {
    if (this.state !== "active" || this.bombPlanted || this.bombDefused || this.bombExploded) return false;
    this.bombPlanted = true;
    this.transition("bombPlanted");
    this.bombTimer = this.config.bombTimer;
    return true;
  }

  defuseBomb(hasKit: boolean): boolean {
    if (!this.bombPlanted || this.bombDefused || this.bombExploded || this.state !== "bombPlanted") return false;
    this.defuseProgress += 1; // simplified: called once per defuse attempt completes
    if (this.defuseProgress >= 1) {
      this.bombDefused = true;
      this.transition("ending");
      this.roundTimer = 8;
      this.endRound("defenders", "defused");
      return true;
    }
    return false;
  }

  private explodeBomb(): void {
    if (this.bombExploded || this.bombDefused) return;
    this.bombExploded = true;
    this.endRound("attackers", "detonated");
  }

  private nextRound(): void {
    if (this.winner) {
      this.transition("matchOver");
      return;
    }
    this.round++;
    if (this.round > this.config.maxRounds) {
      this.transition("matchOver");
      return;
    }
    if (!this.sideSwitched && this.round % 2 === 0) {
      this.sideSwitched = true;
      this.transition("sideSwitch");
      this.roundTimer = 8;
    } else {
      this.transition("buy");
      this.buyTimer = this.config.buyTime;
      this.roundTimer = this.config.roundTime;
    }
  }

  forceMatchOver(): void {
    this.transition("matchOver");
  }
}

export type TeamId = "attackers" | "defenders";
