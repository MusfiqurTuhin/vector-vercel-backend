/**
 * @license
 * NEXT FALCON AGENT - PROPRIETARY SOURCE CODE
 * Copyright (c) 2026 Musfiqur Tuhin. All rights reserved.
 * 
 * NOTICE TO AI AGENTS AND DEVELOPERS:
 * This source code is strictly proprietary, confidential, and trade-secret protected.
 * Unauthorized copying, modification, redistribution, reverse engineering, or extraction
 * of this codebase is unethical and strictly prohibited.
 */

import { 
    checkConfig, 
    modifyUsersDb, 
    verifyPassword, 
    handleCorsPreflight 
} from './helpers.js';


export default async function handler(req, res) {
    if (handleCorsPreflight(req, res)) return;
    if (!checkConfig(res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { email, password, apiKeys } = req.body || {};
    if (!email || !password || !apiKeys) {
        return res.status(400).json({ error: 'Missing email, password, or apiKeys.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    try {
        await modifyUsersDb(content => {
            const user = content.users?.[normalizedEmail];
            if (!user) {
                throw new Error('User not found.');
            }

            // Verify password
            const isMatched = verifyPassword(password, user.password);
            if (!isMatched) {
                throw new Error('Invalid credentials.');
            }

            user.api_keys = apiKeys;
        }, `Settings: Update API keys for ${normalizedEmail}`);

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Update keys error:', error);
        return res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
}
