const GoogleAuth = {
    async getUser() {
        const { googleUser } = await chrome.storage.local.get('googleUser');
        return googleUser || null;
    },

    async signIn() {
        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, async (token) => {
                if (chrome.runtime.lastError || !token) {
                    reject(chrome.runtime.lastError?.message || 'Sign in cancelled');
                    return;
                }
                try {
                    const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    if (!resp.ok) throw new Error('Failed to fetch user profile');
                    const user = await resp.json();
                    const userData = {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        picture: user.picture,
                        token
                    };
                    await chrome.storage.local.set({ googleUser: userData });
                    resolve(userData);
                } catch (err) {
                    chrome.identity.removeCachedAuthToken({ token }, () => {});
                    reject(err.message);
                }
            });
        });
    },

    async signOut() {
        const { googleUser } = await chrome.storage.local.get('googleUser');
        if (googleUser?.token) {
            await new Promise(resolve => {
                chrome.identity.removeCachedAuthToken({ token: googleUser.token }, resolve);
            });
            // Revoke token from Google's side
            await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${googleUser.token}`).catch(() => {});
        }
        await chrome.storage.local.remove('googleUser');
    }
};
