import { world, system, EquipmentSlot, EntityComponentTypes } from "@minecraft/server";

// ================= НАСТРОЙКИ =================
const BLOCKS_PER_LEVEL = 100;
const MAX_LEVEL = 50;
const SPEED_PER_LEVEL = 0.02;
const MAX_AMPLIFIER = 5;
const TRACKER_ID = "speed:tracker";

// ================= АЧИВКИ =================
const ACHIEVEMENTS = {
    "first_step":   { name: "Первый шаг",        desc: "Пройди 1 блок",            needBlocks: 1 },
    "walker_100":   { name: "Ходок",             desc: "Пройди 100 блоков",         needBlocks: 100 },
    "walker_500":   { name: "Путник",            desc: "Пройди 500 блоков",         needBlocks: 500 },
    "walker_1000":  { name: "Странник",          desc: "Пройди 1000 блоков",        needBlocks: 1000 },
    "walker_5000":  { name: "Караванщик",        desc: "Пройди 5000 блоков",        needBlocks: 5000 },
    "walker_10000": { name: "Легенда дорог",     desc: "Пройди 10000 блоков",       needBlocks: 10000 },
    "level_5":      { name: "Разминка",          desc: "Достигни 5 уровня",         needLevel: 5 },
    "level_10":     { name: "Ускоряемся",        desc: "Достигни 10 уровня",        needLevel: 10 },
    "level_25":     { name: "Половина пути",     desc: "Достигни 25 уровня",        needLevel: 25 },
    "level_40":     { name: "Почти бог скорости",desc: "Достигни 40 уровня",        needLevel: 40 },
    "level_50":     { name: "Бог скорости",      desc: "Достигни 50 уровня",        needLevel: 50 },
    "night_walker": { name: "Ночной ходок",      desc: "Пройди 200 блоков ночью",   special: "night" },
    "marathon":     { name: "Марафонец",         desc: "Пройди 2000 блоков за раз", special: "marathon" }
};

// ================= ХРАНИЛИЩА ДАННЫХ =================
const playerData = new Map();
const nightBlocks = new Map();
const marathonData = new Map();

// ================= ЗАГРУЗКА / СОХРАНЕНИЕ =================
function loadData(player) {
    const raw = player.getDynamicProperty("speedwalk_data");
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            return {
                lastLocation: player.location,
                blocksWalked: parsed.blocksWalked || 0,
                level: parsed.level || 0,
                achieved: new Set(parsed.achieved || [])
            };
        } catch (e) { /* ignore */ }
    }
    return { lastLocation: player.location, blocksWalked: 0, level: 0, achieved: new Set() };
}

function saveData(player, data) {
    player.setDynamicProperty("speedwalk_data", JSON.stringify({
        blocksWalked: Math.floor(data.blocksWalked),
        level: data.level,
        achieved: Array.from(data.achieved)
    }));
}

// ================= ИНИЦИАЛИЗАЦИЯ =================
world.afterEvents.playerSpawn.subscribe((event) => {
    const player = event.player;
    
    // Ватермарка при первом входе
    if (!player.getDynamicProperty("author_shown")) {
        player.sendMessage("§6§l[SpeedWalk] §r§fMode by §e@Scanialove");
        player.setDynamicProperty("author_shown", true);
    }

    if (!playerData.has(player.name)) {
        playerData.set(player.name, loadData(player));
        nightBlocks.set(player.name, 0);
        marathonData.set(player.name, { startBlocks: 0 });
    } else {
        playerData.get(player.name).lastLocation = player.location;
    }
});

// ================= ВЫДАЧА АЧИВКИ =================
function grantAchievement(player, id) {
    const data = playerData.get(player.name);
    if (!data || data.achieved.has(id)) return;
    const ach = ACHIEVEMENTS[id];
    if (!ach) return;

    data.achieved.add(id);
    saveData(player, data);
    player.sendMessage(`§6[Ачивка] §e${ach.name} §7— ${ach.desc}`);
    player.playSound("random.levelup", { volume: 1, pitch: 1.2 });
    player.addExperience(50);
}

// ================= ПРОВЕРКА АЧИВОК =================
function checkAchievements(player, data) {
    for (const [id, ach] of Object.entries(ACHIEVEMENTS)) {
        if (data.achieved.has(id)) continue;
        if (ach.needBlocks && data.blocksWalked >= ach.needBlocks) grantAchievement(player, id);
        if (ach.needLevel && data.level >= ach.needLevel) grantAchievement(player, id);
        if (ach.special === "night" && (nightBlocks.get(player.name) || 0) >= 200) grantAchievement(player, id);
    }
}

// ================= ОСНОВНОЙ ЦИКЛ =================
system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
        if (!player.isValid()) continue;
        const data = playerData.get(player.name);
        if (!data) continue;

        // Проверка трекера в основной руке
        const equippable = player.getComponent(EntityComponentTypes.Equippable);
        if (!equippable) continue;

        const mainHand = equippable.getEquipment(EquipmentSlot.Mainhand);
        if (!mainHand || mainHand.typeId !== TRACKER_ID) {
            data.lastLocation = player.location;
            continue;
        }

        const current = player.location;
        const last = data.lastLocation;
        const dx = current.x - last.x;
        const dz = current.z - last.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        // Защита от телепортов
        if (distance > 10) { data.lastLocation = current; continue; }

        if (distance > 0.1) {
            data.blocksWalked += distance;
            data.lastLocation = current;

            // Ночные блоки
            const time = world.getTimeOfDay();
            if (time >= 13000 && time <= 23000) {
                nightBlocks.set(player.name, (nightBlocks.get(player.name) || 0) + distance);
            }

            // Марафон
            const mData = marathonData.get(player.name);
            if (data.blocksWalked - mData.startBlocks >= 2000) {
                grantAchievement(player, "marathon");
                mData.startBlocks = data.blocksWalked;
            }

            // Повышение уровня
            const newLevel = Math.min(Math.floor(data.blocksWalked / BLOCKS_PER_LEVEL), MAX_LEVEL);
            if (newLevel > data.level) {
                data.level = newLevel;
                const amplifier = Math.min(Math.floor(newLevel * SPEED_PER_LEVEL * 10), MAX_AMPLIFIER);
                player.addEffect("speed", 20 * 60, { amplifier: amplifier, showParticles: false });
                player.sendMessage(`§a[Уровень ${newLevel}] §fСкорость повышена!`);
                player.playSound("random.orb", { volume: 0.7, pitch: 1.5 });
            }

            checkAchievements(player, data);
            saveData(player, data);

            // HUD
            const progress = data.blocksWalked % BLOCKS_PER_LEVEL;
            const percent = Math.floor((progress / BLOCKS_PER_LEVEL) * 100);
            player.onScreenDisplay.setActionBar(
                `§eУр. ${data.level}/${MAX_LEVEL} §7| §f${Math.floor(data.blocksWalked)} блоков §7| §a${percent}% §7| §b🧭 Трекер`
            );
        }
    }
}, 20);

// ================= КОМАНДЫ =================
system.afterEvents.scriptEventReceive.subscribe((event) => {
    const player = event.sourceEntity;
    if (!player || player.typeId !== "minecraft:player") return;

    if (event.id === "speed:stats") {
        const data = playerData.get(player.name);
        if (!data) return;
        const progress = data.blocksWalked % BLOCKS_PER_LEVEL;
        player.sendMessage("§6===== Статистика =====");
        player.sendMessage(`§eУровень: §f${data.level}/${MAX_LEVEL}`);
        player.sendMessage(`§eБлоков пройдено: §f${Math.floor(data.blocksWalked)}`);
        player.sendMessage(`§eДо следующего уровня: §f${Math.floor(BLOCKS_PER_LEVEL - progress)}`);
        player.sendMessage(`§eАчивок: §f${data.achieved.size}/${Object.keys(ACHIEVEMENTS).length}`);
    }

    if (event.id === "speed:achievements") {
        const data = playerData.get(player.name);
        if (!data) return;
        player.sendMessage("§6===== Ачивки =====");
        for (const [id, ach] of Object.entries(ACHIEVEMENTS)) {
            const mark = data.achieved.has(id) ? "§a[✓]" : "§7[ ]";
            player.sendMessage(`${mark} §e${ach.name} §7— ${ach.desc}`);
        }
    }
});
