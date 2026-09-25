/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "HeaderBarAPI",
    description: "API to add buttons to the header bar and channel toolbar",
    authors: [Devs.Ven],

    // Patches titlebar désactivés : l'injection Discord 2026 cassait la barre
    // avec ErrorBoundary "Oh no!". Les plugins peuvent encore enregistrer des
    // boutons via l'API ; ils ne seront juste plus montés tant que le patch
    // n'est pas réécrit pour le layout actuel.
    patches: []
});
