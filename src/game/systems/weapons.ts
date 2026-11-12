/**
 * weapons.ts — Weapon roster, ammo state, firing rules.
 * Centralized weapon configuration and per-player weapon runtime state.
 */

import { WEAPONS, type WeaponId, type WeaponSpec, EQUIPMENT, type EquipmentId } from "../config";

export interface AmmoState {
  magazine: number;
  reserve: number;
}

export interface WeaponRuntime {
  spec: WeaponSpec;
  ammo: AmmoState;
  owned: boolean;
  equipped: boolean;
}

export interface EquipmentRuntime {
  spec: typeof EQUIPMENT[EquipmentId];
  count: number;
  owned: boolean;
}

export class WeaponSystem {
  private weapons: Record<WeaponId, WeaponRuntime> = {
    pistol: { spec: WEAPONS.pistol, ammo: { magazine: WEAPONS.pistol.magazine, reserve: WEAPONS.pistol.reserve }, owned: true, equipped: true },
    rifle: { spec: WEAPONS.rifle, ammo: { magazine: WEAPONS.rifle.magazine, reserve: WEAPONS.rifle.reserve }, owned: false, equipped: false },
    smg: { spec: WEAPONS.smg, ammo: { magazine: WEAPONS.smg.magazine, reserve: WEAPONS.smg.reserve }, owned: false, equipped: false },
    shotgun: { spec: WEAPONS.shotgun, ammo: { magazine: WEAPONS.shotgun.magazine, reserve: WEAPONS.shotgun.reserve }, owned: false, equipped: false },
    sniper: { spec: WEAPONS.sniper, ammo: { magazine: WEAPONS.sniper.magazine, reserve: WEAPONS.sniper.reserve }, owned: false, equipped: false },
    knife: { spec: WEAPONS.knife, ammo: { magazine: 1, reserve: 0 }, owned: true, equipped: false },
  };

  private equipment: Record<EquipmentId, EquipmentRuntime> = {
    grenade: { spec: EQUIPMENT.grenade, count: 0, owned: false },
    smoke: { spec: EQUIPMENT.smoke, count: 0, owned: false },
    flashbang: { spec: EQUIPMENT.flashbang, count: 0, owned: false },
    defuseKit: { spec: EQUIPMENT.defuseKit, count: 0, owned: false },
    armor: { spec: EQUIPMENT.armor, count: 0, owned: false },
    helmet: { spec: EQUIPMENT.helmet, count: 0, owned: false },
  };

  private currentWeapon: WeaponId = "pistol";

  getWeapon(id: WeaponId): WeaponRuntime { return this.weapons[id]; }
  getCurrentWeapon(): WeaponId { return this.currentWeapon; }
  getCurrentSpec(): WeaponSpec { return this.weapons[this.currentWeapon].spec; }
  getCurrentAmmo(): AmmoState { return this.weapons[this.currentWeapon].ammo; }
  getAllWeapons(): Record<WeaponId, WeaponRuntime> { return this.weapons; }
  getEquipment(id: EquipmentId): EquipmentRuntime { return this.equipment[id]; }
  getAllEquipment(): Record<EquipmentId, EquipmentRuntime> { return this.equipment; }

  equip(id: WeaponId): boolean {
    const w = this.weapons[id];
    if (!w.owned) return false;
    this.currentWeapon = id;
    for (const key of Object.keys(this.weapons) as WeaponId[]) {
      this.weapons[key].equipped = key === id;
    }
    return true;
  }

  purchaseWeapon(id: WeaponId, cost: number, credits: number): { success: boolean; remaining: number } {
    const w = this.weapons[id];
    if (w.owned) return { success: false, remaining: credits };
    if (credits < cost) return { success: false, remaining: credits };
    w.owned = true;
    w.ammo = { magazine: w.spec.magazine, reserve: w.spec.reserve };
    return { success: true, remaining: credits - cost };
  }

  purchaseEquipment(id: EquipmentId, cost: number, credits: number): { success: boolean; remaining: number } {
    const e = this.equipment[id];
    if (e.owned || e.count >= e.spec.maxPerRound) return { success: false, remaining: credits };
    if (credits < cost) return { success: false, remaining: credits };
    e.owned = true;
    e.count = e.spec.maxPerRound;
    return { success: true, remaining: credits - cost };
  }

  consumeAmmo(): boolean {
    const w = this.weapons[this.currentWeapon];
    if (w.ammo.magazine <= 0) return false;
    w.ammo.magazine--;
    return true;
  }

  hasAmmo(): boolean {
    const w = this.weapons[this.currentWeapon];
    return w.ammo.magazine > 0;
  }

  reload(): boolean {
    const w = this.weapons[this.currentWeapon];
    if (w.ammo.magazine >= w.spec.magazine || w.ammo.reserve <= 0) return false;
    const needed = w.spec.magazine - w.ammo.magazine;
    const moved = Math.min(needed, w.ammo.reserve);
    w.ammo.magazine += moved;
    w.ammo.reserve -= moved;
    return true;
  }

  canReload(): boolean {
    const w = this.weapons[this.currentWeapon];
    return w.ammo.magazine < w.spec.magazine && w.ammo.reserve > 0;
  }

  addReserveAmmo(id: WeaponId, amount: number): void {
    this.weapons[id].ammo.reserve += amount;
  }

  resetRound(): void {
    for (const w of Object.values(this.weapons)) {
      if (w.owned) {
        w.ammo = { magazine: w.spec.magazine, reserve: w.spec.reserve };
      }
    }
    for (const e of Object.values(this.equipment)) {
      e.count = e.owned ? e.spec.maxPerRound : 0;
    }
  }

  resetMatch(): void {
    this.weapons.pistol.owned = true;
    this.weapons.pistol.equipped = true;
    this.weapons.pistol.ammo = { magazine: WEAPONS.pistol.magazine, reserve: WEAPONS.pistol.reserve };
    this.weapons.knife.owned = true;
    this.weapons.knife.equipped = false;
    this.currentWeapon = "pistol";
    for (const id of ["rifle", "smg", "shotgun", "sniper"] as WeaponId[]) {
      this.weapons[id].owned = false;
      this.weapons[id].equipped = false;
      this.weapons[id].ammo = { magazine: WEAPONS[id].magazine, reserve: WEAPONS[id].reserve };
    }
    for (const e of Object.values(this.equipment)) {
      e.owned = false;
      e.count = 0;
    }
  }
}
