/**
 * damage.ts — Damage calculation, hit regions, armor rules.
 * Shared by player, bots, and multiplayer authority.
 */

export type HitRegion = "head" | "torso" | "arm" | "leg";

export interface DamageResult {
  damage: number;
  headshot: boolean;
  killed: boolean;
  remainingHealth: number;
  remainingArmor: number;
}

export interface DamageConfig {
  headMultiplier: number;
  torsoMultiplier: number;
  armMultiplier: number;
  legMultiplier: number;
  armorReduction: number; // fraction absorbed by armor (0-1)
  helmetHeadReduction: number; // armor absorbs this much MORE of headshot damage with helmet
}

export const DEFAULT_DAMAGE_CONFIG: DamageConfig = {
  headMultiplier: 2.0,
  torsoMultiplier: 1.0,
  armMultiplier: 0.75,
  legMultiplier: 0.75,
  armorReduction: 0.5,
  helmetHeadReduction: 1.25,
};

export function calculateDamage(
  baseDamage: number,
  region: HitRegion,
  armor: number,
  hasHelmet: boolean,
  config: Partial<DamageConfig> = {},
): DamageResult {
  const c = { ...DEFAULT_DAMAGE_CONFIG, ...config };
  let multiplier = 1.0;
  let headshot = false;

  switch (region) {
    case "head":
      multiplier = c.headMultiplier;
      headshot = true;
      break;
    case "torso":
      multiplier = c.torsoMultiplier;
      break;
    case "arm":
      multiplier = c.armMultiplier;
      break;
    case "leg":
      multiplier = c.legMultiplier;
      break;
  }

  let rawDamage = baseDamage * multiplier;

  // Armor absorbs a fraction of damage
  let damageAbsorbed = 0;
  if (armor > 0) {
    if (headshot && hasHelmet) {
      damageAbsorbed = rawDamage * c.armorReduction * c.helmetHeadReduction;
    } else {
      damageAbsorbed = rawDamage * c.armorReduction;
    }
    damageAbsorbed = Math.min(damageAbsorbed, armor);
  }

  const finalDamage = Math.max(0, rawDamage - damageAbsorbed);
  const remainingArmor = Math.max(0, armor - damageAbsorbed);
  const remainingHealth = Math.max(0, 100 - finalDamage); // caller applies to current health

  return {
    damage: finalDamage,
    headshot,
    killed: finalDamage >= 100,
    remainingHealth,
    remainingArmor,
  };
}

export function applyDamage(
  currentHealth: number,
  currentArmor: number,
  baseDamage: number,
  region: HitRegion,
  hasHelmet: boolean,
  config: Partial<DamageConfig> = {},
): { health: number; armor: number; killed: boolean; headshot: boolean; damageDealt: number } {
  const result = calculateDamage(baseDamage, region, currentArmor, hasHelmet, config);
  const health = Math.max(0, currentHealth - result.damage);
  return {
    health,
    armor: result.remainingArmor,
    killed: health <= 0,
    headshot: result.headshot,
    damageDealt: result.damage,
  };
}
