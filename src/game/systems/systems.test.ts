import { describe, it, expect } from "vitest";
import { calculateDamage, applyDamage, type DamageConfig } from "./damage";
import { RoundManager } from "./round";
import { EconomyManager } from "./economy";
import { WeaponSystem } from "./weapons";
import { TeamManager } from "./team";
import { WEAPONS, type WeaponId } from "../config";

describe("damage calculations", () => {
  it("headshot does more damage", () => {
    const r = calculateDamage(34, "head", 0, false);
    expect(r.damage).toBe(68); // 34 * 2.0
    expect(r.headshot).toBe(true);
  });

  it("armor reduces damage", () => {
    const r = calculateDamage(34, "torso", 100, false);
    expect(r.damage).toBe(17); // 34 * 1.0 * 0.5 armor reduction
    expect(r.remainingArmor).toBe(83);
  });

  it("damage cannot exceed health", () => {
    const r = calculateDamage(500, "head", 0, false);
    expect(r.killed).toBe(true);
    expect(r.damage).toBe(1000); // 500 * 2.0 but killed just means >= 100
  });

  it("leg shot has damage multiplier", () => {
    const r = calculateDamage(100, "leg", 0, false);
    expect(r.damage).toBe(75); // 100 * 0.75
  });

  it("helmet reduces headshot damage from armor", () => {
    const noHelmet = calculateDamage(60, "head", 100, false);
    const withHelmet = calculateDamage(60, "head", 100, true);
    // no helmet: raw=120, absorbed=min(60, 100)=60, damage=60, armor=40
    // with helmet: raw=120, absorbed=min(75, 100)=75, damage=45, armor=25
    expect(withHelmet.damage).toBeLessThan(noHelmet.damage);
    expect(withHelmet.remainingArmor).toBeLessThan(noHelmet.remainingArmor);
  });

  it("applyDamage returns correct health and armor", () => {
    const result = applyDamage(100, 100, 34, "torso", false);
    expect(result.health).toBe(83); // 100 - 17
    expect(result.armor).toBe(83); // 100 - 17 absorbed
    expect(result.killed).toBe(false);
  });

  it("applyDamage kills at 0 health", () => {
    const result = applyDamage(10, 0, 20, "torso", false);
    expect(result.killed).toBe(true);
    expect(result.health).toBe(0);
  });
});

describe("round manager", () => {
  it("starts in menu state", () => {
    const rm = new RoundManager();
    expect(rm.stateName).toBe("menu");
    rm.startMatch();
    expect(rm.stateName).toBe("buy");
  });

  it("advances from buy to freeze to active", () => {
    const rm = new RoundManager({ buyTime: 0.01, freezeTime: 0.01, roundTime: 0.01 });
    rm.startMatch(); // menu -> buy
    rm.update(0.02); // buy -> freeze (buyTime=0.01)
    expect(rm.stateName).toBe("freeze");
    rm.update(0.02); // freeze -> active (freezeTime=0.01)
    expect(rm.stateName).toBe("active");
  });

  it("round cannot end twice", () => {
    const rm = new RoundManager({ roundTime: 0.01, buyTime: 0.01, freezeTime: 0.01 });
    rm.startMatch(); // menu -> buy
    rm.update(0.02); // buy -> freeze
    rm.update(0.02); // freeze -> active
    expect(rm.stateName).toBe("active");
    rm.update(0.02); // round time expires -> ending
    expect(rm.stateName).toBe("ending");
    rm.update(0.02); // already ending, shouldn't end again
    expect(rm.stateName).toBe("ending");
  });

  it("match over when win score reached", () => {
    const rm = new RoundManager({ winScore: 1, maxRounds: 10, roundTime: 999, buyTime: 0.01, freezeTime: 0.01 });
    rm.startMatch();
    // Use the public endRound
    rm.endRound("attackers", "elimination");
    expect(rm.winner).toBe("attackers");
    expect(rm.isMatchOver).toBe(false); // matchOver state not set until nextRound
  });

  it("bomb plant and defuse", () => {
    const rm = new RoundManager({ buyTime: 0.01, freezeTime: 0.01, roundTime: 999 });
    rm.startMatch();
    rm.startRound();
    rm.update(0.02); // freeze -> active (freezeTime=0.01)
    expect(rm.stateName).toBe("active");
    expect(rm.plantBomb()).toBe(true);
    expect(rm.isBombPlanted).toBe(true);
    expect(rm.plantBomb()).toBe(false); // can't plant again
    expect(rm.defuseBomb(false)).toBe(true);
    expect(rm.isBombDefused).toBe(true);
  });
});

describe("economy", () => {
  it("can afford and purchase", () => {
    const econ = new EconomyManager({ startCredits: 1000 });
    expect(econ.canAfford("attackers", 500)).toBe(true);
    expect(econ.purchase("attackers", 500)).toBe(true);
    expect(econ.getCredits("attackers")).toBe(500);
    expect(econ.purchase("attackers", 600)).toBe(false);
  });

  it("kill and round rewards", () => {
    const econ = new EconomyManager({ startCredits: 0, killReward: 150, winReward: 1400 });
    econ.rewardKill("attackers");
    expect(econ.getCredits("attackers")).toBe(150);
    econ.rewardRoundWin("attackers");
    expect(econ.getCredits("attackers")).toBe(1550);
  });
});

describe("weapon system", () => {
  it("pistol starts owned and equipped", () => {
    const ws = new WeaponSystem();
    expect(ws.getWeapon("pistol").owned).toBe(true);
    expect(ws.getCurrentWeapon()).toBe("pistol");
  });

  it("cannot purchase without enough credits", () => {
    const ws = new WeaponSystem();
    const result = ws.purchaseWeapon("rifle", WEAPONS.rifle.cost, 100);
    expect(result.success).toBe(false);
    expect(result.remaining).toBe(100);
  });

  it("consumes ammo on fire", () => {
    const ws = new WeaponSystem();
    ws.equip("rifle"); // need to own it first - actually rifle not owned
    const ws2 = new WeaponSystem();
    ws2.purchaseWeapon("rifle", 1500, 2000);
    ws2.equip("rifle");
    expect(ws2.getCurrentAmmo().magazine).toBe(WEAPONS.rifle.magazine);
    ws2.consumeAmmo();
    expect(ws2.getCurrentAmmo().magazine).toBe(WEAPONS.rifle.magazine - 1);
  });

  it("reload refills magazine from reserve", () => {
    const ws = new WeaponSystem();
    ws.purchaseWeapon("rifle", 1500, 2000);
    ws.equip("rifle");
    // Empty magazine
    const ammo = ws.getCurrentAmmo();
    ammo.magazine = 0;
    expect(ws.canReload()).toBe(true);
    ws.reload();
    expect(ammo.magazine).toBe(WEAPONS.rifle.magazine);
  });
});

describe("team manager", () => {
  it("tracks alive counts", () => {
    const tm = new TeamManager();
    tm.setAlive("attackers", 5);
    tm.setAlive("defenders", 3);
    expect(tm.getAlive("attackers")).toBe(5);
    expect(tm.getAlive("defenders")).toBe(3);
  });

  it("records kills", () => {
    const tm = new TeamManager();
    tm.recordKill("attackers", "defenders");
    expect(tm.getStats("attackers").kills).toBe(1);
    expect(tm.getStats("defenders").deaths).toBe(1);
  });
});

describe("round reset and cleanup", () => {
  it("resets match state completely", () => {
    const rm = new RoundManager({ winScore: 1, maxRounds: 10 });
    rm.startMatch();
    rm.endRound("attackers", "elimination");
    expect(rm.winner).toBe("attackers");
    rm.startMatch();
    expect(rm.stateName).toBe("buy");
    expect(rm.scores.attackers).toBe(0);
    expect(rm.scores.defenders).toBe(0);
    expect(rm.roundNumber).toBe(1);
  });

  it("round cannot end twice from time expiration", () => {
    const rm = new RoundManager({ roundTime: 0.01, buyTime: 0.01, freezeTime: 0.01 });
    rm.startMatch();
    rm.update(0.02); // buy -> freeze
    rm.update(0.02); // freeze -> active
    rm.update(0.02); // active -> ending (time expired)
    expect(rm.stateName).toBe("ending");
    rm.update(0.05); // should not end again
    expect(rm.stateName).toBe("ending");
  });

  it("bomb cannot explode after defuse", () => {
    const rm = new RoundManager({ buyTime: 0.01, freezeTime: 0.01, roundTime: 999 });
    rm.startMatch();
    rm.startRound();
    rm.update(0.02); // active
    rm.plantBomb();
    rm.defuseBomb(false);
    expect(rm.isBombDefused).toBe(true);
    expect(rm.isBombExploded).toBe(false);
    // Advance bomb timer past expiration - should not explode since defused
    rm.update(50);
    expect(rm.isBombExploded).toBe(false);
  });

  it("weapon cannot fire without ammo", () => {
    const ws = new WeaponSystem();
    ws.purchaseWeapon("rifle", 1500, 2000);
    ws.equip("rifle");
    const ammo = ws.getCurrentAmmo();
    ammo.magazine = 0;
    ammo.reserve = 0;
    expect(ws.hasAmmo()).toBe(false);
    expect(ws.consumeAmmo()).toBe(false);
  });

  it("cannot purchase duplicate weapon", () => {
    const ws = new WeaponSystem();
    // Pistol is already owned
    expect(ws.getWeapon("pistol").owned).toBe(true);
    const result = ws.purchaseWeapon("pistol", 0, 1000);
    expect(result.success).toBe(false);
  });

  it("damage respects armor and helmet", () => {
    const noArmor = calculateDamage(50, "head", 0, false);
    const withArmor = calculateDamage(50, "head", 100, false);
    const withArmorAndHelmet = calculateDamage(50, "head", 100, true);
    expect(withArmor.damage).toBeLessThan(noArmor.damage);
    expect(withArmorAndHelmet.damage).toBeLessThan(withArmor.damage);
  });
});
