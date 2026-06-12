import { 
    checkConfig, 
    fetchGitHubJson, 
    modifyUsersDb, 
    verifyPassword, 
    handleCorsPreflight 
} from './helpers.js';

export default async function handler(req, res) {
    if (handleCorsPreflight(req, res)) return;
    if (!checkConfig(res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { adminEmail, adminPassword, targetEmail, action, limit, systemSettings } = req.body || {};
    if (!adminEmail || !adminPassword || !action) {
        return res.status(400).json({ error: 'Missing required parameters.' });
    }

    const normalizedAdminEmail = adminEmail.trim().toLowerCase();

    try {
        // Fetch all users to verify admin status
        const usersDb = await fetchGitHubJson('users.json');
        const adminUser = usersDb.content.users?.[normalizedAdminEmail];

        if (!adminUser || adminUser.role !== 'admin' || !verifyPassword(adminPassword, adminUser.password)) {
            return res.status(403).json({ error: 'Unauthorized. Admin credentials invalid.' });
        }

        if (action === 'list') {
            return res.status(200).json({
                success: true,
                users: usersDb.content.users || {},
                system_settings: usersDb.content.system_settings || {}
            });
        }

        // Perform the requested modification atomically inside users.json
        const updatedDb = await modifyUsersDb(content => {
            if (action === 'update_system_settings') {
                content.system_settings = systemSettings || {};
                return;
            }

            if (!targetEmail) {
                throw new Error('targetEmail is required for this action.');
            }

            const normalizedTargetEmail = targetEmail.trim().toLowerCase();
            const user = content.users?.[normalizedTargetEmail];

            if (!user && action !== 'remove') {
                throw new Error('Target user not found.');
            }

            switch (action) {
                case 'approve':
                    user.status = 'approved';
                    const approveExpiry = new Date();
                    approveExpiry.setDate(approveExpiry.getDate() + 30);
                    user.expiry_date = approveExpiry.toISOString().split('T')[0];
                    break;
                case 'extend':
                    const currentExpiry = user.expiry_date ? new Date(user.expiry_date) : new Date();
                    currentExpiry.setDate(currentExpiry.getDate() + 30);
                    user.expiry_date = currentExpiry.toISOString().split('T')[0];
                    break;
                case 'remove':
                    if (content.users) {
                        delete content.users[normalizedTargetEmail];
                    }
                    break;
                case 'set_session_limit':
                    const parsedLimit = parseInt(limit, 10);
                    user.session_limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 2;
                    break;
                default:
                    throw new Error('Unsupported admin action: ' + action);
            }
        }, `Admin: ${action} (via Vercel)`);

        return res.status(200).json({
            success: true,
            users: updatedDb.users || {},
            system_settings: updatedDb.system_settings || {}
        });

    } catch (error) {
        console.error('Admin action error:', error);
        return res.status(500).json({ error: 'Internal Server Error: ' + error.message });
    }
}
