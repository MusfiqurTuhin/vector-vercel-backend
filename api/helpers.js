import crypto from 'crypto';

// Retrieve environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

// Helper to check environment configuration
export function checkConfig(res) {
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        res.status(500).json({ error: 'Server misconfigured. GITHUB_TOKEN or GITHUB_REPO environment variables are missing.' });
        return false;
    }
    return true;
}

// Generate endpoints dynamically
export function getEndpoints(path = 'users.json') {
    const segments = path.split('/').map(segment => encodeURIComponent(segment)).join('/');
    return {
        contentsApi: `https://api.github.com/repos/${GITHUB_REPO}/contents/${segments}`,
        rawUrl: `https://raw.githubusercontent.com/${GITHUB_REPO}/refs/heads/main/${segments}`
    };
}

// Fetch JSON file from GitHub Contents API
export async function fetchGitHubJson(path, options = {}) {
    const urls = getEndpoints(path);
    const resp = await fetch(urls.contentsApi + '?t=' + Date.now(), {
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Vercel-Auth-Server'
        }
    });

    if (resp.status === 404 && options.allowMissing) {
        return null;
    }

    if (!resp.ok) {
        throw new Error(`GitHub read failed: ${resp.status}`);
    }

    const fileData = await resp.json();
    const contentBuffer = Buffer.from(fileData.content, 'base64');
    
    return {
        content: JSON.parse(contentBuffer.toString('utf8')),
        sha: fileData.sha
    };
}

// Write JSON file back to GitHub
export async function writeGitHubJson(path, content, sha, message) {
    const urls = getEndpoints(path);
    const body = {
        message: message || `Server update: ${path}`,
        content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64')
    };
    if (sha) {
        body.sha = sha;
    }

    const resp = await fetch(urls.contentsApi, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'Vercel-Auth-Server'
        },
        body: JSON.stringify(body)
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`GitHub write failed: ${resp.status} - ${err.message || ''}`);
    }

    return true;
}

// Atomic read-modify-write for users.json with retry logic
export async function modifyUsersDb(modifyFn, commitMessage) {
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const { content, sha } = await fetchGitHubJson('users.json');
            await modifyFn(content);
            await writeGitHubJson('users.json', content, sha, commitMessage);
            return content;
        } catch (error) {
            if (error.message.includes('409') && i < maxRetries - 1) {
                // Wait and retry on collision
                await new Promise(r => setTimeout(r, 600 + Math.random() * 800));
                continue;
            }
            throw error;
        }
    }
}

// Hash passwords using SHA-256 with a salt
export function hashPassword(password) {
    const salt = 'vector_secure_salt_2026'; // Static salt for password hashing migration
    return crypto.createHash('sha256').update(password + salt).digest('hex');
}

// Check password matching (support both plain text and SHA-256 hashed values)
export function verifyPassword(inputPassword, storedPasswordValue) {
    if (!storedPasswordValue) return false;
    
    // Check if stored password is a hash (length 64 for SHA-256 hex)
    const isHash = storedPasswordValue.length === 64 && /^[a-f0-9]+$/i.test(storedPasswordValue);
    
    if (isHash) {
        return hashPassword(inputPassword) === storedPasswordValue;
    }
    
    // Fallback to legacy plain-text match
    return inputPassword === storedPasswordValue;
}

// Handle OPTIONS (CORS preflight requests)
export function handleCorsPreflight(req, res) {
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return true;
    }
    return false;
}
