import { SFRPG } from "../../../config.js";
import { DiceSFRPG } from "../../../dice.js";
import { SFRPGEffectType, SFRPGModifierType, SFRPGModifierTypes } from "../../../modifiers/types.js";
import RollContext from "../../../rolls/rollcontext.js";

export default function (engine) {
    engine.closures.add("calculateDamageMitigation", (fact, context) => {
        const data = fact.data;
        const actor = fact.actor;

        data.traits.damageMitigation = {
            damageReduction: [],
            damageReductionFirst: null,
            damageReductionTooltip: [],
            energyResistance: {}
        };

        const modifiers = fact.modifiers;
        const damageReductionModifiers = modifiers.filter(mod => { return mod.enabled && mod.modifierType === "constant" && [SFRPGEffectType.DAMAGE_REDUCTION].includes(mod.effectType); });
        const energyResistanceModifiers = modifiers.filter(mod => { return mod.enabled && mod.modifierType === "constant" && [SFRPGEffectType.ENERGY_RESISTANCE].includes(mod.effectType); });

        for (const drModifier of damageReductionModifiers) {
            // TODO: Resolve formula; use RollTree, as it can complete synchronously
            const modifierInfo = {
                value: drModifier.max,
                negatedBy: "",
                source: drModifier
            };

            // Add in something for creating an actual list, so the tooltip shows everything.
            // That way we no longer have to default to making everything not have a negate.

            if (data.traits.damageMitigation.damageReduction.length == 0)
                data.traits.damageMitigation.damageReduction.push(modifierInfo);
            else
                data.traits.damageMitigation.damageReduction[0].value += modifierInfo.value;
        }

        let primaryReduction = data.traits.damageMitigation.damageReduction[0];
        if (!(primaryReduction === undefined)) {
            data.traits.damageMitigation.damageReductionFirst = primaryReduction;
            data.traits.damageMitigation.damageReductionTooltip.push(`${primaryReduction.source.name}: ${primaryReduction.value} / -`);
        }

        for (const erModifier of energyResistanceModifiers) {
            const modifierInfo = {
                value: erModifier.max,
                damageType: erModifier.valueAffected,
                source: erModifier
            };

            if (modifierInfo.negatedBy === "custom") {
                modifierInfo.damageType = erModifier.notes;
            }
            
            if (!data.traits.damageMitigation.energyResistance[modifierInfo.damageType]) {
                data.traits.damageMitigation.energyResistance[modifierInfo.damageType] = modifierInfo;
            }
            else {
                data.traits.damageMitigation.energyResistance[modifierInfo.damageType].value += modifierInfo.value;
            }
        }

        return fact;
    }, { required: ["stackModifiers"], closureParameters: ["stackModifiers"] });
}