import { SFRPG } from "../config.js"
import { DiceSFRPG } from "../dice.js";
import RollContext from "../rolls/rollcontext.js";
import { Mix } from "../utils/custom-mixer.js";
import { ActorConditionsMixin } from "./mixins/actor-conditions.js";
import { ActorCrewMixin } from "./mixins/actor-crew.js";
import { ActorDamageMixin } from "./mixins/actor-damage.js";
import { ActorInventoryMixin } from "./mixins/actor-inventory.js";
import { ActorModifiersMixin } from "./mixins/actor-modifiers.js";
import { ActorResourcesMixin } from "./mixins/actor-resources.js";
import { ActorRestMixin } from "./mixins/actor-rest.js";
import { ChoiceDialog } from "../apps/choice-dialog.js";
import { SpellCastDialog } from "../apps/spell-cast-dialog.js";
import { AddEditSkillDialog } from "../apps/edit-skill-dialog.js";
import { NpcSkillToggleDialog } from "../apps/npc-skill-toggle-dialog.js";

import { } from "./crew-update.js"
import { ItemSheetSFRPG } from "../item/sheet.js";
import { ItemSFRPG } from "../item/item.js";
import { hasDiceTerms } from "../utilities.js";

/**
 * A data structure for storing damage statistics.
 * 
 * @typedef {Object} DamagePart
 * @property {string}                     formula  The roll formula to use.
 * @property {{[key: string]: boolean}}   types    A set of key value pairs that determines the available damage types.
 * @property {string}                     operator An operator that determines how damage is split between multiple types.
 */

/**
 * Extend the base :class:`Actor` to implement additional logic specialized for SFRPG
 */
export class ActorSFRPG extends Mix(Actor).with(ActorConditionsMixin, ActorCrewMixin, ActorDamageMixin, ActorInventoryMixin, ActorModifiersMixin, ActorResourcesMixin, ActorRestMixin) {

    constructor(data, context) {
        super(data, context);
        //console.log(`Constructor for actor named ${data.name} of type ${data.type}`);
    }

    /** @override */
    getRollData() {
        const data = super.getRollData();

        return data;
    }

    /**
     * Augment the basic actor data with additional dynamic data.
     * 
     * @param {Object} actorData The data for the actor
     * @returns {Promise} A promise for the automation process triggered at the end.
     */
    prepareData() {
        super.prepareData();

        this._ensureHasModifiers(this.system);
        const modifiers = this.getAllModifiers();

        const items = this.items;
        const armors = items.filter(item => item.type === "equipment" && item.system.equipped);
        const shields = items.filter(item => item.type === "shield" && item.system.equipped);
        const weapons = items.filter(item => item.type === "weapon" && item.system.equipped);
        const races = items.filter(item => item.type === "race");
        const frames = items.filter(item => item.type === "starshipFrame");
        const classes = items.filter(item => item.type === "class");
        const chassis = items.filter(item => item.type === "chassis");
        const theme = items.find(item => item.type === "theme");
        const mods = items.filter(item => item.type === "mod");
        const armorUpgrades = items.filter(item => item.type === "upgrade");
        const asis = items.filter(item => item.type === "asi");
        const actorResources = items.filter(item => item.type === "actorResource");
        return game.sfrpg.engine.process("process-actors", {
            actorId: this.id,
            actor: this,
            type: this.type,
            data: this.system,
            flags: this.flags,
            items: this.items,
            armors,
            shields,
            weapons,
            races,
            classes,
            chassis,
            modifiers,
            theme,
            mods,
            armorUpgrades,
            asis,
            frames,
            actorResources
        });
    }

    
    /** @override */
    render(force, context={}) {
        /** Clear out deleted item sheets. */
        const keysToDelete = [];
        for (const [appId, app] of Object.entries(this.apps)) {
            if (app instanceof ItemSheetSFRPG) {
                const item = app.object;
                if (!this.items.find(x => x.id === item.id)) {
                    keysToDelete.push(appId);
                }
            }
        }
        if (keysToDelete.length > 0) {
            for (const key of keysToDelete) {
                delete this.apps[key];
            }
        }

        /** Now render this actor. */
        return super.render(force, context);
    }

    /**
     * TODO: Use these two methods to properly setup actor data for use
     * in the new Active Effects API.
     */
    prepareBaseData() { super.prepareBaseData(); }
    prepareDerivedData() { super.prepareDerivedData(); }
    
    /**
     * Extend the default update method to enhance data before submission.
     * See the parent Entity.update method for full details.
     *
     * @param {Object} data     The data with which to update the Actor
     * @param {Object} options  Additional options which customize the update workflow
     * @return {Promise}        A Promise which resolves to the updated Entity
     */
    async update(data, options = {}) {
        const newSize = data['system.traits.size'];
        if (newSize && (newSize !== getProperty(this.system, "traits.size"))) {
            let size = CONFIG.SFRPG.tokenSizes[data['system.traits.size']];
            if (this.isToken) this.token.update({ height: size, width: size });
            else if (!data["token.width"] && !hasProperty(data, "token.width")) {
                setProperty(data, 'token.height', size);
                setProperty(data, 'token.width', size);
            }
        }

        return super.update(data, options);
    }

    /**
     * Extend OwnedItem creation logic for the SFRPG system to make weapons proficient by default when dropped on a NPC sheet
     * See the base Actor class for API documentation of this method
     * 
     * @param {String} embeddedName The type of Entity being embedded.
     * @param {Object} itemData The data object of the item
     * @param {Object} options Any options passed in
     * @returns {Promise}
     */
    async createEmbeddedDocuments(embeddedName, itemData, options) {
        for (const item of itemData) {
            if (!this.hasPlayerOwner) {
                let t = item.type;
                let initial = {};           
                if (t === "weapon") initial['system.proficient'] = true;
                if (["weapon", "equipment"].includes(t)) initial['system.equipped'] = true;
                if (t === "spell") initial['system.prepared'] = true;
                mergeObject(item, initial);
            }

            item.effects = null;
        }

        return super.createEmbeddedDocuments(embeddedName, itemData, options);
    }
    
    /*
     * Extend preCreate to automatically link PC and Drone tokens, as well as add Unarmed Strikes to PCs automatically.
     * See the base Actor class for API documentation of this method
     *
     * @param {object} data           The initial data object provided to the document creation request
     * @param {object} options        Additional options which modify the creation request
     * @param {string} userId         The ID of the requesting user, always game.user.id
     * @returns {boolean|void}         Explicitly return false to prevent creation of this Document
     */
    async _preCreate(data, options, user) {
        const autoLinkedTypes = ['character', 'drone'];
        let updates = {}
        
        if (autoLinkedTypes.includes(this.type)) {
            updates.prototypeToken = { actorLink:  true };
        };
        
        if (this.type === "character" && game.settings.get("sfrpg", "autoAddUnarmedStrike")) {
            const ITEM_UUID = "Compendium.sfrpg.equipment.AWo4DU0s18agsFtJ"; // Unarmed strike
            const source = (await fromUuid(ITEM_UUID)).toObject();
            source.flags = mergeObject(source.flags ?? {}, { core: { sourceId: ITEM_UUID } });
            
            updates.items = [source];
        };

        this.updateSource(updates)
        
        return super._preCreate(data, options, user)
    };

    async useSpell(item, { configureDialog = true } = {}) {
        if (item.type !== "spell") throw new Error("Wrong item type");

        let spellLevel = item.system.level;
        const usesSlots = (spellLevel > 0) && item.system.preparation.mode === "";
        if (!usesSlots) {
            if (item.system.uses?.max > 0) {
                if (item.system.uses.value <= 0) {
                    ui.notifications.error(game.i18n.localize("SFRPG.Items.Spell.ErrorNoUses", {permanent: true}));
                    return;
                }

                const itemUpdatePromise = item.update({
                    [`system.uses.value`]: Math.max(item.system.uses.value - 1, 0)
                });
                itemUpdatePromise.then(() => {
                    item.roll();
                });
                return itemUpdatePromise;
            } else {
                return item.roll();
            }
        }

        let consumeSpellSlot = true;
        let selectedSlot = null;
        if (configureDialog) {
            try {
                const dialogResponse = await SpellCastDialog.create(this, item);
                const slotIndex = parseInt(dialogResponse.formData.get("level"));
                consumeSpellSlot = Boolean(dialogResponse.formData.get("consume"));
                selectedSlot = dialogResponse.spellLevels[slotIndex];
                spellLevel = parseInt(selectedSlot?.level || item.system.level);

                if (spellLevel !== item.system.level && item.system.level > spellLevel) {
                    const newItemData = duplicate(item);
                    newItemData.system.level = spellLevel;

                    if (this.type === "npc" || this.type === "npc2") {
                        if (newItemData.system.save.dc && !Number.isNaN(newItemData.system.save.dc)) {
                            newItemData.system.save.dc = newItemData.system.save.dc - item.system.level + spellLevel;
                        }
                    }

                    item = new ItemSFRPG(newItemData, {parent: this});
                }

                // Run automation to ensure save DCs are correct.
                item.prepareData();
                if (item.system.actionType && item.system.save.type) {
                    await item.processData();
                }
            } catch (error) {
                console.error(error);
                return null;
            }
        }

        let processContext = null;
        if (consumeSpellSlot && spellLevel > 0 && selectedSlot) {
            const actor = this;
            if (selectedSlot.source === "general") {
                if (processContext) {
                    processContext.then(function(result) {
                        return actor.update({
                            [`system.spells.spell${spellLevel}.value`]: Math.max(parseInt(actor.system.spells[`spell${spellLevel}`].value) - 1, 0)
                        });
                    });
                } else {
                    processContext = actor.update({
                        [`system.spells.spell${spellLevel}.value`]: Math.max(parseInt(actor.system.spells[`spell${spellLevel}`].value) - 1, 0)
                    });
                }
            } else {
                const selectedLevel = selectedSlot.level;
                const selectedClass = selectedSlot.source;

                if (processContext) {
                    processContext.then(function(result) {
                        return actor.update({
                            [`system.spells.spell${selectedLevel}.perClass.${selectedClass}.value`]: Math.max(parseInt(actor.system.spells[`spell${spellLevel}`].perClass[selectedClass].value) - 1, 0)
                        });
                    });
                } else {
                    processContext = actor.update({
                        [`system.spells.spell${selectedLevel}.perClass.${selectedClass}.value`]: Math.max(parseInt(actor.system.spells[`spell${spellLevel}`].perClass[selectedClass].value) - 1, 0)
                    });
                }
            }
        }

        if (processContext) {
            processContext.then(function(result) {
                return item.roll();
            });
            
            return processContext;
        }

        return item.roll();
    }

    /**
     * Edit a skill's fields
     * @param {string} skillId The skill id (e.g. "ins")
     * @param {Object} options Options which configure how the skill is edited
     */
    async editSkill(skillId, options = {}) {
        // Keeping this here for later
        // this.update({"data.skills.-=skillId": null});
        // use this to delete any unwanted skills.

        const skill = duplicate(this.system.skills[skillId]);
        const isNpc = this.type === "npc" || this.type === "npc2";
        const formData = await AddEditSkillDialog.create(skillId, skill, true, isNpc, this.isOwner),
            isTrainedOnly = Boolean(formData.get('isTrainedOnly')),
            hasArmorCheckPenalty = Boolean(formData.get('hasArmorCheckPenalty')),
            value = Boolean(formData.get('value')) ? 3 : 0,
            misc = Number(formData.get('misc')),
            notes = String(formData.get('notes')),
            ranks = Number(formData.get('ranks')),
            ability = formData.get('ability'),
            remove = Boolean(formData.get('remove'));

        if (remove) return this.update({ [`system.skills.-=${skillId}`]: null });

        let updateObject = {
            [`system.skills.${skillId}.ability`]: ability,
            [`system.skills.${skillId}.ranks`]: ranks,
            [`system.skills.${skillId}.value`]: value,
            [`system.skills.${skillId}.misc`]: misc,
            [`system.skills.${skillId}.notes`]: notes,
            [`system.skills.${skillId}.isTrainedOnly`]: isTrainedOnly,
            [`system.skills.${skillId}.hasArmorCheckPenalty`]: hasArmorCheckPenalty
        };

        if (isNpc) updateObject[`system.skills.${skillId}.enabled`] = Boolean(formData.get('enabled'));

        if ("subname" in skill) {
            updateObject[`system.skills.${skillId}.subname`] = formData.get('subname');
        }

        return this.update(updateObject);
    }

    /**
     * Toggles what NPC skills are shown on the sheet.
     */
    async toggleNpcSkills() {
        const skills = duplicate(this.system.skills);
        const formData = await NpcSkillToggleDialog.create(skills);
        let enabledSkills = {};
        const delta = Object.entries(skills).reduce((obj, curr) => {
            if (curr[1].enabled) obj[`system.skills.${curr[0]}.enabled`] = !curr[1].enabled;
            return obj;
        }, {});

        for (let [key, value] of formData.entries()) {
            enabledSkills[`system.${key}`] = Boolean(value);
        }
        
        enabledSkills = mergeObject(enabledSkills, delta, {overwrite: false, inplace: false});

        return await this.update(enabledSkills);
    }

    /**
     * Add a new skill
     * @param {Object} options Options which configure how the skill is added
     */
    async addSkill(options = {}) {
        const skill = {
            ability: "int",
            ranks: 0,
            value: 0,
            misc: 0,
            isTrainedOnly: false,
            hasArmorCheckPenalty: false,
            subname: ""
        };

        let skillId = "pro";
        let counter = 0;

        while (this.system.skills[skillId]) {
            skillId = `pro${++counter}`;
        }

        const formData = await AddEditSkillDialog.create(skillId, skill, false, this.hasPlayerOwner, this.isOwner),
            isTrainedOnly = Boolean(formData.get('isTrainedOnly')),
            hasArmorCheckPenalty = Boolean(formData.get('hasArmorCheckPenalty')),
            value = Boolean(formData.get('value')) ? 3 : 0,
            misc = Number(formData.get('misc')),
            ranks = Number(formData.get('ranks')),
            ability = formData.get('ability'),
            subname = formData.get('subname');

        let newSkillData = {
            [`system.skills.${skillId}`]: {},
            [`system.skills.${skillId}.isTrainedOnly`]: isTrainedOnly,
            [`system.skills.${skillId}.hasArmorCheckPenalty`]: hasArmorCheckPenalty,
            [`system.skills.${skillId}.value`]: value,
            [`system.skills.${skillId}.misc`]: misc,
            [`system.skills.${skillId}.ranks`]: ranks,
            [`system.skills.${skillId}.ability`]: ability,
            [`system.skills.${skillId}.subname`]: subname,
            [`system.skills.${skillId}.mod`]: value + misc + ranks,
            [`system.skills.${skillId}.enabled`]: true
        };

        return this.update(newSkillData);
    }

    /**
     * Roll a Skill Check
     * Prompt the user for input regarding Advantage/Disadvantage and any Situational Bonus
     * @param {string} skillId      The skill id (e.g. "ins")
     * @param {Object} options      Options which configure how the skill check is rolled
     */
    async rollSkill(skillId, options = {}) {
        const skl = this.system.skills[skillId];

        if (!this.hasPlayerOwner) {
            return await this.rollSkillCheck(skillId, skl, options);
        }

        if (skl.isTrainedOnly && !(skl.ranks > 0)) {
            let content = `${CONFIG.SFRPG.skills[skillId.substring(0, 3)]} is a trained only skill, but ${this.name} is not trained in that skill.
                Would you like to roll anyway?`;

            return new Promise(resolve => {
                new Dialog({
                    title: `${CONFIG.SFRPG.skills[skillId.substring(0, 3)]} is trained only`,
                    content: content,
                    buttons: {
                        yes: {
                            label: "Yes",
                            callback: () => resolve(this.rollSkillCheck(skillId, skl, options))
                        },
                        cancel: {
                            label: "No"
                        }
                    },
                    default: "cancel"
                }).render(true);
            });
        } else {
            return await this.rollSkillCheck(skillId, skl, options);
        }
    }

    /**
     * Roll a generic ability test.
     * 
     * @param {String} abilityId The ability id (e.g. "str")
     * @param {Object} options Options which configure how ability tests are rolled
     */
    async rollAbility(abilityId, options = {}) {
        const label = CONFIG.SFRPG.abilities[abilityId];
        const abl = this.system.abilities[abilityId];
        
        const parts = [];
        const data = this.getRollData();

        const rollContext = RollContext.createActorRollContext(this);

        //Include ability check bonus only if it's not 0
        if(abl.abilityCheckBonus) {
            parts.push('@abilityCheckBonus');
            data.abilityCheckBonus = abl.abilityCheckBonus;
        }
        parts.push(`@abilities.${abilityId}.mod`);

        return await DiceSFRPG.d20Roll({
            event: options.event,
            rollContext: rollContext,
            parts: parts,
            title:  game.i18n.format("SFRPG.Rolls.Dice.AbilityCheckTitle", {label: label}),
            flavor: null,
            speaker: ChatMessage.getSpeaker({ actor: this }),
            dialogOptions: {
                left: options.event ? options.event.clientX - 80 : null,
                top: options.event ? options.event.clientY - 80 : null
            }
        });
    }

    /**
     * Roll a save check
     * 
     * @param {String} saveId The save id (e.g. "will")
     * @param {Object} options Options which configure how saves are rolled
     */
    rollSave(saveId, options = {}) {
        const label = CONFIG.SFRPG.saves[saveId];

        const rollContext = RollContext.createActorRollContext(this);

        const parts = [`@attributes.${saveId}.bonus`];

        return DiceSFRPG.d20Roll({
            event: options.event,
            rollContext: rollContext,
            parts: parts,
            title: game.i18n.format("SFRPG.Rolls.Dice.SaveTitle", {label: label}),
            flavor: null,
            speaker: ChatMessage.getSpeaker({ actor: this }),
            dialogOptions: {
                left: options.event ? options.event.clientX - 80 : null,
                top: options.event ? options.event.clientY - 80 : null
            }
        });
    }

    async rollSkillCheck(skillId, skill, options = {}) {
        const rollContext = RollContext.createActorRollContext(this);
        const parts = [`@skills.${skillId}.mod`];

        const title = skillId.includes('pro') ? 
            game.i18n.format("SFRPG.Rolls.Dice.SkillCheckTitleWithProfession", { skill: CONFIG.SFRPG.skills[skillId.substring(0, 3)], profession: skill.subname }) : 
            game.i18n.format("SFRPG.Rolls.Dice.SkillCheckTitle", { skill: CONFIG.SFRPG.skills[skillId.substring(0, 3)] });

        return await DiceSFRPG.d20Roll({
            event: options.event,
            rollContext: rollContext,
            parts: parts,
            title: title,
            flavor: TextEditor.enrichHTML(skill.notes, {async: false}),
            speaker: ChatMessage.getSpeaker({ actor: this }),
            dialogOptions: {
                left: options.event ? options.event.clientX - 80 : null,
                top: options.event ? options.event.clientY - 80 : null
            }
        });
    }

    /**
     * Roll the Piloting skill of the pilot of a vehicle
     *
     * @param {Object} options Options which configure how saves are rolled
     */
    async rollVehiclePilotingSkill(role = null, actorId = null, system = null, options = {}) {

        let parts = [];
        let data = this.getRollData();

        const rollContext = new RollContext();
        rollContext.addContext("vehicle", this, data);
        rollContext.setMainContext("vehicle");

        // Add piloting modifier of vehicle
        parts.push(`@attributes.modifiers.piloting`);

        // Roll a piloting check with a specific system (usually Autopilot).
        // Only takes vehicle and system piloting into account
        if (system) {
            rollContext.addContext("system", system, system.system);
            parts.push(`@system.piloting.piloting`);
        }
        else if(!role || !actorId) {
            // Add pilot's piloting modifier
            parts.push(`@pilot.skills.pil.mod`);
        }
        else {
            const passengerId = this.system.crew[role].actorIds.find(id => id === actorId);
            let passenger = game.actors.get(passengerId);
            let actorData = null;
            if (passenger instanceof ActorSFRPG) {
                actorData = passenger.system;
            } else {
                actorData = passenger.data;
            }

            rollContext.addContext("passenger", passenger, actorData);
            parts.push(`@passenger.skills.pil.mod`);
        }

        this.setupRollContexts(rollContext);

        return await DiceSFRPG.d20Roll({
            event: options.event,
            rollContext: rollContext,
            parts: parts,
            title: game.i18n.format("SFRPG.Rolls.Dice.SkillCheckTitle", {skill: CONFIG.SFRPG.skills["pil"]}),
            flavor: null,
            speaker: ChatMessage.getSpeaker({ actor: this }),
            dialogOptions: {
                left: options.event ? options.event.clientX - 80 : null,
                top: options.event ? options.event.clientY - 80 : null
            }
        });
    }

    /** Starship code */
    async useStarshipAction(actionId) {
        /** Bad entry; no action! */
        if (!actionId) {
            ui.notifications.error(game.i18n.format("SFRPG.Rolls.StarshipActions.ActionNotFoundError", {actionId: actionId}));
            return;
        }

        const starshipPackKey = game.settings.get("sfrpg", "starshipActionsSource");
        const starshipActions = game.packs.get(starshipPackKey);
        const actionEntryDocument = await starshipActions.getDocument(actionId);
        const actionEntry = actionEntryDocument;

        /** Bad entry; no action! */
        if (!actionEntry) {
            ui.notifications.error(game.i18n.format("SFRPG.Rolls.StarshipActions.ActionNotFoundError", {actionId: actionId}));
            return;
        }

        /** Bad entry; no formula! */
        if (actionEntry.system.formula.length < 1) {
            ui.notifications.error(game.i18n.format("SFRPG.Rolls.StarshipActions.NoFormulaError", {name: actionEntry.name}));
            return;
        }

        let quadrant = "";
        if (actionEntry.system.role === "gunner") {
            const options = [
                game.i18n.format("SFRPG.Rolls.StarshipActions.Quadrant.Forward"),
                game.i18n.format("SFRPG.Rolls.StarshipActions.Quadrant.Port"),
                game.i18n.format("SFRPG.Rolls.StarshipActions.Quadrant.Starboard"),
                game.i18n.format("SFRPG.Rolls.StarshipActions.Quadrant.Aft")
            ];
            const results = await ChoiceDialog.show(
                game.i18n.format("SFRPG.Rolls.StarshipActions.Quadrant.Title", {name: actionEntry.name}),
                game.i18n.format("SFRPG.Rolls.StarshipActions.Quadrant.Message"),
                {
                    quadrant: {
                        name: game.i18n.format("SFRPG.Rolls.StarshipActions.Quadrant.Quadrant"),
                        options: options,
                        default: options[0]
                    }
                }
            );

            if (results.resolution === 'cancel') {
                return;
            }

            const selectedOption = options.indexOf(results.result.quadrant);
            if (selectedOption === 1) {
                quadrant = "Port";
            } else if (selectedOption === 2) {
                quadrant = "Starboard";
            } else if (selectedOption === 3) {
                quadrant = "Aft";
            } else {
                quadrant = "Forward";
            }
        }

        let selectedFormula = actionEntry.system.formula[0];
        if (actionEntry.system.formula.length > 1) {
            const results = await ChoiceDialog.show(
                game.i18n.format("SFRPG.Rolls.StarshipActions.Choice.Title", {name: actionEntry.name}),
                game.i18n.format("SFRPG.Rolls.StarshipActions.Choice.Message", {name: actionEntry.name}),
                {
                    roll: {
                        name: game.i18n.format("SFRPG.Rolls.StarshipActions.Choice.AvailableRolls"),
                        options: actionEntry.system.formula.map(x => x.name),
                        default: actionEntry.system.formula[0].name
                    }
                }
            );

            if (results.resolution === 'cancel') {
                return;
            }

            selectedFormula = actionEntry.system.formula.find(x => x.name === results.result.roll);
        }

        const rollContext = new RollContext();
        rollContext.addContext("ship", this);
        rollContext.setMainContext("ship");

        this.setupRollContexts(rollContext, actionEntry.system.selectors || []);

        /** Create additional modifiers. */
        const additionalModifiers = [
            {bonus: { name: game.i18n.format("SFRPG.Rolls.Starship.ComputerBonus"), modifier: "@ship.attributes.computer.value", enabled: false} },
            {bonus: { name: game.i18n.format("SFRPG.Rolls.Starship.CaptainDemand"), modifier: "4", enabled: false} },
            {bonus: { name: game.i18n.format("SFRPG.Rolls.Starship.CaptainEncouragement"), modifier: "2", enabled: false} },
            {bonus: { name: game.i18n.format("SFRPG.Rolls.Starship.ScienceOfficerLockOn"), modifier: "2", enabled: false} }
        ];
        rollContext.addContext("additional", {name: "additional"}, {modifiers: { bonus: "n/a", rolledMods: additionalModifiers } });

        let systemBonus = "";
        // Patch and Hold It Together are not affected by critical damage.
        if (actionEntry.name !== "Patch" && actionEntry.name !== "Hold It Together") {
            // Gunners must select a quadrant.
            if (actionEntry.system.role === "gunner") {
                systemBonus = ` + @ship.attributes.systems.weaponsArray${quadrant}.mod`;
                systemBonus += ` + @ship.attributes.systems.powerCore.modOther`;
            } else {
                for (const [key, value] of Object.entries(this.system.attributes.systems)) {
                    if (value.affectedRoles && value.affectedRoles[actionEntry.system.role]) {
                        if (key === "powerCore" && actionEntry.system.role !== "engineer") {
                            systemBonus += ` + @ship.attributes.systems.${key}.modOther`;
                        } else {
                            systemBonus += ` + @ship.attributes.systems.${key}.mod`;
                        }
                    }
                }
            }
        }

        const rollResult = await DiceSFRPG.createRoll({
            rollContext: rollContext,
            rollFormula: selectedFormula.formula + systemBonus + " + @additional.modifiers.bonus",
            title: game.i18n.format("SFRPG.Rolls.StarshipAction", {action: actionEntry.name})
        });

        if (!rollResult) {
            return;
        }

        let speakerActor = this;
        const roleKey = CONFIG.SFRPG.starshipRoleNames[actionEntry.system.role];
        let roleName = game.i18n.format(roleKey);

        const desiredKey = actionEntry.system.selectorKey;
        if (desiredKey) {
            const selectedContext = rollContext.allContexts[desiredKey];
            if (!selectedContext) {
                ui.notifications.error(game.i18n.format("SFRPG.Rolls.StarshipActions.NoActorError", {name: desiredKey}));
                return;
            }

            speakerActor = selectedContext?.entity || this;

            const actorRole = this.getCrewRoleForActor(speakerActor.id);
            if (actorRole) {
                const actorRoleKey = CONFIG.SFRPG.starshipRoleNames[actorRole];
                roleName = game.i18n.format(actorRoleKey);
            }
        }

        let flavor = "";
        flavor += game.i18n.format("SFRPG.Rolls.StarshipActions.Chat.Role", {role: roleName, name: this.name});
        flavor += "<br/>";
        if (actionEntry.system.formula.length <= 1) {
            flavor += `<h2>${actionEntry.name}</h2>`;
        } else {
            flavor += `<h2>${actionEntry.name} (${selectedFormula.name})</h2>`;
        }

        const dc = selectedFormula.dc || actionEntry.system.dc;
        if (dc) {
            if (dc.resolve) {
                const dcRoll = await DiceSFRPG.createRoll({
                    rollContext: rollContext,
                    rollFormula: dc.value,
                    mainDie: 'd0',
                    title: game.i18n.format("SFRPG.Rolls.StarshipAction", {action: actionEntry.name}),
                    dialogOptions: { skipUI: true }
                });

                flavor += `<p><strong>${game.i18n.format("SFRPG.Rolls.StarshipActions.Chat.DC")}: </strong>${dcRoll.roll.total}</p>`;
            } else {
                flavor += `<p><strong>${game.i18n.format("SFRPG.Rolls.StarshipActions.Chat.DC")}: </strong>${TextEditor.enrichHTML(dc.value, {async: false})}</p>`;
            }
        }

        flavor += `<p><strong>${game.i18n.format("SFRPG.Rolls.StarshipActions.Chat.NormalEffect")}: </strong>`;
        flavor += TextEditor.enrichHTML(selectedFormula.effectNormal || actionEntry.system.effectNormal, {async: false});
        flavor += "</p>";

        if (actionEntry.system.effectCritical) {
            const critEffectDisplayState = game.settings.get("sfrpg", "starshipActionsCrit");
            if (critEffectDisplayState !== 'never') {
                if (critEffectDisplayState === 'always' || rollResult.roll.dice[0].values[0] === 20) {
                    flavor += `<p><strong>${game.i18n.format("SFRPG.Rolls.StarshipActions.Chat.CriticalEffect")}: </strong>`;
                    flavor += TextEditor.enrichHTML(selectedFormula.effectCritical || actionEntry.system.effectCritical, {async: false});
                    flavor += "</p>";
                }
            }
        }

        const rollMode = game.settings.get("core", "rollMode");
        const preparedRollExplanation = DiceSFRPG.formatFormula(rollResult.formula.formula);
        const rollContent = await rollResult.roll.render({ breakdown: preparedRollExplanation });

        ChatMessage.create({
            flavor: flavor,
            speaker: ChatMessage.getSpeaker({ actor: speakerActor }),
            content: rollContent,
            rollMode: rollMode,
            roll: rollResult.roll,
            type: CONST.CHAT_MESSAGE_TYPES.ROLL,
            sound: CONFIG.sounds.dice
        });
    }

    /** Roll contexts */
    setupRollContexts(rollContext, desiredSelectors = []) {
        if (!this) {
            return;
        }

        const crewData = this.system.crew;
        const crewActorData = this.crew;

        const actorData = this;
        if (actorData.type === "vehicle") {
            if (!crewData.useNPCCrew) {
                /** Add player pilot if available. */
                if (crewActorData.pilot?.actors?.length > 0) {
                    const pilotActor = crewActorData.pilot.actors[0];
                    let pilotData = null;
                    if (pilotActor instanceof ActorSFRPG) {
                        pilotData = pilotActor.system;
                    } else {
                        pilotData = pilotActor.data;
                    }
                    rollContext.addContext("pilot", pilotActor, pilotData);
                }
            }
        }
        else if (actorData.type === "starship") {
            if (!crewData.useNPCCrew) {
                /** Add player captain if available. */
                if (crewActorData.captain?.actors?.length > 0) {
                    const actor = crewActorData.captain.actors[0];
                    let crewMemberActorData = null;
                    if (actor instanceof ActorSFRPG) {
                        crewMemberActorData = actor.system;
                    } else {
                        crewMemberActorData = actor.data;
                    }
                    rollContext.addContext("captain", actor, crewMemberActorData);
                }
        
                /** Add player pilot if available. */
                if (crewActorData.pilot?.actors?.length > 0) {
                    const actor = crewActorData.pilot.actors[0];
                    let crewMemberActorData = null;
                    if (actor instanceof ActorSFRPG) {
                        crewMemberActorData = actor.system;
                    } else {
                        crewMemberActorData = actor.data;
                    }
                    rollContext.addContext("pilot", actor, crewMemberActorData);
                }
        
                /** Add remaining roles if available. */
                const crewMates = ["gunner", "engineer", "chiefMate", "magicOfficer", "passenger", "scienceOfficer", "minorCrew", "openCrew"];
                const allCrewMates = ["minorCrew", "openCrew"];
                for (const crewType of crewMates) {
                    let crewCount = 1;
                    const crew = [];
                    if (allCrewMates.includes(crewType)) {
                        for (const crewEntries of Object.values(crewActorData)) {
                            const crewList = crewEntries.actors;
                            if (crewList && crewList.length > 0) {
                                for (const actor of crewList) {
                                    let crewMemberActorData = null;
                                    if (actor instanceof ActorSFRPG) {
                                        crewMemberActorData = actor.system;
                                    } else {
                                        crewMemberActorData = actor.data;
                                    }

                                    const contextId = crewType + crewCount;
                                    rollContext.addContext(contextId, actor, crewMemberActorData);
                                    crew.push(contextId);
                                    crewCount += 1;
                                }
                            }
                        }
                    } else {
                        const crewList = crewActorData[crewType].actors;
                        if (crewList && crewList.length > 0) {
                            for (const actor of crewList) {
                                let crewMemberActorData = null;
                                if (actor instanceof ActorSFRPG) {
                                    crewMemberActorData = actor.system;
                                } else {
                                    crewMemberActorData = actor.data;
                                }

                                const contextId = crewType + crewCount;
                                rollContext.addContext(contextId, actor, crewMemberActorData);
                                crew.push(contextId);
                                crewCount += 1;
                            }
                        }
                    }
        
                    if (desiredSelectors.includes(crewType)) {
                        rollContext.addSelector(crewType, crew);
                    }
                }
            } else {
                /** Create 'fake' actors. */
                rollContext.addContext("captain", this, actorData.system.crew.npcData.captain);
                rollContext.addContext("pilot", this, actorData.system.crew.npcData.pilot);
                rollContext.addContext("gunner", this, actorData.system.crew.npcData.gunner);
                rollContext.addContext("engineer", this, actorData.system.crew.npcData.engineer);
                rollContext.addContext("chiefMate", this, actorData.system.crew.npcData.chiefMate);
                rollContext.addContext("magicOfficer", this, actorData.system.crew.npcData.magicOfficer);
                rollContext.addContext("scienceOfficer", this, actorData.system.crew.npcData.scienceOfficer);
            }
        }
    }
}

Hooks.on("afterClosureProcessed", async (closureName, fact) => {
    if (closureName == "process-actors") {
        await fact.actor.processItemData();
    }
});
