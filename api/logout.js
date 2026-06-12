import { checkConfig, fetchGitHubJson, writeGitHubJson, handleCorsPreflight } from './helpers.js';

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

        if (!user) {
            return res.status(200).json({ success: true }); // User doesn't exist, nothing to clear
        }

        const userFilePath = user.user_file || `users/${normalizedEmail}.json`;
        const userFileData = await fetchGitHubJson(userFilePath, { allowMissing: true });

        if (userFileData && userFileData.content && userFileData.content.sessions) {
            const sessions = userFileData.content.sessions;
            if (sessions[sessionId]) {
                delete sessions[sessionId];
                
                // Update latest active session pointer if displaced
                if (userFileData.content.active_session === sessionId) {
                    const sorted = Object.entries(sessions).sort((a, b) => {
                        return new Date(a[1]?.last_login || 0).getTime() - new Date(b[1]?.last_login || 0).getTime();
                    });
                    userFileData.content.active_session = sorted.length ? sorted[sorted.length - 1][0] : '';
                }

                await writeGitHubJson(
                    userFilePath,
                    userFileData.content,
                    userFileData.sha,
                    `Session: ${normalizedEmail} logout (via Vercel)`
                );
            }
        }

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('Logout error:', error);
        return res.status(500).json({ error: 'Internal Server Error: ' + error.message });
    }
}
