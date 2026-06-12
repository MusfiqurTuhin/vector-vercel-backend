import { checkConfig, fetchGitHubJson, handleCorsPreflight } from './helpers.js';

export default async function handler(req, res) {
    if (handleCorsPreflight(req, res)) return;
    if (!checkConfig(res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { email, sessionId } = req.body || {};
    if (!email || !sessionId) {
        return res.status(400).json({ error: 'Email and sessionId are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    try {
        const usersDb = await fetchGitHubJson('users.json');
        const user = usersDb.content.users?.[normalizedEmail];

        if (!user || user.status !== 'approved' && user.status !== 'APPROVED') {
            return res.status(200).json({ success: true, valid: false, reason: 'unapproved' });
        }

        const isExpired = user.expiry_date ? (new Date(user.expiry_date).getTime() < Date.now()) : false;
        if (isExpired) {
            return res.status(200).json({ success: true, valid: false, reason: 'expired' });
        }

        const userFilePath = user.user_file || `users/${normalizedEmail}.json`;
        const userFileData = await fetchGitHubJson(userFilePath, { allowMissing: true });

        if (!userFileData || !userFileData.content || !userFileData.content.sessions) {
            // If the user file doesn't exist yet but user is approved, the session is considered valid (grace period)
            return res.status(200).json({ success: true, valid: true });
        }

        const sessions = userFileData.content.sessions;
        const isValid = !!sessions[sessionId];

        return res.status(200).json({ 
            success: true, 
            valid: isValid,
            reason: isValid ? '' : 'displaced'
        });

    } catch (error) {
        console.error('Session check error:', error);
        return res.status(500).json({ error: 'Internal Server Error: ' + error.message });
    }
}
