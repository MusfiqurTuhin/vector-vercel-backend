import { 
    checkConfig, 
    fetchGitHubJson, 
    writeGitHubJson, 
    modifyUsersDb, 
    verifyPassword, 
    hashPassword,
    handleCorsPreflight 
} from './helpers.js';

export default async function handler(req, res) {
    if (handleCorsPreflight(req, res)) return;
    if (!checkConfig(res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { email, password, sessionId } = req.body || {};
    if (!email || !password || !sessionId) {
        return res.status(400).json({ error: 'Missing email, password, or sessionId.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    try {
        // Fetch all users
        const usersDb = await fetchGitHubJson('users.json');
        const user = usersDb.content.users?.[normalizedEmail];

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Verify password
        const isMatched = verifyPassword(password, user.password);
        if (!isMatched) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Auto-migrate plain-text password to hashed password
        const passwordIsPlain = user.password.length !== 64 || !/^[a-f0-9]+$/i.test(user.password);
        if (passwordIsPlain) {
            try {
                await modifyUsersDb(content => {
                    const u = content.users[normalizedEmail];
                    if (u) {
                        u.password = hashPassword(password);
                    }
                }, `Security: Hash password for ${normalizedEmail}`);
            } catch (hashError) {
                console.warn('Failed to auto-migrate password hash:', hashError.message);
            }
        }

        // Resolve user configuration settings
        const systemSettings = usersDb.content.system_settings || {};
        const globalMedia = systemSettings.media_access || { images: true, files: true, audio: true };
        const modelAccess = Object.keys(systemSettings.models || {}).length
            ? { ...systemSettings.models }
            : (user.model_access || {});

        const isExpired = user.expiry_date ? (new Date(user.expiry_date).getTime() < Date.now()) : false;

        // Perform session registration (write session to users/{email}.json)
        const userFilePath = user.user_file || `users/${normalizedEmail}.json`;
        const limit = user.session_limit || 2;

        let userFileData = null;
        let fileSha = null;

        try {
            const fileResult = await fetchGitHubJson(userFilePath, { allowMissing: true });
            if (fileResult) {
                userFileData = fileResult.content;
                fileSha = fileResult.sha;
            }
        } catch (e) {
            console.warn('User file fetch error:', e.message);
        }

        if (!userFileData) {
            userFileData = { email: normalizedEmail, sessions: {} };
        }

        if (!userFileData.sessions || typeof userFileData.sessions !== 'object' || Array.isArray(userFileData.sessions)) {
            userFileData.sessions = {};
        }

        const nowIso = new Date().toISOString();
        userFileData.sessions[sessionId] = { last_login: nowIso };

        // Trim sessions to limit
        const sortedSessions = Object.entries(userFileData.sessions).sort((a, b) => {
            return new Date(a[1]?.last_login || 0).getTime() - new Date(b[1]?.last_login || 0).getTime();
        });

        if (sortedSessions.length > limit) {
            const trimmed = sortedSessions.slice(-limit);
            userFileData.sessions = Object.fromEntries(trimmed);
        }

        userFileData.active_session = sessionId;
        userFileData.last_login = nowIso;

        await writeGitHubJson(
            userFilePath,
            userFileData,
            fileSha,
            `Session: ${normalizedEmail} login (via Vercel)`
        );

        // Success response
        return res.status(200).json({
            success: true,
            status: user.status,
            email: normalizedEmail,
            role: user.role || 'user',
            user_file: userFilePath,
            model_access: modelAccess,
            media_access: globalMedia,
            auto_pilot: systemSettings.auto_pilot !== false,
            message_limit: systemSettings.message_limit === true,
            session_limit: limit,
            expiry_date: user.expiry_date || '',
            created_at: user.created_at || '',
            is_expired: isExpired,
            system_settings: systemSettings
        });

    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ error: 'Internal Server Error: ' + error.message });
    }
}
