/*
 * Zcord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Card } from "@components/Card";
import { HeadingTertiary } from "@components/Heading";
import { Margins } from "@components/margins";
import { Button, useEffect, useState } from "@webpack/common";

import {
    type HiddenChannelRecord,
    type HiddenChannelsDb,
    clearDb,
    exportDbJson,
    getDb,
    getDbStats,
    scanNow,
    subscribeDb
} from "../hiddenChannelsDb";

const TypeIcons: Record<number, string> = {
    0: "💬", // text
    2: "🔊", // voice
    4: "📁", // category
    5: "📢", // announcement
    13: "🎭", // stage
    15: "📋" // forum
};

function fmtDate(ts?: number | null) {
    if (!ts) return "—";
    try {
        return new Date(ts).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
    } catch {
        return "?";
    }
}

function ChannelRow({ record }: { record: HiddenChannelRecord; }) {
    const allowed = [
        ...record.allowedRoles.map(r => `🎭 ${r.name}`),
        ...record.allowedUsers.map(u => `👤 ${u.name}`)
    ];
    const denied = [
        ...record.deniedRoles.map(r => `🎭 ${r.name}`),
        ...record.deniedUsers.map(u => `👤 ${u.name}`)
    ];

    return (
        <div className="vc-shc-db-channel">
            <div className="vc-shc-db-channel-head">
                <span className="vc-shc-db-channel-name">
                    {TypeIcons[record.type] ?? "💬"} #{record.name}
                </span>
                <span className="vc-shc-db-channel-dates">
                    créé {fmtDate(record.createdTimestamp)} · dernier message {fmtDate(record.lastMessageTimestamp)}
                </span>
            </div>

            {record.topic &&
                <div className="vc-shc-db-channel-topic">📌 {record.topic}</div>}

            {(allowed.length > 0 || denied.length > 0) &&
                <div className="vc-shc-db-channel-perms">
                    {allowed.length > 0 && <div>✅ Accès : {allowed.join(", ")}</div>}
                    {denied.length > 0 && <div>🚫 Bloqué : {denied.join(", ")}</div>}
                </div>}
        </div>
    );
}

function HiddenChannelsDbPanel() {
    const [db, setDb] = useState<HiddenChannelsDb>(getDb());
    const [openGuild, setOpenGuild] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [armClear, setArmClear] = useState(false);

    useEffect(() => subscribeDb(() => setDb(getDb())), []);

    const guilds = Object.values(db.guilds)
        .map(g => ({ ...g, count: Object.keys(g.channels).length }))
        .sort((a, b) => b.count - a.count);
    const total = guilds.reduce((n, g) => n + g.count, 0);

    const handleRefresh = () => {
        const res = scanNow();
        setStatus(res.ok
            ? `✔ Actualisée : ${res.total} salons masqués dans ${res.guilds} serveurs`
            : "✖ Échec — vérifie que l'option « Activer la base » est cochée");
    };

    const handleExport = () => {
        const bytes = exportDbJson();
        setStatus(`✔ JSON exporté (${Math.max(1, Math.round(bytes / 1024))} Ko) — fichier « salons-masques-…json » téléchargé`);
    };

    const handleClear = async () => {
        if (!armClear) {
            setArmClear(true);
            setStatus("⚠ Confirme : reclique sur « Vider la base »");
            return;
        }
        await clearDb();
        setArmClear(false);
        setStatus("✔ Base vidée");
    };

    const stats = getDbStats();

    return (
        <Card className="vc-shc-db-card">
            <HeadingTertiary className={Margins.bottom8}>
                🗄 Base locale des salons masqués
            </HeadingTertiary>

            <div className="vc-shc-db-header">
                <span>
                    <b>{total}</b> salons masqués connus dans <b>{guilds.length}</b> serveurs
                    {stats.scanCount > 0 && <> · scan n°{stats.scanCount}</>}
                </span>
                <span className="vc-shc-db-muted">
                    Mise à jour : {stats.updatedAt ? fmtDate(stats.updatedAt) : "jamais"}
                </span>
                <span className="vc-shc-db-muted">
                    Métadonnées uniquement (noms, sujets, dates, rôles autorisés) — Discord
                    n'envoie jamais le contenu des messages masqués.
                </span>
            </div>

            <div className="vc-shc-db-actions">
                <Button size={Button.Sizes.SMALL} onClick={handleRefresh}>
                    Actualiser
                </Button>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.TRANSPARENT} onClick={handleExport}>
                    Exporter (JSON)
                </Button>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={handleClear}>
                    {armClear ? "Confirmer ?" : "Vider la base"}
                </Button>
                {status && <span className="vc-shc-db-status">{status}</span>}
            </div>

            {guilds.length === 0
                ? <div className="vc-shc-db-muted">Base vide — clique sur « Actualiser ».</div>
                : guilds.map(g => (
                    <div key={g.id} className="vc-shc-db-guild">
                        <button
                            type="button"
                            className="vc-shc-db-guild-toggle"
                            onClick={() => setOpenGuild(openGuild === g.id ? null : g.id)}
                        >
                            <span>🖥 {g.name}</span>
                            <span>
                                {g.count} salon{g.count > 1 ? "s" : ""} {openGuild === g.id ? "▲" : "▼"}
                            </span>
                        </button>

                        {openGuild === g.id &&
                            <div className="vc-shc-db-channels">
                                {Object.values(g.channels)
                                    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
                                    .map(c => <ChannelRow key={c.id} record={c} />)}
                            </div>}
                    </div>
                ))}
        </Card>
    );
}

export default function HiddenChannelsDbPanelWrapped() {
    return (
        <ErrorBoundary noop>
            <HiddenChannelsDbPanel />
        </ErrorBoundary>
    );
}
