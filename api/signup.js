import { 
    checkConfig, 
    modifyUsersDb, 
    hashPassword,
    handleCorsPreflight 
} from './helpers.js';

export default async function handler(req, res) {
    if (handleCorsPreflight(req, res)) return;
    if (!checkConfig(res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { email, password, refer } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    if (password.length < 5) {
        return res.status(400).json({ error: 'Password must be at least 5 characters.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    try {
        let isAlreadyRegistered = false;

        await modifyUsersDb(content => {
            if (!content.users) content.users = {};
            
            if (content.users[normalizedEmail]) {
                isAlreadyRegistered = true;
                return;
            }

            content.users[normalizedEmail] = {
                password: hashPassword(password.trim()),
                status: 'pending',
                role: 'user',
                refer_code: (refer || '').trim(),
                user_file: `users/${normalizedEmail}.json`,
                session_limit: 2, // Default session limit
                expiry_date: '',
                created_at: new Date().toISOString()
            };
        }, `New user signup: ${normalizedEmail} (via Vercel)`);

        if (isAlreadyRegistered) {
            return res.status(409).json({ error: 'Email already registered.' });
        }

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('Signup error:', error);
        return res.status(500).json({ error: 'Internal Server Error: ' + error.message });
    }
}
